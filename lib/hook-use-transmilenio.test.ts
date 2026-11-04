import assert from "node:assert/strict"
import test from "node:test"
import { setImmediate as turno } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { LAYER_TIMEOUT_MS, TransmilenioDataSchema } from "./transmilenio"
import ReactNS from "react"

/**
 * Regresión del issue #32 (frontera HTTP del cliente). Ejercita el hook REAL
 * con un despachador de hooks de React simulado (sin navegador) y mocks de
 * `globalThis.fetch`, `Date.now`, `setInterval` y los listeners de ventana. No
 * usa exports solo para pruebas: carga el hook fresco por import dinámico.
 *
 * Cubre: la respuesta vacía no reemplaza el catálogo bueno, el error queda
 * expuesto conservando datos, la consulta sin respuesta no bloquea el reintento,
 * y el hook montado renueva tras la frescura.
 */

const React = (ReactNS as unknown as { default?: unknown }).default ?? ReactNS
const datos = TransmilenioDataSchema.parse(snapshot)
const vacio = { ...datos, stations: [], routes: [] }
const raiz = pathToFileURL(process.cwd() + "/")
const pausa = async () => {
  for (let i = 0; i < 6; i++) await turno()
}

let secuencia = 0

/**
 * Monta el hook una vez con un despachador simulado y un entorno de navegador
 * mínimo (document/window con listeners y temporizadores registrables). Devuelve
 * utilidades para re-renderizar, ejecutar efectos/timers y leer el estado.
 */
async function montarHook(fetchImpl: typeof fetch, cuerpo: (ctx: HookCtx) => Promise<void>) {
  const mod = await import(new URL(`hooks/use-transmilenio.ts?caso=${++secuencia}`, raiz).href)
  const estados: unknown[] = []
  const efectos: Array<() => void | (() => void)> = []
  const limpiezas: Array<void | (() => void)> = []
  const timers: Array<{ f: () => void; ms: number }> = []
  const listeners: Record<string, Array<() => void>> = {}

  const internos = (React as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as {
    H: unknown
  }
  const previoH = internos.H
  const prevFetch = globalThis.fetch
  const prevInterval = globalThis.setInterval
  const prevWindow = (globalThis as Record<string, unknown>).window
  const prevDocument = (globalThis as Record<string, unknown>).document

  let cursor = 0
  internos.H = {
    useState(inicial: unknown) {
      const i = cursor++
      if (!(i in estados)) estados[i] = typeof inicial === "function" ? (inicial as () => unknown)() : inicial
      return [estados[i], (valor: unknown) => { estados[i] = typeof valor === "function" ? (valor as (p: unknown) => unknown)(estados[i]) : valor }]
    },
    useCallback(f: unknown) { return f },
    useEffect(f: () => void | (() => void)) { efectos.push(f) },
  }
  globalThis.fetch = fetchImpl
  ;(globalThis as Record<string, unknown>).setInterval = ((f: () => void, ms: number) => { timers.push({ f, ms }); return 0 }) as unknown as typeof setInterval
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: (ev: string, cb: () => void) => { (listeners[ev] ??= []).push(cb) },
    removeEventListener: () => {},
  }
  ;(globalThis as Record<string, unknown>).document = {
    visibilityState: "visible",
    addEventListener: (ev: string, cb: () => void) => { (listeners[ev] ??= []).push(cb) },
    removeEventListener: () => {},
  }

  const render = () => { cursor = 0; return mod.useTransmilenio() }
  try {
    const primera = render()
    for (const efecto of efectos) limpiezas.push(efecto())
    await pausa()
    await cuerpo({ hook: primera, render, timers, listeners, dispararTimers: (hasta: number) => timers.forEach((t) => t.ms <= hasta && t.f()) })
  } finally {
    limpiezas.forEach((f) => typeof f === "function" && f())
    internos.H = previoH
    globalThis.fetch = prevFetch
    globalThis.setInterval = prevInterval
    ;(globalThis as Record<string, unknown>).window = prevWindow
    ;(globalThis as Record<string, unknown>).document = prevDocument
  }
}

type HookCtx = {
  hook: { data: unknown; error: boolean; cargando: boolean; reintentar: () => void }
  render: () => HookCtx["hook"]
  timers: Array<{ f: () => void; ms: number }>
  listeners: Record<string, Array<() => void>>
  dispararTimers: (hasta: number) => void
}

test("una respuesta 200 vacía no reemplaza el último catálogo válido y expone el error", async () => {
  let n = 0
  await montarHook((async () => Response.json(++n === 1 ? datos : vacio)) as unknown as typeof fetch, async ({ render }) => {
    let vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124, "primera carga buena")
    vista.reintentar()
    await pausa()
    vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124, "el vacío NO reemplazó las 124 rutas")
    assert.equal(vista.error, true, "el fallo de integridad queda expuesto")
  })
})

test("un error de renovación conserva los datos y expone el fallo", async () => {
  let n = 0
  await montarHook((async () => { if (++n === 1) return Response.json(datos); throw new Error("sin red") }) as unknown as typeof fetch, async ({ render }) => {
    let vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124)
    vista.reintentar()
    await pausa()
    vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124, "datos conservados")
    assert.equal(vista.error, true, "fallo expuesto para reintentar")
  })
})

test("la consulta lleva espera acotada y un fallo libera la pendiente para reintentar", async () => {
  // El código debe pasar un AbortSignal (espera acotada con AbortSignal.timeout)
  // y, cuando una consulta falla —como haría al expirar el tiempo—, liberar la
  // pendiente para que un reintento no quede atado a una promesa bloqueada.
  let n = 0
  let huboSignal = false
  await montarHook((async (_url: unknown, opciones: { signal?: AbortSignal }) => {
    n++
    if (opciones?.signal instanceof AbortSignal) huboSignal = true
    if (n === 1) throw Object.assign(new Error("TimeoutError"), { name: "TimeoutError" })
    return Response.json(datos)
  }) as unknown as typeof fetch, async ({ render }) => {
    let vista = render()
    assert.equal(huboSignal, true, "la consulta cliente lleva AbortSignal (espera acotada)")
    assert.equal(vista.error, true, "una consulta fallida queda expuesta")
    // La pendiente quedó liberada: el reintento lanza una consulta nueva que carga.
    vista.reintentar()
    await pausa()
    vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124, "el reintento sí cargó tras liberar la pendiente")
    assert.equal(vista.error, false)
  })
})

test("el hook montado renueva tras la frescura (temporizador registrado)", async () => {
  const relojPrevio = Date.now
  let reloj = relojPrevio()
  Date.now = () => reloj
  let n = 0
  try {
    await montarHook((async () => { n++; return Response.json(datos) }) as unknown as typeof fetch, async ({ render, timers, dispararTimers }) => {
      render()
      assert.equal(n, 1, "una consulta al montar")
      assert.ok(timers.length > 0, "se registró un temporizador de frescura")
      reloj += 7 * 60 * 60 * 1000
      dispararTimers(7 * 60 * 60 * 1000)
      await pausa()
      render()
      assert.ok(n >= 2, "renueva después de siete horas con el hook montado")
    })
  } finally {
    Date.now = relojPrevio
  }
})

// --- Política de frescura, reintento visible y espera acotada (issue #32) ---

const MIN = 60 * 1000
const HORA = 60 * MIN
type Catalogo = { source: string; fetchedAt: string; routes: unknown[] }

/** Corre `cuerpo` con un reloj controlado y lo restaura siempre. */
async function conReloj(cuerpo: (avanzar: (ms: number) => void, ahora: () => number) => Promise<void>) {
  const relojPrevio = Date.now
  let reloj = relojPrevio()
  Date.now = () => reloj
  try {
    await cuerpo((ms) => { reloj += ms }, () => reloj)
  } finally {
    Date.now = relojPrevio
  }
}

test("primer GET fallido: sin catálogo expone error y el reintento recupera sin remontar", async () => {
  let n = 0
  await montarHook((async () => (++n === 1 ? new Response("caído", { status: 503 }) : Response.json(datos))) as unknown as typeof fetch, async ({ render }) => {
    let vista = render()
    assert.equal(vista.data, null, "sin catálogo todavía")
    assert.equal(vista.error, true, "el fallo inicial queda expuesto para pintar el reintento")
    assert.equal(vista.cargando, false)
    vista.reintentar()
    await pausa()
    vista = render()
    assert.equal((vista.data as { routes: unknown[] }).routes.length, 124, "recupera en la misma instancia")
    assert.equal(vista.error, false)
  })
})

test("el primer GET fallido se reintenta solo, acotado a cinco minutos", async () => {
  await conReloj(async (avanzar) => {
    let n = 0
    await montarHook((async () => (++n === 1 ? new Response("caído", { status: 503 }) : Response.json(datos))) as unknown as typeof fetch, async ({ render, dispararTimers }) => {
      avanzar(MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 1, "antes de cinco minutos no insiste")
      avanzar(5 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 2, "pasados cinco minutos reintenta")
      assert.equal((render().data as Catalogo).routes.length, 124)
    })
  })
})

test("una copia guardada recibida de nuevo no se rejuvenece: se renueva cada ~5 min", async () => {
  await conReloj(async (avanzar) => {
    let n = 0
    await montarHook((async () => { n++; return Response.json(datos) }) as unknown as typeof fetch, async ({ render, dispararTimers }) => {
      assert.equal(n, 1)
      avanzar(4 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 1, "a los 4 min no consulta")
      avanzar(2 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 2, "a los 6 min renueva sin remontar")
      assert.equal((render().data as Catalogo).fetchedAt, datos.fetchedAt, "no cambia la fecha de la copia")
      avanzar(6 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 3, "sigue acotado a un intento por ventana, sin ocultar la recuperación seis horas")
    })
  })
})

test("un dato en vivo ya vencido al recibirlo se reintenta en ~5 min y luego pasa a vivo fresco", async () => {
  await conReloj(async (avanzar, ahora) => {
    let n = 0
    const viejo = { ...datos, source: "live" as const, fetchedAt: new Date(ahora() - 7 * HORA).toISOString() }
    const fresco = () => ({ ...datos, source: "live" as const, fetchedAt: new Date(ahora()).toISOString() })
    await montarHook((async () => Response.json(++n === 1 ? viejo : fresco())) as unknown as typeof fetch, async ({ render, dispararTimers }) => {
      assert.equal((render().data as Catalogo).fetchedAt, viejo.fetchedAt)
      avanzar(2 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 1, "antes de cinco minutos no consulta")
      avanzar(4 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 2, "el vivo viejo se renueva a los ~5 min")
      assert.notEqual((render().data as Catalogo).fetchedAt, viejo.fetchedAt, "ya quedó el dato nuevo")
      avanzar(30 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 2, "con dato vivo fresco no vuelve a consultar en minutos")
    })
  })
})

test("un dato vivo fresco se renueva solo a las seis horas de su fetchedAt", async () => {
  await conReloj(async (avanzar, ahora) => {
    let n = 0
    const vivo = () => ({ ...datos, source: "live" as const, fetchedAt: new Date(ahora()).toISOString() })
    await montarHook((async () => { n++; return Response.json(vivo()) }) as unknown as typeof fetch, async ({ dispararTimers }) => {
      avanzar(5 * HORA + 50 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 1, "a 5 h 50 min sigue fresco")
      avanzar(15 * MIN)
      dispararTimers(MIN)
      await pausa()
      assert.equal(n, 2, "pasadas las seis horas renueva")
    })
  })
})

test("volver a la pestaña o recuperar la red no genera bucles de consulta tras un fallo", async () => {
  await conReloj(async (avanzar) => {
    let n = 0
    await montarHook((async () => { n++; return new Response("caído", { status: 503 }) }) as unknown as typeof fetch, async ({ listeners }) => {
      for (let i = 0; i < 5; i++) {
        listeners.online?.forEach((f) => f())
        listeners.visibilitychange?.forEach((f) => f())
        await pausa()
      }
      assert.equal(n, 1, "las señales repetidas dentro de la ventana no consultan")
      avanzar(6 * MIN)
      listeners.online?.forEach((f) => f())
      await pausa()
      assert.equal(n, 2, "pasada la ventana, una señal sí renueva")
    })
  })
})

test("las consultas simultáneas se comparten (una sola petición pendiente)", async () => {
  let n = 0
  let liberar!: () => void
  const espera = new Promise<void>((r) => { liberar = r })
  await montarHook((async () => { n++; await espera; return Response.json(datos) }) as unknown as typeof fetch, async ({ render }) => {
    const vista = render()
    vista.reintentar()
    vista.reintentar()
    assert.equal(render().cargando, true)
    liberar()
    await pausa()
    assert.equal(n, 1, "montar y reintentar dos veces comparten una sola petición")
    assert.equal(render().cargando, false)
  })
})

test("la espera cliente supera el techo upstream del servidor para dejar entregar su respaldo", async () => {
  const original = AbortSignal.timeout
  const esperas: number[] = []
  AbortSignal.timeout = ((ms: number) => { esperas.push(ms); return original.call(AbortSignal, ms) }) as typeof AbortSignal.timeout
  try {
    await montarHook((async () => Response.json(datos)) as unknown as typeof fetch, async () => {
      assert.equal(esperas.length, 1)
      assert.ok(esperas[0] > LAYER_TIMEOUT_MS, "mayor que el techo upstream (15 s)")
      assert.ok(esperas[0] <= 30_000, "sigue siendo finita y corta")
    })
  } finally {
    AbortSignal.timeout = original
  }
})

test("un error tras tener catálogo conserva los datos y el reintento posterior se recupera", async () => {
  let n = 0
  await montarHook((async () => { if (++n === 2) throw new Error("sin red"); return Response.json(datos) }) as unknown as typeof fetch, async ({ render }) => {
    render().reintentar()
    await pausa()
    let vista = render()
    assert.equal(vista.error, true)
    assert.equal((vista.data as Catalogo).routes.length, 124, "datos conservados con el error")
    vista.reintentar()
    await pausa()
    vista = render()
    assert.equal(vista.error, false, "el reintento limpia el error")
    assert.equal(n, 3)
  })
})
