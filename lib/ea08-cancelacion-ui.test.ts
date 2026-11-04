import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import * as consultaAgente from "./consulta-agente"
import * as localAgent from "./local-agent"
import * as rutas from "./routes"
import * as seleccion from "./seleccion-interprete"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * Regresión del issue #34 (EA-08) en la RAMA DE UI real: ejecuta el TSX de
 * `TotalAgent` y `VoiceOverlay` con hooks de React simulados, un reconocimiento
 * de voz que se comporta como el navegador (`abort()` emite `error: "aborted"`),
 * un `fetch` controlado y un RELOJ SIMULADO para los temporizadores del
 * componente.
 *
 * Para la decisión E (identidad de locución), los escenarios de voz usan el
 * gancho REAL `useSpeech` con una síntesis tipo Chrome cuyo `cancel()` entrega
 * los eventos `error` de forma ASÍNCRONA (en otra tarea), para reproducir la
 * carrera de eventos del navegador. El resto usa un doble estable de `useSpeech`.
 *
 * Cubre: E (salir calla la última locución propia; una segunda pregunta rápida
 * o escrita durante el saludo y salir → calla; `changeMode` del padre mientras
 * el asistente habla no se corta; la respuesta que navega no se cancela); R1
 * (salir con `fetch` que ignora la señal no habla ni navega); R3 (toque en
 * «Pensando…» aborta y libera `busyRef`); M13 (fallo no-abort → aviso
 * recuperable); F (permiso pendiente con cota de 15 s, cancelable, `busyRef`
 * libre); G (cancelar durante `permissions.query` / permiso denegado no anuncia
 * espera); M16 (frase `unknown` no pide ni adjunta la ubicación); R2 (gancho y
 * superposición reales no reinician tras `no-speech`); AC2 (sin pausas por
 * paso); cerrar aborta; `aria-label` dinámico.
 */

const datos = TransmilenioDataSchema.parse(snapshot)
/** Deja avanzar microtareas Y macrotareas reales (el respaldo/`consultarAgente` usa ambas). */
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

/** Reloj de temporizadores SIMULADO para el `window` del componente. */
function crearReloj() {
  let ahora = 0
  let id = 0
  const pendientes = new Map<number, { cuando: number; fn: () => void }>()
  return {
    setTimeout(fn: () => void, ms = 0) { const n = ++id; pendientes.set(n, { cuando: ahora + ms, fn }); return n },
    clearTimeout(n: number) { pendientes.delete(n) },
    avanzar(ms: number) {
      ahora += ms
      for (const [n, t] of [...pendientes].sort((a, b) => a[1].cuando - b[1].cuando)) {
        if (t.cuando <= ahora) { pendientes.delete(n); t.fn() }
      }
    },
    /** Nº de temporizadores aún pendientes (para comprobar limpiezas). */
    pendientes: () => pendientes.size,
  }
}

/** Compila un componente/módulo TSX del proyecto y lo ejecuta con los dobles dados. */
function compilar(archivo: string, react: object, dobles: Record<string, unknown>, ventana: Record<string, unknown> = {}) {
  const salida = ts.transpileModule(readFileSync(`${process.cwd()}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const hijos: Record<string, unknown> = {}
  const require = (nombre: string) => {
    if (nombre === "react") return react
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/routes") return rutas
    if (nombre === "@/lib/local-agent") return localAgent
    if (nombre === "@/lib/consulta-agente") return consultaAgente
    if (nombre === "@/lib/seleccion-interprete") return seleccion
    if (nombre in dobles) return dobles[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/") || nombre.startsWith("@/lib/")) {
      return (hijos[nombre] ??= new Proxy({}, { get: () => function Componente() {} }))
    }
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (...a: unknown[]) => Elemento> }
  const sandbox = {
    console,
    setTimeout: (ventana.setTimeout as typeof setTimeout) ?? setTimeout,
    clearTimeout: (ventana.clearTimeout as typeof clearTimeout) ?? clearTimeout,
    Promise,
    AbortController,
    DOMException,
    Response,
    Event,
    EventTarget,
    SpeechSynthesisUtterance: ventana.SpeechSynthesisUtterance,
    get fetch() { return globalThis.fetch },
    navigator: { geolocation: undefined, vibrate: () => true, permissions: undefined, ...(ventana.navigator as object) },
    window: { setTimeout, clearTimeout, ...ventana },
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
const botonPrincipal = (arbol: unknown) =>
  nodos(arbol, (n) => n.type === "button" && typeof n.props?.["aria-label"] === "string")[0]
const idEntrada = (arbol: unknown) => nodos(arbol, (n) => n.props?.id === "agent-text")[0]
const formulario = (arbol: unknown) => nodos(arbol, (n) => n.type === "form")[0]

/** Reconocimiento de voz simulado que se comporta como el navegador. */
class ReconocimientoSimulado {
  static instancias: ReconocimientoSimulado[] = []
  inicios = 0
  abortos = 0
  detenciones = 0
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null = null
  constructor() { ReconocimientoSimulado.instancias.push(this) }
  start() { this.inicios++; this.onstart?.() }
  stop() { this.detenciones++; this.onend?.() }
  // Chrome: abort() emite onerror("aborted") y luego onend.
  abort() { this.abortos++; this.onerror?.({ error: "aborted" }); this.onend?.() }
}

/** Doble ESTABLE del gancho de voz que delega en la instancia simulada. */
function hookVoz(listening = false) {
  let api: { listening: boolean; supported: boolean; start: () => void; stop: () => void; abort: () => void } | null = null
  return ({ onResult, onError }: { onResult: (t: string) => void; onError: (e: string) => void }) => {
    const rec = ReconocimientoSimulado.instancias[0] ?? new ReconocimientoSimulado()
    rec.onresult = (e) => onResult(e.results[0][0].transcript)
    rec.onerror = (e) => onError(e.error)
    api ??= { listening, supported: true, start: () => rec.start(), stop: () => rec.stop(), abort: () => rec.abort() }
    return api
  }
}

/** Locución simulada: como `SpeechSynthesisUtterance`, con oyentes de `end`/`error`. */
class LocucionSimulada {
  oyentes: Record<string, Array<() => void>> = {}
  texto: string
  constructor(texto: string) { this.texto = texto }
  addEventListener(tipo: string, fn: () => void) { (this.oyentes[tipo] ??= []).push(fn) }
}

/**
 * Doble ESTABLE del módulo `@/hooks/use-speech` para las pruebas que no usan la
 * síntesis real: `speak` devuelve una `LocucionSimulada` y registra la última
 * (como el `ultimaLocucion` de módulo del gancho real); `esUltimaLocucion`
 * comprueba la identidad; `cancel` cuenta. Se devuelve el objeto completo del
 * módulo (incluido `esUltimaLocucion`), que `total-agent.tsx` importa.
 */
function dobleVoz(
  voz: string[],
  useVoiceRecognition: unknown,
  estado?: { cancelaciones: number },
) {
  let ultima: LocucionSimulada | null = null
  const api = {
    speak: (t: string) => {
      voz.push(t)
      const locucion = new LocucionSimulada(t)
      ultima = locucion
      return locucion
    },
    cancel: () => { if (estado) estado.cancelaciones++ },
  }
  return {
    useSpeech: () => api,
    useVoiceRecognition,
    esUltimaLocucion: (locucion: LocucionSimulada | null | undefined) => locucion != null && ultima === locucion,
  }
}

/** Locución tipo `SpeechSynthesisUtterance` (EventTarget) para la síntesis real. */
class Utt extends EventTarget {
  text: string
  lang = ""
  rate = 1
  pitch = 1
  constructor(t: string) { super(); this.text = t }
}

/**
 * `speechSynthesis` tipo Chrome: `cancel()` entrega el evento `error` de las
 * locuciones pendientes en OTRA TAREA (asíncrono), como el navegador. Permite
 * reproducir la carrera de eventos que rompe una bandera booleana (decisión E).
 */
function crearSintesis() {
  const reg: string[] = []
  const s = {
    reg,
    hablando: null as Utt | null,
    cola: [] as Utt[],
    speak(u: Utt) {
      reg.push(`speak:${u.text.slice(0, 24)}`)
      if (!s.hablando) s.hablando = u
      else s.cola.push(u)
    },
    cancel() {
      reg.push("cancel")
      const pendientes = [s.hablando, ...s.cola].filter(Boolean) as Utt[]
      s.hablando = null
      s.cola.length = 0
      for (const u of pendientes) setTimeout(() => u.dispatchEvent(new Event("error")), 0)
    },
    terminar() {
      const u = s.hablando
      if (!u) return
      s.hablando = null
      u.dispatchEvent(new Event("end"))
      s.hablando = s.cola.shift() ?? null
    },
  }
  return s
}

// ── Decisión E: identidad de locución, con síntesis tipo Chrome (async) ──

/**
 * Monta `TotalAgent` con el gancho `useSpeech` REAL y una síntesis asíncrona.
 * Si `desmontarAlNavegar`, el padre desmonta en `onAction` (como la app real).
 * `hablaOtraPantalla` emite voz con el MISMO módulo `use-speech` pero desde una
 * instancia de hooks propia (otra pantalla), para el caso `changeMode`.
 */
function montarConSintesisReal(desmontarAlNavegar = false) {
  const hooks = crearHooks()
  const sint = crearSintesis()
  const ventana = { speechSynthesis: sint, SpeechSynthesisUtterance: Utt }
  const hook = compilar("hooks/use-speech.ts", hooks, {}, ventana) as unknown as {
    useSpeech: () => { speak: (t: string, o?: { queue?: boolean }) => Utt | undefined; cancel: () => void }
    useVoiceRecognition: unknown
  }
  const rec = { listening: false, supported: true, start() {}, stop() {}, abort() {} }
  const { TotalAgent } = compilar(
    "components/total-agent.tsx",
    hooks,
    { "@/hooks/use-speech": { ...hook, useVoiceRecognition: () => rec } },
    ventana,
  )
  const acciones: string[] = []
  const render = () => {
    hooks.iniciar()
    const a = TotalAgent({
      data: datos,
      onAction: (r: { action: string }) => { acciones.push(r.action); if (desmontarAlNavegar) hooks.desmontar() },
    })
    hooks.ejecutarEfectos()
    return a
  }
  const enviar = (t: string) => {
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: t } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
  }
  // «Otra pantalla» que habla con el MISMO módulo `use-speech` que el asistente
  // (comparte `ultimaLocucion` a nivel de módulo, que es lo que `changeMode`
  // hace en la app: el padre usa el mismo gancho). Se reinicia el cursor de
  // hooks y se obtiene su `speak` estable; tras esto no se vuelve a renderizar.
  // ACOPLAMIENTO: `useSpeech` es la PRIMERA llamada de `TotalAgent`, así que al
  // reiniciar el cursor y pedir `useSpeech()` se reutiliza la ranura 0 ya creada;
  // `speak` es estable (`useCallback([])`), por lo que es inocuo. Si cambiara el
  // orden de los ganchos en `TotalAgent`, habría que ajustar esto.
  const hablaOtraPantalla = (texto: string) => {
    hooks.iniciar()
    hook.useSpeech().speak(texto)
  }
  return { sint, hooks, render, enviar, acciones, hablaOtraPantalla }
}

test("E: salir mientras suena la respuesta propia la calla (síntesis asíncrona)", async () => {
  const c = montarConSintesisReal()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: "Respuesta larga que sigue sonando al salir.", action: "none", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    c.render(); c.sint.terminar() // el saludo inicial ya terminó
    c.sint.reg.length = 0
    c.enviar("cuéntame un chiste sobre buses")
    await asentar()
    c.hooks.desmontar() // la persona pulsa «atrás» con la respuesta sonando
    assert.ok(c.sint.reg.includes("cancel"), "al salir se calla la locución propia")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("E: segunda pregunta rápida y salir → se calla (el error tardío de la 1ª no desmarca)", async () => {
  const c = montarConSintesisReal()
  let i = 0
  const textos = ["Primera respuesta larga que aún suena.", "Segunda respuesta larga que suena al salir."]
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: textos[Math.min(i++, 1)], action: "none", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    c.render(); c.sint.terminar()
    c.sint.reg.length = 0
    c.enviar("cuéntame un chiste sobre buses"); await asentar()
    c.enviar("cuéntame otro chiste distinto"); await asentar()
    // El `error` asíncrono de la 1ª locución (cancelada por la 2ª) llega ahora.
    await new Promise((r) => setTimeout(r, 5))
    const cancelsAntes = c.sint.reg.filter((x) => x === "cancel").length
    c.hooks.desmontar() // atrás mientras suena la 2ª
    const cancelsDespues = c.sint.reg.filter((x) => x === "cancel").length
    assert.ok(cancelsDespues > cancelsAntes, "al salir se calla la 2ª locución pese al error tardío de la 1ª")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("E: pregunta escrita durante el saludo inicial y salir → se calla", async () => {
  const c = montarConSintesisReal()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: "Respuesta que suena al salir.", action: "none", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    c.render() // el saludo inicial (en cola) sigue sonando
    c.sint.reg.length = 0
    c.enviar("cuéntame un chiste sobre buses"); await asentar()
    await new Promise((r) => setTimeout(r, 5)) // error tardío del saludo cancelado
    const cancelsAntes = c.sint.reg.filter((x) => x === "cancel").length
    c.hooks.desmontar()
    const cancelsDespues = c.sint.reg.filter((x) => x === "cancel").length
    assert.ok(cancelsDespues > cancelsAntes, "al salir se calla la respuesta aunque el saludo cancelado dispare su error tardío")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("E: `changeMode` del padre mientras el asistente habla → su anuncio NO se corta", async () => {
  const c = montarConSintesisReal()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: "x", action: "none", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    c.render() // saludo inicial (propio del asistente) AÚN sonando
    // El padre (changeMode) habla con el MISMO gancho justo antes del desmontaje:
    // su `speak` cancela el saludo (cuyo `error` llega después, async) y el
    // anuncio de modo pasa a ser la ÚLTIMA locución entregada a la síntesis.
    c.hablaOtraPantalla("Modo baja visión activado.")
    c.hooks.desmontar()
    // En el desmontaje, la locución propia (el saludo) aún no es null (su `error`
    // es asíncrono), pero ya NO es la última: la comprobación de «última locución»
    // evita cancelar el anuncio de modo.
    assert.equal(c.sint.hablando?.text, "Modo baja visión activado.", "sigue sonando el anuncio de modo (no lo corta la limpieza del asistente)")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("E: la respuesta que navega NO se cancela al desmontar", async () => {
  const c = montarConSintesisReal(true) // el padre desmonta en onAction, como la app
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: "La B23 va de X a Y.", action: "route", routeCode: "B23", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    c.render(); c.sint.terminar(); c.sint.reg.length = 0
    c.enviar("información de la B23")
    await asentar()
    // La navegación (acción route) desmontó el asistente; su voz debe seguir
    // sonando: la última locución es la respuesta y el desmontaje fue por ella.
    assert.deepEqual(c.acciones, ["route"], "navegó")
    assert.equal(c.sint.hablando?.text, "La B23 va de X a Y.", "sigue sonando la respuesta que navega")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── R1: salir con fetch que IGNORA la señal: no habla ni navega (mata vigente=()=>true) ──

test("R1: salir con respuesta en vuelo y fetch que ignora la señal no habla ni navega", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const acciones: unknown[] = []
  const resolver: { fn: ((r: Response) => void) | null } = { fn: null }
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (() => new Promise<Response>((res) => { resolver.fn = res })) as unknown as typeof fetch // ignora init.signal
  try {
    const { TotalAgent } = compilar("components/total-agent.tsx", hooks, {
      "@/hooks/use-speech": dobleVoz(voz, hookVoz()),
    })
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: unknown) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.ok(resolver.fn, "el fetch ya estaba en vuelo")
    hooks.desmontar() // la persona sale
    const vozAntes = voz.length
    if (resolver.fn) resolver.fn(new Response(JSON.stringify({ reply: "La B23 va de X a Y.", action: "route", routeCode: "B23", steps: [], engine: "reglas" })))
    await asentar()
    assert.equal(acciones.length, 0, "una respuesta tardía tras salir no navega")
    assert.equal(voz.length, vozAntes, "una respuesta tardía tras salir no habla")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── R3: tocar en «Pensando…» aborta el fetch, calla y libera busyRef ──

test("R3: tocar durante «Pensando…» aborta el fetch, calla y libera busyRef (una pregunta nueva sí consulta)", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const estado = { cancelaciones: 0 }
  let llamadas = 0
  let senal: AbortSignal | undefined
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = ((_u: string, init?: RequestInit) => { llamadas++; senal = init?.signal ?? undefined; return new Promise<Response>(() => {}) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar("components/total-agent.tsx", hooks, {
      "@/hooks/use-speech": dobleVoz(voz, hookVoz(), estado),
    })
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction() {} }); hooks.ejecutarEfectos(); return a }
    render()
    const escribir = (t: string) => {
      ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: t } })
      render()
      ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    }
    escribir("información de la B23")
    await asentar()
    assert.equal(llamadas, 1)
    ;(botonPrincipal(render()).props.onClick as () => void)() // toque en «Pensando…»
    assert.equal(senal?.aborted, true, "el fetch en vuelo se aborta")
    assert.ok(estado.cancelaciones >= 1, "calla")
    escribir("información de la H54")
    await asentar()
    assert.equal(llamadas, 2, "busyRef liberado: la pregunta nueva consulta")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── M13: un fallo que NO es aborto muestra un aviso recuperable ──

test("M13: un fallo no-abort del respaldo local muestra un aviso recuperable y vuelve a reposo", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const fetchOriginal = globalThis.fetch
  // El servidor falla; `consultarAgente` cae al respaldo local, pero con un
  // catálogo corrupto (sin `stations` iterable) el intérprete lanza un error
  // que NO es un aborto: debe avisarse de forma recuperable (no tragarse).
  globalThis.fetch = (async () => { throw new Error("sin red") }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar("components/total-agent.tsx", hooks, {
      "@/hooks/use-speech": dobleVoz(voz, hookVoz()),
    })
    const corrupto = { fetchedAt: "2026-11-04T10:00:00Z", source: "snapshot" } as unknown as typeof datos
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: corrupto, onAction() {} }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.ok(voz.some((t) => /problema para responder/i.test(t)), "avisa de forma recuperable, no se traga el error")
    const arbol = render()
    assert.match(texto(arbol), /Tuve un problema para responder/)
    assert.doesNotMatch(texto(arbol), /Pensando…/)
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── Decisión D: la espera de permiso de ubicación no bloquea ──

test("D: permiso CONCEDIDO acota la posición a 2 s; si no llega, la consulta sigue sin coordenada", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const acciones: Array<{ action: string }> = []
  let fetchLlamadas = 0
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { fetchLlamadas++; return new Response(JSON.stringify({ reply: "Voy a abrir el GPS auditivo…", action: "gps", steps: [], engine: "reglas" })) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        setTimeout: reloj.setTimeout,
        clearTimeout: reloj.clearTimeout,
        navigator: {
          geolocation: { getCurrentPosition: () => {} }, // nunca responde la posición
          permissions: { query: async () => ({ state: "granted" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: { action: string }) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.equal(fetchLlamadas, 0, "con permiso concedido espera la posición (cota 2 s)")
    reloj.avanzar(2_100) // vence la cota de 2 s
    await asentar()
    assert.equal(fetchLlamadas, 1, "tras 2 s sin posición, consulta sin coordenada")
    assert.deepEqual(acciones.map((a) => a.action), ["gps"])
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("D: permiso PENDIENTE anuncia «Esperando permiso», es cancelable y no bloquea busyRef", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const estado = { cancelaciones: 0 }
  const acciones: unknown[] = []
  let getCurrentPositionLlamadas = 0
  let fetchLlamadas = 0
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { fetchLlamadas++; return new Response(JSON.stringify({ reply: "ok", action: "none", steps: [], engine: "reglas" })) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz(), estado) },
      {
        setTimeout: reloj.setTimeout,
        clearTimeout: reloj.clearTimeout,
        navigator: {
          geolocation: { getCurrentPosition: () => { getCurrentPositionLlamadas++ } }, // permiso sin responder
          permissions: { query: async () => ({ state: "prompt" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: unknown) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    reloj.avanzar(10_000) // a los 10 s (< cota de 15 s) aún espera el permiso
    await asentar()
    assert.equal(getCurrentPositionLlamadas, 1, "pidió la ubicación")
    assert.equal(fetchLlamadas, 0, "antes de la cota sigue esperando el permiso, sin consultar")
    assert.equal(texto(render()).includes("Esperando permiso"), true, "anuncia que espera el permiso")
    // La persona cancela con un toque: libera busyRef y vuelve a reposo.
    ;(botonPrincipal(render()).props.onClick as () => void)()
    assert.ok(estado.cancelaciones >= 1, "cancelar calla")
    // G2/D4: la espera del permiso escucha el aborto; al cancelar se limpia su
    // temporizador de 15 s (si no, quedaría pendiente y dispararía `alVencer`).
    assert.equal(reloj.pendientes(), 0, "cancelar limpia el temporizador del permiso (escucha del aborto)")
    reloj.avanzar(20_000)
    await asentar()
    assert.equal(getCurrentPositionLlamadas, 1, "tras cancelar no se vuelve a pedir la ubicación")
    assert.equal(texto(render()).includes("No recibí permiso de ubicación"), false, "tras cancelar no reaparece el aviso de permiso vencido")
    // Una pregunta nueva por texto sí consulta (busyRef liberado).
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.equal(fetchLlamadas, 1, "busyRef liberado: la pregunta nueva consulta")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── Decisión F: cota total de 15 s para el permiso pendiente ──

test("F: permiso PENDIENTE sin respuesta ni toque → a los 15 s la consulta sigue sin coordenada y busyRef se libera", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const acciones: Array<{ action: string }> = []
  let fetchLlamadas = 0
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { fetchLlamadas++; return new Response(JSON.stringify({ reply: "Voy a abrir el GPS auditivo…", action: "gps", steps: [], engine: "reglas" })) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        setTimeout: reloj.setTimeout,
        clearTimeout: reloj.clearTimeout,
        navigator: {
          geolocation: { getCurrentPosition: () => {} }, // el permiso nunca se responde
          permissions: { query: async () => ({ state: "prompt" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: { action: string }) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.equal(fetchLlamadas, 0, "antes de la cota aún espera")
    reloj.avanzar(15_100) // vence la cota total del permiso pendiente
    await asentar()
    assert.equal(fetchLlamadas, 1, "al vencer 15 s, la consulta se lanza sin coordenada (busyRef libre)")
    assert.deepEqual(acciones.map((a) => a.action), ["gps"])
    // R4-2/G1: la locución y el subtítulo de la respuesta llevan DELANTE el aviso
    // NEUTRO de permiso vencido, en una sola locución (no una segunda ni cola).
    assert.ok(voz.some((t) => t.startsWith("No recibí permiso de ubicación a tiempo.")), "la respuesta se dice con el aviso de permiso vencido delante")
    assert.ok(voz.some((t) => t.startsWith("No recibí permiso de ubicación a tiempo.") && t.includes("Voy a abrir el GPS")), "el aviso va en la MISMA locución que la respuesta")
    assert.match(texto(render()), /No recibí permiso de ubicación a tiempo\./)
    // busyRef liberado: una pregunta nueva por texto consulta de nuevo.
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.equal(fetchLlamadas, 2, "busyRef no quedó bloqueado tras vencer la cota del permiso")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// H1: el aviso de permiso vencido se antepone al texto YA saneado (sanear), no a
// `reply.reply` crudo. Caso donde `sanear` SÍ cambia el texto: una respuesta
// informativa (`gps`) cuya prosa trae una orden de abordaje («sube en …») se
// degrada al aviso seguro `VIAJE_NO_CONFIRMABLE` (EA-05). El texto hablado debe
// ser el aviso neutro + el texto SEGURO, nunca la prosa original con el
// imperativo. Falla si el prefijo se construyera desde `reply.reply`.
test("H1: el prefijo de permiso vencido va sobre el texto saneado, no sobre la prosa cruda", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const acciones: Array<{ action: string }> = []
  let fetchLlamadas = 0
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  // Prosa con una orden de abordaje: `sanear` la rechaza y la sustituye.
  const crudo = "Sube en la estación Ricaurte y continúa."
  globalThis.fetch = (async () => { fetchLlamadas++; return new Response(JSON.stringify({ reply: crudo, action: "gps", steps: [], engine: "reglas" })) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        setTimeout: reloj.setTimeout,
        clearTimeout: reloj.clearTimeout,
        navigator: {
          geolocation: { getCurrentPosition: () => {} }, // el permiso nunca se responde
          permissions: { query: async () => ({ state: "prompt" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: { action: string }) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    reloj.avanzar(15_100) // vence la cota del permiso pendiente
    await asentar()
    assert.equal(fetchLlamadas, 1)
    const hablado = voz.find((t) => t.startsWith("No recibí permiso de ubicación a tiempo."))
    assert.ok(hablado, "se dice el aviso neutro delante")
    assert.ok(hablado!.includes("No puedo confirmar las paradas"), "el prefijo va sobre el texto SANEADO (aviso seguro de EA-05)")
    assert.equal(hablado!.includes("Sube en la estación"), false, "nunca se dice la prosa cruda con la orden de abordaje")
    assert.equal(texto(render()).includes("Sube en la estación"), false, "el subtítulo tampoco muestra la prosa cruda")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── Decisión G: señal de aborto durante permissions.query; permiso denegado ──

test("G: cancelar mientras `permissions.query` está pendiente → no llama getCurrentPosition ni deja la leyenda", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  let getCurrentPositionLlamadas = 0
  const reloj = crearReloj()
  // `permissions.query` resuelve DESPUÉS (microtarea diferida) para poder cancelar antes.
  const resolverQuery: { fn: ((v: { state: string }) => void) | null } = { fn: null }
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ reply: "x", action: "none", steps: [], engine: "reglas" }))) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        setTimeout: reloj.setTimeout,
        clearTimeout: reloj.clearTimeout,
        navigator: {
          geolocation: { getCurrentPosition: () => { getCurrentPositionLlamadas++ } },
          permissions: { query: () => new Promise((res) => { resolverQuery.fn = res }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction() {} }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar(2) // la consulta de permiso queda pendiente
    ;(botonPrincipal(render()).props.onClick as () => void)() // cancela mientras query está pendiente
    resolverQuery.fn?.({ state: "prompt" }) // la query resuelve DESPUÉS de cancelar
    await asentar()
    assert.equal(getCurrentPositionLlamadas, 0, "cancelar antes de resolver la query evita pedir la posición")
    assert.equal(texto(render()).includes("Esperando permiso"), false, "no queda la leyenda de espera tras cancelar")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("G: permiso DENEGADO → sigue sin coordenada de inmediato, sin leyenda de espera", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const acciones: Array<{ action: string }> = []
  let getCurrentPositionLlamadas = 0
  let fetchLlamadas = 0
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { fetchLlamadas++; return new Response(JSON.stringify({ reply: "Voy a abrir el GPS auditivo…", action: "gps", steps: [], engine: "reglas" })) }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        navigator: {
          geolocation: { getCurrentPosition: () => { getCurrentPositionLlamadas++ } },
          permissions: { query: async () => ({ state: "denied" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: { action: string }) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "dónde estoy" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.equal(getCurrentPositionLlamadas, 0, "con permiso denegado no se pide la posición")
    assert.equal(fetchLlamadas, 1, "consulta de inmediato sin coordenada")
    assert.deepEqual(acciones.map((a) => a.action), ["gps"])
    assert.equal(texto(render()).includes("Esperando permiso"), false, "con permiso denegado no hay leyenda de espera")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── M16: una frase que las reglas no entienden NO pide ni envía la ubicación ──

test("M16: una frase `unknown` no pide `getCurrentPosition` ni adjunta `position` (decisión B/AC4)", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  let getCurrentPositionLlamadas = 0
  const cuerpos: Array<unknown> = []
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? "{}")).position)
    return new Response(JSON.stringify({ reply: "ok", action: "none", steps: [], engine: "reglas" }))
  }) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      {
        navigator: {
          // Concede la posición: así queda en caché (`positionRef`) y la mutación
          // M16 (adjuntarla para `unknown`) sí la filtraría.
          geolocation: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => { getCurrentPositionLlamadas++; ok({ coords: { latitude: 4.65, longitude: -74.1 } }) } },
          permissions: { query: async () => ({ state: "granted" }) },
          vibrate: () => true,
        },
      },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction() {} }); hooks.ejecutarEfectos(); return a }
    render()
    const preguntar = async (t: string) => {
      ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: t } })
      render()
      ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
      await asentar()
    }
    // 1) Un GPS concede y CACHEA la posición (sí la usa y la envía).
    await preguntar("dónde estoy")
    assert.equal(getCurrentPositionLlamadas, 1, "el GPS pide la ubicación")
    assert.ok(cuerpos[0] && typeof cuerpos[0] === "object", "el GPS sí envía la coordenada")
    // 2) Una frase que las reglas no entienden NO vuelve a pedirla ni la adjunta,
    //    aunque esté en caché (decisión B/AC4).
    await preguntar("cuéntame un chiste sobre buses")
    assert.equal(getCurrentPositionLlamadas, 1, "no vuelve a pedir la ubicación para una frase unknown")
    assert.equal(cuerpos[1], undefined, "una frase unknown no adjunta `position`, ni la que está en caché")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── R2: gancho REAL + superposición REAL: no-speech no reinicia (mata M6b) ──

test("R2: gancho REAL + superposición REAL no reinician la escucha tras no-speech", () => {
  class SimNavegador {
    static instancias: SimNavegador[] = []
    inicios = 0; activo = false
    onstart: (() => void) | null = null; onend: (() => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null; onresult: unknown = null
    lang = ""; continuous = false; interimResults = false; maxAlternatives = 1
    constructor() { SimNavegador.instancias.push(this) }
    start() { this.inicios++; this.activo = true; this.onstart?.() }
    stop() { this.activo = false; this.onend?.() }
    abort() { if (!this.activo) return; this.activo = false; this.onerror?.({ error: "aborted" }); this.onend?.() }
  }
  const hooks = crearHooks()
  const reloj = crearReloj()
  // El gancho REAL (`use-speech.ts`) se compila con un `SpeechRecognition` tipo
  // navegador; la superposición REAL lo usa. Así se reproduciría el defecto
  // original del hallazgo 6 (reprogramar la escucha al cambiar `listening`).
  const hook = compilar("hooks/use-speech.ts", hooks, {}, { SpeechRecognition: SimNavegador })
  const { VoiceOverlay } = compilar(
    "components/voice-overlay.tsx",
    hooks,
    { "@/hooks/use-speech": dobleVoz([], (hook as { useVoiceRecognition: unknown }).useVoiceRecognition) },
    { setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout },
  )
  const render = () => { hooks.iniciar(); const a = VoiceOverlay({ open: true, onClose() {}, onTranscript() {} }); hooks.ejecutarEfectos(); return a }
  render(); render() // el gancho marca `supported` y provoca un re-render
  // El doble de módulo de `@/hooks/use-speech` NO incluye
  // `ESCUCHA_ESPERA_SUPERPOSICION_MS`, así que en esta prueba el temporizador de
  // arranque de la superposición vale `undefined` → 0 ms; basta avanzar el reloj
  // para dispararlo. La prueba comprueba el REINICIO tras `no-speech`, no el
  // valor del margen de arranque.
  reloj.avanzar(1_000)
  const rec = SimNavegador.instancias[0]
  assert.equal(rec.inicios, 1, "arranca una vez")
  // Re-render con la escucha ACTIVA: si `start` dependiera de `listening` (M6b),
  // aquí cambiaría de identidad y el efecto reprogramaría la escucha.
  render()
  // no-speech: el gancho pasa `listening` a falso. Sin M6b, `start` es estable y
  // el efecto no se reejecuta; con M6b, cambia y reprograma.
  rec.onerror?.({ error: "no-speech" }); rec.activo = false; rec.onend?.()
  render(); render()
  reloj.avanzar(5_000)
  assert.equal(rec.inicios, 1, "no reinicia la escucha tras no-speech")
})

// ── AC2: sin pausas con pasos NO vacíos ──

test("AC2: una respuesta con pasos navega sin pausa por paso (steps no vacíos)", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const acciones: Array<{ action: string }> = []
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      reply: "La B23 va de Portal Norte a Portal Sur.",
      action: "route",
      routeCode: "B23",
      steps: [{ label: "Busqué la ruta B23" }, { label: "Revisé su recorrido" }],
      engine: "reglas",
    }))) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar("components/total-agent.tsx", hooks, {
      "@/hooks/use-speech": dobleVoz([], hookVoz()),
    })
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction: (r: { action: string }) => acciones.push(r) }); hooks.ejecutarEfectos(); return a }
    render()
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar(8) // si hubiera STEP_DELAY de 450 ms/paso, no navegaría aquí
    assert.deepEqual(acciones.map((a) => a.action), ["route"], "navegó sin esperar 450 ms por cada paso")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── Superposición: cerrar aborta (no detiene) y descarta un resultado tardío ──

test("cerrar la superposición aborta (no detiene) y descarta un resultado tardío", () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const transcripciones: string[] = []
  let cerrada = false
  const reloj = crearReloj()
  const { VoiceOverlay } = compilar(
    "components/voice-overlay.tsx",
    hooks,
    { "@/hooks/use-speech": dobleVoz([], hookVoz(true)) },
    { setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout },
  )
  const render = (open: boolean) => {
    hooks.iniciar()
    const a = VoiceOverlay({ open, onClose: () => { cerrada = true }, onTranscript: (t: string) => transcripciones.push(t) })
    hooks.ejecutarEfectos()
    return a
  }
  const arbol = render(true)
  reloj.avanzar(1_000)
  const rec = ReconocimientoSimulado.instancias[0]
  ;(nodos(arbol, (n) => n.props?.["aria-label"] === "Cerrar micrófono")[0].props.onClick as () => void)()
  assert.equal(cerrada, true)
  assert.equal(rec.abortos, 1, "cerrar aborta")
  assert.equal(rec.detenciones, 0, "cerrar no usa stop()")
  render(false)
  rec.onresult?.({ results: [[{ transcript: "B23" }]] })
  assert.deepEqual(transcripciones, [], "un resultado tardío tras cerrar no busca")
})


// ── N5: el aria-label del botón principal cambia a «Cancelar» al escuchar/pensar ──

test("N5: el aria-label del botón principal pasa a «Cancelar» mientras escucha o piensa", async () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch // cuelga: deja en «Pensando…»
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      { setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction() {} }); hooks.ejecutarEfectos(); return a }
    render()
    // En reposo: etiqueta de «Asistente de voz…».
    assert.match(botonPrincipal(render()).props["aria-label"] as string, /Asistente de voz\. Toca para hablar/)
    // Al escribir una pregunta pasa a «Pensando…»: la etiqueta ofrece cancelar.
    ;(idEntrada(render()).props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "información de la B23" } })
    render()
    ;(formulario(render()).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault() {} })
    await asentar()
    assert.match(botonPrincipal(render()).props["aria-label"] as string, /^Cancelar\./)
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// R5-1: el aviso de privacidad del asistente (`role="note"`) debe mantener su
// contenido esencial (AC4). Se afirma sobre FRAGMENTOS clave, no sobre el texto
// completo, para no volverla frágil. Debe fallar si se quita la cláusula de que
// la ubicación se envía al servidor (esa cláusula ya se perdió una vez).
test("R5-1: el aviso de privacidad del asistente mantiene su contenido esencial (AC4)", () => {
  ReconocimientoSimulado.instancias = []
  const hooks = crearHooks()
  const voz: string[] = []
  const reloj = crearReloj()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch
  try {
    const { TotalAgent } = compilar(
      "components/total-agent.tsx",
      hooks,
      { "@/hooks/use-speech": dobleVoz(voz, hookVoz()) },
      { setTimeout: reloj.setTimeout, clearTimeout: reloj.clearTimeout },
    )
    const render = () => { hooks.iniciar(); const a = TotalAgent({ data: datos, onAction() {} }); hooks.ejecutarEfectos(); return a }
    const nota = nodos(render(), (n) => n.type === "p" && n.props?.role === "note")[0]
    assert.ok(nota, "hay un aviso de privacidad con role=note")
    const t = texto(nota).toLowerCase()
    // Fragmentos exigidos por AC4 (no el texto completo):
    assert.match(t, /audio.*servicio del navegador/, "dice que el audio puede ir a un servicio del navegador")
    assert.match(t, /frase viaja a este servidor/, "dice que la frase viaja al servidor")
    assert.match(t, /modelo/, "menciona el modelo")
    assert.match(t, /ubicación es opcional/, "dice que la ubicación es opcional")
    // Cláusula que ya se perdió una vez: la ubicación se envía al servidor cuando
    // la pregunta la necesita. Debe fallar si se quita.
    assert.match(t, /tu ubicación se envía a este servidor/, "dice que la ubicación se envía al servidor cuando la pregunta la necesita")
    assert.match(t, /google maps/, "menciona que Google Maps comparte el origen")
    assert.match(t, /escribir en vez de hablar/, "ofrece la alternativa por texto")
  } finally {
    globalThis.fetch = fetchOriginal
  }
})
