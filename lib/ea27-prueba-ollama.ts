import { pathToFileURL } from "node:url"

/**
 * Apoyo de las pruebas de EA-27 (#53). No es una prueba (no termina en
 * `.test.ts`). `lib/ollama.ts` lee el entorno al cargarse, así que cada caso
 * carga una copia FRESCA del módulo (query distinta, como en
 * `ea08-reglas-cancelacion.test.ts`). El `POST`/`GET` de la ruta importa
 * `@/lib/ollama` SIN query, y ese módulo se queda en caché para todo el
 * proceso, con el entorno que leyó: por eso cada entorno distinto de los casos
 * de ruta vive en su propio archivo de prueba (`node --test` corre cada archivo
 * en un proceso aparte). El estado de «modelo cargado» vive en `globalThis` y
 * lo comparten todas las copias: cada caso lo deja sin cargar al empezar, y los
 * de ruta lo fijan a propósito con `fijarModelo`.
 */
const raiz = pathToFileURL(process.cwd() + "/")
export const TOKEN = "token-de-prueba-0123456789"
export const URL_TUNEL = "https://tunel-secreto.example"
let contadorCaso = 0

export type Llamada = {
  url: string
  autorizacion: string | null
  redirect: RequestRedirect | undefined
  /** Cuerpo JSON enviado, ya interpretado (`null` si no hay). */
  cuerpo: Record<string, unknown> | null
  /** Milisegundos de `AbortSignal.timeout` con los que se creó la señal, si se conocen. */
  plazoMs: number | undefined
}

/** ¿Es la precarga del modelo (`warmUpOllama`)? Es el único `/api/chat` sin mensajes. */
export function esPrecarga(llamada: Llamada): boolean {
  const mensajes = llamada.cuerpo?.messages
  return llamada.url.endsWith("/api/chat") && Array.isArray(mensajes) && mensajes.length === 0
}

/** ¿Es una consulta al modelo (`parseIntentWithOllama`)? Es un `/api/chat` con mensajes. */
export function esConsulta(llamada: Llamada): boolean {
  return llamada.url.endsWith("/api/chat") && !esPrecarga(llamada)
}

export type EntornoPrueba = {
  OLLAMA_MODEL?: string
  OLLAMA_BASE_URL?: string
  OLLAMA_TOKEN?: string
  APP_PASSWORD?: string
  NODE_ENV?: string
}
const VARIABLES = ["OLLAMA_MODEL", "OLLAMA_BASE_URL", "OLLAMA_TOKEN", "APP_PASSWORD", "NODE_ENV"] as const
const env: Record<string, string | undefined> = process.env

/** Aplica `entorno` (las claves ausentes se borran) y devuelve cómo restaurar el anterior. */
export function aplicarEntorno(entorno: EntornoPrueba): () => void {
  const previo = Object.fromEntries(VARIABLES.map((clave) => [clave, env[clave]]))
  for (const clave of VARIABLES) {
    if (entorno[clave] === undefined) delete env[clave]
    else env[clave] = entorno[clave]
  }
  return () => {
    for (const clave of VARIABLES) {
      if (previo[clave] === undefined) delete env[clave]
      else env[clave] = previo[clave]
    }
  }
}

/** Anota los milisegundos de cada `AbortSignal.timeout`. Devuelve cómo deshacerlo. */
function registrarPlazos(plazos: WeakMap<AbortSignal, number>): () => void {
  const original = AbortSignal.timeout
  AbortSignal.timeout = (ms: number) => {
    const senal = original.call(AbortSignal, ms)
    plazos.set(senal, ms)
    return senal
  }
  return () => {
    AbortSignal.timeout = original
  }
}

/**
 * Cómo responde el Ollama simulado. Los casos pueden cambiar estos campos
 * entre una pregunta y otra: se leen en cada petición.
 */
export type OpcionesFetch = {
  /**
   * Las consultas de chat y `/api/tags` van al `fetch` verdadero: sirve para
   * que el error sea el de undici (cabecera inválida, dirección inválida), que
   * son los que pueden traer el token o la dirección. Ese `fetch` falla antes
   * de abrir la red. Las precargas siguen simuladas, para poder dejar el modelo
   * como cargado.
   */
  real?: boolean
  /** Las consultas de chat fallan como un error de red. */
  chatFalla?: boolean
  /** Las precargas (chat sin mensajes) fallan como un error de red. */
  precargaFalla?: boolean
  /** Las precargas no responden hasta que esta promesa se resuelva. */
  precargaEspera?: Promise<void>
  /** Las respuestas de chat, consultas y precargas, llegan con un cuerpo que se corta al leerlo. */
  cuerpoFalla?: boolean
  /** Estado HTTP de las respuestas de chat, consultas y precargas (200 por defecto). */
  estadoChat?: number
  /** Cuerpo completo de la respuesta de chat, sin el envoltorio `message.content` (p. ej. uno sin `message`). */
  cuerpo?: unknown
  /** Cuerpo de la respuesta de chat tal cual, sin pasarlo a JSON (p. ej. la página HTML de un proxy). */
  cuerpoCrudo?: string
  /** Lo que «devuelve» el modelo en `message.content`: un objeto (se envía como JSON) o texto crudo. */
  contenido?: unknown
}

const CONTENIDO_GPS = { intent: "gps", origin: "", destination: "", routeCode: "" }

/** `fetch` simulado de Ollama que anota cada llamada. */
function simularOllama(llamadas: Llamada[], plazos: WeakMap<AbortSignal, number>, opciones: OpcionesFetch): typeof fetch {
  const fetchReal = globalThis.fetch
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const direccion = String(url)
    const esChat = direccion.endsWith("/api/chat")
    const esTags = direccion.endsWith("/api/tags")
    const cuerpo = typeof init?.body === "string" ? JSON.parse(init.body) : null
    const precarga = esChat && Array.isArray(cuerpo?.messages) && cuerpo.messages.length === 0
    if (opciones.real && (esTags || (esChat && !precarga))) return fetchReal(url, init)
    if (!esChat && !esTags) throw new Error("sin red (ArcGIS simulado): usa la copia")
    // Se anota antes de fallar: un intento que falla también es una llamada.
    let autorizacion: string | null = null
    try {
      autorizacion = new Headers(init?.headers).get("authorization")
    } catch {
      // Cabecera inválida (token con salto de línea): el `fetch` real la rechazaría.
    }
    llamadas.push({
      url: direccion,
      autorizacion,
      redirect: init?.redirect,
      cuerpo,
      plazoMs: init?.signal ? plazos.get(init.signal) : undefined,
    })
    if (precarga) await opciones.precargaEspera
    if (esChat && (precarga ? opciones.precargaFalla : opciones.chatFalla)) {
      // Como el real: la dirección viaja en `cause`.
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND tunel-secreto.example") })
    }
    if (esTags) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }))
    if (opciones.cuerpoFalla) {
      const cortado = new ReadableStream({ start: (control) => control.error(new TypeError("terminated")) })
      return new Response(cortado, { status: opciones.estadoChat ?? 200 })
    }
    if (opciones.cuerpoCrudo !== undefined) return new Response(opciones.cuerpoCrudo, { status: opciones.estadoChat ?? 200 })
    if (opciones.cuerpo !== undefined) return new Response(JSON.stringify(opciones.cuerpo), { status: opciones.estadoChat ?? 200 })
    const contenido = opciones.contenido ?? CONTENIDO_GPS
    const texto = typeof contenido === "string" ? contenido : JSON.stringify(contenido)
    return new Response(JSON.stringify({ message: { content: texto } }), { status: opciones.estadoChat ?? 200 })
  }) as typeof fetch
}

async function conSimulacion<T>(entorno: EntornoPrueba, opciones: OpcionesFetch, prueba: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const fetchOriginal = globalThis.fetch
  const restaurar = aplicarEntorno(entorno)
  const plazos = new WeakMap<AbortSignal, number>()
  const deshacerPlazos = registrarPlazos(plazos)
  const llamadas: Llamada[] = []
  // Cada caso parte sin modelo cargado. Se cambia el mismo objeto, sin borrarlo:
  // la copia de `lib/ollama.ts` que la ruta dejó en caché lo sigue usando.
  const estado = estadoDeOllama()
  if (estado) {
    await estado.precarga
    estado.cargado = false
  }
  globalThis.fetch = simularOllama(llamadas, plazos, opciones)
  try {
    return await prueba(llamadas)
  } finally {
    globalThis.fetch = fetchOriginal
    deshacerPlazos()
    restaurar()
  }
}

/** El estado que `lib/ollama.ts` comparte en `globalThis`, si alguna copia lo creó ya. */
function estadoDeOllama() {
  return (globalThis as { __transmivozOllama?: { precarga: Promise<void> | null; cargado: boolean } }).__transmivozOllama
}

/** Espera la precarga que esté en curso, sin lanzar otra. */
export async function esperarPrecarga(): Promise<void> {
  await estadoDeOllama()?.precarga
}

/** Carga una copia nueva de `lib/ollama.ts`, que lee el entorno de ese momento. */
export function copiaDeOllama(): Promise<typeof import("./ollama")> {
  return import(new URL(`lib/ollama.ts?ea27=${contadorCaso++}`, raiz).href)
}

/**
 * Ejecuta `prueba` con el entorno dado, una copia fresca de `lib/ollama.ts` y
 * `fetch` simulado. `opciones` se puede cambiar durante la prueba.
 */
export function conOllama(
  entorno: EntornoPrueba,
  prueba: (ollama: typeof import("./ollama"), llamadas: Llamada[], opciones: OpcionesFetch) => Promise<void>,
  opciones: OpcionesFetch = {},
) {
  return conSimulacion(entorno, opciones, async (llamadas) => {
    await prueba(await copiaDeOllama(), llamadas, opciones)
  })
}

/**
 * Ejecuta `prueba` con el `GET` y el `POST` reales de `/api/agent`, el entorno
 * dado (sin `APP_PASSWORD` ni `NODE_ENV=production` salvo que se pidan) y
 * `console.warn` capturado. Cada archivo de prueba debe usarlo con UN solo entorno.
 * `ollama` es la MISMA instancia de `lib/ollama.ts` que usa la ruta.
 */
export function conRuta(
  entorno: EntornoPrueba,
  opciones: OpcionesFetch,
  prueba: (ruta: {
    GET: (req: Request) => Promise<Response>
    POST: (req: Request) => Promise<Response>
    llamadas: Llamada[]
    registros: string[]
    preguntar: (message: string) => Promise<Response>
    ollama: typeof import("./ollama")
    /** Las mismas `opciones` del Ollama simulado, para cambiarlas durante el caso. */
    opciones: OpcionesFetch
    /**
     * Deja el módulo de la ruta con el modelo cargado (`true`) o sin cargar
     * (`false`) con una precarga que sale bien o mal, y vacía `llamadas`.
     */
    fijarModelo: (listo: boolean) => Promise<void>
  }) => Promise<void>,
) {
  return conSimulacion(entorno, opciones, async (llamadas) => {
    const warnOriginal = console.warn
    const registros: string[] = []
    console.warn = (...args: unknown[]) =>
      void registros.push(args.map((a) => (a instanceof Error ? `${a.message} ${String(a.cause)}` : String(a))).join(" "))
    try {
      const ollama: typeof import("./ollama") = await import(new URL("lib/ollama.ts", raiz).href)
      const { GET, POST } = await import(new URL(`app/api/agent/route.ts?ea27=${contadorCaso++}`, raiz).href)
      const preguntar = (message: string) =>
        POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ message }) })) as Promise<Response>
      const fijarModelo = async (listo: boolean) => {
        opciones.precargaFalla = !listo
        // Una precarga en curso se lanzó con el estado anterior: se espera y se repite.
        for (let intento = 0; intento < 3; intento++) {
          await ollama.warmUpOllama()
          if (ollama.modeloListo() === listo) break
        }
        llamadas.length = 0
      }
      await prueba({ GET, POST, llamadas, registros, preguntar, ollama, opciones, fijarModelo })
    } finally {
      console.warn = warnOriginal
    }
  })
}
