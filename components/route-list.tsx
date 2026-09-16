"use client"

import { ArrowLeft, Bus, MapPin } from "lucide-react"
import type { BusRoute } from "@/lib/routes"
import { useSpeech } from "@/hooks/use-speech"

type RouteListProps = {
  title: string
  routes: BusRoute[]
  emptyMessage: string
  onBack: () => void
}

export function RouteList({ title, routes, emptyMessage, onBack }: RouteListProps) {
  const { speak } = useSpeech()

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label={title}>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <h2 className="mb-4 text-2xl font-bold">{title}</h2>

      {routes.length === 0 ? (
        <p className="text-lg text-muted-foreground" role="status">
          {emptyMessage}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {routes.map((route) => (
            <li key={route.id}>
              <button
                type="button"
                onFocus={() =>
                  speak(`Ruta ${route.code}. ${route.label}. Paradas principales: ${route.stops.join(", ")}.`)
                }
                onClick={() =>
                  speak(`Ruta ${route.code}. ${route.label}. Paradas principales: ${route.stops.join(", ")}.`)
                }
                className="w-full rounded-2xl border-2 border-foreground p-4 text-left"
              >
                <span className="flex items-center gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border-2 border-foreground font-bold">
                    {route.code}
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-lg font-bold">
                      <Bus className="size-5 shrink-0" aria-hidden="true" />
                      {route.from}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-base text-muted-foreground">
                      <MapPin className="size-4 shrink-0" aria-hidden="true" />
                      hacia {route.to}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
