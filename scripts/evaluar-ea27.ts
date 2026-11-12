/**
 * Evaluación de EA-27 (#53): reglas frente a modelo con el corpus congelado de
 * `data/ea27-corpus.json`. Mide comprensión (intención y entidades), no fluidez.
 *
 *   RENDER_URL=https://… EA27_CLAVE_ARCHIVO=<archivo con la clave> pnpm evaluar:ea27 render [n]
 *                                 La app desplegada de punta a punta (`POST /api/agent`):
 *                                 lo que verá la feria. Escribe ea-27-resultados-render-<n>.json
 *                                 (n = 1 por defecto). Una petición cada 3,5 s.
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { z } from "zod"
import { catalogoCongelado, corpus, huellaDeArchivo, percentil, puntuar, resumir, type Medicion } from "@/lib/ea27-evaluacion"
import { recorrerCorpus, type Peticion } from "@/lib/ea27-render"
import { validarBase } from "./medir-render.mjs"
import { parseIntent, type Intent } from "@/lib/local-agent"
import { OLLAMA_MODEL, ollamaConfigured, ollamaStatus, parseIntentWithOllama, warmUpOllama } from "@/lib/ollama"
import { elegirIntent, requiereModelo } from "@/lib/seleccion-interprete"

const modo = process.argv[2]
const conModelo = modo === "modelo"
if (modo && !conModelo && modo !== "render") throw new Error(`Modo desconocido «${modo}». Usa «modelo», «render» o nada.`)

const data = catalogoCongelado()
const medir = async <T>(f: () => T | Promise<T>): Promise<[T, number]> => {
  const inicio = performance.now()
  const valor = await f()
  return [valor, performance.now() - inicio]
}

const redondear = (n: number) => Math.round(n * 1000) / 1000

/** Consulta al modelo; un fallo devuelve solo el mensaje, porque `fetch` pone la dirección en `cause`. */
async function consultarModelo(frase: string): Promise<{ intent: Intent | null; error?: string }> {
  try {
    return { intent: await parseIntentWithOllama(frase, data) }
  } catch (e) {
    return { intent: null, error: e instanceof Error ? e.message : "error desconocido" }
  }
}

/**
 * Modo `render`. La clave se lee del archivo que indica `EA27_CLAVE_ARCHIVO`, dentro
 * de este proceso: no se imprime, no va en argumentos ni en el resultado, que no
 * guarda cabeceras, cookies ni la dirección con credenciales.
 */
async function correrRender() {
  const base = validarBase(process.env.RENDER_URL)
  const archivo = process.env.EA27_CLAVE_ARCHIVO
  if (!archivo) throw new Error("Define EA27_CLAVE_ARCHIVO con la ruta del archivo que contiene la clave.")
  const autorizacion = "Basic " + Buffer.from(`transmivoz:${readFileSync(archivo, "utf8").replace(/\r?\n$/, "")}`).toString("base64")
  const n = Number(process.argv[3] ?? 1)
  if (!Number.isInteger(n) || n < 1) throw new Error("n debe ser un entero positivo.")

  const pedir = async (ruta: string, init: RequestInit = {}) => fetch(base + ruta, { ...init, redirect: "manual", signal: AbortSignal.timeout(45_000), headers: { authorization: autorizacion, ...init.headers } })
  const motor = async () => {
    const r = await pedir("/api/agent")
    if (!r.ok) throw new Error(`GET /api/agent respondió ${r.status}`)
    return z.object({ engine: z.string(), model: z.string().optional(), reachable: z.boolean().optional(), hasModel: z.boolean().optional() }).parse(await r.json())
  }
  const peticion: Peticion = async (frase) => {
    const inicio = performance.now()
    try {
      const r = await pedir("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: frase }) })
      const texto = await r.text()
      let cuerpo: unknown = null
      try {
        cuerpo = JSON.parse(texto)
      } catch {}
      return { estado: r.status, retryAfter: r.headers.get("retry-after"), cuerpo, ms: performance.now() - inicio }
    } catch {
      return { estado: 0, retryAfter: null, cuerpo: null, ms: performance.now() - inicio }
    }
  }
  // Primer contacto: si Render estaba dormido, aquí se ve el arranque en frío, aparte de las 100 frases.
  const contacto = performance.now()
  const estadoInicial = await motor()
  const primerContactoMs = performance.now() - contacto
  // Identificador de build de Next, como en la comprobación del despliegue; solo si aparece en el HTML.
  const buildId = await pedir("/")
    .then((r) => r.text())
    .then((t) => /\\"b\\":\\"([^\\"]+)/.exec(t)?.[1] ?? "desconocido")
    .catch(() => "desconocido")
  if (!estadoInicial.reachable || !estadoInicial.hasModel) throw new Error("El modelo no está alcanzable en la app desplegada; no se mide.")
  const inicio = new Date()
  const mediciones = await recorrerCorpus({
    items: corpus.items,
    data,
    peticion,
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    motorListo: async () => {
      const e = await motor()
      return !!e.reachable && !!e.hasModel
    },
  })

  // La primera petición puede ser un arranque en frío: se informa aparte y no entra en p50/p95.
  const resto = mediciones.slice(1)
  const resumen = resumir(mediciones)
  const porMotor = (engine: string) => {
    const m = mediciones.filter((x) => x.engine === engine)
    return { n: m.length, ok: m.filter((x) => x.puntuacion?.ok).length }
  }
  const ms = resto.map((m) => m.ms)
  const resultado = {
    corpus: { version: corpus.version, congelado: corpus.congelado, items: corpus.items.length, sha256: huellaDeArchivo("ea27-corpus.json") },
    modo: "app desplegada (POST /api/agent)",
    corrida: n,
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    despliegue: { buildId, motorAlEmpezar: { engine: estadoInicial.engine, model: estadoInicial.model, reachable: estadoInicial.reachable, hasModel: estadoInicial.hasModel } },
    puntuacion:
      "La respuesta no trae la intención: se reconstruye de `reply`, `action` y `steps` (lib/ea27-render.ts). Lo que no se reconoce cuenta como fallo.",
    costo: "Sin precio por petición: el modelo es propio (Ollama) y corre en hardware que el equipo ya tiene.",
    resumen: {
      ...resumen,
      latenciaMs: { p50: redondear(percentil(ms, 50)), p95: redondear(percentil(ms, 95)), max: redondear(Math.max(...ms)), n: ms.length },
      primerContactoMs: redondear(primerContactoMs),
      primeraPeticionMs: redondear(mediciones[0].ms),
      decididoPor: { ollama: porMotor("ollama"), reglas: porMotor("reglas") },
      reintentos429: mediciones.reduce((a, m) => a + m.reintentos429, 0),
    },
    items: Object.fromEntries(
      mediciones.map((m) => [m.id, { engine: m.engine, accion: m.accion, observado: m.observado, estado: m.estado, ok: m.puntuacion?.ok ?? false, ms: redondear(m.ms), reintentos429: m.reintentos429, error: m.error }]),
    ),
  }
  const salida = new URL(`../docs/expoandes/ea-27-resultados-render-${n}.json`, import.meta.url)
  writeFileSync(salida, JSON.stringify(resultado, null, 2) + "\n")
  const r = resultado.resumen
  console.log(`render ${n}: ${r.ok}/${r.n} (${Math.round(r.exactitud * 100)} %), modelo ${r.decididoPor.ollama.n} / reglas ${r.decididoPor.reglas.n}, p50 ${r.latenciaMs.p50} ms, p95 ${r.latenciaMs.p95} ms, contacto ${r.primerContactoMs} ms, primera ${r.primeraPeticionMs} ms, errores ${r.errores.length}, 429 ${r.reintentos429}`)
  for (const [c, v] of Object.entries(r.porCategoria)) console.log(`  ${c}: ${v.ok}/${v.n}`)
  console.log(`Resultados en ${salida.pathname}`)
}

if (modo === "render") {
  await correrRender()
  process.exit(0)
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

  const [deReglas, msReglas] = await medir(() => parseIntent(item.frase, data))
  const pReglas = puntuar(item.esperado, deReglas, data)
  reglas.push({ ...base, puntuacion: pReglas, ms: msReglas })
  fila.reglas = { intent: deReglas, ok: pReglas.ok, ms: redondear(msReglas) }

  if (!conModelo) continue

  const [{ intent: deModelo, error }, msModelo] = await medir(() => consultarModelo(item.frase))

  const pModelo = error ? null : puntuar(item.esperado, deModelo ?? { type: "unknown" }, data)
  modelo.push({ ...base, puntuacion: pModelo, ms: msModelo, error })
  const salida = error ? { error } : deModelo === null ? { sinSalidaValida: true } : { intent: deModelo }
  fila.modelo = { ...salida, ok: pModelo?.ok ?? false, ms: redondear(msModelo) }

  // Como la ruta: las dos intenciones solo de reglas no consultan al modelo.
  const consultaba = requiereModelo(deReglas)
  const { intent, engine } = elegirIntent(deReglas, consultaba ? deModelo : null)
  const pApp = puntuar(item.esperado, intent, data)
  const msApp = msReglas + (consultaba ? msModelo : 0)
  app.push({ ...base, puntuacion: pApp, ms: msApp })
  fila.app = { engine, intent, ok: pApp.ok, ms: redondear(msApp) }
}

const resultado = {
  corpus: { version: corpus.version, congelado: corpus.congelado, items: corpus.items.length, sha256: huellaDeArchivo("ea27-corpus.json") },
  catalogo: { archivo: "data/transmilenio.json", sha256: huellaDeArchivo("transmilenio.json") },
  reproducibilidad: "Las exactitudes salen de corpus, catálogo y código fijos. `ejecutado`, `latenciaMs` y los `ms` de cada frase son informativos y cambian en cada corrida; un modelo con temperature 0 en GPU tampoco garantiza la misma salida.",
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
