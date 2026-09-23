"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef } from "react"
import type { Map as LeafletMap, LayerGroup } from "leaflet"

export type MapLine = {
  path: [number, number][]
  /** Segunda línea en un viaje con transbordo: se dibuja punteada. */
  secondary?: boolean
}

export type MapMarker = {
  lat: number
  lng: number
  label: string
  kind: "station" | "user" | "target"
}

type TransitMapProps = {
  lines?: MapLine[]
  markers?: MapMarker[]
  /** Descripción para lectores de pantalla. */
  label: string
  className?: string
}

/** Centro de Bogotá, para cuando todavía no hay nada que mostrar. */
const BOGOTA: [number, number] = [4.65, -74.1]

/**
 * Mapa con Leaflet y OpenStreetMap. No pide clave de API.
 *
 * Los marcadores son círculos grandes con borde grueso para que se distingan
 * con baja visión; no usan imágenes, así que no dependen de rutas a archivos.
 */
export function TransitMap({ lines = [], markers = [], label, className = "" }: TransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const leafletRef = useRef<typeof import("leaflet") | null>(null)

  // Crea el mapa una sola vez. Leaflet toca `window`, así que se importa aquí.
  useEffect(() => {
    let cancelled = false
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(BOGOTA, 12)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map)
      mapRef.current = map
      layerRef.current = L.layerGroup().addTo(map)
      draw()
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redibuja cuando cambian las líneas o los marcadores.
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, markers])

  function draw() {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer || !containerRef.current) return
    layer.clearLayers()

    const styles = getComputedStyle(containerRef.current)
    const brand = styles.getPropertyValue("--brand").trim() || "#8a3a10"
    const ink = styles.getPropertyValue("--foreground").trim() || "#1b1b1b"

    const bounds: [number, number][] = []
    for (const line of lines) {
      L.polyline(line.path, {
        color: line.secondary ? ink : brand,
        weight: 7,
        opacity: 0.9,
        dashArray: line.secondary ? "10 8" : undefined,
      }).addTo(layer)
      bounds.push(...line.path)
    }

    for (const marker of markers) {
      const isUser = marker.kind === "user"
      const isTarget = marker.kind === "target"
      L.circleMarker([marker.lat, marker.lng], {
        radius: isTarget ? 13 : isUser ? 11 : 8,
        color: isUser ? "#ffffff" : ink,
        weight: isTarget ? 5 : 3,
        fillColor: isUser ? "#1d4ed8" : brand,
        fillOpacity: 1,
      })
        .bindTooltip(marker.label, { direction: "top", permanent: isTarget })
        .addTo(layer)
      bounds.push([marker.lat, marker.lng])
    }

    if (bounds.length === 1) map.setView(bounds[0], 16)
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      className={`relative z-0 min-h-64 w-full overflow-hidden rounded-2xl border-2 border-border ${className}`}
    />
  )
}
