"use client"

import type { FormEvent } from "react"
import { Search, X, Mic, Heart, Bus } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"

type PartialRoutesProps = {
  query: string
  onQueryChange: (value: string) => void
  onSubmitSearch: () => void
  onVoice: () => void
  onFrequent: () => void
  onBack: () => void
}

export function PartialRoutes({
  query,
  onQueryChange,
  onSubmitSearch,
  onVoice,
  onFrequent,
  onBack,
}: PartialRoutesProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmitSearch()
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4" aria-label="Rutas">
      <ScreenHeader title="Rutas" subtitle="Busca por estación o ruta" icon={Bus} onBack={onBack} />

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
          className="w-full rounded-2xl border-2 border-border bg-card py-5 pl-12 pr-28 text-lg shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-[3px]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Borrar búsqueda"
            className="absolute right-14 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-xl"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={onVoice}
          aria-label="Buscar con la voz"
          className="absolute right-1.5 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-xl border-[3px] border-border bg-brand text-brand-foreground"
        >
          <Mic className="size-5" aria-hidden="true" />
        </button>
      </form>

      <button
        type="button"
        onClick={onVoice}
        className="flex shrink-0 items-center justify-center gap-3 rounded-2xl border-[3px] border-border bg-brand py-4 text-lg font-bold text-brand-foreground shadow-sm transition active:scale-[0.99]"
      >
        <Mic className="size-6" aria-hidden="true" />
        Buscar hablando
      </button>

      <button
        type="button"
        onClick={onFrequent}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99]"
      >
        <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
          <Heart className="size-8" aria-hidden="true" />
        </span>
        <span className="text-xl font-bold">Rutas frecuentes</span>
        <span className="text-base text-muted-foreground">Tus rutas guardadas</span>
      </button>
    </section>
  )
}
