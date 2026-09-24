"use client"

import { useMemo } from "react"
import { ArrowRight, Route as RouteIcon } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapLine, type MapMarker } from "@/components/transit-map"
import type { TripLegSummary } from "@/lib/local-agent"
import type { TransmilenioData } from "@/lib/routes"

type TripViewProps = {
  legs: TripLegSummary[]
  data: TransmilenioData
  onOpenRoute: (code: string) => void
  onBack: () => void
}

/** Plan de viaje que armó el asistente: uno o dos buses, en el mapa. */
export function TripView({ legs, data, onOpenRoute, onBack }: TripViewProps) {
  const station = (name: string) => data.stations.find((s) => s.name === name)

  const lines = useMemo<MapLine[]>(
    () =>
      legs.flatMap((leg, i) => {
        const route = data.routes.find((r) => r.code === leg.routeCode)
        return route ? [{ path: route.path, secondary: i > 0 }] : []
      }),
    [legs, data],
  )

  const markers = useMemo<MapMarker[]>(() => {
    const names = [legs[0].board, ...legs.map((l) => l.alight)]
    return names.flatMap((name) => {
      const s = station(name)
      return s ? [{ lat: s.lat, lng: s.lng, label: name, kind: "target" as const }] : []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, data])

  const first = legs[0]
  const last = legs[legs.length - 1]

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Plan de viaje">
      <ScreenHeader
        title="Plan de viaje"
        subtitle={`${first.board} → ${last.alight}`}
        icon={RouteIcon}
        onBack={onBack}
      />

      <TransitMap lines={lines} markers={markers} label="Mapa del plan de viaje" className="h-72 shrink-0" />

      <ol className="mt-4 flex flex-col gap-3">
        {legs.map((leg, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onOpenRoute(leg.routeCode)}
              className="flex w-full items-center gap-4 rounded-2xl border-3 border-border bg-card p-4 text-left"
            >
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border-3 border-border bg-brand text-xl font-bold text-brand-foreground">
                {leg.routeCode}
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-lg">
                <span className="font-bold">
                  {i === 0 ? "Sube en" : "Cambia en"} {leg.board}
                </span>
                <span className="flex items-center gap-1">
                  <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
                  Bájate en {leg.alight}
                </span>
                <span className="text-base text-muted-foreground">
                  {leg.stationsRidden} {leg.stationsRidden === 1 ? "estación" : "estaciones"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
