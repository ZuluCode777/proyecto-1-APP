"use client"

import { useEffect, useRef } from "react"
import { X, Eye, EyeOff, Check } from "lucide-react"
import type { Mode } from "@/components/transmivoz-app"

type ModeMenuProps = {
  open: boolean
  mode: Mode
  onClose: () => void
  onSelect: (mode: Mode) => void
}

const options: { value: Mode; title: string; description: string; icon: typeof Eye }[] = [
  {
    value: "parcial",
    title: "Visión parcial",
    description: "Buscar rutas, rutas frecuentes y asistencia con texto e íconos grandes.",
    icon: Eye,
  },
  {
    value: "total",
    title: "Visión total",
    description: "Solo hablar y escanear, guiado por voz.",
    icon: EyeOff,
  },
]

export function ModeMenu({ open, mode, onClose, onSelect }: ModeMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Menú de modo de visualización"
    >
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h2 className="text-xl font-bold">Modo de visualización</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar menú"
          className="flex size-12 items-center justify-center rounded-xl border-2 border-foreground"
        >
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div ref={panelRef} tabIndex={-1} className="flex flex-col gap-4 p-4 outline-none">
        {options.map((option) => {
          const Icon = option.icon
          const active = option.value === mode
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={active}
              className="flex items-start gap-4 rounded-2xl border-2 border-foreground p-5 text-left"
            >
              <Icon className="mt-1 size-8 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                <span className="flex items-center gap-2 text-lg font-bold">
                  {option.title}
                  {active && <Check className="size-5 text-brand" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-base text-muted-foreground">
                  {option.description}
                </span>
                {active && <span className="sr-only">Modo activo</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
