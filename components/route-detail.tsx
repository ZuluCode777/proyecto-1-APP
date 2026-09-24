"use client"

import { useEffect, useMemo } from "react"
import { Bus, Clock, Heart, Volume2 } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapMarker } from "@/components/transit-map"
import { useSpeech } from "@/hooks/use-speech"
import type { BusRoute, TransmilenioData } from "@/lib/routes"

type RouteDetailProps = {
  route: BusRoute
  data: TransmilenioData
  favorite: boolean
  onToggleFavorite: () => void
  onBack: () => void
}

const describe = (route: BusRoute) =>
  `Ruta ${route.code}, de ${route.from} hacia ${route.to}. Pasa por ${route.stops.length} estaciones. Entre semana opera de ${route.schedule.weekday || "horario no publicado"}.`

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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label={`Ruta ${route.code}`}>
      <ScreenHeader title={`Ruta ${route.code}`} subtitle={route.label} icon={Bus} onBack={onBack} />

      <TransitMap lines={lines} markers={markers} label={`Mapa del recorrido de la ruta ${route.code}`} className="h-72 shrink-0" />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => speak(describe(route))}
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card px-3 text-lg font-bold"
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
            "flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-lg font-bold",
            favorite ? "border-border bg-brand text-brand-foreground" : "border-border bg-card",
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
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
        <dt className="font-bold">Lunes a viernes</dt>
        <dd>{route.schedule.weekday || "No publicado"}</dd>
        <dt className="font-bold">Sábados</dt>
        <dd>{route.schedule.saturday || "No publicado"}</dd>
        <dt className="font-bold">Festivos</dt>
        <dd>{route.schedule.holiday || "No publicado"}</dd>
      </dl>

      <h3 className="mt-6 text-xl font-bold">Estaciones en el recorrido ({route.stops.length})</h3>
      <p className="text-base text-muted-foreground">
        Las estaciones por las que pasa el bus. Un servicio expreso no para en todas.
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {route.stops.map((stop, i) => (
          <li key={`${stop}-${i}`} className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-3 text-lg">
            <span className="w-8 shrink-0 text-right font-bold tabular-nums text-brand-ink">{i + 1}</span>
            {stop}
          </li>
        ))}
      </ol>
    </section>
  )
}
