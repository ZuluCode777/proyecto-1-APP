import { readFileSync } from "node:fs"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"

/**
 * Ayudas de las pruebas de interfaz del Metro (EA-13 y EA-24): ejecutan el TSX
 * real de un componente con dobles mínimos, sin navegador ni dependencias
 * nuevas. No importan el catálogo ni la cartografía: cada prueba pasa en
 * `modulos` lo que su componente necesita.
 */

export type Elemento = { type: unknown; props: Record<string, unknown> }

/**
 * Compila `archivo` y devuelve sus exportaciones. `modulos` resuelve sus imports;
 * los demás componentes e iconos se reemplazan por componentes vacíos. `contexto`
 * son los globales que el componente espera del navegador.
 */
export function compilar(archivo: string, modulos: Record<string, unknown>, contexto: object = {}) {
  const salida = ts.transpileModule(readFileSync(`${process.cwd()}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const require = (nombre: string) => {
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre in modulos) return modulos[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/")) return new Proxy({}, { get: (_o, n) => function Componente() { void n } })
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (props: object) => Elemento> }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, contexto)(require, modulo, modulo.exports)
  return modulo.exports
}

/** Elementos del árbol que cumplen `pred`. */
export function nodos(el: unknown, pred: (n: Elemento) => boolean): Elemento[] {
  if (!el || typeof el !== "object") return []
  if (Array.isArray(el)) return el.flatMap((n) => nodos(n, pred))
  const e = el as Elemento
  return [...(pred(e) ? [e] : []), ...nodos(e.props?.children, pred)]
}

/** Texto visible de un árbol. */
export function texto(el: unknown): string {
  if (Array.isArray(el)) return el.map(texto).join("")
  if (typeof el === "string" || typeof el === "number") return String(el)
  return el && typeof el === "object" ? texto((el as Elemento).props?.children) : ""
}
