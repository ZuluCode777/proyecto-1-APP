"use client"

import { Menu, Bell } from "lucide-react"

type AppHeaderProps = {
  onMenu: () => void
  onNotifications: () => void
}

export function AppHeader({ onMenu, onNotifications }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menú de accesibilidad"
        className="flex size-12 items-center justify-center rounded-xl border-2 border-foreground focus-visible:outline-3"
      >
        <Menu className="size-6" aria-hidden="true" />
      </button>

      <h1 className="text-2xl font-bold tracking-tight">TransMiVoz</h1>

      <button
        type="button"
        onClick={onNotifications}
        aria-label="Notificaciones"
        className="flex size-12 items-center justify-center rounded-xl border-2 border-foreground"
      >
        <Bell className="size-6" aria-hidden="true" />
      </button>
    </header>
  )
}
