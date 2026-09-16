"use client"

import { Bus, MapPin, ChevronRight } from "lucide-react"
import type { BusRoute } from "@/lib/routes"
import { useSpeech } from "@/hooks/use-speech"
import { ScreenHeader } from "@/components/screen-header"

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
      <ScreenHeader title={title} icon={Bus} onBack={onBack} />

      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Bus className="size-7" aria-hidden="true" />
          </span>
          <p className="text-lg text-muted-foreground" role="status">
            {emptyMessage}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
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
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.99]"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-lg font-bold text-brand">
                  {route.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-lg font-bold">
                    <Bus className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{route.from}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-base text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">hacia {route.to}</span>
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
