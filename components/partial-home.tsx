"use client"

import { Bus, Navigation, PhoneCall, ScanText, Zap, ChevronRight } from "lucide-react"

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
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4 pt-2">
      <h2 className="shrink-0 text-xl font-bold tracking-tight">¿Qué necesitas?</h2>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        onClick={onToggleFluor}
        className={[
          "flex shrink-0 items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 shadow-sm transition active:scale-[0.99]",
          fluor
            ? "border-brand bg-brand text-brand-foreground"
            : "border-border bg-card",
        ].join(" ")}
      >
        <span className="flex items-center gap-3 text-left">
          <span
            className={[
              "flex size-11 shrink-0 items-center justify-center rounded-xl",
              fluor ? "bg-brand-foreground/15 text-brand-foreground" : "bg-brand-soft text-brand",
            ].join(" ")}
          >
            <Zap className="size-6" aria-hidden="true" />
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-bold">Colores fluorescentes</span>
            <span
              className={[
                "text-sm",
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
            "flex h-8 w-14 shrink-0 items-center rounded-full p-0.5 transition-colors",
            fluor ? "justify-end bg-brand-foreground/25" : "justify-start bg-muted",
          ].join(" ")}
        >
          <span
            className={[
              "size-7 rounded-full shadow transition-colors",
              fluor ? "bg-brand-foreground" : "bg-foreground/60",
            ].join(" ")}
          />
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
                "flex flex-1 items-center gap-4 rounded-2xl border px-4 text-left shadow-sm transition active:scale-[0.99]",
                action.brand
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-14 shrink-0 items-center justify-center rounded-2xl",
                  action.brand ? "bg-brand-foreground/15 text-brand-foreground" : "bg-brand-soft text-brand",
                ].join(" ")}
              >
                <Icon className="size-7" aria-hidden="true" />
              </span>
              <span className="flex flex-1 flex-col">
                <span className="text-xl font-bold">{action.label}</span>
                <span
                  className={[
                    "text-sm",
                    action.brand ? "text-brand-foreground/80" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {action.hint}
                </span>
              </span>
              <ChevronRight
                className={[
                  "size-6 shrink-0",
                  action.brand ? "text-brand-foreground/70" : "text-muted-foreground",
                ].join(" ")}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
