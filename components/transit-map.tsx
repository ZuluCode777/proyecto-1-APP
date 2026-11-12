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

/**
 * Capa ilustrativa, como un proyecto sin servicio. Se dibuja punteada, con su
 * rótulo siempre visible y su atribución; nunca con el estilo de una ruta en
 * servicio. El rótulo y la atribución son obligatorios.
 */
export type MapOverlay = {
  /** Rótulo fijo en el marco del mapa: sigue a la vista al acercar o mover. */
  label: string
  /** Fuente, licencia y fecha: se suma a la atribución del mapa. */
  attribution: string
  lines: [number, number][][]
  polygons: { ring: [number, number][]; label: string }[]
}

type TransitMapProps = {
  lines?: MapLine[]
  markers?: MapMarker[]
  overlay?: MapOverlay
  /** Descripción para lectores de pantalla. */
  label: string
  className?: string
}

// Constantes, no `[]` en la firma: un arreglo nuevo en cada render redibujaría y
// reencuadraría el mapa cada vez que el componente padre se actualiza.
const SIN_LINEAS: MapLine[] = []
const SIN_MARCADORES: MapMarker[] = []

/** Centro de Bogotá, para cuando todavía no hay nada que mostrar. */
const BOGOTA: [number, number] = [4.65, -74.1]

/**
 * Mapa con Leaflet y OpenStreetMap. No pide clave de API.
 *
 * Los marcadores son círculos grandes con borde grueso para que se distingan
 * con baja visión; no usan imágenes, así que no dependen de rutas a archivos.
 */
export function TransitMap({ lines = SIN_LINEAS, markers = SIN_MARCADORES, overlay, label, className = "" }: TransitMapProps) {
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

  // Redibuja cuando cambian las líneas, los marcadores o la capa ilustrativa.
  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, markers, overlay])

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
    if (overlay) {
      // La atribución va en cada pieza: Leaflet la muestra una sola vez y la
      // conserva mientras quede alguna en el mapa.
      const base = { color: ink, attribution: overlay.attribution }
      if (overlay.lines.length) {
        // Un solo trazo para todas las líneas de la capa.
        L.polyline(overlay.lines, { ...base, weight: 5, opacity: 0.85, dashArray: "2 10" })
          .bindTooltip(overlay.label, { sticky: true })
          .addTo(layer)
      }
      for (const polygon of overlay.polygons) {
        // Borde grueso: a escala de ciudad una huella mide pocos píxeles.
        L.polygon(polygon.ring, { ...base, weight: 4, fillColor: ink, fillOpacity: 0.3 }).bindTooltip(polygon.label).addTo(layer)
      }
      bounds.push(...overlay.lines.flat(), ...overlay.polygons.flatMap((polygon) => polygon.ring))
    }
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

  const mapa = (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      className={`relative z-0 min-h-64 w-full overflow-hidden rounded-2xl border-3 border-border ${overlay ? "rounded-t-none" : ""} ${className}`}
    />
  )
  if (!overlay) return mapa
  // El rótulo va en el marco y no sobre el lienzo: dentro tapaba el trazo o
  // quedaba bajo la atribución. Así no depende del zoom ni del cursor, y con
  // letra grande se parte en renglones.
  return (
    <div className="w-full shrink-0">
      <p className="rounded-t-2xl border-3 border-b-0 border-border bg-card px-3 py-2 text-base font-bold">{overlay.label}</p>
      {mapa}
    </div>
  )
}
