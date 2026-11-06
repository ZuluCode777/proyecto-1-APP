import { readFileSync } from "node:fs"

/**
 * SONDA TEMPORAL de EA-14 (#40): cifras de memoria del proceso y del cgroup
 * para comprobar el límite de 512 MB de Render Free sin la telemetría de pago.
 * Solo existe en la rama `ea-14-sonda-ram`; NUNCA se fusiona a `main`.
 *
 * Solo se leen las rutas de `RUTAS` (lista cerrada, sin entrada del cliente).
 * Un archivo ausente o ilegible da `null`, nunca un error ni una cifra inventada.
 */
export const RUTAS = {
  proceso: "/proc/self/cgroup",
  v2: {
    actual: "/sys/fs/cgroup/memory.current",
    pico: "/sys/fs/cgroup/memory.peak",
    limite: "/sys/fs/cgroup/memory.max",
  },
  v1: {
    actual: "/sys/fs/cgroup/memory/memory.usage_in_bytes",
    pico: "/sys/fs/cgroup/memory/memory.max_usage_in_bytes",
    limite: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  },
} as const

export const LIMITE_512_MIB = 512 * 1024 * 1024

export type Lector = (ruta: string) => string

const leerUtf8: Lector = (ruta) => readFileSync(ruta, "utf8")

/** Contenido recortado del archivo, o `null` si no existe o no se puede leer. */
function leer(lector: Lector, ruta: string): string | null {
  try {
    return lector(ruta).trim()
  } catch {
    return null
  }
}

/** Entero de bytes, o `null` si falta, `max` o supera el rango exacto (v1 sin tope ≈ 2^63). */
function aBytes(texto: string | null): number | null {
  if (texto === null || !/^\d+$/.test(texto)) return null
  const n = Number(texto)
  return Number.isSafeInteger(n) ? n : null
}

function leerCgroup(lector: Lector, plataforma: string) {
  if (plataforma !== "linux") {
    return { version: null, motivo: "no-linux", rutaProceso: null, actualBytes: null, picoBytes: null, limiteBytes: null, sinLimite: null, limiteIgual512MiB: null }
  }
  // Identidad del cgroup: `0::/` es la raíz de su espacio de nombres; otra ruta indica un cgroup anidado.
  const rutaProceso = leer(lector, RUTAS.proceso)?.slice(0, 200) ?? null
  const v2 = leer(lector, RUTAS.v2.actual) !== null
  const version = v2 ? "v2" : leer(lector, RUTAS.v1.actual) !== null ? "v1" : null
  const rutas = v2 ? RUTAS.v2 : RUTAS.v1
  if (version === null) {
    return { version, motivo: "cgroup-no-legible", rutaProceso, actualBytes: null, picoBytes: null, limiteBytes: null, sinLimite: null, limiteIgual512MiB: null }
  }
  const limiteTexto = leer(lector, rutas.limite)
  const limiteBytes = aBytes(limiteTexto)
  return {
    version,
    motivo: null,
    rutaProceso,
    actualBytes: aBytes(leer(lector, rutas.actual)),
    picoBytes: aBytes(leer(lector, rutas.pico)),
    limiteBytes,
    // `max` (v2) o el tope enorme de v1 = sin límite; `null` aquí significa que no se pudo leer.
    sinLimite: limiteTexto === null ? null : limiteBytes === null,
    limiteIgual512MiB: limiteBytes === null ? null : limiteBytes === LIMITE_512_MIB,
  }
}

/** Cifras del proceso y del cgroup. `lector` y `plataforma` existen solo para las pruebas. */
export function metricasDeMemoria(lector: Lector = leerUtf8, plataforma: string = process.platform) {
  const uso = process.resourceUsage()
  return {
    proceso: {
      node: process.versions.node,
      plataforma,
      pnpm: /\bpnpm\/(\d+\.\d+\.\d+\S*)/.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? null,
      uptimeSegundos: process.uptime(),
      rssBytes: process.memoryUsage().rss,
      // `maxRSS` viene en KiB (Linux y Windows); se convierte a bytes.
      maxRssBytes: uso.maxRSS * 1024,
    },
    // Alcance: el cgroup puede abarcar más que este proceso; solo `limiteIgual512MiB: true`
    // junto con `rutaProceso` respalda que la cifra es la del servicio de 512 MB.
    cgroup: leerCgroup(lector, plataforma),
  }
}
