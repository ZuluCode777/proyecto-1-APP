"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Navigation, MapPin, Volume2, Map, LocateFixed } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapMarker } from "@/components/transit-map"
import { distanceMeters, spokenDistance } from "@/lib/geo"
import { MAX_ESTACIONES_CERCANAS, nearestStations, type StationWithDistance, type TransmilenioData } from "@/lib/routes"
import {
  EDAD_MAXIMA_POSICION_MS,
  cardinalHacia,
  decisionLlegada,
  horaDeEvento,
  leerPosicionNavegador,
  orientarHacia,
  ubicacionVigente,
  type LecturaRumbo,
  type LecturaUbicacion,
} from "@/lib/ubicacion"

type AuditoryGpsProps = {
  data: TransmilenioData
  onBack: () => void
}

type OrientationEventLike = DeviceOrientationEvent & {
  webkitCompassHeading?: number
  webkitCompassAccuracy?: number
  absolute?: boolean
}

type DeviceOrientationCtor = {
  requestPermission?: () => Promise<"granted" | "denied">
}

/** Recursos de UNA activación del GPS; su identidad distingue sesión vieja de nueva. */
type Sesion = {
  vivo: boolean
  watchId: number | null
  vencimiento: number | null
  quitarOrientacion: (() => void) | null
  /** Última lectura de rumbo CRUDA; se valida al producir una dirección, no al recibirla. */
  ultimoRumbo: LecturaRumbo | null
}

/** Aviso cuando la última ubicación ya venció y no hay una nueva aún. */
const UBICACION_VENCIDA = "Tu ubicación ya no está actualizada. Toca «Activar mi ubicación» para renovarla."

export function AuditoryGps({ data, onBack }: AuditoryGpsProps) {
  const { speak } = useSpeech()
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState<LecturaUbicacion | null>(null)
  const [target, setTarget] = useState<StationWithDistance | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * UNA sola suscripción por sesión, cancelable. Cada activación crea su PROPIO
   * objeto `Sesion` (su identidad): sus callbacks de posición, error y
   * orientación, y el permiso de orientación tardío, comprueban que su sesión
   * siga viva antes de cualquier efecto. Cerrar una sesión solo libera lo que
   * ella posee, así que un callback viejo no puede tocar el estado ni el
   * watcher de la sesión que lo reemplazó. Decisión EA-07 (#33): activar
   * repetido, salir, fallar o conceder permiso tarde no deja watchers,
   * listeners ni timers vivos.
   */
  const sesionRef = useRef<Sesion | null>(null)

  /** Evita repetir el aviso de proximidad una vez anunciado para el destino actual. */
  const arrivedRef = useRef(false)
  /** Evita repetir el anuncio de estación más cercana la primera vez. */
  const announcedRef = useRef(false)

  const ubicacionActual = ubicacionVigente(position) ?? null
  const nearby = useMemo(
    () => (ubicacionActual ? nearestStations(ubicacionActual, data, MAX_ESTACIONES_CERCANAS) : []),
    [ubicacionActual, data],
  )

  /**
   * Devuelve la ubicación VIGENTE (fresca) en el momento de usarla, o `null` si
   * venció o no hay. No presenta una coordenada vencida como ubicación actual:
   * orientar, repetir, la proximidad y Google Maps pasan por aquí. Si venció, lo
   * refleja en pantalla/voz en vez de guiar con datos viejos.
   */
  const ubicacionUsable = useCallback((): LecturaUbicacion | null => {
    const vigente = ubicacionVigente(position ?? undefined)
    return vigente ?? null
  }, [position])

  /**
   * Indicación de ORIENTACIÓN hacia una estación. Todo se valida AQUÍ, al
   * producir la dirección, con la lectura completa de posición (`current`, con
   * su precisión) y de rumbo (`ultimoRumbo`): solo con precisión suficiente Y
   * rumbo fiable hay un giro relativo. Con precisión desconocida o insuficiente,
   * o brújula no fiable, se da una referencia CARDINAL estimada con su límite;
   * si la estación cae dentro del margen de error de la ubicación no se da
   * dirección alguna. Es orientación, no un itinerario peatonal accesible. La
   * decisión es `orientarHacia` (`lib/ubicacion.ts`), la misma que responde
   * `POST /api/planificador` al iPhone.
   */
  const instruction = useCallback(
    (station: StationWithDistance, current: LecturaUbicacion): string =>
      orientarHacia(station, current, sesionRef.current?.ultimoRumbo).indicacion,
    [],
  )

  /** Dirección cardinal estimada para listas y anuncios; vacía si la estación cae dentro del margen de error. */
  const cardinalEstimado = (lectura: LecturaUbicacion, est: StationWithDistance): string => {
    const punto = cardinalHacia(lectura, est)
    return punto ? ` ${punto}` : ""
  }

  /**
   * Suscribe los oyentes de orientación UNA vez y GUARDA la última lectura cruda
   * en `sesionRef.ultimoRumbo` (grados, referencia y CALIDAD). No decide aquí si
   * es fiable: eso se hace al producir la dirección (`instruction`), con la hora
   * y calidad del momento de uso. Un evento sin valor usable INVALIDA el rumbo
   * previo (guarda `grados: null`), para no retener uno «bueno» ya viejo.
   *
   * Referencia: solo es ABSOLUTA con `webkitCompassHeading` (iOS) o cuando el
   * evento trae `absolute === true`. El nombre `deviceorientationabsolute` por sí
   * solo, con `absolute === false`, NO basta: se trata como relativa.
   */
  const startOrientation = useCallback((sesion: Sesion) => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return () => {}
    const handler = (event: Event) => {
      if (!sesion.vivo) return
      const e = event as OrientationEventLike
      // Hora de CAPTURA del evento, no de su recepción: un evento entregado tarde
      // llega vencido. Sin fecha verificable queda `null` (cae a cardinal).
      const hora = horaDeEvento(
        e.timeStamp,
        Date.now(),
        typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : null,
      )
      if (typeof e.webkitCompassHeading === "number") {
        // iOS: rumbo respecto al norte, con cota de error en `webkitCompassAccuracy`.
        sesion.ultimoRumbo = {
          grados: e.webkitCompassHeading,
          referencia: "absoluta",
          calidad: typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null,
          hora,
        }
      } else if (typeof e.alpha === "number") {
        // Sin calidad conocida (`null`): aunque la referencia sea absoluta, el
        // rumbo no se afirma fiable y cae a cardinal (ver `validarRumbo`).
        const esAbsoluto = e.absolute === true
        sesion.ultimoRumbo = {
          grados: (360 - e.alpha) % 360,
          referencia: esAbsoluto ? "absoluta" : "relativa",
          calidad: null,
          hora,
        }
      } else {
        // Evento sin dato de orientación: invalida el rumbo previo.
        sesion.ultimoRumbo = { grados: null, referencia: "relativa", calidad: null, hora }
      }
    }
    const Ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationCtor
    if (typeof Ctor?.requestPermission === "function") {
      let quitado = false
      const quitar = () => {
        quitado = true
        window.removeEventListener("deviceorientation", handler)
      }
      Ctor.requestPermission()
        .then((state) => {
          // Permiso tardío: solo si esta sesión sigue viva y no se canceló.
          if (state === "granted" && !quitado && sesion.vivo) window.addEventListener("deviceorientation", handler)
        })
        .catch(() => {})
      return quitar
    }
    window.addEventListener("deviceorientationabsolute", handler)
    window.addEventListener("deviceorientation", handler)
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler)
      window.removeEventListener("deviceorientation", handler)
    }
  }, [])

  /** Cierra los recursos de UNA sesión (no los de otra): watcher, oyentes y rumbo. Idempotente. */
  const cerrarSesion = useCallback((sesion: Sesion | null) => {
    if (!sesion) return
    sesion.vivo = false
    if (sesion.watchId != null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(sesion.watchId)
    }
    sesion.watchId = null
    if (sesion.vencimiento !== null) window.clearTimeout(sesion.vencimiento)
    sesion.vencimiento = null
    sesion.quitarOrientacion?.()
    sesion.quitarOrientacion = null
    sesion.ultimoRumbo = null
    if (sesionRef.current === sesion) sesionRef.current = null
  }, [])

  const activate = useCallback(() => {
    // UNA adquisición por sesión: una segunda pulsación no vuelve a pedir
    // permiso ni añade otro watcher/oyente. Se comprueba ANTES de pedir permisos.
    if (sesionRef.current) {
      if (position && !ubicacionVigente(position)) cerrarSesion(sesionRef.current)
      else {
        if (position) speak("La ubicación ya está activa.")
        return
      }
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Tu dispositivo no permite ubicación.")
      speak("Tu dispositivo no permite ubicación.")
      return
    }
    const sesion: Sesion = { vivo: true, watchId: null, vencimiento: null, quitarOrientacion: null, ultimoRumbo: null }
    sesionRef.current = sesion
    setError(null)
    speak("Activando ubicación. Por favor acepta el permiso.")
    sesion.quitarOrientacion = startOrientation(sesion)
    sesion.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Un callback de una sesión ya cerrada (desmontaje, fallo o reemplazada
        // por un reintento) no toca estado ni voz.
        if (!sesion.vivo) return
        const lectura = ubicacionVigente(leerPosicionNavegador(pos))
        if (!lectura || lectura.hora === null) return
        if (sesion.vencimiento !== null) window.clearTimeout(sesion.vencimiento)
        // `watchPosition` no garantiza otra captura antes de que venza la actual.
        const vencimiento = window.setTimeout(() => {
          if (!sesion.vivo || sesion.vencimiento !== vencimiento) return
          cerrarSesion(sesion)
          setActive(false)
          setPosition(null)
          setError(UBICACION_VENCIDA)
          speak(UBICACION_VENCIDA)
        }, Math.max(0, lectura.hora + EDAD_MAXIMA_POSICION_MS - Date.now() + 1))
        sesion.vencimiento = vencimiento
        setError(null)
        setActive(true)
        setPosition(lectura)
      },
      (err) => {
        if (!sesion.vivo) return
        // Fallo TERMINAL (permiso denegado, code 1): cierra SOLO esta sesión, lo
        // que libera la guardia para que la persona pueda reintentar.
        const denegado = typeof err?.code === "number" && err.code === 1
        cerrarSesion(sesion)
        setActive(false)
        setPosition(null)
        const msg = denegado
          ? "No diste permiso de ubicación. Puedes volver a tocar «Activar mi ubicación» para intentarlo otra vez."
          : "No pude obtener tu ubicación. Toca «Activar mi ubicación» para reintentar."
        setError(msg)
        speak(msg)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  }, [speak, startOrientation, cerrarSesion, position])

  // Limpieza ÚNICA al desmontar: cierra la sesión vigente (los callbacks tardíos
  // ya no tocan estado). La suscripción se hace en `activate` (por interacción),
  // no en un efecto, así que el doble montaje de StrictMode no crea dos watchers;
  // aun así, el cierre es idempotente.
  useEffect(() => () => cerrarSesion(sesionRef.current), [cerrarSesion])

  // Anuncia la estación más cercana la primera vez que hay ubicación VIGENTE. Es
  // orientación cardinal (dónde queda), no una promesa de acceso ni de llegada.
  useEffect(() => {
    if (announcedRef.current || nearby.length === 0) return
    const punto = ubicacionUsable()
    if (!punto) return
    announcedRef.current = true
    speak(`Ubicación lista. La estación más cercana es ${nearby[0].name}, a ${spokenDistance(nearby[0].distance)}${cardinalEstimado(punto, nearby[0])}.`)
  }, [nearby, ubicacionUsable, speak])

  // Aviso de proximidad: SOLO con ubicación VIGENTE y cuando la distancia Y la
  // precisión lo respaldan. Una lectura imprecisa (20 m con precisión 200 m) o
  // vencida nunca lo anuncia. Habla de CERCANÍA al punto de referencia, sin
  // prometer acceso peatonal.
  useEffect(() => {
    if (!target || arrivedRef.current) return
    const punto = ubicacionUsable()
    if (!punto) return
    const distancia = distanceMeters({ lat: punto.lat, lng: punto.lng }, target)
    if (decisionLlegada(punto, distancia).llego) {
      arrivedRef.current = true
      speak(`Estás muy cerca de ${target.name}, a unos ${spokenDistance(distancia)}. Busca el acceso de la estación; el punto es una referencia aproximada, no un acceso verificado.`)
    }
  }, [position, target, ubicacionUsable, speak])

  const guideTo = useCallback(
    (station: StationWithDistance) => {
      const punto = ubicacionUsable()
      if (!punto) {
        setError(UBICACION_VENCIDA)
        speak(UBICACION_VENCIDA)
        return
      }
      arrivedRef.current = false
      setTarget(station)
      speak(`Te oriento hacia ${station.name}. ${instruction(station, punto)} Para la ruta a pie, abre Google Maps; es una ruta aproximada al punto y la accesibilidad del acceso no está verificada.`)
    },
    [ubicacionUsable, instruction, speak],
  )

  const repeat = useCallback(() => {
    const punto = ubicacionUsable()
    if (!punto) {
      setError(UBICACION_VENCIDA)
      speak(UBICACION_VENCIDA)
      return
    }
    if (target) {
      speak(instruction({ ...target, distance: distanceMeters(punto, target) }, punto))
    } else if (nearby.length > 0) {
      speak(instruction(nearby[0], punto))
    }
  }, [ubicacionUsable, target, nearby, instruction, speak])

  const openInMaps = useCallback(
    (station: StationWithDistance) => {
      const punto = ubicacionUsable()
      if (!punto) {
        setError(UBICACION_VENCIDA)
        speak(UBICACION_VENCIDA)
        return
      }
      const url = `https://www.google.com/maps/dir/?api=1&origin=${punto.lat},${punto.lng}&destination=${station.lat},${station.lng}&travelmode=walking`
      // Pestaña nueva: TransMiVoz sigue abierta detrás, con el destino elegido.
      window.open(url, "_blank", "noopener,noreferrer")
      speak(`Abrí una ruta a pie APROXIMADA hacia ${station.name} en Google Maps, en otra pestaña. La accesibilidad del acceso no está verificada.`)
    },
    [ubicacionUsable, speak],
  )

  const mapMarkers = useMemo<MapMarker[]>(() => {
    if (!ubicacionActual) return []
    return [
      { lat: ubicacionActual.lat, lng: ubicacionActual.lng, label: "Tú estás aquí", kind: "user" as const },
      ...nearby.map((s) => ({
        lat: s.lat,
        lng: s.lng,
        label: s.name,
        kind: s.id === target?.id ? ("target" as const) : ("station" as const),
      })),
    ]
  }, [ubicacionActual, nearby, target])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="GPS auditivo">
      <ScreenHeader
        title="Mapa y GPS"
        subtitle="Te oriento por voz hacia la estación más cercana"
        icon={Navigation}
        onBack={onBack}
      />

      {(!active || !ubicacionActual) && (
        <button
          type="button"
          onClick={activate}
          className="flex flex-col items-center justify-center gap-3 rounded-3xl border-3 border-border bg-brand p-6 text-brand-foreground transition active:scale-[0.99]"
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-foreground/15">
            <LocateFixed className="size-9" aria-hidden="true" />
          </span>
          <span className="text-xl font-bold">Activar mi ubicación</span>
        </button>
      )}

      {error && (
        <p
          className="rounded-2xl border-3 border-fail bg-card p-4 text-lg font-bold"
          role="alert"
        >
          {error}
        </p>
      )}

      {active && !ubicacionActual && !error && <p role="alert">{UBICACION_VENCIDA}</p>}

      {active && ubicacionActual && (
        <>
          <button
            type="button"
            onClick={repeat}
            className="mb-5 flex items-center justify-center gap-3 rounded-2xl border-3 border-border bg-card p-4 text-lg font-bold shadow-sm transition active:scale-[0.99]"
          >
            <Volume2 className="size-6 text-brand-ink" aria-hidden="true" />
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
          {nearby.length === 0 ? (
            <p className="rounded-2xl border-3 border-border bg-card p-4 text-lg" role="status">
              No tengo estaciones de TransMilenio cargadas en este momento. Tu ubicación sí está activa; vuelve a
              intentarlo cuando se carguen las estaciones.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
            {nearby.map((station) => {
              const isTarget = target?.id === station.id
              return (
                <li
                  key={station.id}
                  className={[
                    "rounded-2xl border-3 border-border p-4 shadow-sm",
                    isTarget ? "bg-brand text-brand-foreground" : "bg-card",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                      <MapPin className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold">{station.name}</p>
                      <p className={isTarget ? "text-base" : "text-base text-muted-foreground"}>
                        A {spokenDistance(station.distance)}
                        {cardinalEstimado(ubicacionActual, station)}
                        {isTarget ? " · Orientando" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => guideTo(station)}
                      className={[
                        "flex items-center justify-center gap-2 rounded-xl border-3 border-border px-4 py-3 text-base font-bold shadow-sm transition active:scale-[0.98]",
                        // En la fila elegida (ya rellena de acento) el botón va en tarjeta para no fundirse.
                        isTarget ? "bg-card text-card-foreground" : "bg-brand text-brand-foreground",
                      ].join(" ")}
                    >
                      <Navigation className="size-5" aria-hidden="true" />
                      Oriéntame por voz
                    </button>
                    <button
                      type="button"
                      onClick={() => openInMaps(station)}
                      className="flex items-center justify-center gap-2 rounded-xl border-3 border-border bg-card px-4 py-3 text-base font-bold shadow-sm transition active:scale-[0.98]"
                    >
                      <Map className="size-5 text-brand-ink" aria-hidden="true" />
                      Abrir en Google Maps
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          )}
        </>
      )}
    </section>
  )
}
