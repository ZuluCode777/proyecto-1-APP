import assert from "node:assert/strict"
import test from "node:test"
import * as metro from "./metro"
import * as cartografia from "./metro-cartografia"
import { compilar as compilarTsx, nodos, texto } from "./metro-prueba-ui"

/**
 * Regresión de EA-13 en la UI: ejecuta el TSX real de `MetroList` y de
 * `PartialHome` con dobles mínimos (sin navegador ni dependencias nuevas) y
 * comprueba el listado accesible, las fuentes visibles y la voz. El mapa
 * ilustrativo de EA-24 se prueba en `ea24-mapa.test.ts`.
 */

const compilar = (archivo: string, dobles: Record<string, unknown>) =>
  compilarTsx(archivo, { "@/lib/metro": metro, "@/lib/metro-cartografia": cartografia, ...dobles })

/**
 * Dobles de React y de voz con ciclo de vida: `useEffect` corre al montar y guarda
 * su limpieza; `esUltimaLocucion` compara la identidad con la última locución
 * entregada, como el singleton real de `use-speech`.
 */
function dobleCiclo() {
  const voz: string[] = []
  const limpiezas: Array<() => void> = []
  const estado = { cancelaciones: 0, ultima: undefined as object | undefined }
  const hablar = (t: string) => {
    voz.push(t)
    estado.ultima = { texto: t }
    return estado.ultima
  }
  return {
    voz,
    estado,
    hablar,
    desmontar: () => limpiezas.forEach((f) => f()),
    dobles: {
      react: { useEffect: (f: () => void | (() => void)) => { const l = f(); if (typeof l === "function") limpiezas.push(l) } },
      "@/hooks/use-speech": {
        useSpeech: () => ({ speak: hablar, cancel: () => estado.cancelaciones++ }),
        esUltimaLocucion: (l: object | undefined) => l !== undefined && estado.ultima === l,
      },
    },
  }
}

test("MetroList: 16 estaciones en lista, estado visible, fuentes con enlace y la misma voz que el texto", () => {
  const { voz, dobles } = dobleCiclo()
  const { MetroList } = compilar("components/metro-list.tsx", dobles)
  const arbol = MetroList({ onBack() {} })
  const visible = texto(arbol)

  assert.equal(nodos(arbol, (n) => n.type === "details").length, 16 + 1, "16 estaciones y la ficha de la Línea 2, todas desplegables con teclado")
  for (const e of metro.ESTACIONES_METRO_L1) assert.ok(visible.includes(`${e.idOficial} · ${metro.nombreEstacion(e)}`), e.idOficial)
  assert.match(visible, /E07 · nombre pendiente/)
  assert.ok(visible.includes(metro.TEXTO_LINEA_1), "estado de la Línea 1 visible")
  assert.match(visible, /11 estaciones proyectadas/)
  assert.match(visible, /No tengo ubicación exacta ni accesos validados/)
  assert.ok(visible.includes(metro.TEXTO_HOMONIMO), "aviso de homónimos en las fichas")
  assert.doesNotMatch(visible, /accesos publicados/)

  const enlaces = nodos(arbol, (n) => n.type === "a").map((n) => n.props.href)
  assert.deepEqual(enlaces, Object.values(metro.FUENTES_METRO).map((f) => f.url), "todas las fuentes enlazadas")
  assert.ok(visible.includes("CC BY 4.0"), "atribución de datos visible")
  assert.equal(nodos(arbol, (n) => n.type === "canvas" || n.type === "svg").length, 0, "el listado no depende de un dibujo; el mapa de EA-24 es aparte")

  assert.equal(voz.length, 1)
  const [nota] = nodos(arbol, (n) => n.props?.role === "note")
  assert.equal(voz[0], texto(nota), "la voz dice exactamente lo que muestra la nota de estado")
  assert.ok(voz[0].startsWith(metro.TEXTO_LINEA_1) && voz[0].includes(`Datos al ${metro.METRO_CORTE_HABLADO}.`), "con estado, límites y fecha de corte")
})

test("MetroList: cada estación lleva un indicador decorativo que gira al abrirse", () => {
  const { MetroList } = compilar("components/metro-list.tsx", dobleCiclo().dobles)
  const estaciones = nodos(MetroList({ onBack() {} }), (n) => n.type === "details").slice(0, 16)
  assert.equal(estaciones.length, 16)
  for (const d of estaciones) {
    assert.match(String(d.props.className), /\bgroup\b/)
    const [resumen] = nodos(d, (n) => n.type === "summary")
    const iconos = nodos(resumen, (n) => n.props["aria-hidden"] === "true" && /group-open:rotate-180/.test(String(n.props.className)))
    assert.equal(iconos.length, 1, texto(resumen))
    const clases = String(resumen.props.className)
    assert.match(clases, /\blist-none\b/, "sin ocultar el marcador nativo habría dos indicadores")
    assert.ok(clases.includes("[&::-webkit-details-marker]:hidden"), "sin ocultar el marcador nativo de WebKit habría dos indicadores")
  }
})

test("MetroList: al salir antes de terminar corta su propia locución", () => {
  const c = dobleCiclo()
  const { MetroList } = compilar("components/metro-list.tsx", c.dobles)
  MetroList({ onBack() {} })
  assert.equal(c.estado.cancelaciones, 0, "no corta al montar")
  c.desmontar()
  assert.equal(c.estado.cancelaciones, 1, "la locución larga no sigue sonando fuera de la pantalla")
})

test("MetroList: al salir no corta una locución más nueva del padre", () => {
  const c = dobleCiclo()
  const { MetroList } = compilar("components/metro-list.tsx", c.dobles)
  MetroList({ onBack() {} })
  c.hablar("Modo baja visión") // anuncio posterior del padre al cambiar de modo
  c.desmontar()
  assert.equal(c.estado.cancelaciones, 0, "la voz del padre sigue")
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
