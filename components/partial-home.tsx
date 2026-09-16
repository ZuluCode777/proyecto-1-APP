"use client"

import { Bus, Eye, Navigation, PhoneCall } from "lucide-react"

type PartialHomeProps = {
  onRoutes: () => void
  onTools: () => void
  onGps: () => void
  onAssistance: () => void
}

export function PartialHome({ onRoutes, onTools, onGps, onAssistance }: PartialHomeProps) {
  const actions = [
    {
      key: "rutas",
      label: "Rutas",
      hint: "Buscar y ver rutas frecuentes",
      icon: Bus,
      onClick: onRoutes,
      brand: false,
    },
    {
      key: "ayudas",
      label: "Ayudas visuales",
      hint: "Contraste y lectura con cámara",
      icon: Eye,
      onClick: onTools,
      brand: false,
    },
    {
      key: "gps",
      label: "GPS auditivo",
      hint: "Camina a estaciones cercanas",
      icon: Navigation,
      onClick: onGps,
      brand: false,
    },
    {
      key: "asistencia",
      label: "Asistencia",
      hint: "Líneas de emergencia",
      icon: PhoneCall,
      onClick: onAssistance,
      brand: true,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <h2 className="shrink-0 pt-1 text-xl font-bold">¿Qué necesitas?</h2>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={[
                "flex flex-1 items-center gap-4 rounded-2xl border-2 px-5 text-left",
                action.brand
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-foreground bg-card",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-14 shrink-0 items-center justify-center rounded-xl border-2",
                  action.brand ? "border-brand-foreground" : "border-foreground",
                ].join(" ")}
              >
                <Icon className="size-7" aria-hidden="true" />
              </span>
              <span className="flex flex-col">
                <span className="text-xl font-bold">{action.label}</span>
                <span
                  className={[
                    "text-base",
                    action.brand ? "text-brand-foreground/80" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {action.hint}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
