"use client"

import { Bus, ChevronRight, Database, MapPin } from "lucide-react"
import type { BusRoute } from "@/lib/routes"
import { useSpeech } from "@/hooks/use-speech"
import { ScreenHeader } from "@/components/screen-header"

type RouteListProps = {
  title: string
  routes: BusRoute[]
  emptyMessage: string
  /** Fecha de la consulta a TransMilenio, para citar la fuente. */
  fetchedAt?: string
  onOpen: (route: BusRoute) => void
  onBack: () => void
}

export function RouteList({ title, routes, emptyMessage, fetchedAt, onOpen, onBack }: RouteListProps) {
  const { speak } = useSpeech()

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label={title}>
      <ScreenHeader title={title} subtitle={`${routes.length} ${routes.length === 1 ? "ruta" : "rutas"}`} icon={Bus} onBack={onBack} />

      {fetchedAt && (
        <p className="mb-3 flex items-start gap-2 text-base text-muted-foreground">
          <Database className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          Datos abiertos de TransMilenio, consultados el {new Date(fetchedAt).toLocaleDateString("es-CO")}.
        </p>
      )}

      {routes.length === 0 ? (
        <p className="rounded-2xl border-3 border-border bg-card p-8 text-center text-xl" role="status">
          {emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {routes.map((route) => (
            <li key={route.id}>
              <button
                type="button"
                onFocus={() => speak(`Ruta ${route.code}, de ${route.from} hacia ${route.to}.`)}
                onClick={() => onOpen(route)}
                className="flex min-h-20 w-full items-center gap-4 rounded-2xl border-3 border-border bg-card p-4 text-left"
              >
                <span className="flex min-w-16 shrink-0 items-center justify-center rounded-xl border-3 border-border bg-brand px-2 py-3 text-xl font-bold text-brand-foreground">
                  {route.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-bold leading-snug">{route.from}</span>
                  <span className="mt-1 flex items-center gap-2 text-lg">
                    <MapPin className="size-5 shrink-0" aria-hidden="true" />
                    hacia {route.to}
                  </span>
                </span>
                <ChevronRight className="size-7 shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
