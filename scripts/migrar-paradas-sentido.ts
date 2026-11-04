/**
 * Migración de `data/transmilenio.json` para el issue #31.
 *
 * Paso 1 (aditivo, todos los servicios): agrega `servedStops: []` cuando falta
 * y calcula `directionEvidence` comparando `from`/`to` con el orden de las
 * estaciones cercanas al trazado (`reconcileDirection`). No invierte geometría
 * ni inventa sentidos.
 *
 * Paso 2 (evidencia GTFS, solo servicios corroborados): `aplicarEvidenciaGtfs`
 * corrige `from`/`to`/`label` de 8 G y 8 T (GIS los traía invertidos), fija el
 * sentido verificado, las paradas atendidas del patrón completo con sus
 * franjas y el calendario por servicio. Deja a H72 sin Calle 127 (nodo 2202).
 * Solo se aplica si la geometría coincide con el sentido GTFS. Es la misma
 * función que usa la consulta en vivo.
 *
 * Se PRESERVA la geometría (`path`), `stops`, estaciones, códigos, horarios y
 * la fecha de la copia. Es idempotente.
 *
 * Uso: pnpm migrar:paradas-sentido
 */
import { readFileSync, writeFileSync } from "node:fs"
import { aplicarEvidenciaGtfs, CORRECCIONES_GTFS } from "@/lib/evidencia-gtfs"
import { reconcileDirection, TransmilenioDataSchema } from "@/lib/transmilenio"

const url = new URL("../data/transmilenio.json", import.meta.url)
const snapshot = JSON.parse(readFileSync(url, "utf8"))

// Con el esquema vigente: lo anterior queda en su forma actual (p. ej. un
// calendario viejo sin `servicios`) y la evidencia GTFS se vuelve a escribir.
const data = TransmilenioDataSchema.parse(snapshot)
for (const route of data.routes) route.directionEvidence = reconcileDirection(route.from, route.to, route.stops)
aplicarEvidenciaGtfs(data.routes, data.stations)

const corregidos = data.routes.filter((r) => CORRECCIONES_GTFS[r.code] && r.verifiedCalendar).map((r) => r.code)
if (corregidos.length !== Object.keys(CORRECCIONES_GTFS).length) {
  throw new Error(`La evidencia GTFS no se aplicó a todos los servicios: ${corregidos.join(", ") || "ninguno"}.`)
}

writeFileSync(url, JSON.stringify(data) + "\n")
console.log(`Servicios: ${data.routes.length}; con evidencia GTFS: ${corregidos.join(", ")}.`)
