"use client"

import { Menu, Bell, Bus } from "lucide-react"

type AppHeaderProps = {
  onMenu: () => void
  onNotifications: () => void
}

export function AppHeader({ onMenu, onNotifications }: AppHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-gradient-to-b from-brand-soft/40 to-transparent px-4 pb-3 pt-5">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menú de accesibilidad"
        className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm transition active:scale-95"
      >
        <Menu className="size-6" aria-hidden="true" />
      </button>

      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-sm"
        >
          <Bus className="size-5" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">TransMiVoz</h1>
      </div>

      <button
        type="button"
        onClick={onNotifications}
        aria-label="Notificaciones"
        className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm transition active:scale-95"
      >
        <Bell className="size-6" aria-hidden="true" />
      </button>
    </header>
  )
}
