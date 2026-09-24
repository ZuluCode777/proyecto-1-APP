"use client"

import { useCallback, useEffect, useState } from "react"
import { z } from "zod"
import { DEFAULT_FAVORITES } from "@/lib/routes"

const KEY = "transmivoz-favoritas"

const SavedFavoritesSchema = z.array(z.string())

/**
 * Lee las favoritas guardadas. Si el valor no existe, está dañado o lo dejó
 * otra versión de la app con otra forma, devuelve `null` y se usan las sugeridas.
 */
export function readSavedFavorites(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = SavedFavoritesSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Rutas frecuentes guardadas en el navegador. Empieza con unas sugeridas. */
export function useFavorites() {
  const [codes, setCodes] = useState<string[]>(DEFAULT_FAVORITES)

  useEffect(() => {
    const saved = readSavedFavorites(window.localStorage.getItem(KEY))
    if (saved) setCodes(saved)
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
