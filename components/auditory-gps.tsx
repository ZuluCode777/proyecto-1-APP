"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Navigation, MapPin, Volume2, Map, LocateFixed } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapMarker } from "@/components/transit-map"
import {
  bearingDegrees,
  cardinal,
  distanceMeters,
  relativeDirection,
  spokenDistance,
  type LatLng,
} from "@/lib/geo"
import { nearestStations, type StationWithDistance, type TransmilenioData } from "@/lib/routes"

type AuditoryGpsProps = {
  data: TransmilenioData
  onBack: () => void
}

type OrientationEventLike = DeviceOrientationEvent & {
  webkitCompassHeading?: number
}

type DeviceOrientationCtor = {
  requestPermission?: () => Promise<"granted" | "denied">
}

const ARRIVAL_METERS = 30

export function AuditoryGps({ data, onBack }: AuditoryGpsProps) {
  const { speak } = useSpeech()
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [target, setTarget] = useState<StationWithDistance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const arrivedRef = useRef(false)

  const nearby = useMemo(() => (position ? nearestStations(position, data, 4) : []), [position, data])

  const instruction = useCallback(
    (station: StationWithDistance, current: LatLng): string => {
      const dist = station.distance
      const bearing = bearingDegrees(current, { lat: station.lat, lng: station.lng })
      const where =
        heading != null ? relativeDirection(heading, bearing) : cardinal(bearing)
      return `${station.name} está a ${spokenDistance(dist)} ${where}.`
    },
    [heading],
  )

  const startOrientation = useCallback(() => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return
    const handler = (event: Event) => {
      const e = event as OrientationEventLike
      if (typeof e.webkitCompassHeading === "number") {
        setHeading(e.webkitCompassHeading)
      } else if (typeof e.alpha === "number") {
        setHeading((360 - e.alpha) % 360)
      }
    }
    const Ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationCtor
    if (typeof Ctor?.requestPermission === "function") {
      Ctor.requestPermission()
        .then((state) => {
          if (state === "granted") window.addEventListener("deviceorientation", handler)
        })
        .catch(() => {})
    } else {
      window.addEventListener("deviceorientationabsolute", handler)
      window.addEventListener("deviceorientation", handler)
    }
  }, [])

  const activate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Tu dispositivo no permite ubicación.")
      speak("Tu dispositivo no permite ubicación.")
      return
    }
    speak("Activando ubicación. Por favor acepta el permiso.")
    startOrientation()
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null)
        setActive(true)
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        setError("No pude obtener tu ubicación. Revisa los permisos.")
        speak("No pude obtener tu ubicación. Revisa los permisos.")
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  }, [speak, startOrientation])

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  // Anuncia la estación más cercana la primera vez que hay ubicación.
  const announcedRef = useRef(false)
  useEffect(() => {
    if (!position || announcedRef.current || nearby.length === 0) return
    announcedRef.current = true
    speak(
      `Ubicación lista. La estación más cercana es ${nearby[0].name}, a ${spokenDistance(nearby[0].distance)} ${cardinal(bearingDegrees(position, { lat: nearby[0].lat, lng: nearby[0].lng }))}.`,
    )
  }, [position, nearby, speak])

  // Aviso de llegada cuando el destino queda muy cerca.
  useEffect(() => {
    if (!target || !position) return
    const distance = distanceMeters(position, target)
    if (distance <= ARRIVAL_METERS && !arrivedRef.current) {
      arrivedRef.current = true
      speak(`Has llegado a ${target.name}. Estás a ${spokenDistance(distance)}.`)
    }
  }, [position, target, speak])

  const guideTo = useCallback(
    (station: StationWithDistance) => {
      if (!position) return
      arrivedRef.current = false
      setTarget(station)
      speak(`Te guío caminando a ${station.name}. ${instruction(station, position)}`)
    },
    [position, instruction, speak],
  )

  const repeat = useCallback(() => {
    if (!position) return
    if (target) {
      speak(instruction({ ...target, distance: distanceMeters(position, target) }, position))
    } else if (nearby.length > 0) {
      speak(instruction(nearby[0], position))
    }
  }, [position, target, nearby, instruction, speak])

  const openInMaps = useCallback(
    (station: StationWithDistance) => {
      if (!position) return
      const url = `https://www.google.com/maps/dir/?api=1&origin=${position.lat},${position.lng}&destination=${station.lat},${station.lng}&travelmode=walking`
      // Pestaña nueva: TransMiVoz sigue abierta detrás, con el destino elegido.
      window.open(url, "_blank", "noopener,noreferrer")
      speak(`Abrí la ruta a pie hacia ${station.name} en Google Maps, en otra pestaña.`)
    },
    [position, speak],
  )

  const mapMarkers = useMemo<MapMarker[]>(() => {
    if (!position) return []
    return [
      { ...position, label: "Tú estás aquí", kind: "user" as const },
      ...nearby.map((s) => ({
        lat: s.lat,
        lng: s.lng,
        label: s.name,
        kind: s.id === target?.id ? ("target" as const) : ("station" as const),
      })),
    ]
  }, [position, nearby, target])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="GPS auditivo">
      <ScreenHeader
        title="Mapa y GPS"
        subtitle="Te guío por voz a la estación más cercana"
        icon={Navigation}
        onBack={onBack}
      />

      {!active && (
        <button
          type="button"
          onClick={activate}
          className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-brand bg-brand p-6 text-brand-foreground shadow-lg shadow-brand/30 transition active:scale-[0.99]"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-foreground/15">
            <LocateFixed className="size-9" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold">Activar mi ubicación</span>
        </button>
      )}

      {error && (
        <p
          className="rounded-2xl border border-destructive bg-destructive/10 p-4 text-base font-bold text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {active && (
        <>
          <button
            type="button"
            onClick={repeat}
            className="mb-5 flex items-center justify-center gap-3 rounded-2xl border border-border bg-card p-4 text-lg font-bold shadow-sm transition active:scale-[0.99]"
          >
            <Volume2 className="size-6 text-brand" aria-hidden="true" />
            Repetir indicación
          </button>

          <TransitMap
            markers={mapMarkers}
            label="Mapa con tu ubicación y las estaciones cercanas"
            className="mb-5 h-64 shrink-0"
          />

          <h3 className="mb-3 text-xl font-bold" role="status">
            Estaciones cercanas
          </h3>
          <ul className="flex flex-col gap-3">
            {nearby.map((station) => {
              const isTarget = target?.id === station.id
              return (
                <li
                  key={station.id}
                  className={[
                    "rounded-2xl border p-4 shadow-sm",
                    isTarget ? "border-brand bg-brand-soft" : "border-border bg-card",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <MapPin className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold">{station.name}</p>
                      <p className="text-base text-muted-foreground">
                        A {spokenDistance(station.distance)}
                        {position
                          ? ` ${cardinal(bearingDegrees(position, { lat: station.lat, lng: station.lng }))}`
                          : ""}
                        {isTarget ? " · Guiando" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => guideTo(station)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-brand bg-brand px-4 py-3 text-base font-bold text-brand-foreground shadow-sm transition active:scale-[0.98]"
                    >
                      <Navigation className="size-5" aria-hidden="true" />
                      Guíame por voz
                    </button>
                    <button
                      type="button"
                      onClick={() => openInMaps(station)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-base font-bold shadow-sm transition active:scale-[0.98]"
                    >
                      <Map className="size-5 text-brand" aria-hidden="true" />
                      Abrir en Google Maps
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
