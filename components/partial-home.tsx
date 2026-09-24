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
    // Un color distinto por botón, sin repetir el de la cabecera.
    { key: "asistente", label: "Asistente", hint: "Pregunta cómo llegar", icon: Bot, onClick: onAgent, fill: "bg-fill-agent", emergency: false },
    { key: "rutas", label: "Rutas", hint: "Buscar y frecuentes", icon: Bus, onClick: onRoutes, fill: "bg-fill-routes", emergency: false },
    { key: "gps", label: "Mapa y GPS", hint: "Estaciones cercanas", icon: Map, onClick: onGps, fill: "bg-fill-map", emergency: false },
    { key: "vision", label: "Lupa", hint: "Ampliar letreros", icon: ScanText, onClick: onVision, fill: "bg-fill-lens", emergency: false },
    // Emergencia va siempre al final, con el contorno más grueso.
    { key: "asistencia", label: "Emergencia", hint: "Llamar al 123", icon: PhoneCall, onClick: onAssistance, fill: "bg-sos", emergency: true },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
      <h2 className="rounded-2xl border-3 border-border bg-bar px-3 py-1.5 text-2xl font-extrabold">¿Qué necesitas?</h2>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className={[
          "flex min-h-16 shrink-0 items-center justify-between gap-3 rounded-2xl border-3 border-border px-4",
          fluor ? "bg-brand text-brand-foreground" : "bg-fill-switch",
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
              "flex min-h-[4.5rem] shrink-0 items-center gap-4 rounded-2xl px-4 text-left",
              action.emergency ? "border-5 border-sos-border text-sos-foreground" : "border-3 border-border",
              action.fill,
            ].join(" ")}
          >
            <Icon className="size-9 shrink-0" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-2xl font-extrabold leading-tight">{action.label}</span>
              <span className="text-lg font-semibold leading-tight">{action.hint}</span>
            </span>
            <ChevronRight className="size-7 shrink-0" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
