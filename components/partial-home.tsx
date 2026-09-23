"use client"

import { Bot, Bus, ChevronRight, Map, PhoneCall, ScanText, Zap } from "lucide-react"

type PartialHomeProps = {
  fluor: boolean
  onToggleFluor: () => void
  onAgent: () => void
  onRoutes: () => void
  onVision: () => void
  onGps: () => void
  onAssistance: () => void
}

/**
 * Inicio del modo baja visión: pocas opciones, grandes, con alto contraste.
 * Cada opción ocupa el ancho completo y al menos 72 px de alto.
 */
export function PartialHome({ fluor, onToggleFluor, onAgent, onRoutes, onVision, onGps, onAssistance }: PartialHomeProps) {
  const actions = [
    { key: "asistente", label: "Asistente", hint: "Pregunta cómo llegar", icon: Bot, onClick: onAgent, emphasis: false },
    { key: "rutas", label: "Rutas", hint: "Buscar y frecuentes", icon: Bus, onClick: onRoutes, emphasis: false },
    { key: "gps", label: "Mapa y GPS", hint: "Estaciones cercanas", icon: Map, onClick: onGps, emphasis: false },
    { key: "vision", label: "Lupa", hint: "Ampliar letreros", icon: ScanText, onClick: onVision, emphasis: false },
    { key: "asistencia", label: "Emergencia", hint: "Llamar al 123", icon: PhoneCall, onClick: onAssistance, emphasis: true },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
      <h2 className="text-2xl font-bold">¿Qué necesitas?</h2>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className={[
          "flex min-h-16 shrink-0 items-center justify-between gap-3 rounded-2xl border-2 px-4",
          fluor ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card",
        ].join(" ")}
      >
        <span className="flex items-center gap-3 text-xl font-bold">
          <Zap className="size-7 shrink-0" aria-hidden="true" />
          Alto contraste
        </span>
        <span className="text-lg font-bold">{fluor ? "Activado" : "Apagado"}</span>
      </button>

      {actions.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            className={[
              "flex min-h-[4.5rem] shrink-0 items-center gap-4 rounded-2xl border-2 px-4 text-left",
              action.emphasis ? "border-emergency bg-emergency text-white" : "border-border bg-card",
            ].join(" ")}
          >
            <Icon className="size-9 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-2xl font-bold leading-tight">{action.label}</span>
              <span className="text-lg leading-tight">{action.hint}</span>
            </span>
            <ChevronRight className="size-7 shrink-0" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
