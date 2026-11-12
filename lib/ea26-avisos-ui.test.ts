import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { mock } from "node:test"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import * as anuncios from "./anuncios"
import * as textos from "./anuncios-texto"
import * as transmilenio from "./transmilenio"

/**
 * EA-26 (#52) en la UI: ejecuta el TSX real de `Avisos` y de `AppHeader` con
 * dobles mínimos de React y de la voz (sin navegador ni dependencias nuevas).
 * Cubre lo que decide la pantalla: qué dice la voz, que calle al cerrar, el
 * canal único (voz o región viva) y el rótulo de la campana.
 */

type Elemento = { type: unknown; props: Record<string, unknown> }
const raiz = process.cwd()

function compilar(archivo: string, dobles: Record<string, unknown>, global: Record<string, unknown> = {}) {
  const salida = ts.transpileModule(readFileSync(`${raiz}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const require = (nombre: string) => {
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/anuncios") return anuncios
    if (nombre === "@/lib/anuncios-texto") return textos
    if (nombre === "@/lib/transmilenio") return transmilenio
    if (nombre in dobles) return dobles[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/")) return new Proxy({}, { get: (_o, n) => function Componente() { void n } })
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (...a: unknown[]) => Elemento> }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, global)(require, modulo, modulo.exports)
  return modulo.exports
}

function nodos(el: unknown, pred: (n: Elemento) => boolean): Elemento[] {
  if (!el || typeof el !== "object") return []
  if (Array.isArray(el)) return el.flatMap((n) => nodos(n, pred))
  const e = el as Elemento
  return [...(pred(e) ? [e] : []), ...nodos(e.props?.children, pred)]
}
function texto(el: unknown): string {
  if (Array.isArray(el)) return el.map(texto).join("")
  if (typeof el === "string" || typeof el === "number") return String(el)
  return el && typeof el === "object" ? texto((el as Elemento).props?.children) : ""
}

/**
 * Monta el componente `exportado` de `archivo` con `useState`/`useEffect` de
 * verdad: re-renderiza al cambiar el estado y corre las limpiezas al cambiar las
 * dependencias o al desmontar.
 */
function montar(archivo: string, exportado: string, propsIniciales: object, dobles: Record<string, unknown>, global: Record<string, unknown> = {}) {
  let props = propsIniciales
  const estados: unknown[] = []
  const efectos: { deps: unknown[]; limpieza?: void | (() => void) }[] = []
  let arbol: Elemento = undefined as never
  let hu = 0
  let he = 0
  let pendientes: (() => void)[] = []
  const react = {
    useState: (inicial: unknown) => {
      const i = hu++
      if (!(i in estados)) estados[i] = inicial
      return [estados[i], (v: unknown) => { estados[i] = v; render() }]
    },
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
      const i = he++
      const previo = efectos[i]
      if (previo && deps.every((d, k) => d === previo.deps[k])) return
      pendientes.push(() => {
        if (typeof previo?.limpieza === "function") previo.limpieza()
        efectos[i] = { deps }
        efectos[i].limpieza = fn()
      })
    },
  }
  const componente = compilar(archivo, { ...dobles, react }, global)[exportado] as (p: object) => Elemento
  function render() {
    hu = 0
    he = 0
    arbol = componente(props)
    const lista = pendientes
    pendientes = []
    lista.forEach((f) => f())
  }
  render()
  return {
    arbol: () => arbol,
    actualizar: (nuevas: object) => { props = { ...props, ...nuevas }; render() },
    desmontar: () => efectos.forEach((e) => typeof e.limpieza === "function" && e.limpieza()),
  }
}

/** Voz con identidad de locución, como el singleton real de `use-speech`. */
function dobleVoz() {
  const voz: string[] = []
  const estado = { cancelaciones: 0, ultima: undefined as object | undefined }
  const hablar = (t: string) => {
    voz.push(t)
    estado.ultima = { texto: t }
    return estado.ultima
  }
  const cancelar = () => estado.cancelaciones++ // estable, como el `useCallback` real: si cambiara, el efecto se repetiría
  return {
    voz,
    estado,
    hablar,
    dobles: {
      "@/hooks/use-speech": {
        useSpeech: () => ({ speak: hablar, cancel: cancelar }),
        esUltimaLocucion: (l: object | undefined) => l !== undefined && estado.ultima === l,
      },
    },
  }
}

const iso = (ms: number) => new Date(ms).toISOString()
const AHORA = Date.UTC(2026, 10, 11, 17, 0, 0)
const respuesta = (anuncios: object[] = []) => ({
  fuente: {
    estado: "activa", confianza: "media", entidad: "TransMilenio S.A.", nombre: "n", url: "u",
    consultadoEn: iso(AHORA), publicadoEn: iso(AHORA - 30_000),
    mensaje: `Hay ${anuncios.length} anuncios vigentes publicados por TransMilenio.`,
  },
  anuncios,
})
const anuncio = (i: number) => ({
  origen: "oficial", entidad: "TransMilenio S.A.", identificador: `id${i}`, titulo: `TM0${i} KR.17 CLL.51`,
  descripcion: `Novedad en la operación ${i}`, fecha: iso(AHORA - 600_000), vigenciaHasta: iso(AHORA + 600_000),
  afectacion: { efecto: "desvio", rutas: ["10173"] },
})

/** Panel `Avisos` abierto, con `/api/anuncios` simulado y, o no, la voz del navegador. */
async function abrirPanel(cuerpo: unknown, { conVoz = true, estadoHttp = 200 } = {}) {
  const v = dobleVoz()
  const red = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(cuerpo), { status: estadoHttp }))
  const panel = montar(
    "components/avisos.tsx",
    "Avisos",
    { open: false, onClose() {}, catalogo: null, errorCatalogo: false },
    v.dobles,
    {
      window: conVoz ? { speechSynthesis: {} } : {},
      fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a),
      AbortController,
      setTimeout,
      clearTimeout,
      Error,
    },
  )
  panel.actualizar({ open: true })
  await new Promise((r) => setTimeout(r, 20)) // deja resolver fetch y json
  // Desmontar limpia el temporizador de espera de 12 s del panel, que si no retendría el proceso de prueba.
  return { v, panel, restaurar: () => (panel.desmontar(), red.mock.restore()) }
}

test("Avisos: al abrir dice «consultando» y luego estado, fuente con su hora y cada anuncio (título, descripción, afectación y vigencia)", async () => {
  const { v, panel, restaurar } = await abrirPanel(respuesta([anuncio(1), anuncio(2)]))
  try {
    assert.equal(v.voz.length, 2)
    assert.match(v.voz[0], /Consultando/)
    for (const frase of ["Hay 2 anuncios vigentes", "publicado por la fuente el", "TM01 KR.17 CLL.51", "Novedad en la operación 2", "Desvío", "Vigente desde"]) {
      assert.ok(v.voz[1].includes(frase), frase)
    }
    const visible = texto(panel.arbol())
    assert.ok(visible.includes("Fuente conectada") && visible.includes("Anuncio oficial · TransMilenio S.A.") && visible.includes("Novedad en la operación 1"))
    assert.equal(nodos(panel.arbol(), (n) => n.type === "h4").length, 2, "cada título es un encabezado")
  } finally {
    restaurar()
  }
})

test("Avisos: al cerrar el panel calla su propia locución, no una más nueva de otro", async () => {
  const a = await abrirPanel(respuesta([anuncio(1)]))
  try {
    assert.equal(a.v.estado.cancelaciones, 0, "no corta mientras está abierto")
    a.panel.actualizar({ open: false })
    assert.equal(a.v.estado.cancelaciones, 1, "la lectura no sigue sonando fuera del panel")
  } finally {
    a.restaurar()
  }
  const b = await abrirPanel(respuesta([anuncio(1)]))
  try {
    b.v.hablar("Modo baja visión") // el padre habló después
    b.panel.actualizar({ open: false })
    assert.equal(b.v.estado.cancelaciones, 0)
  } finally {
    b.restaurar()
  }
  const c = await abrirPanel(respuesta([anuncio(1)]))
  try {
    c.panel.desmontar()
    assert.equal(c.v.estado.cancelaciones, 1, "también al desmontar")
  } finally {
    c.restaurar()
  }
})

test("Avisos: un solo canal. Con voz no hay región viva; sin voz del navegador, el resultado va en una región aria-live", async () => {
  const con = await abrirPanel(respuesta([anuncio(1)]))
  try {
    assert.equal(nodos(con.panel.arbol(), (n) => n.props?.["aria-live"] !== undefined).length, 0)
    assert.equal(nodos(con.panel.arbol(), (n) => n.props?.role === "status").length, 0)
  } finally {
    con.restaurar()
  }
  const sin = await abrirPanel(respuesta([anuncio(1)]), { conVoz: false })
  try {
    const vivas = nodos(sin.panel.arbol(), (n) => n.props?.["aria-live"] === "polite")
    assert.equal(vivas.length, 1)
    assert.ok(texto(vivas[0]).includes("Fuente conectada"), "el estado cae dentro de la región viva")
    assert.ok(texto(vivas[0]).includes("TM01 KR.17 CLL.51"), "y también la lista de anuncios")
  } finally {
    sin.restaurar()
  }
})

test("Avisos: si la consulta falla, no dice que no hay incidentes", async () => {
  const { v, panel, restaurar } = await abrirPanel({ error: "x" }, { estadoHttp: 503 })
  try {
    assert.match(v.voz.at(-1) ?? "", /No pude consultar/)
    assert.ok((v.voz.at(-1) ?? "").endsWith(textos.AVISO_SIN_GARANTIA))
    assert.ok(texto(panel.arbol()).includes(textos.AVISO_SIN_GARANTIA))
  } finally {
    restaurar()
  }
})

test("Avisos: separa anuncio del operador, aviso de la app y escenario simulado, cada uno con su marca en texto", async () => {
  const { panel, restaurar } = await abrirPanel(respuesta([anuncio(1)]))
  try {
    const visible = texto(panel.arbol())
    for (const marca of ["Anuncio oficial · TransMilenio S.A.", "Aviso de la app", "Simulado"]) assert.ok(visible.includes(marca), marca)
    const [h3] = nodos(panel.arbol(), (n) => n.type === "h3")
    assert.ok(texto(h3).includes("Anuncios del operador"))
    assert.equal(nodos(panel.arbol(), (n) => n.type === "h3").length, 3)
  } finally {
    restaurar()
  }
})

test("AppHeader: la campana se llama «Avisos y anuncios» y abre el panel, no dice nada por sí sola", () => {
  const abierto: string[] = []
  const { AppHeader } = compilar("components/app-header.tsx", {})
  const arbol = AppHeader({ onMenu() {}, onNotifications: () => abierto.push("avisos") })
  const botones = nodos(arbol, (n) => n.type === "button")
  const campana = botones.find((b) => b.props["aria-label"] === "Avisos y anuncios")
  assert.ok(campana, "rótulo accesible de la campana")
  assert.equal(botones.filter((b) => b.props["aria-label"] === "Notificaciones").length, 0)
  ;(campana.props.onClick as () => void)()
  assert.deepEqual(abierto, ["avisos"])
})
