import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import * as metro from "./metro"

/**
 * Regresión de EA-13 en la UI: ejecuta el TSX real de `MetroList` y de
 * `PartialHome` con dobles mínimos (sin navegador ni dependencias nuevas) y
 * comprueba el listado accesible sin mapa, las fuentes visibles y la voz.
 */

type Elemento = { type: unknown; props: Record<string, unknown> }
const raiz = process.cwd()

function compilar(archivo: string, dobles: Record<string, unknown>) {
  const salida = ts.transpileModule(readFileSync(`${raiz}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const require = (nombre: string) => {
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/metro") return metro
    if (nombre in dobles) return dobles[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/")) return new Proxy({}, { get: (_o, n) => function Componente() { void n } })
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (...a: unknown[]) => Elemento> }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, {})(require, modulo, modulo.exports)
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

test("MetroList: 16 estaciones sin mapa, estado visible, fuentes con enlace y la misma voz que el texto", () => {
  const voz: string[] = []
  const { MetroList } = compilar("components/metro-list.tsx", {
    react: { useEffect: (f: () => void) => f() },
    "@/hooks/use-speech": { useSpeech: () => ({ speak: (t: string) => voz.push(t) }) },
  })
  const arbol = MetroList({ onBack() {} })
  const visible = texto(arbol)

  assert.equal(nodos(arbol, (n) => n.type === "details").length, 16 + 1, "16 estaciones y la ficha de la Línea 2, todas desplegables con teclado")
  for (const e of metro.ESTACIONES_METRO_L1) assert.ok(visible.includes(`${e.idOficial} · ${metro.nombreEstacion(e)}`), e.idOficial)
  assert.match(visible, /E07 · nombre pendiente/)
  assert.ok(visible.includes(metro.TEXTO_LINEA_1), "estado de la Línea 1 visible")
  assert.match(visible, /11 estaciones proyectadas/)

  const enlaces = nodos(arbol, (n) => n.type === "a").map((n) => n.props.href)
  assert.deepEqual(enlaces, Object.values(metro.FUENTES_METRO).map((f) => f.url), "todas las fuentes enlazadas")
  assert.ok(visible.includes("CC BY 4.0"), "atribución de datos visible")
  assert.equal(nodos(arbol, (n) => n.type === "canvas" || n.type === "svg" || n.props?.["data-mapa"] !== undefined).length, 0)

  assert.equal(voz.length, 1)
  assert.ok(voz[0].startsWith(metro.TEXTO_LINEA_1) && visible.includes(metro.TEXTO_LINEA_1), "voz y texto dicen el mismo estado")
})

test("PartialHome ofrece el Metro como opción descubrible y la activa", () => {
  const { PartialHome } = compilar("components/partial-home.tsx", {})
  let abierto = 0
  const arbol = PartialHome({ fluor: false, onToggleFluor() {}, onAgent() {}, onRoutes() {}, onVision() {}, onGps() {}, onMetro: () => abierto++, onAssistance() {} })
  const boton = nodos(arbol, (n) => n.type === "button" && texto(n).includes("Metro de Bogotá"))
  assert.equal(boton.length, 1)
  assert.match(texto(boton[0]), /En construcción, sin servicio/)
  ;(boton[0].props.onClick as () => void)()
  assert.equal(abierto, 1)
})
