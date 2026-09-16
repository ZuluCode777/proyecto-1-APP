"use client"

import { Bus, Navigation, PhoneCall, ScanText, Zap } from "lucide-react"

type PartialHomeProps = {
  fluor: boolean
  onToggleFluor: () => void
  onRoutes: () => void
  onVision: () => void
  onGps: () => void
  onAssistance: () => void
}

export function PartialHome({
  fluor,
  onToggleFluor,
  onRoutes,
  onVision,
  onGps,
  onAssistance,
}: PartialHomeProps) {
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
      key: "vision",
      label: "Asistente de visión",
      hint: "Leer letreros con la cámara",
      icon: ScanText,
      onClick: onVision,
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

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className={[
          "flex shrink-0 items-center justify-between gap-3 rounded-2xl border-2 px-5 py-3.5",
          fluor ? "border-brand bg-brand text-brand-foreground" : "border-foreground bg-card",
        ].join(" ")}
      >
        <span className="flex items-center gap-3 text-left">
          <Zap className="size-7 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-xl font-bold">Colores fluorescentes</span>
            <span
              className={[
                "text-base",
                fluor ? "text-brand-foreground/80" : "text-muted-foreground",
              ].join(" ")}
            >
              {fluor ? "Activados" : "Resalta la pantalla"}
            </span>
          </span>
        </span>
        <span
          aria-hidden="true"
          className={[
            "flex h-8 w-14 shrink-0 items-center rounded-full border-2 p-0.5 transition-colors",
            fluor ? "justify-end border-brand-foreground" : "justify-start border-foreground",
          ].join(" ")}
        >
          <span className={["size-6 rounded-full", fluor ? "bg-brand-foreground" : "bg-foreground"].join(" ")} />
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
