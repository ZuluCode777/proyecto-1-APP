/**
 * Guarda una copia de los datos de TransMilenio en `data/transmilenio.json`.
 *
 * La app consulta el servicio en vivo y usa esta copia solo si el servicio no
 * responde, para que la demostración no dependa de la red del día.
 *
 * Uso: pnpm sync:transmilenio
 */
import { writeFileSync } from "node:fs"
import { fetchTransmilenio } from "@/lib/transmilenio"

const data = await fetchTransmilenio()
const snapshot = { ...data, source: "snapshot" as const }
writeFileSync(new URL("../data/transmilenio.json", import.meta.url), JSON.stringify(snapshot) + "\n")
console.log(`Guardadas ${data.stations.length} estaciones y ${data.routes.length} rutas (${data.fetchedAt}).`)
