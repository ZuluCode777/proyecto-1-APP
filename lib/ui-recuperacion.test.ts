import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { pathToFileURL } from "node:url"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import * as rutas from "./routes"
import * as catalogo from "./transmilenio"

/**
 * Regresión del issue #32 en la RAMA DE UI (no solo en el hook): ejecuta el TSX
 * REAL de `TransMiVozApp` y `RouteList` con dobles mínimos de hooks de React y
 * de los componentes hijos, sin navegador ni dependencias nuevas. Inspecciona el
 * árbol de elementos que devuelven, como lo haría una prueba de render, para
 * comprobar lo que las pruebas del hook no ven:
 *
 * - tras fallar el PRIMER GET (sin catálogo) hay un botón «Reintentar» visible
 *   en ambos modos y también en el asistente; con catálogo conservado, uno solo;
 * - la lista de resultados se deriva de la consulta confirmada y del catálogo;
 * - la lista dice su procedencia por voz una vez al entrar y al cambiar, sin
 *   repetirla al enfocar cada ruta.
 */

const raiz = process.cwd()
const datos = catalogo.TransmilenioDataSchema.parse(snapshot)

type Elemento = { type: unknown; props: Record<string, unknown> }
type Voz = { texto: string; opciones?: { queue?: boolean } }

/** Hooks de React simulados con estado persistente entre renders. */
function crearHooks() {
  let cursor = 0
  const estados: unknown[] = []
  const deps: Array<unknown[] | undefined> = []
  const efectos: Array<() => void> = []
  const limpiezas: Array<void | (() => void)> = []
  return {
    iniciar() { cursor = 0; efectos.length = 0 },
    ejecutarEfectos() { efectos.splice(0).forEach((f) => f()) },
    desmontar() { limpiezas.forEach((f) => typeof f === "function" && f()) },
    useState(inicial: unknown) {
      const i = cursor++
      if (!(i in estados)) estados[i] = typeof inicial === "function" ? (inicial as () => unknown)() : inicial
      return [estados[i], (v: unknown) => { estados[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(estados[i]) : v }]
    },
    useMemo(f: () => unknown) { cursor++; return f() },
    useCallback(f: unknown, nuevas: unknown[]) {
      const i = cursor++
      const previas = deps[i]
      if (!previas || nuevas.some((d, j) => d !== previas[j])) { deps[i] = nuevas; estados[i] = f }
      return estados[i]
    },
    useEffect(f: () => void | (() => void), nuevas?: unknown[]) {
      const i = cursor++
      const previas = deps[i]
      if (!previas || !nuevas || nuevas.some((d, j) => d !== previas[j])) {
        deps[i] = nuevas
        efectos.push(() => {
          const limpiar = limpiezas[i]
          if (typeof limpiar === "function") limpiar()
          limpiezas[i] = f()
        })
      }
    },
    useRef(inicial: unknown) { const i = cursor++; if (!(i in estados)) estados[i] = { current: inicial }; return estados[i] },
  }
}

/** Compila un componente TSX del proyecto y lo ejecuta con los dobles dados. */
function compilar(archivo: string, react: object, dobles: Record<string, unknown>, ventana: object = {}) {
  const salida = ts.transpileModule(readFileSync(`${raiz}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const hijos: Record<string, unknown> = {}
  const require = (nombre: string) => {
    if (nombre === "react") return react
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/routes") return rutas
    if (nombre === "@/lib/transmilenio") return catalogo
    if (nombre in dobles) return dobles[nombre]
    // Íconos y componentes hijos: funciones vacías que solo aportan su tipo y props.
    if (nombre === "lucide-react" || nombre.startsWith("@/components/")) {
      return (hijos[nombre] ??= new Proxy({}, { get: (_o, n) => function Componente() { void n } }))
    }
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (...a: unknown[]) => Elemento> }
  const sandbox = {
    console, setInterval: () => 0, clearInterval() {},
    window: { localStorage: { getItem: (k: string) => (k === "transmivoz-mode" ? almacen.modo : null), setItem() {} }, ...ventana },
  }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, sandbox)(require, modulo, modulo.exports)
  return modulo.exports
}
const almacen = { modo: "parcial" }

function nodos(el: unknown, pred: (n: Elemento) => boolean): Elemento[] {
  if (!el || typeof el !== "object") return []
  if (Array.isArray(el)) return el.flatMap((n) => nodos(n, pred))
  const e = el as Elemento
  return [...(pred(e) ? [e] : []), ...nodos(e.props?.children, pred)]
}
function texto(el: unknown): string {
  if (Array.isArray(el)) return el.map(texto).join(" ")
  if (typeof el === "string" || typeof el === "number") return String(el)
  return el && typeof el === "object" ? texto((el as Elemento).props?.children) : ""
}
const botonesReintentar = (arbol: unknown) => nodos(arbol, (n) => n.type === "button" && texto(n).includes("Reintentar"))

type EstadoHook = { data: typeof datos | null; error: boolean; cargando: boolean }

/** Monta `TransMiVozApp` con un estado del hook controlable desde la prueba. */
function montarApp(modo: "parcial" | "total", inicial: EstadoHook) {
  almacen.modo = modo
  const hooks = crearHooks()
  const voz: Voz[] = []
  const estado = { ...inicial }
  let reintentos = 0
  const speak = (texto: string, opciones?: { queue?: boolean }) => { voz.push({ texto, opciones }) }
  const { TransMiVozApp } = compilar("components/transmivoz-app.tsx", hooks, {
    "@/hooks/use-speech": { useSpeech: () => ({ speak }) },
    "@/hooks/use-transmilenio": { useTransmilenio: () => ({ ...estado, reintentar() { reintentos++ } }) },
    "@/hooks/use-favorites": { useFavorites: () => ({ codes: ["B23"], isFavorite: () => false, toggle() {} }) },
  })
  const render = () => { hooks.iniciar(); return TransMiVozApp() }
  render()
  hooks.ejecutarEfectos() // lee el modo guardado
  return { render, estado, voz, reintentos: () => reintentos }
}

test("modo ceguera total, primer GET fallido sin catálogo: hay un solo Reintentar que funciona", () => {
  const app = montarApp("total", { data: null, error: true, cargando: false })
  const arbol = app.render()
  assert.equal(nodos(arbol, (n) => typeof n.props?.onAction === "function").length, 1, "está en el inicio del modo total")
  const botones = botonesReintentar(arbol)
  assert.equal(botones.length, 1, "un único control de reintento, sin duplicar")
  assert.match(texto(arbol), /No pude cargar las rutas/)
  assert.equal(nodos(arbol, (n) => n.props?.role === "alert").length, 1, "anunciado como alerta accesible")
  ;(botones[0].props.onClick as () => void)()
  assert.equal(app.reintentos(), 1, "reintenta sin recargar ni cambiar de modo")
  assert.match(app.voz.at(-1)!.texto, /Reintentando/)
})

test("la recuperación quita el aviso sin cambiar de modo ni pantalla", () => {
  const app = montarApp("total", { data: null, error: true, cargando: false })
  assert.equal(botonesReintentar(app.render()).length, 1)
  Object.assign(app.estado, { data: datos, error: false })
  const arbol = app.render()
  assert.equal(botonesReintentar(arbol).length, 0)
  assert.equal(nodos(arbol, (n) => typeof n.props?.onAction === "function").length, 1, "sigue en el asistente total")
})

test("renovar el catálogo conserva el callback del asistente y su escucha activa", () => {
  const app = montarApp("total", { data: datos, error: false, cargando: false })
  const asistente = (arbol: unknown) => nodos(arbol, (n) => typeof n.props?.onAction === "function")[0]
  const accion = asistente(app.render()).props.onAction
  const actual = { ...datos, fetchedAt: "2026-11-04T17:00:00.000Z" }
  Object.assign(app.estado, { data: actual })
  assert.equal(asistente(app.render()).props.onAction, accion, "no recrea onResult ni aborta el reconocimiento por renovar datos")
  ;(accion as (respuesta: { action: "route"; routeCode: string }) => void)({ action: "route", routeCode: "B23" })
  const detalle = nodos(app.render(), (n) => n.props?.route !== undefined)[0]
  assert.equal(detalle.props.data, actual, "navega usando el catálogo actual sin capturarlo en el callback")
})

test("actualizar callbacks de voz conserva captura y usa receptores actuales hasta desmontar", () => {
  const hooks = crearHooks()
  const instancias: ReconocimientoSimulado[] = []
  class ReconocimientoSimulado {
    inicios = 0
    abortos = 0
    onstart: (() => void) | null = null
    onend: (() => void) | null = null
    onerror: ((evento: { error: string }) => void) | null = null
    onresult: ((evento: { results: Array<Array<{ transcript: string }>> }) => void) | null = null
    constructor() { instancias.push(this) }
    start() { this.inicios++; this.onstart?.() }
    stop() { this.onend?.() }
    abort() { this.abortos++; this.onend?.() }
  }
  const { useVoiceRecognition } = compilar("hooks/use-speech.ts", hooks, {}, { SpeechRecognition: ReconocimientoSimulado })
  const recibidos: string[] = []
  const render = (onResult: (texto: string) => void, onError: (error: string) => void) => {
    hooks.iniciar()
    const estado = useVoiceRecognition({ onResult, onError }) as unknown as { start: () => void }
    hooks.ejecutarEfectos()
    return estado
  }
  render((t) => recibidos.push(`anterior:${t}`), (e) => recibidos.push(`error anterior:${e}`)).start()
  render((t) => recibidos.push(`actual:${t}`), (e) => recibidos.push(`error actual:${e}`))
  assert.equal(instancias.length, 1, "no sustituye el dispositivo activo al cambiar callbacks de sus consumidores")
  assert.equal(instancias[0].inicios, 1)
  assert.equal(instancias[0].abortos, 0)
  instancias[0].onresult?.({ results: [[{ transcript: "B23" }]] })
  instancias[0].onerror?.({ error: "network" })
  assert.deepEqual(recibidos, ["actual:B23", "error actual:network"], "ambos consumidores reciben los callbacks actuales")
  hooks.desmontar()
  assert.equal(instancias[0].abortos, 1)
  for (const campo of ["onstart", "onend", "onerror", "onresult"] as const) assert.equal(instancias[0][campo], null)
})

test("modo baja visión: el asistente y el inicio sin catálogo también ofrecen Reintentar", () => {
  const app = montarApp("parcial", { data: null, error: true, cargando: false })
  let arbol = app.render()
  assert.equal(botonesReintentar(arbol).length, 1, "inicio parcial")
  ;(nodos(arbol, (n) => typeof n.props?.onAgent === "function")[0].props.onAgent as () => void)()
  arbol = app.render()
  assert.equal(nodos(arbol, (n) => typeof n.props?.onAction === "function").length, 1, "pantalla del asistente")
  assert.equal(botonesReintentar(arbol).length, 1, "asistente sin catálogo")
})

test("con catálogo conservado el aviso es uno solo, explica y se deshabilita mientras reintenta", () => {
  const app = montarApp("total", { data: datos, error: true, cargando: false })
  let arbol = app.render()
  assert.equal(botonesReintentar(arbol).length, 1)
  assert.match(texto(arbol), /Sigues viendo los últimos datos/)
  assert.equal(botonesReintentar(arbol)[0].props.disabled, false)
  Object.assign(app.estado, { cargando: true })
  arbol = app.render()
  assert.equal(botonesReintentar(arbol)[0].props.disabled, true)
  Object.assign(app.estado, { error: false, cargando: false })
  assert.equal(botonesReintentar(app.render()).length, 0, "sin fallo no hay aviso")
})

test("la lista de resultados se deriva de la consulta confirmada y del catálogo vigente", () => {
  const app = montarApp("parcial", { data: datos, error: false, cargando: false })
  let arbol = app.render()
  ;(nodos(arbol, (n) => typeof n.props?.onRoutes === "function")[0].props.onRoutes as () => void)()
  arbol = app.render()
  const entrada = nodos(arbol, (n) => typeof n.props?.onSubmitSearch === "function")[0].props
  ;(entrada.onQueryChange as (t: string) => void)("B23")
  arbol = app.render()
  ;(nodos(arbol, (n) => typeof n.props?.onSubmitSearch === "function")[0].props.onSubmitSearch as () => void)()
  arbol = app.render()
  let lista = nodos(arbol, (n) => Array.isArray(n.props?.routes) && n.props?.fetchedAt !== undefined)[0]
  assert.equal(lista.props.title, "Rutas para “B23”")
  const anterior = (lista.props.routes as Array<{ code: string; from: string }>)[0]
  assert.equal(anterior.code, "B23")
  assert.equal(lista.props.source, datos.source)
  assert.equal(lista.props.fetchedAt, datos.fetchedAt)
  assert.match(app.voz.at(-1)!.texto, /Encontré/)
  assert.doesNotMatch(app.voz.at(-1)!.texto, /copia guardada|consultados/, "la procedencia la dice la lista, no se duplica aquí")

  // Catálogo renovado: la lista y su cabecera citan el mismo dato nuevo.
  const nuevo = { ...datos, source: "live" as const, fetchedAt: "2026-11-04T15:00:00.000Z", routes: datos.routes.map((r) => (r.code === "B23" ? { ...r, from: "CABECERA NUEVA" } : r)) }
  Object.assign(app.estado, { data: nuevo })
  lista = nodos(app.render(), (n) => Array.isArray(n.props?.routes) && n.props?.fetchedAt !== undefined)[0]
  assert.equal((lista.props.routes as Array<{ from: string }>)[0].from, "CABECERA NUEVA")
  assert.equal(lista.props.source, "live")
  assert.equal(lista.props.fetchedAt, nuevo.fetchedAt)
})

test("rutas frecuentes recibe source y fetchedAt para decir su procedencia", () => {
  const app = montarApp("parcial", { data: datos, error: false, cargando: false })
  let arbol = app.render()
  ;(nodos(arbol, (n) => typeof n.props?.onRoutes === "function")[0].props.onRoutes as () => void)()
  arbol = app.render()
  ;(nodos(arbol, (n) => typeof n.props?.onFrequent === "function")[0].props.onFrequent as () => void)()
  const lista = nodos(app.render(), (n) => n.props?.title === "Rutas frecuentes")[0]
  assert.equal(lista.props.source, datos.source)
  assert.equal(lista.props.fetchedAt, datos.fetchedAt)
})

/** Monta `RouteList` con voz simulada y estado de hooks persistente. */
function montarLista() {
  const hooks = crearHooks()
  const voz: Voz[] = []
  const speak = (t: string, o?: { queue?: boolean }) => { voz.push({ texto: t, opciones: o }) } // estable, como useSpeech
  const { RouteList } = compilar("components/route-list.tsx", hooks, { "@/hooks/use-speech": { useSpeech: () => ({ speak }) } })
  const rutasLista = datos.routes.slice(0, 3)
  const render = (props: { source?: string; fetchedAt?: string }) => {
    hooks.iniciar()
    const arbol = RouteList({ title: "Rutas frecuentes", routes: rutasLista, emptyMessage: "vacío", onOpen() {}, onBack() {}, ...props } as never)
    hooks.ejecutarEfectos()
    return arbol
  }
  return { render, voz }
}

test("RouteList dice la procedencia una vez al entrar y al cambiar, no al enfocar cada ruta", () => {
  const { render, voz } = montarLista()
  const viva = { source: "live", fetchedAt: "2026-11-04T15:00:00.000Z" }
  const arbol = render(viva)
  assert.equal(voz.length, 1, "una voz al entrar")
  assert.equal(voz[0].texto, catalogo.procedenciaCatalogo(viva as never))
  assert.equal(voz[0].opciones?.queue, true, "se encola tras el aviso que ya se estaba diciendo")

  // Enfocar rutas no repite la fecha.
  for (const boton of nodos(arbol, (n) => n.type === "button" && typeof n.props.onFocus === "function")) (boton.props.onFocus as () => void)()
  assert.equal(voz.length, 4)
  for (const v of voz.slice(1)) assert.doesNotMatch(v.texto, /consultados|copia guardada|\d{1,2}\/\d{1,2}\/\d{4}/)

  // Mismo catálogo en otro render: no se repite.
  render(viva)
  assert.equal(voz.length, 4)

  // Procedencia distinta (copia guardada tras caída): se anuncia de nuevo, una vez.
  const copia = { source: "snapshot", fetchedAt: "2026-09-24T12:00:00.000Z" }
  render(copia)
  assert.equal(voz.length, 5)
  assert.match(voz[4].texto, /copia guardada/)
  render(copia)
  assert.equal(voz.length, 5)
})
