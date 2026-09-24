"use client"

import { ArrowLeft, type LucideIcon } from "lucide-react"

type ScreenHeaderProps = {
  title: string
  subtitle?: string
  icon?: LucideIcon
  onBack: () => void
}

export function ScreenHeader({ title, subtitle, icon: Icon, onBack }: ScreenHeaderProps) {
  return (
    <div className="mb-5 flex shrink-0 flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 self-start rounded-full border-3 border-border bg-card px-4 py-2.5 text-base font-semibold shadow-sm transition active:scale-95"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <div className="flex items-center gap-3 rounded-2xl border-3 border-border bg-bar p-3">
        {Icon && (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-3 border-border bg-card text-brand-ink">
            <Icon className="size-6" aria-hidden="true" />
          </span>
        )}
        <div className="flex flex-col">
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-base font-semibold">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}
