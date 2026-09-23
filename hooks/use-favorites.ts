"use client"

import { useCallback, useEffect, useState } from "react"
import { DEFAULT_FAVORITES } from "@/lib/routes"

const KEY = "transmivoz-favoritas"

/** Rutas frecuentes guardadas en el navegador. Empieza con unas sugeridas. */
export function useFavorites() {
  const [codes, setCodes] = useState<string[]>(DEFAULT_FAVORITES)

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY)
    if (saved) setCodes(JSON.parse(saved) as string[])
  }, [])

  const toggle = useCallback((code: string) => {
    setCodes((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
      window.localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }, [])

  return { codes, toggle, isFavorite: (code: string) => codes.includes(code) }
}
