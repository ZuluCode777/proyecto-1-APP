"use client"

import type { FormEvent } from "react"
import { Search, X, Mic, Heart, Bus, PhoneCall, Zap, Navigation } from "lucide-react"

type PartialHomeProps = {
  query: string
  onQueryChange: (value: string) => void
  onSubmitSearch: () => void
  onVoice: () => void
  onFrequent: () => void
  onSearch: () => void
  onAssistance: () => void
  onGps: () => void
  fluor: boolean
  onToggleFluor: () => void
}

export function PartialHome({
  query,
  onQueryChange,
  onSubmitSearch,
  onVoice,
  onFrequent,
  onSearch,
  onAssistance,
  onGps,
  fluor,
  onToggleFluor,
}: PartialHomeProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmitSearch()
  }

  const actions = [
    { key: "frecuentes", label: "Rutas frecuentes", icon: Heart, onClick: onFrequent, brand: false },
    { key: "buscar", label: "Buscar rutas", icon: Bus, onClick: onSearch, brand: false },
    { key: "gps", label: "GPS auditivo", icon: Navigation, onClick: onGps, brand: false },
    { key: "asistencia", label: "Asistencia", icon: PhoneCall, onClick: onAssistance, brand: true },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <form onSubmit={handleSubmit} className="relative shrink-0" role="search">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar estación o ruta"
          aria-label="Buscar estación o ruta"
          className="w-full rounded-xl border-2 border-foreground bg-card py-3.5 pl-12 pr-20 text-lg outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Borrar búsqueda"
            className="absolute right-14 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onVoice}
          aria-label="Buscar con la voz"
          className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border-2 border-brand bg-brand text-brand-foreground"
        >
          <Mic className="size-5" aria-hidden="true" />
        </button>
      </form>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className="flex shrink-0 items-center justify-between gap-3 rounded-xl border-2 border-foreground bg-card px-4 py-2.5"
      >
        <span className="flex items-center gap-2 text-base font-bold">
          <Zap className="size-5 text-brand" aria-hidden="true" />
          Colores fluorescentes
        </span>
        <span
          aria-hidden="true"
          className={[
            "flex h-7 w-12 items-center rounded-full border-2 border-foreground p-0.5 transition-colors",
            fluor ? "justify-end bg-brand" : "justify-start bg-transparent",
          ].join(" ")}
        >
          <span className="size-5 rounded-full bg-foreground" />
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={[
                "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 p-2",
                action.brand
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-foreground bg-card",
              ].join(" ")}
            >
              <Icon className="size-7" aria-hidden="true" />
              <span className="text-lg font-bold">{action.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
