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
      hint: "Buscar y frecuentes",
      icon: Bus,
      onClick: onRoutes,
      brand: false,
    },
    {
      key: "vision",
      label: "Asistente visual",
      hint: "Leer letreros",
      icon: ScanText,
      onClick: onVision,
      brand: false,
    },
    {
      key: "gps",
      label: "GPS auditivo",
      hint: "Ir a estaciones",
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
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-3 pt-2">
      <h2 className="shrink-0 text-lg font-bold tracking-tight">¿Qué necesitas?</h2>

      <button
        type="button"
        role="switch"
        aria-checked={fluor}
        aria-label="Colores fluorescentes de alto contraste"
        onClick={onToggleFluor}
        className={[
          "flex shrink-0 items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 shadow-sm transition active:scale-[0.99]",
          fluor
            ? "border-brand bg-brand text-brand-foreground"
            : "border-border bg-card",
        ].join(" ")}
      >
        <span className="flex min-w-0 items-center gap-3 text-left">
          <span
            className={[
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              fluor ? "bg-brand-foreground/15 text-brand-foreground" : "bg-brand-soft text-brand",
            ].join(" ")}
          >
            <Zap className="size-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-base font-bold leading-tight">Fluorescente</span>
            <span
              className={[
                "text-xs leading-tight",
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
            "flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors",
            fluor ? "justify-end bg-brand-foreground/25" : "justify-start bg-muted",
          ].join(" ")}
        >
          <span
            className={[
              "size-6 rounded-full shadow transition-colors",
              fluor ? "bg-brand-foreground" : "bg-foreground/60",
            ].join(" ")}
          />
        </span>
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={[
                "flex flex-1 items-center gap-3.5 rounded-2xl border px-3.5 text-left shadow-sm transition active:scale-[0.99]",
                action.brand
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                  action.brand ? "bg-brand-foreground/15 text-brand-foreground" : "bg-brand-soft text-brand",
                ].join(" ")}
              >
                <Icon className="size-6" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-lg font-bold leading-tight">{action.label}</span>
                <span
                  className={[
                    "truncate text-xs leading-tight",
                    action.brand ? "text-brand-foreground/80" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {action.hint}
                </span>
              </span>
              <ChevronRight
                className={[
                  "size-5 shrink-0",
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
