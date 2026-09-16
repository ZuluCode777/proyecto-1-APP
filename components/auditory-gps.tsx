"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Navigation, MapPin, Volume2, Map, LocateFixed } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"
import {
  bearingDegrees,
  cardinal,
  relativeDirection,
  spokenDistance,
  type LatLng,
} from "@/lib/geo"
import { nearestStations, type StationWithDistance } from "@/lib/routes"

type AuditoryGpsProps = {
  onBack: () => void
}

type OrientationEventLike = DeviceOrientationEvent & {
  webkitCompassHeading?: number
}

type DeviceOrientationCtor = {
  requestPermission?: () => Promise<"granted" | "denied">
}

const ARRIVAL_METERS = 30

export function AuditoryGps({ onBack }: AuditoryGpsProps) {
  const { speak } = useSpeech()
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [target, setTarget] = useState<StationWithDistance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const arrivedRef = useRef(false)

  const nearby = position ? nearestStations(position, 4) : []

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
    const fresh = nearestStations(position, 20).find((s) => s.id === target.id)
    if (fresh && fresh.distance <= ARRIVAL_METERS && !arrivedRef.current) {
      arrivedRef.current = true
      speak(`Has llegado a ${target.name}. Estás a ${spokenDistance(fresh.distance)}.`)
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
      const fresh =
        nearestStations(position, 20).find((s) => s.id === target.id) ?? target
      speak(instruction(fresh, position))
    } else if (nearby.length > 0) {
      speak(instruction(nearby[0], position))
    }
  }, [position, target, nearby, instruction, speak])

  const openInMaps = useCallback(
    (station: StationWithDistance) => {
      if (!position) return
      const url = `https://www.google.com/maps/dir/?api=1&origin=${position.lat},${position.lng}&destination=${station.lat},${station.lng}&travelmode=walking`
      if (window.self !== window.top) {
        window.open(url, "_blank", "noopener,noreferrer")
      } else {
        window.location.href = url
      }
      speak(`Abriendo la ruta a pie hacia ${station.name} en Google Maps.`)
    },
    [position, speak],
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="GPS auditivo">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <h2 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Navigation className="size-6 text-brand" aria-hidden="true" />
        GPS auditivo
      </h2>
      <p className="mb-4 text-base text-muted-foreground">
        Te digo en voz alta tu ubicación y te guío caminando a las estaciones cercanas.
      </p>

      {!active && (
        <button
          type="button"
          onClick={activate}
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-brand p-6 text-brand-foreground"
        >
          <LocateFixed className="size-10" aria-hidden="true" />
          <span className="text-xl font-bold">Activar mi ubicación</span>
        </button>
      )}

      {error && (
        <p className="rounded-xl border-2 border-destructive p-4 text-base font-bold text-destructive" role="alert">
          {error}
        </p>
      )}

      {active && (
        <>
          <button
            type="button"
            onClick={repeat}
            className="mb-4 flex items-center justify-center gap-3 rounded-2xl border-2 border-foreground bg-card p-4 text-lg font-bold"
          >
            <Volume2 className="size-6 text-brand" aria-hidden="true" />
            Repetir indicación
          </button>

          <h3 className="mb-3 text-lg font-bold" role="status">
            Estaciones cercanas
          </h3>
          <ul className="flex flex-col gap-4">
            {nearby.map((station) => {
              const isTarget = target?.id === station.id
              return (
                <li
                  key={station.id}
                  className={[
                    "rounded-2xl border-2 p-4",
                    isTarget ? "border-brand bg-card" : "border-foreground",
                  ].join(" ")}
                >
                  <p className="flex items-center gap-2 text-lg font-bold">
                    <MapPin className="size-5 shrink-0 text-brand" aria-hidden="true" />
                    {station.name}
                  </p>
                  <p className="mb-3 mt-1 text-base text-muted-foreground">
                    A {spokenDistance(station.distance)}
                    {position
                      ? ` ${cardinal(bearingDegrees(position, { lat: station.lat, lng: station.lng }))}`
                      : ""}
                    {isTarget ? " · Guiando" : ""}
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => guideTo(station)}
                      className="flex items-center justify-center gap-2 rounded-xl border-2 border-brand bg-brand px-4 py-3 text-base font-bold text-brand-foreground"
                    >
                      <Navigation className="size-5" aria-hidden="true" />
                      Guíame por voz
                    </button>
                    <button
                      type="button"
                      onClick={() => openInMaps(station)}
                      className="flex items-center justify-center gap-2 rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
                    >
                      <Map className="size-5" aria-hidden="true" />
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
