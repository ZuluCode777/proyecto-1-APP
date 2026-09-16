"use client"

import { ArrowLeft, Eye, ScanText, Zap } from "lucide-react"

type PartialToolsProps = {
  fluor: boolean
  onToggleFluor: () => void
  onVision: () => void
  onBack: () => void
}

export function PartialTools({ fluor, onToggleFluor, onVision, onBack }: PartialToolsProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4" aria-label="Ayudas visuales">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <h2 className="flex items-center gap-2 text-2xl font-bold">
        <Eye className="size-7 text-brand" aria-hidden="true" />
        Ayudas visuales
      </h2>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border-2 border-foreground bg-card px-4 py-4"
      >
        <span className="flex flex-col text-left">
          <span className="flex items-center gap-2 text-lg font-bold">
            <Zap className="size-5 text-brand" aria-hidden="true" />
            Colores fluorescentes
          </span>
          <span className="text-base text-muted-foreground">Resalta toda la interfaz</span>
        </span>
        <span
          aria-hidden="true"
          className={[
            "flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-foreground p-0.5 transition-colors",
            fluor ? "justify-end bg-brand" : "justify-start bg-transparent",
          ].join(" ")}
        >
          <span className="size-6 rounded-full bg-foreground" />
        </span>
      </button>

      <button
        type="button"
        onClick={onVision}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-foreground bg-card p-4"
      >
        <ScanText className="size-9" aria-hidden="true" />
        <span className="text-xl font-bold">Asistente de visión</span>
        <span className="text-center text-base text-muted-foreground">
          Usa la cámara para leer letreros con más contraste
        </span>
      </button>
    </section>
  )
}
