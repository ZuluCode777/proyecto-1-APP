"use client"

import { useEffect, useState } from "react"
import { TransmilenioDataSchema, type TransmilenioData } from "@/lib/transmilenio"

let request: Promise<TransmilenioData> | null = null

/** Carga una sola vez las estaciones y rutas reales, compartidas por toda la app. */
function load(): Promise<TransmilenioData> {
  request ??= fetch("/api/transmilenio").then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return TransmilenioDataSchema.parse(await res.json())
  })
  request.catch(() => {
    request = null
  })
  return request
}

export function useTransmilenio() {
  const [data, setData] = useState<TransmilenioData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    load()
      .then((d) => active && setData(d))
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [])

  return { data, error }
}
