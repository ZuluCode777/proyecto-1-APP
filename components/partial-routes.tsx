"use client"

import type { FormEvent } from "react"
import { ArrowLeft, Search, X, Mic, Heart, Bus } from "lucide-react"

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
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <h2 className="flex items-center gap-2 text-2xl font-bold">
        <Bus className="size-7 text-brand" aria-hidden="true" />
        Rutas
      </h2>

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
          className="w-full rounded-xl border-2 border-foreground bg-card py-4 pl-12 pr-20 text-lg outline-none placeholder:text-muted-foreground"
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
        onClick={onVoice}
        className="flex shrink-0 items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-brand py-4 text-lg font-bold text-brand-foreground"
      >
        <Mic className="size-6" aria-hidden="true" />
        Buscar hablando
      </button>

      <button
        type="button"
        onClick={onFrequent}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-foreground bg-card p-4"
      >
        <Heart className="size-9" aria-hidden="true" />
        <span className="text-xl font-bold">Rutas frecuentes</span>
        <span className="text-base text-muted-foreground">Tus rutas guardadas</span>
      </button>
    </section>
  )
}
