/**
 * Evaluación de EA-27 (#53): reglas frente a modelo con el corpus congelado de
 * `data/ea27-corpus.json`. Mide comprensión (intención y entidades), no fluidez.
 *
 *   pnpm evaluar:ea27             Solo las reglas, en este proceso. Escribe
 *                                 docs/expoandes/ea-27-resultados-reglas.json.
 *   OLLAMA_BASE_URL=… OLLAMA_MODEL=qwen2.5:3b [OLLAMA_TOKEN=…] pnpm evaluar:ea27 modelo
 *                                 Reglas y modelo. Escribe
 *                                 docs/expoandes/ea-27-resultados-modelo.json.
 *
 * Motores que se miden:
 * - reglas: `parseIntent`, sin red.
 * - modelo: `parseIntentWithOllama`, el mismo prompt, esquema y validación de
 *   entidades que usa la app. Un `null` (salida que no valida contra los datos)
 *   cuenta como `unknown`. No puede expresar `metro` ni `trip_missing_destination`
 *   (solo las reglas), así que falla esas por diseño.
 * - app: lo que responde `POST /api/agent` con el modelo cargado: `requiereModelo`
 *   y `elegirIntent`, con las reglas de respaldo si el modelo falla o no valida.
 *
 * Usa el catálogo congelado (`data/transmilenio.json`), no el servicio en vivo,
 * para que la corrida se pueda repetir. Cada frase se evalúa sola: el asistente
 * no guarda la conversación. El token se lee solo del entorno y no se escribe en
 * el resultado, la consola ni los errores. Sin precio por petición: el modelo es
 * propio y corre en hardware del equipo.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { catalogoCongelado, corpus, puntuar, resumir, type Medicion } from "@/lib/ea27-evaluacion"
import { parseIntent, type Intent } from "@/lib/local-agent"
import { OLLAMA_MODEL, ollamaConfigured, ollamaStatus, parseIntentWithOllama, warmUpOllama } from "@/lib/ollama"
import { elegirIntent, requiereModelo } from "@/lib/seleccion-interprete"

const conModelo = process.argv[2] === "modelo"
if (process.argv[2] && !conModelo) throw new Error(`Modo desconocido «${process.argv[2]}». Usa «modelo» o nada.`)

const data = catalogoCongelado()
const medir = <T>(f: () => T): [T, number] => {
  const inicio = performance.now()
  const valor = f()
  return [valor, performance.now() - inicio]
}

const reglas: Medicion[] = []
const modelo: Medicion[] = []
const app: Medicion[] = []
const detalle: Record<string, Record<string, unknown>> = {}

if (conModelo) {
  if (!ollamaConfigured()) throw new Error("Define OLLAMA_MODEL y una OLLAMA_BASE_URL segura (https o este mismo equipo si hay OLLAMA_TOKEN).")
  const estado = await ollamaStatus()
  if (!estado.reachable || !estado.hasModel) throw new Error(`Ollama no está listo: alcanzable=${estado.reachable}, modelo descargado=${estado.hasModel}.`)
  // La primera consulta carga el modelo; no se mide.
  await warmUpOllama()
}

for (const item of corpus.items) {
  const fila: Record<string, unknown> = (detalle[item.id] = { frase: item.frase })
  const base = { id: item.id, categoria: item.categoria, esperado: item.esperado }

  const [deReglas, msReglas] = medir(() => parseIntent(item.frase, data))
  reglas.push({ ...base, puntuacion: puntuar(item.esperado, deReglas, data), ms: msReglas })
  fila.reglas = deReglas

  if (!conModelo) continue

  let deModelo: Intent | null = null
  let error: string | undefined
  const inicio = performance.now()
  try {
    deModelo = await parseIntentWithOllama(item.frase, data)
  } catch (e) {
    // Solo el mensaje: `fetch` pone la dirección en `cause`.
    error = e instanceof Error ? e.message : "error desconocido"
  }
  const msModelo = performance.now() - inicio

  const crudo: Intent = deModelo ?? { type: "unknown" }
  modelo.push({ ...base, puntuacion: error ? null : puntuar(item.esperado, crudo, data), ms: msModelo, error })
  fila.modelo = error ? { error } : deModelo === null ? { sinSalidaValida: true } : deModelo

  // Como la ruta: las dos intenciones solo de reglas no consultan al modelo.
  const consultaba = requiereModelo(deReglas)
  const { intent, engine } = elegirIntent(deReglas, consultaba ? deModelo : null)
  app.push({ ...base, puntuacion: puntuar(item.esperado, intent, data), ms: msReglas + (consultaba ? msModelo : 0) })
  fila.app = { engine, intent }
}

const resultado = {
  corpus: { version: corpus.version, congelado: corpus.congelado, items: corpus.items.length },
  ejecutado: new Date().toISOString(),
  modo: conModelo ? "reglas y modelo" : "solo reglas",
  modelo: conModelo ? OLLAMA_MODEL : null,
  costo: "Sin precio por petición: el modelo es propio (Ollama) y corre en hardware que el equipo ya tiene. No hay API externa ni presupuesto.",
  motores: {
    reglas: resumir(reglas),
    ...(conModelo && { modelo: resumir(modelo), app: resumir(app) }),
  },
  fallosConocidos: corpus.items.filter((i) => i.falloConocido).map((i) => i.id),
  items: detalle,
}

const salida = new URL(`../docs/expoandes/ea-27-resultados-${conModelo ? "modelo" : "reglas"}.json`, import.meta.url)
mkdirSync(new URL(".", salida), { recursive: true })
writeFileSync(salida, JSON.stringify(resultado, null, 2) + "\n")

for (const [nombre, r] of Object.entries(resultado.motores)) {
  console.log(`${nombre}: ${r.ok}/${r.n} (${Math.round(r.exactitud * 100)} %), p50 ${r.latenciaMs.p50} ms, p95 ${r.latenciaMs.p95} ms, errores ${r.errores.length}`)
  for (const [c, v] of Object.entries(r.porCategoria)) console.log(`  ${c}: ${v.ok}/${v.n}`)
}
console.log(`Resultados en ${salida.pathname}`)
