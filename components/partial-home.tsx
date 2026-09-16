"use client"

import type { FormEvent } from "react"
import { Search, X, Mic, Heart, Bus, PhoneCall } from "lucide-react"

type PartialHomeProps = {
  query: string
  onQueryChange: (value: string) => void
  onSubmitSearch: () => void
  onVoice: () => void
  onFrequent: () => void
  onSearch: () => void
  onAssistance: () => void
}

export function PartialHome({
  query,
  onQueryChange,
  onSubmitSearch,
  onVoice,
  onFrequent,
  onSearch,
  onAssistance,
}: PartialHomeProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmitSearch()
  }

  const actions = [
    { key: "frecuentes", label: "Rutas frecuentes", icon: Heart, onClick: onFrequent, brand: false },
    { key: "buscar", label: "Buscar rutas", icon: Bus, onClick: onSearch, brand: false },
    { key: "asistencia", label: "Asistencia", icon: PhoneCall, onClick: onAssistance, brand: true },
  ]

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 pb-6">
      <form onSubmit={handleSubmit} className="relative" role="search">
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
          className="w-full rounded-xl border-2 border-foreground bg-background py-4 pl-12 pr-12 text-lg outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Borrar búsqueda"
            className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
      </form>

      <button
        type="button"
        onClick={onVoice}
        aria-label="Buscar con la voz"
        className="mx-auto flex size-20 items-center justify-center rounded-full border-2 border-foreground"
      >
        <Mic className="size-9" aria-hidden="true" />
      </button>

      <div className="flex flex-col gap-4">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={[
                "flex flex-col items-center gap-2 rounded-2xl border-2 p-6",
                action.brand
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-foreground",
              ].join(" ")}
            >
              <Icon className="size-9" aria-hidden="true" />
              <span className="text-xl font-bold">{action.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
