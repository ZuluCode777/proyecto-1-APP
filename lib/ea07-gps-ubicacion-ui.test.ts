import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import * as geo from "./geo"
import * as rutas from "./routes"
import * as ubicacion from "./ubicacion"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * Prueba de la RAMA DE UI real de `components/auditory-gps.tsx` (EA-07, #33) con
 * la misma técnica TSX/VM de EA-08: compila el componente, lo ejecuta con hooks
 * de React simulados y dobles del navegador (geolocalización, orientación,
 * síntesis de voz). Cubre los criterios de aceptación de la tarea:
 *
 * - Una sola adquisición/suscripción por sesión: activar dos veces no crea dos
 *   `watchPosition` ni pide permiso de orientación dos veces.
 * - Montaje/desmontaje sin fugas: al desmontar se llama `clearWatch` y se
 *   retiran los oyentes de orientación; un callback de posición TARDÍO tras el
 *   desmontaje no toca estado.
 * - Llegada SEGURA: a 20 m con precisión 200 m no se anuncia llegada; con buena
 *   precisión sí.
 * - Rumbo RELATIVO (alpha sin referencia absoluta) NO confirma un giro: la
 *   indicación cae a una referencia cardinal, no a «a tu derecha»/«de frente».
 */

const datos = TransmilenioDataSchema.parse(snapshot)
const asentar = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

type Elemento = { type: unknown; props: Record<string, unknown> }

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
    useMemo(f: () => unknown, nuevas: unknown[]) {
      const i = cursor++
      const previas = deps[i]
      if (!previas || nuevas.some((d, j) => d !== previas[j])) { deps[i] = nuevas; estados[i] = f() }
      return estados[i]
    },
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

/** Ejecuta `lib/ubicacion.ts` en un realm con el `Date` dado (para el reloj simulado). */
function compilarUbicacion(DateImpl: DateConstructor): typeof ubicacion {
  const salida = ts.transpileModule(readFileSync(`${process.cwd()}/lib/ubicacion.ts`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const modulo = { exports: {} as Record<string, unknown> }
  const require = (nombre: string) => {
    if (nombre === "@/lib/geo") return geo
    throw new Error(`Import no previsto en ubicacion: ${nombre}`)
  }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, { Date: DateImpl, Number, Math })(require, modulo, modulo.exports)
  return modulo.exports as unknown as typeof ubicacion
}

/** Compila `auditory-gps.tsx` con los dobles dados y la ventana simulada. */
function compilar(react: object, dobles: Record<string, unknown>, ventana: Record<string, unknown>, ahora?: () => number) {
  const salida = ts.transpileModule(readFileSync(`${process.cwd()}/components/auditory-gps.tsx`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  // Si se da un reloj, `Date.now()` dentro del componente lo usa. Para que la
  // política de ubicación vea el MISMO reloj (y no el real), se compila una copia
  // de `@/lib/ubicacion` en este sandbox cuando hay reloj; si no, se usa la real.
  const DateSandbox = ahora
    ? (new Proxy(Date, { get: (t, p) => (p === "now" ? ahora : Reflect.get(t, p)) }) as DateConstructor)
    : Date
  const ubicacionSandbox = ahora ? compilarUbicacion(DateSandbox) : ubicacion
  const hijos: Record<string, unknown> = {}
  const require = (nombre: string) => {
    if (nombre === "react") return react
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/geo") return geo
    if (nombre === "@/lib/routes") return rutas
    if (nombre === "@/lib/ubicacion") return ubicacionSandbox
    if (nombre in dobles) return dobles[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/") || nombre.startsWith("@/lib/")) {
      return (hijos[nombre] ??= new Proxy({}, { get: () => function Componente() {} }))
    }
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (...a: unknown[]) => Elemento> }
  const sandbox = {
    console,
    Promise,
    Date: DateSandbox,
    Math,
    setTimeout,
    clearTimeout,
    navigator: ventana.navigator,
    window: ventana.window,
    // Reloj monotónico del navegador (`performance.now()`): fija la escala de `event.timeStamp`.
    performance: ventana.performance,
  }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, sandbox)(require, modulo, modulo.exports)
  return modulo.exports
}

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
/** Botón «Activar mi ubicación» (el único con ese texto antes de activar). */
const botonActivar = (arbol: unknown) =>
  nodos(arbol, (n) => n.type === "button").find((b) => texto(b.props.children).includes("Activar mi ubicación"))
/** Botones «Oriéntame por voz» de cada estación cercana. */
const botonesOrientar = (arbol: unknown) =>
  nodos(arbol, (n) => n.type === "button").filter((b) => texto(b.props.children).includes("Oriéntame por voz"))

/** Doble de geolocalización que registra watchers y expone sus callbacks. */
function crearGeo() {
  let id = 0
  const watchers = new Map<number, { ok: (p: unknown) => void; err: (e: unknown) => void }>()
  const limpiados: number[] = []
  return {
    watchLlamadas: 0,
    watchers,
    limpiados,
    api: {
      watchPosition(ok: (p: unknown) => void, err: (e: unknown) => void) {
        const n = ++id
        watchers.set(n, { ok, err })
        return n
      },
      clearWatch(n: number) { limpiados.push(n); watchers.delete(n) },
    },
    get watchCount() { return id },
    emitir(lat: number, lng: number, accuracy: number | null, hora = Date.now()) {
      for (const w of watchers.values()) w.ok({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: hora })
    },
  }
}

/**
 * Doble de `DeviceOrientationEvent`/listeners de la ventana. `mono` es el reloj
 * monotónico (`performance.now()`): los eventos llevan por defecto un `timeStamp`
 * de AHORA en esa escala, como los eventos reales del navegador; una prueba puede
 * pasar su propio `timeStamp` (retrasado, ausente, inválido, futuro).
 */
function crearReloj() {
  let ahora = Date.now()
  let siguiente = 0
  const pendientes = new Map<number, { cuando: number; fn: () => void }>()
  return {
    ahora: () => ahora,
    pendientes: () => pendientes.size,
    setTimeout(fn: () => void, ms: number) {
      const id = ++siguiente
      pendientes.set(id, { cuando: ahora + ms, fn })
      return id
    },
    clearTimeout(id: number) { pendientes.delete(id) },
    avanzar(ms: number) {
      ahora += ms
      for (const [id, t] of [...pendientes]) {
        if (t.cuando <= ahora) { pendientes.delete(id); t.fn() }
      }
    },
  }
}

function crearVentanaOrientacion(extra: Record<string, unknown> = {}, mono: () => number = () => performance.now()) {
  const oyentes = new Map<string, Set<(e: unknown) => void>>()
  const reloj = crearReloj()
  const win: Record<string, unknown> = {
    DeviceOrientationEvent: function () {},
    addEventListener(tipo: string, fn: (e: unknown) => void) { (oyentes.get(tipo) ?? oyentes.set(tipo, new Set()).get(tipo)!).add(fn) },
    removeEventListener(tipo: string, fn: (e: unknown) => void) { oyentes.get(tipo)?.delete(fn) },
    open() {},
    setTimeout: reloj.setTimeout,
    clearTimeout: reloj.clearTimeout,
    ...extra,
  }
  return {
    window: win,
    reloj,
    mono,
    oyentes,
    /** Total de oyentes de orientación vivos (deviceorientation*). */
    vivos() {
      let n = 0
      for (const [tipo, set] of oyentes) if (tipo.startsWith("deviceorientation")) n += set.size
      return n
    },
    emitir(tipo: string, evento: Record<string, unknown>) {
      for (const fn of oyentes.get(tipo) ?? []) fn({ type: tipo, timeStamp: mono(), ...evento })
    },
  }
}

/** Monta el componente con los dobles dados y expone render/voz. */
function montar({ geoApi, win, voz, ahora, mono }: { geoApi: unknown; win: Record<string, unknown>; voz: string[]; ahora?: () => number; mono?: () => number }) {
  const hooks = crearHooks()
  const useSpeech = () => ({ speak: (t: string) => { voz.push(t) } })
  const navigator = { geolocation: geoApi }
  const exports = compilar(hooks, { "@/hooks/use-speech": { useSpeech } }, { navigator, window: win, performance: mono ? { now: mono } : performance }, ahora)
  const AuditoryGps = exports.AuditoryGps as (p: unknown) => Elemento
  const render = () => {
    hooks.iniciar()
    const a = AuditoryGps({ data: datos, onBack() {} })
    hooks.ejecutarEfectos()
    return a
  }
  return { hooks, render }
}

// ── Una sola suscripción por sesión ──

test("doble activación: una sola `watchPosition` por sesión", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  // Primera activación.
  ;(botonActivar(render())!.props.onClick as () => void)()
  // Segunda pulsación del mismo botón (aún visible si no llegó posición).
  const activar2 = botonActivar(render())
  if (activar2) (activar2.props.onClick as () => void)()
  assert.equal(geoDoble.watchCount, 1, "solo se crea un watcher pese a dos activaciones")
})

test("GPS ignora capturas no vigentes y retira mapa, lista y recursos cuando vence la última captura", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz, ahora: vent.reloj.ahora })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  for (const hora of [vent.reloj.ahora() - ubicacion.EDAD_MAXIMA_POSICION_MS - 1, undefined]) {
    const callback = [...geoDoble.watchers.values()][0]
    callback.ok({ coords: { latitude: est.lat, longitude: est.lng, accuracy: 10 }, timestamp: hora })
    const arbol = render()
    assert.equal(nodos(arbol, (n) => Array.isArray(n.props?.markers)).length, 0, "no presenta una captura no vigente")
    assert.equal(botonesOrientar(arbol).length, 0)
  }
  geoDoble.emitir(est.lat, est.lng, 10, vent.reloj.ahora())
  let arbol = render()
  assert.equal(nodos(arbol, (n) => Array.isArray(n.props?.markers)).length, 1, "una captura vigente sí se presenta")
  assert.equal(vent.reloj.pendientes(), 1, "un único vencimiento de la captura")
  vent.reloj.avanzar(ubicacion.EDAD_MAXIMA_POSICION_MS + 1)
  arbol = render()
  assert.equal(nodos(arbol, (n) => Array.isArray(n.props?.markers)).length, 0)
  assert.equal(botonesOrientar(arbol).length, 0)
  assert.doesNotMatch(texto(arbol), /Estaciones cercanas/)
  assert.match(texto(arbol), /ya no está actualizada/)
  assert.ok(botonActivar(arbol), "permite solicitar una captura nueva")
  assert.equal(geoDoble.watchers.size, 0)
  assert.equal(vent.vivos(), 0)
  assert.equal(vent.reloj.pendientes(), 0)
  ;(botonActivar(arbol)!.props.onClick as () => void)()
  assert.equal(geoDoble.watchCount, 2)
  geoDoble.emitir(est.lat, est.lng, 10, vent.reloj.ahora())
  assert.equal(nodos(render(), (n) => Array.isArray(n.props?.markers)).length, 1)
})

test("renovar captura sustituye su vencimiento y desmontar elimina el temporizador sin efectos tardíos", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { hooks, render } = montar({ geoApi: geoDoble.api, win: vent.window, voz, ahora: vent.reloj.ahora })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat, est.lng, 10, vent.reloj.ahora())
  render()
  vent.reloj.avanzar(30_000)
  geoDoble.emitir(est.lat, est.lng, 10, vent.reloj.ahora())
  render()
  assert.equal(vent.reloj.pendientes(), 1, "reemplaza el temporizador anterior")
  vent.reloj.avanzar(30_001)
  assert.equal(nodos(render(), (n) => Array.isArray(n.props?.markers)).length, 1, "el plazo anterior no vence la captura nueva")
  assert.equal(geoDoble.watchers.size, 1)
  hooks.desmontar()
  assert.equal(vent.reloj.pendientes(), 0)
  assert.equal(geoDoble.watchers.size, 0)
  assert.equal(vent.vivos(), 0)
  voz.length = 0
  vent.reloj.avanzar(ubicacion.EDAD_MAXIMA_POSICION_MS + 1)
  assert.deepEqual(voz, [], "ningún aviso tardío tras salir")
})

test("desmontar retira el watcher y los oyentes de orientación (sin fugas)", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { hooks, render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  assert.ok(vent.vivos() >= 1, "hay al menos un oyente de orientación tras activar")
  hooks.desmontar()
  assert.equal(geoDoble.limpiados.length, 1, "se llamó clearWatch al desmontar")
  assert.equal(vent.vivos(), 0, "no quedan oyentes de orientación tras desmontar")
})

test("un callback de posición TARDÍO tras desmontar no actualiza (no lanza)", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { hooks, render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const watcher = [...geoDoble.watchers.values()][0]
  hooks.desmontar()
  // El navegador entrega una posición después de salir: no debe tocar estado.
  assert.doesNotThrow(() => watcher.ok({ coords: { latitude: 4.6, longitude: -74.1, accuracy: 5 }, timestamp: Date.now() }))
})

// ── Llegada segura ──

test("llegada: a 20 m con precisión 200 m NO se anuncia llegada", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  // Coloca la persona ~20 m al norte de la primera estación, con precisión 200 m.
  const est = datos.stations[0]
  const lat = est.lat + 20 / 111_320
  geoDoble.emitir(lat, est.lng, 200)
  const arbol = render()
  // Elige guiar a esa estación (será una de las cercanas).
  const orientar = botonesOrientar(arbol)[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  render()
  assert.ok(!voz.some((v) => /muy cerca/.test(v)), "no se anuncia llegada con precisión insuficiente")
})

test("llegada: muy cerca y con buena precisión sí anuncia (cercanía, sin prometer acceso)", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  const lat = est.lat + 10 / 111_320 // ~10 m
  geoDoble.emitir(lat, est.lng, 8)
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  // La llegada se evalúa en el render posterior a fijar el destino (target).
  render()
  const aviso = voz.find((v) => /muy cerca/.test(v))
  assert.ok(aviso, "se anuncia cercanía con buena precisión")
  assert.ok(/referencia aproximada/.test(aviso!), "el aviso no promete acceso: lo llama referencia aproximada")
})

// ── Rumbo relativo no confirma giro ──

test("rumbo RELATIVO (alpha) no produce giro: la orientación cae a cardinal", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  // Evento de orientación RELATIVO (sin absolute, no es deviceorientationabsolute).
  vent.emitir("deviceorientation", { alpha: 90, absolute: false })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(!/a tu derecha|a tu izquierda|de frente|date la vuelta/.test(guia), "no da un giro relativo con rumbo relativo")
  assert.ok(/orientación aproximada/.test(guia), "cae a referencia cardinal con aviso de aproximación")
})

test("rumbo ABSOLUTO con calidad REAL conocida (iOS) sí habilita indicación relativa", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(!/orientación aproximada/.test(guia), "con rumbo absoluto de calidad conocida no usa el aviso cardinal")
  assert.match(guia, /de frente|a tu derecha|a tu izquierda|detrás de ti/, "da una indicación relativa")
})

test("rumbo ABSOLUTO SIN calidad conocida (alpha absoluto, sin accuracy) cae a cardinal", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  vent.emitir("deviceorientationabsolute", { alpha: 0, absolute: true })
  vent.emitir("deviceorientation", { webkitCompassHeading: 0 }) // iOS sin `webkitCompassAccuracy`
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(!/a tu derecha|a tu izquierda|de frente|detrás de ti/.test(guia), "sin calidad no afirma un giro")
  assert.ok(/orientación aproximada/.test(guia), "cae a cardinal")
})

// ── GPS impreciso no ordena giro (hueco 1) ──

/** Voz de la indicación al orientar y al repetir, con la persona a `metros` al norte de la estación 0. */
function guiaConPrecision(metros: number, precision: number | null, rumbo: Record<string, unknown>) {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + metros / 111_320, est.lng, precision)
  vent.emitir("deviceorientation", rumbo)
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  ;(orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  const repetir = nodos(render(), (n) => n.type === "button").find((b) => texto(b.props.children).includes("Repetir indicación"))!
  voz.length = 0
  ;(repetir.props.onClick as () => void)()
  return { guia, repetida: voz.join(" "), todo: voz }
}
const GIRO = /a tu derecha|a tu izquierda|de frente|detrás de ti|date la vuelta/

test("hueco 1: 20 m con precisión 200 m y brújula iOS buena NO ordena giro (orientar ni repetir)", () => {
  // Rumbo 0 (norte) con calidad 5: sin la corrección dice «detrás de ti, date la vuelta».
  const { guia, repetida } = guiaConPrecision(20, 200, { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  for (const texto of [guia, repetida]) {
    assert.doesNotMatch(texto, GIRO, "no da giro con posición imprecisa")
    assert.match(texto, /margen de error/, "explica el límite en vez de callar")
  }
})

test("hueco 1: precisión 100 m a 300 m solo da cardinal estimado, nunca giro", () => {
  const { guia } = guiaConPrecision(300, 100, { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  assert.doesNotMatch(guia, GIRO)
  assert.match(guia, /orientación aproximada/)
  assert.match(guia, /imprecisa/)
})

test("hueco 1: precisión desconocida (accuracy ausente) tampoco permite giro", () => {
  const { guia } = guiaConPrecision(300, null, { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  assert.doesNotMatch(guia, GIRO)
  assert.match(guia, /orientación aproximada/)
})

test("hueco 1: precisión buena (10 m) a 300 m con brújula buena SÍ da giro", () => {
  const { guia } = guiaConPrecision(300, 10, { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  assert.match(guia, GIRO)
})

// ── H3: rumbo VENCIDO al orientar (no al recibir) cae a cardinal ──

test("H3: un rumbo absoluto que envejece >2 s se valida al orientar y cae a cardinal", () => {
  let t = 1_000_000
  const mono = () => t - 500_000 // reloj monotónico simulado, en la misma escala que `timeStamp`
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion({}, mono)
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz, ahora: () => t, mono })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10, t)
  render()
  // Rumbo absoluto y de buena calidad en el instante t.
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  // Pasan 2001 ms antes de pedir orientación: el rumbo ya no es fresco.
  t += 2_001
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(!/a tu derecha|a tu izquierda|de frente|date la vuelta/.test(guia), "rumbo vencido no da giro")
  assert.ok(/orientación aproximada/.test(guia), "cae a cardinal por rumbo vencido")
})

// ── H4: calidad de brújula iOS ──

test("H4: webkitCompassAccuracy -1 (calibración desconocida) no da giro", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: -1 })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(/orientación aproximada/.test(guia), "mala calidad iOS cae a cardinal")
})

test("H4: mala calidad TRAS una buena invalida el giro (se revalida al orientar)", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5 }) // buena
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: -1 }) // luego mala
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(/orientación aproximada/.test(guia), "no retiene el rumbo bueno anterior")
})

test("H4: un evento sin dato de orientación invalida el rumbo previo", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5 }) // buena
  vent.emitir("deviceorientation", {}) // evento vacío: invalida
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(/orientación aproximada/.test(guia), "evento vacío invalida el rumbo previo")
})

test("H4: deviceorientationabsolute con absolute=false NO cuenta como absoluto", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  // Evento llamado «absolute» pero con la bandera en false: es relativo.
  vent.emitir("deviceorientationabsolute", { alpha: 90, absolute: false })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  if (orientar) (orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.ok(/orientación aproximada/.test(guia), "el nombre del evento no basta: absolute=false es relativo")
})

// ── B: la edad del rumbo se cuenta desde la CAPTURA del evento, no desde su recepción ──

/** Orienta con posición fresca/10 m, estación a 300 m y UN evento iOS bueno con el `timeStamp` dado. */
function guiaConEvento(timeStamp: (mono: () => number, ahora: () => number) => unknown, claves: Record<string, unknown> = {}) {
  let t = 1_800_000_000_000 // epoch realista (> 1e12) para distinguirlo de la escala relativa
  const mono = () => t - 1_799_000_000_000 // escala de `performance.now()`
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion({}, mono)
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz, ahora: () => t, mono })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const est = datos.stations[0]
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10, t)
  render()
  // El evento se ENTREGA ahora, pero lleva el `timeStamp` de su captura.
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5, timeStamp: timeStamp(mono, () => t), ...claves })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  ;(orientar.props.onClick as () => void)()
  return voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
}

test("B: evento ENTREGADO tarde (capturado hace 10 s) no da giro: cae a cardinal", () => {
  const guia = guiaConEvento((mono) => mono() - 10_000)
  assert.doesNotMatch(guia, GIRO, "un rumbo capturado hace 10 s no ordena un giro aunque llegue ahora")
  assert.match(guia, /orientación aproximada/)
})

test("B: evento fresco con `timeStamp` válido (relativo) sí da giro", () => {
  const guia = guiaConEvento((mono) => mono() - 500)
  assert.match(guia, GIRO)
})

test("B: `timeStamp` epoch (plataformas que lo entregan así) se normaliza: viejo cae a cardinal, fresco da giro", () => {
  assert.doesNotMatch(guiaConEvento((_m, ahora) => ahora() - 10_000), GIRO)
  assert.match(guiaConEvento((_m, ahora) => ahora() - 500), GIRO)
})

test("B: `timeStamp` ausente, inválido o futuro no se fabrica como captura fresca: cae a cardinal", () => {
  const invalidos: Array<[string, (mono: () => number) => unknown]> = [
    ["ausente", () => undefined],
    ["NaN", () => Number.NaN],
    ["cero", () => 0],
    ["negativo", () => -5],
    ["texto", () => "ahora"],
    ["futuro", (mono) => mono() + 60_000],
  ]
  for (const [nombre, marca] of invalidos) {
    const guia = guiaConEvento((mono) => marca(mono))
    assert.doesNotMatch(guia, GIRO, `${nombre}: sin fecha verificable no hay giro`)
    assert.match(guia, /orientación aproximada/, nombre)
  }
})

test("B: sin reloj monotónico (`performance`) un `timeStamp` relativo no se puede verificar y cae a cardinal", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz, mono: () => Number.NaN })
  ;(botonActivar(render())!.props.onClick as () => void)()
  geoDoble.emitir(datos.stations[0].lat + 300 / 111_320, datos.stations[0].lng, 10)
  vent.emitir("deviceorientation", { webkitCompassHeading: 0, webkitCompassAccuracy: 5, timeStamp: 1234 })
  voz.length = 0
  ;(botonesOrientar(render())[0].props.onClick as () => void)()
  assert.doesNotMatch(voz.join(" "), GIRO)
})

// ── H6: reintento tras denegación; concesión tardía no deja oyentes ──

test("H6: tras denegar (code 1) la sesión se resetea y se puede reintentar", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  assert.equal(geoDoble.watchCount, 1, "primera adquisición")
  // El navegador rechaza por permiso denegado.
  const w1 = [...geoDoble.watchers.values()][0]
  voz.length = 0
  w1.err({ code: 1, message: "User denied Geolocation" })
  const arbol = render()
  assert.ok(voz.some((v) => /volver a tocar|reintentar/i.test(v)), "explica que puede reintentar")
  // El botón «Activar» vuelve a estar disponible y una nueva pulsación adquiere.
  const activar = botonActivar(arbol)
  assert.ok(activar, "el botón de activar sigue disponible tras la denegación")
  ;(activar!.props.onClick as () => void)()
  assert.equal(geoDoble.watchCount, 2, "reintento crea una nueva adquisición (sin acumular la anterior)")
  assert.equal(geoDoble.limpiados.length, 1, "la sesión fallida liberó su watcher")
})

// ── Identidad de sesión (hueco 2) ──

/** Marcadores que recibe el mapa en el último render (el del usuario es `kind: "user"`). */
const marcadorUsuario = (arbol: unknown) =>
  (nodos(arbol, (n) => Array.isArray(n.props?.markers))[0]?.props.markers as Array<{ kind: string; lat: number; lng: number }> | undefined)?.find(
    (m) => m.kind === "user",
  )

test("hueco 2: callbacks éxito/error de la sesión A (fallida) no afectan a la B (marcador, voz, watcher)", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  const est = datos.stations[0]
  ;(botonActivar(render())!.props.onClick as () => void)()
  const wA = [...geoDoble.watchers.values()][0]
  wA.err({ code: 1 })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const idB = geoDoble.watchCount
  assert.equal(idB, 2, "B es una adquisición nueva")
  geoDoble.emitir(est.lat, est.lng, 8)
  assert.equal(marcadorUsuario(render())?.lat, est.lat, "B colocó el marcador")
  voz.length = 0
  // Callbacks VIEJOS de A: éxito con otra coordenada y luego error terminal.
  wA.ok({ coords: { latitude: est.lat + 0.1, longitude: est.lng + 0.1, accuracy: 5 }, timestamp: Date.now() })
  wA.err({ code: 1 })
  const arbol = render()
  assert.equal(marcadorUsuario(arbol)?.lat, est.lat, "el marcador sigue en la coordenada de B")
  assert.equal(marcadorUsuario(arbol)?.lng, est.lng)
  assert.deepEqual(voz, [], "los callbacks viejos no hablan")
  assert.ok(!geoDoble.limpiados.includes(idB), "el watcher B sigue vivo")
  assert.ok(geoDoble.watchers.has(idB))
  assert.equal(botonActivar(arbol), undefined, "B sigue activa: el botón de activar no reaparece")
  assert.doesNotMatch(texto(arbol), /No pude obtener|No diste permiso/, "no se muestra el error de A")
})

test("hueco 2: oyente de orientación de A (viejo) no escribe el rumbo de B", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  const est = datos.stations[0]
  ;(botonActivar(render())!.props.onClick as () => void)()
  const manejadorA = [...(vent.oyentes.get("deviceorientation") ?? [])][0]
  geoDoble.watchers.get(1)!.err({ code: 1 })
  assert.equal(vent.vivos(), 0, "A retiró sus oyentes")
  ;(botonActivar(render())!.props.onClick as () => void)()
  geoDoble.emitir(est.lat + 300 / 111_320, est.lng, 10)
  render()
  // El manejador viejo de A dispara con una brújula «buena»: no debe contar para B.
  manejadorA({ type: "deviceorientation", webkitCompassHeading: 0, webkitCompassAccuracy: 5 })
  const orientar = botonesOrientar(render())[0]
  voz.length = 0
  ;(orientar.props.onClick as () => void)()
  const guia = voz.find((v) => /Te oriento hacia/.test(v)) ?? ""
  assert.match(guia, /orientación aproximada/, "B sigue sin rumbo fiable")
  assert.doesNotMatch(guia, GIRO)
})

test("hueco 2: permiso de orientación TARDÍO tras fallo+reintento o desmontaje no deja oyentes", async () => {
  const resolvers: Array<(estado: "granted" | "denied") => void> = []
  const requestPermission = () => new Promise<"granted" | "denied">((r) => { resolvers.push(r) })
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion({ DeviceOrientationEvent: Object.assign(function () {}, { requestPermission }) })
  const voz: string[] = []
  const { hooks, render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)() // A: permiso pendiente
  geoDoble.watchers.get(1)!.err({ code: 1 }) // A falla
  ;(botonActivar(render())!.props.onClick as () => void)() // B: permiso pendiente
  assert.equal(resolvers.length, 2)
  resolvers[0]("granted") // A concede tarde
  await asentar()
  assert.equal(vent.vivos(), 0, "el permiso tardío de A no añade oyentes")
  resolvers[1]("granted") // B concede a tiempo
  await asentar()
  assert.equal(vent.vivos(), 1, "el de B sí queda activo (uno solo)")
  hooks.desmontar()
  assert.equal(vent.vivos(), 0, "desmontar retira el oyente de B")
  // Desmontaje antes de conceder: tampoco queda oyente.
  const vent2 = crearVentanaOrientacion({ DeviceOrientationEvent: Object.assign(function () {}, { requestPermission }) })
  const m2 = montar({ geoApi: crearGeo().api, win: vent2.window, voz })
  ;(botonActivar(m2.render())!.props.onClick as () => void)()
  m2.hooks.desmontar()
  resolvers[2]("granted")
  await asentar()
  assert.equal(vent2.vivos(), 0, "permiso concedido tras desmontar no registra oyente")
})

test("hueco 2: éxito de A tras desmontar no toca estado ni voz", () => {
  const geoDoble = crearGeo()
  const vent = crearVentanaOrientacion()
  const voz: string[] = []
  const { hooks, render } = montar({ geoApi: geoDoble.api, win: vent.window, voz })
  ;(botonActivar(render())!.props.onClick as () => void)()
  const watcher = [...geoDoble.watchers.values()][0]
  hooks.desmontar()
  voz.length = 0
  watcher.ok({ coords: { latitude: 4.6, longitude: -74.1, accuracy: 5 }, timestamp: Date.now() })
  watcher.err({ code: 1 })
  const arbol = render()
  assert.equal(marcadorUsuario(arbol), undefined, "ningún marcador nuevo")
  assert.deepEqual(voz, [])
})
