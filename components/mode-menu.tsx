"use client"

import { X, Eye, EyeOff, Check } from "lucide-react"
import { Modal } from "@/components/modal"
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
    title: "Baja visión",
    description: "Para personas con visión parcial. Texto e íconos grandes: buscar rutas, frecuentes y asistencia.",
    icon: Eye,
  },
  {
    value: "total",
    title: "Ceguera total",
    description: "Para personas totalmente ciegas. Sin mirar la pantalla: solo voz y escaneo guiados por audio.",
    icon: EyeOff,
  },
]

export function ModeMenu({ open, mode, onClose, onSelect }: ModeMenuProps) {
  return (
    <Modal open={open} onClose={onClose} label="Menú de modo de visualización" className="open:flex open:flex-col">
      <div className="flex items-center justify-between border-b-3 border-border bg-bar px-4 pb-3 pt-5">
        <h2 className="text-2xl font-bold tracking-tight">Modo de visualización</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar menú"
          className="flex size-12 items-center justify-center rounded-2xl border-3 border-border bg-bar transition active:scale-95"
        >
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {options.map((option) => {
          const Icon = option.icon
          const active = option.value === mode
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={active}
              className={[
                "flex items-start gap-4 rounded-2xl border-3 border-border p-4 text-left",
                active ? "bg-brand text-brand-foreground" : "bg-card",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                  active ? "border-3 border-current" : "bg-brand-soft text-brand-ink",
                ].join(" ")}
              >
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2 text-2xl font-bold">
                  {option.title}
                  {active && <Check className="size-5" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-lg">
                  {option.description}
                </span>
                {active && <span className="sr-only">Modo activo</span>}
              </span>
            </button>
          )
        })}
        <a href="/diagnostico" className="mt-2 rounded-2xl border-3 border-border bg-card p-4 text-center text-xl font-bold">
          Diagnóstico: comprobar que todo funciona
        </a>
      </div>
    </Modal>
  )
}
