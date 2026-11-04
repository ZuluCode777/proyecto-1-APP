/**
 * Migración ADITIVA de `data/transmilenio.json` para el issue #31.
 *
 * Agrega a cada servicio los campos nuevos sin tocar los datos existentes:
 *
 * - `servedStops: []` — paradas atendidas verificadas. Vacío porque no se
 *   consiguió una fuente oficial vigente de paradas por servicio y sentido
 *   (ver `lib/transmilenio.ts`). No se convierte ninguna estación cercana al
 *   trazado en parada verificada.
 * - `directionEvidence` — reconciliación del sentido declarado (`from`/`to`)
 *   con el orden de las estaciones cercanas al trazado (`stops`), calculada con
 *   `reconcileDirection`. No invierte geometría ni inventa sentidos.
 *
 * No modifica estaciones, códigos, recorridos, horarios ni la fecha de la copia.
 *
 * Uso: pnpm migrar:paradas-sentido
 */
import { readFileSync, writeFileSync } from "node:fs"
import { reconcileDirection } from "@/lib/transmilenio"

const url = new URL("../data/transmilenio.json", import.meta.url)
const snapshot = JSON.parse(readFileSync(url, "utf8")) as {
  routes: { from: string; to: string; stops: string[]; servedStops?: unknown; directionEvidence?: unknown }[]
}

let actualizados = 0
for (const route of snapshot.routes) {
  if (!Array.isArray(route.servedStops)) route.servedStops = []
  route.directionEvidence = reconcileDirection(route.from, route.to, route.stops)
  actualizados++
}

writeFileSync(url, JSON.stringify(snapshot) + "\n")
console.log(`Campos aditivos escritos en ${actualizados} servicios (servedStops y directionEvidence).`)
