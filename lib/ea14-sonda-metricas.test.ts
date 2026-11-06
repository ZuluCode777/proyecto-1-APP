import assert from "node:assert/strict"
import test from "node:test"
import { LIMITE_512_MIB, metricasDeMemoria, RUTAS } from "./ea14-sonda-metricas"

/** Regresión de la sonda TEMPORAL de EA-14 (#40): cifras de memoria con un sistema de archivos simulado. */
const permitidas = new Set<string>([RUTAS.proceso, ...Object.values(RUTAS.v2), ...Object.values(RUTAS.v1)])

function falso(archivos: Record<string, string>) {
  const leidas: string[] = []
  const lector = (ruta: string) => {
    leidas.push(ruta)
    if (!(ruta in archivos)) throw new Error("ENOENT")
    return archivos[ruta]
  }
  return { lector, leidas }
}

test("proceso: Node real, cifras no negativas y maxRSS convertido a bytes", () => {
  const { proceso } = metricasDeMemoria(falso({}).lector, "linux")
  assert.equal(proceso.node, process.versions.node)
  assert.ok(proceso.rssBytes > 0 && proceso.maxRssBytes > 0)
  assert.ok(proceso.uptimeSegundos >= 0)
  assert.equal(proceso.maxRssBytes % 1024, 0)
})

test("cgroup v2: actual, pico y límite de 512 MiB; solo lee rutas de la lista cerrada", () => {
  const { lector, leidas } = falso({
    [RUTAS.proceso]: "0::/\n",
    [RUTAS.v2.actual]: "123456789\n",
    [RUTAS.v2.pico]: "200000000\n",
    [RUTAS.v2.limite]: `${LIMITE_512_MIB}\n`,
  })
  const { cgroup } = metricasDeMemoria(lector, "linux")
  assert.deepEqual(cgroup, {
    version: "v2",
    motivo: null,
    rutaProceso: "0::/",
    actualBytes: 123456789,
    picoBytes: 200000000,
    limiteBytes: LIMITE_512_MIB,
    sinLimite: false,
    limiteIgual512MiB: true,
  })
  assert.ok(leidas.every((ruta) => permitidas.has(ruta)))
})

test("cgroup v2 sin pico (kernel antiguo) y memory.max = max: null honesto, sin error", () => {
  const { lector } = falso({ [RUTAS.v2.actual]: "42", [RUTAS.v2.limite]: "max" })
  const { cgroup } = metricasDeMemoria(lector, "linux")
  assert.equal(cgroup.actualBytes, 42)
  assert.equal(cgroup.picoBytes, null)
  assert.equal(cgroup.limiteBytes, null)
  assert.equal(cgroup.sinLimite, true)
  assert.equal(cgroup.limiteIgual512MiB, null)
})

test("cgroup v1: rutas propias y tope enorme = sin límite", () => {
  const { lector } = falso({
    [RUTAS.v1.actual]: "1000",
    [RUTAS.v1.pico]: "2000",
    [RUTAS.v1.limite]: "9223372036854771712",
  })
  const { cgroup } = metricasDeMemoria(lector, "linux")
  assert.equal(cgroup.version, "v1")
  assert.equal(cgroup.actualBytes, 1000)
  assert.equal(cgroup.picoBytes, 2000)
  assert.equal(cgroup.limiteBytes, null)
  assert.equal(cgroup.sinLimite, true)
})

test("sin cgroup legible o fuera de Linux: todo null, motivo explícito y ninguna lectura en Windows", () => {
  const linux = metricasDeMemoria(falso({ [RUTAS.proceso]: "0::/x" }).lector, "linux").cgroup
  assert.equal(linux.rutaProceso, "0::/x")
  assert.equal(linux.version, null)
  assert.equal(linux.motivo, "cgroup-no-legible")
  assert.equal(linux.actualBytes, null)
  const { lector, leidas } = falso({ [RUTAS.v2.actual]: "1" })
  const win = metricasDeMemoria(lector, "win32").cgroup
  assert.equal(win.motivo, "no-linux")
  assert.equal(win.actualBytes, null)
  assert.deepEqual(leidas, [])
})

test("contenido no numérico no produce NaN ni cifras falsas", () => {
  const { lector } = falso({ [RUTAS.v2.actual]: "7", [RUTAS.v2.pico]: "abc", [RUTAS.v2.limite]: "-1" })
  const { cgroup } = metricasDeMemoria(lector, "linux")
  assert.equal(cgroup.picoBytes, null)
  assert.equal(cgroup.limiteBytes, null)
})

test("pnpm: versión leída del user agent; ausente → null", () => {
  const previo = process.env.npm_config_user_agent
  try {
    process.env.npm_config_user_agent = "pnpm/12.3.4 npm/? node/v24.1.0 linux x64"
    assert.equal(metricasDeMemoria(falso({}).lector, "linux").proceso.pnpm, "12.3.4")
    delete process.env.npm_config_user_agent
    assert.equal(metricasDeMemoria(falso({}).lector, "linux").proceso.pnpm, null)
  } finally {
    if (previo === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = previo
  }
})
