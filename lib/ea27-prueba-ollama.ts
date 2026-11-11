import { pathToFileURL } from "node:url"

/**
 * Apoyo de las pruebas de EA-27 (#53). No es una prueba (no termina en
 * `.test.ts`). `lib/ollama.ts` lee el entorno al cargarse, así que cada caso
 * carga una copia FRESCA del módulo (query distinta, como en
 * `ea08-reglas-cancelacion.test.ts`). El `POST`/`GET` de la ruta importa
 * `@/lib/ollama` SIN query, y ese módulo se queda en caché para todo el
 * proceso: por eso cada entorno distinto de los casos de ruta vive en su propio
 * archivo de prueba (`node --test` corre cada archivo en un proceso aparte).
 */
const raiz = pathToFileURL(process.cwd() + "/")
export const TOKEN = "token-de-prueba-0123456789"
export const URL_TUNEL = "https://tunel-secreto.example"
let contadorCaso = 0

/** ¿Es la precarga del modelo (`warmUpOllama`)? Es el único `/api/chat` sin mensajes. */
export function esPrecarga(llamada: Llamada): boolean {
  const mensajes = llamada.cuerpo?.messages
  return llamada.url.endsWith("/api/chat") && Array.isArray(mensajes) && mensajes.length === 0
}

export type Llamada = {
  url: string
  autorizacion: string | null
  redirect: RequestRedirect | undefined
  /** Cuerpo JSON enviado, ya interpretado (`null` si no hay). */
  cuerpo: Record<string, unknown> | null
  /** Milisegundos de `AbortSignal.timeout` con los que se creó la señal, si se conocen. */
  plazoMs: number | undefined
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
 * `fetch` simulado de Ollama que anota cada llamada. Con `real`, `/api/chat` y
 * `/api/tags` van al `fetch` verdadero: sirve para que el error sea el de
 * undici (cabecera inválida, dirección inválida), que son los que pueden
 * traer el token o la dirección. Ese `fetch` falla antes de abrir la red.
 */
function simularOllama(llamadas: Llamada[], plazos: WeakMap<AbortSignal, number>, opciones: { real?: boolean; chatFalla?: boolean }): typeof fetch {
  const fetchReal = globalThis.fetch
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const direccion = String(url)
    const esChat = direccion.endsWith("/api/chat")
    if (opciones.real && (esChat || direccion.endsWith("/api/tags"))) return fetchReal(url, init)
    if (!esChat && !direccion.endsWith("/api/tags")) throw new Error("sin red (ArcGIS simulado): usa la copia")
    // Se anota antes de fallar: un intento que falla también es una llamada.
    llamadas.push({
      url: direccion,
      autorizacion: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      cuerpo: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      plazoMs: init?.signal ? plazos.get(init.signal) : undefined,
    })
    if (esChat && opciones.chatFalla) {
      // Como el real: la dirección viaja en `cause`.
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND tunel-secreto.example") })
    }
    if (!esChat) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }))
    const contenido = { intent: "gps", origin: "", destination: "", routeCode: "" }
    return new Response(JSON.stringify({ message: { content: JSON.stringify(contenido) } }))
  }) as typeof fetch
}

type OpcionesFetch = { real?: boolean; chatFalla?: boolean }

async function conSimulacion<T>(entorno: EntornoPrueba, opciones: OpcionesFetch, prueba: (llamadas: Llamada[]) => Promise<T>): Promise<T> {
  const fetchOriginal = globalThis.fetch
  const restaurar = aplicarEntorno(entorno)
  const plazos = new WeakMap<AbortSignal, number>()
  const deshacerPlazos = registrarPlazos(plazos)
  const llamadas: Llamada[] = []
  globalThis.fetch = simularOllama(llamadas, plazos, opciones)
  try {
    return await prueba(llamadas)
  } finally {
    globalThis.fetch = fetchOriginal
    deshacerPlazos()
    restaurar()
  }
}

/** Ejecuta `prueba` con el entorno dado, una copia fresca de `lib/ollama.ts` y `fetch` simulado. */
export function conOllama(entorno: EntornoPrueba, prueba: (ollama: typeof import("./ollama"), llamadas: Llamada[]) => Promise<void>) {
  return conSimulacion(entorno, {}, async (llamadas) => {
    const ollama = await import(new URL(`lib/ollama.ts?ea27=${contadorCaso++}`, raiz).href)
    await prueba(ollama, llamadas)
  })
}

/**
 * Ejecuta `prueba` con el `GET` y el `POST` reales de `/api/agent`, el entorno
 * dado (sin `APP_PASSWORD` ni `NODE_ENV=production` salvo que se pidan) y
 * `console.warn` capturado. Cada archivo de prueba debe usarlo con UN solo entorno.
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
  }) => Promise<void>,
) {
  return conSimulacion(entorno, opciones, async (llamadas) => {
    const warnOriginal = console.warn
    const registros: string[] = []
    console.warn = (...args: unknown[]) =>
      void registros.push(args.map((a) => (a instanceof Error ? `${a.message} ${String(a.cause)}` : String(a))).join(" "))
    try {
      const { GET, POST } = await import(new URL(`app/api/agent/route.ts?ea27=${contadorCaso++}`, raiz).href)
      const preguntar = (message: string) =>
        POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ message }) })) as Promise<Response>
      await prueba({ GET, POST, llamadas, registros, preguntar })
    } finally {
      console.warn = warnOriginal
    }
  })
}
