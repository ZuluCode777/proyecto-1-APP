"use client"

import { useEffect, useMemo } from "react"
import { Bus, Clock, Heart, Volume2 } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapMarker } from "@/components/transit-map"
import { useSpeech } from "@/hooks/use-speech"
import { calendarioOperaEnFecha, rutaConParadasVerificadas } from "@/lib/evidencia"
import type { BusRoute, TransmilenioData } from "@/lib/routes"

type RouteDetailProps = {
  route: BusRoute
  data: TransmilenioData
  favorite: boolean
  onToggleFavorite: () => void
  onBack: () => void
}

const describe = (route: BusRoute, now: Date = new Date()) => {
  const sentido =
    route.directionEvidence.agreement === "contradictorio"
      ? `con sentido declarado de ${route.from} hacia ${route.to}, aún sin confirmar porque el orden de las estaciones no coincide`
      : `de ${route.from} hacia ${route.to}`
  // Operación: solo se afirma con calendario verificado; el horario textual no.
  const operacion = route.verifiedCalendar
    ? calendarioOperaEnFecha(route.verifiedCalendar, now)
      ? " Según su calendario verificado, hoy opera; confirma el horario antes de salir."
      : " Según su calendario verificado, hoy no tiene servicio programado."
    : route.schedule.weekday
      ? ` Su horario publicado entre semana es ${route.schedule.weekday}, pero no tengo calendario verificado para confirmar que opere ahora.`
      : " No tengo horario publicado ni calendario verificado."
  const paradas = rutaConParadasVerificadas(route, now)
    ? ""
    : " Aún no tengo confirmado en qué estaciones para, así que no uses el recorrido como paradas de abordaje."
  return `Ruta ${route.code}, ${sentido}. Su recorrido pasa cerca de ${route.stops.length} estaciones.${paradas}${operacion}`
}

/** Recorrido de una ruta en el mapa, con sus estaciones y horarios. */
export function RouteDetail({ route, data, favorite, onToggleFavorite, onBack }: RouteDetailProps) {
  const { speak } = useSpeech()

  useEffect(() => {
    speak(describe(route), { queue: true })
  }, [route, speak])

  const markers = useMemo<MapMarker[]>(
    () =>
      route.stops.flatMap((name, i) => {
        const station = data.stations.find((s) => s.name === name)
        if (!station) return []
        const endpoint = i === 0 || i === route.stops.length - 1
        return [{ lat: station.lat, lng: station.lng, label: name, kind: endpoint ? "target" : "station" }]
      }),
    [route, data],
  )
  const lines = useMemo(() => [{ path: route.path }], [route])

  // Paradas atendidas prescriptibles (fuente/estado/fecha válidos), para marcarlas.
  const verified = useMemo(() => {
    const now = new Date()
    if (!rutaConParadasVerificadas(route, now)) return new Set<string>()
    return new Set(route.servedStops.filter((s) => s.canBoard || s.canAlight).map((s) => s.name))
  }, [route])
  const operaHoy = useMemo(() => calendarioOperaEnFecha(route.verifiedCalendar, new Date()), [route])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label={`Ruta ${route.code}`}>
      <ScreenHeader title={`Ruta ${route.code}`} subtitle={route.label} icon={Bus} onBack={onBack} />

      <TransitMap lines={lines} markers={markers} label={`Mapa del recorrido de la ruta ${route.code}`} className="h-72 shrink-0" />

      {route.directionEvidence.agreement === "contradictorio" && (
        <p className="mt-4 rounded-2xl border-3 border-border bg-card p-4 text-base" role="note">
          El sentido declarado ({route.from} hacia {route.to}) no coincide con el orden de las estaciones del
          recorrido. No está confirmado con una fuente vigente; verifica la dirección antes de guiarte por ella.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => speak(describe(route))}
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-3 border-border bg-card px-3 text-lg font-bold"
        >
          <Volume2 className="size-6 text-brand-ink" aria-hidden="true" />
          Escuchar
        </button>
        <button
          type="button"
          onClick={() => {
            onToggleFavorite()
            speak(favorite ? `Quité la ${route.code} de tus frecuentes.` : `Guardé la ${route.code} en tus frecuentes.`)
          }}
          aria-pressed={favorite}
          className={[
            "flex min-h-14 items-center justify-center gap-2 rounded-2xl border-3 border-border px-3 text-lg font-bold",
            favorite ? "bg-brand text-brand-foreground" : "bg-card",
          ].join(" ")}
        >
          <Heart className="size-6" aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
          {favorite ? "Guardada" : "Guardar"}
        </button>
      </div>

      <h3 className="mt-6 flex items-center gap-2 text-xl font-bold">
        <Clock className="size-6 text-brand-ink" aria-hidden="true" />
        Horario
      </h3>
      <p className="text-base text-muted-foreground">
        {route.verifiedCalendar
          ? operaHoy
            ? "Según el calendario verificado, hoy opera. Confirma el horario antes de salir."
            : "Según el calendario verificado, hoy no tiene servicio programado."
          : "Horario publicado por TransMilenio, no un calendario verificado. No confirma operación ahora."}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        <dt className="font-bold">Lunes a viernes</dt>
        <dd>{route.schedule.weekday || "No publicado"}</dd>
        <dt className="font-bold">Sábados</dt>
        <dd>{route.schedule.saturday || "No publicado"}</dd>
        <dt className="font-bold">Festivos</dt>
        <dd>{route.schedule.holiday || "No publicado"}</dd>
      </dl>

      <h3 className="mt-6 text-xl font-bold">Estaciones cercanas al trazado ({route.stops.length})</h3>
      <p className="text-base text-muted-foreground">
        {verified.size > 0
          ? "Las estaciones por las que pasa el bus. Las marcadas como parada verificada son donde una fuente confirma que se puede subir o bajar."
          : "Las estaciones por las que pasa el bus. Aún no hay una fuente que confirme en cuáles para; no uses esta lista como paradas de abordaje."}
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {route.stops.map((stop, i) => {
          const isVerified = verified.has(stop)
          return (
            <li key={`${stop}-${i}`} className="flex items-center gap-3 rounded-xl border-3 border-border bg-card px-4 py-3 text-lg">
              <span className="w-8 shrink-0 text-right font-bold tabular-nums text-brand-ink">{i + 1}</span>
              <span className="flex-1">{stop}</span>
              {isVerified && (
                <span className="shrink-0 rounded-full border-3 border-border px-2 py-0.5 text-sm font-semibold">
                  Parada verificada
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
