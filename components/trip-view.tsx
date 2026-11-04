"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Route as RouteIcon } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"
import { TransitMap, type MapLine, type MapMarker } from "@/components/transit-map"
import type { TripLegSummary } from "@/lib/local-agent"
import { pathBetween } from "@/lib/geo"
import { procedenciaCatalogo } from "@/lib/transmilenio"
import { tripSummaryStillValid, type TransmilenioData } from "@/lib/routes"

type TripViewProps = {
  legs: TripLegSummary[]
  data: TransmilenioData
  onOpenRoute: (code: string) => void
  onBack: () => void
}

/** Cada cuánto se revalida el plan mientras la pantalla sigue abierta. */
const REVALIDA_MS = 30_000

/** Plan de viaje que armó el asistente: uno o dos buses, en el mapa. */
export function TripView({ legs, data, onOpenRoute, onBack }: TripViewProps) {
  const station = (name: string) => data.stations.find((s) => s.name === name)

  // Revalida el resumen contra el catálogo y la evidencia ACTUAL antes de dar
  // órdenes de subir/bajar, y VUELVE a hacerlo mientras la pantalla siga
  // montada: el plan puede salir de su franja con el paso del tiempo. El tic
  // acotado (cada 30 s, sin framework) fuerza el recálculo; por eso la validez
  // no puede ser un useMemo que dependa solo de legs/data.
  const [tic, setTic] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTic((t) => t + 1), REVALIDA_MS)
    return () => clearInterval(id)
  }, [])
  const prescriptible = useMemo(
    () => tripSummaryStillValid(legs, data, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legs, data, tic],
  )

  // Solo el tramo que se recorre, de la estación donde se sube a la de bajada.
  const lines = useMemo<MapLine[]>(
    () =>
      legs.flatMap((leg, i) => {
        const route = data.routes.find((r) => r.code === leg.routeCode)
        if (!route) return []
        const board = data.stations.find((s) => s.name === leg.board)
        const alight = data.stations.find((s) => s.name === leg.alight)
        const path = board && alight ? pathBetween(route.path, board, alight) : route.path
        return [{ path, secondary: i > 0 }]
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

      {!prescriptible && (
        <p className="mt-4 rounded-2xl border-3 border-fail bg-card p-4 text-base" role="alert">
          No puedo confirmar las paradas de este recorrido con la evidencia actual, así que te muestro el trazado sin
          indicarte dónde subir o bajar. Verifica las paradas con TransMilenio antes de viajar.
        </p>
      )}

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
                {prescriptible ? (
                  <>
                    <span className="font-bold">
                      {i === 0 ? "Sube en" : "Cambia en"} {leg.board}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
                      Bájate en {leg.alight}
                    </span>
                    {leg.conteoVerificado && (
                      <span className="text-base text-muted-foreground">
                        {leg.stationsRidden} {leg.stationsRidden === 1 ? "estación" : "estaciones"}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="font-bold">Recorrido de la {leg.routeCode}</span>
                    <span className="flex items-center gap-1">
                      <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
                      pasa cerca de {leg.board} y {leg.alight}
                    </span>
                    <span className="text-base text-muted-foreground">Paradas sin confirmar</span>
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {prescriptible && (
        <p className="mt-4 rounded-2xl border-3 border-border bg-card p-4 text-base text-muted-foreground" role="note">
          Plan armado con paradas verificadas. No tengo los horarios en tiempo real; confirma que el servicio esté
          operando antes de salir.
        </p>
      )}

      <p className="mt-4 text-base text-muted-foreground" role="note">
        {procedenciaCatalogo(data)}
      </p>
    </section>
  )
}
