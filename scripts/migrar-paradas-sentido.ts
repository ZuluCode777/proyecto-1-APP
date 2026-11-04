/**
 * Migración de `data/transmilenio.json` para el issue #31.
 *
 * Paso 1 (aditivo, todos los servicios): agrega `servedStops: []` cuando falta
 * y calcula `directionEvidence` comparando `from`/`to` con el orden de las
 * estaciones cercanas al trazado (`reconcileDirection`). No invierte geometría
 * ni inventa sentidos.
 *
 * Paso 2 (corrección con evidencia GTFS, solo servicios corroborados): para
 * 8 G y 8 T corrige `from`/`to`/`label` desde el GTFS oficial (GIS los traía
 * invertidos), fija `directionEvidence.verified = true`, agrega las paradas
 * atendidas verificadas (extremos del patrón dominante) y el calendario
 * verificado. Para H72 solo se deja constancia de que no para en Calle 127
 * (nodo 2202): no se agregan paradas positivas, así el planificador se abstiene.
 * Se PRESERVA la geometría (`path`) y la lista `stops` de todos.
 *
 * No modifica estaciones, códigos de ruta, recorridos (`path`), horarios ni la
 * fecha de la copia.
 *
 * Uso: pnpm migrar:paradas-sentido
 */
import { readFileSync, writeFileSync } from "node:fs"
import { CORRECCIONES_GTFS, H72_NO_PARA_EN } from "@/lib/evidencia-gtfs"
import { reconcileDirection } from "@/lib/transmilenio"

const url = new URL("../data/transmilenio.json", import.meta.url)
const snapshot = JSON.parse(readFileSync(url, "utf8")) as {
  stations: { name: string }[]
  routes: {
    code: string
    from: string
    to: string
    label: string
    stops: string[]
    servedStops?: unknown
    directionEvidence?: unknown
    verifiedCalendar?: unknown
  }[]
}

const nombresEstacion = new Set(snapshot.stations.map((s) => s.name))

let aditivos = 0
let corregidos = 0
for (const route of snapshot.routes) {
  // Paso 1: aditivo para todos.
  if (!Array.isArray(route.servedStops)) route.servedStops = []
  route.directionEvidence = reconcileDirection(route.from, route.to, route.stops)
  aditivos++

  // Paso 2: corrección con evidencia GTFS corroborada.
  const correccion = CORRECCIONES_GTFS[route.code]
  if (correccion) {
    // Las paradas verificadas deben referirse a estaciones reales del catálogo.
    for (const parada of correccion.servedStops) {
      if (!nombresEstacion.has(parada.name)) {
        throw new Error(`Corrección ${route.code}: la parada "${parada.name}" no existe en el catálogo.`)
      }
    }
    route.from = correccion.from
    route.to = correccion.to
    route.label = correccion.label
    route.directionEvidence = correccion.directionEvidence
    route.servedStops = correccion.servedStops
    route.verifiedCalendar = correccion.verifiedCalendar
    corregidos++
  }
}

// Verificación de H72: su recorrido pasa por Calle 127, pero no la atiende.
const h72 = snapshot.routes.find((r) => r.code === H72_NO_PARA_EN.code)
if (h72) {
  if (Array.isArray(h72.servedStops) && (h72.servedStops as unknown[]).length > 0) {
    throw new Error("H72 no debe tener paradas verificadas: no se transcribió su secuencia completa.")
  }
  console.log(`H72: ${H72_NO_PARA_EN.nota}`)
}

writeFileSync(url, JSON.stringify(snapshot) + "\n")
console.log(`Campos aditivos en ${aditivos} servicios; corregidos con evidencia GTFS: ${corregidos} (8 G, 8 T).`)
