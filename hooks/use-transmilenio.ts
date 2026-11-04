"use client"

import { useCallback, useEffect, useState } from "react"
import {
  LAYER_TIMEOUT_MS,
  motivoCatalogoNoUsable,
  TransmilenioDataSchema,
  type TransmilenioData,
} from "@/lib/transmilenio"

/**
 * Carga del catálogo de TransMilenio en el cliente, compartida por toda la app.
 *
 * - Una sola consulta pendiente se comparte entre todas las pantallas (no se
 *   dispara una petición por componente).
 * - El último catálogo BUENO se guarda en memoria del módulo (solo de esta
 *   sesión; no hay arranque sin red): al cambiar de pantalla no se vuelve a
 *   pedir, y una pantalla montada después lo recibe ya.
 * - Antes de adoptar una respuesta se valida su integridad semántica con la
 *   MISMA guardia que el servidor (`motivoCatalogoNoUsable`): una respuesta
 *   vacía, parcial o con referencias rotas NO reemplaza al último catálogo
 *   válido; se conserva y se marca el fallo para ofrecer reintento visible.
 * - La frescura sale de `source` y `fetchedAt` del catálogo, NO de cuándo llegó
 *   la respuesta: recibir otra vez la misma copia vieja no la rejuvenece.
 *   Un catálogo en vivo reciente se renueva a las seis horas de su `fetchedAt`
 *   (igual que el servidor); una copia guardada, un dato en vivo ya vencido o
 *   una consulta fallida se reintentan cada cinco minutos, como el servidor.
 * - Con el hook montado se revisa cada minuto (sin red) si toca renovar; también
 *   al volver a la pestaña o recuperar la red. Todas las señales pasan por la
 *   misma regla, así que no hay bucles de red. Se limpia al desmontar.
 * - La consulta tiene espera acotada, mayor que el techo upstream del servidor
 *   para que alcance a entregar su copia si el servicio cae; si vence, falla,
 *   libera la pendiente y permite reintentar sin remontar.
 * - `reintentar()` fuerza una nueva consulta sin desmontar la pantalla.
 */

/** Vigencia de un catálogo en vivo, igual que `LIVE_TTL_MS` del servidor. */
const FRESCO_VIVO_MS = 6 * 60 * 60 * 1000
/** Espera entre intentos con respaldo, dato viejo o fallo (`RETRY_MS` del servidor). */
const REINTENTO_MS = 5 * 60 * 1000
/** Cada cuánto, con el hook montado, se comprueba (sin red) si toca renovar. */
const REVISA_MS = 60 * 1000
/** Espera máxima por el servidor: el techo upstream más un margen para su respaldo. */
const CONSULTA_TIMEOUT_MS = LAYER_TIMEOUT_MS + 5_000

/** Último catálogo bueno, compartido por el módulo. */
let catalogo: TransmilenioData | null = null
/** La última consulta terminada falló (se limpia al tener éxito). */
let fallo = false
/** Cuándo terminó la última consulta, con éxito o con fallo. */
let ultimoIntentoEn = 0
/** Consulta en curso, compartida para no lanzar varias a la vez. */
let pendiente: Promise<void> | null = null
/** Suscriptores vivos, para avisarles cuando cambia el estado compartido. */
const suscriptores = new Set<() => void>()

function avisar(): void {
  for (const notificar of suscriptores) notificar()
}

/**
 * Pide el catálogo al servidor y lo adopta solo si es íntegro y no más viejo que
 * el que ya hay. Nunca rechaza: un fallo (red, HTTP, esquema, integridad o
 * tiempo agotado) conserva el último catálogo bueno y se anota en `fallo`. La
 * pendiente se libera siempre, de modo que un reintento no queda atado a una
 * promesa bloqueada. Los componentes se enteran por `avisar()`.
 */
function consultar(): Promise<void> {
  if (pendiente) return pendiente
  pendiente = (async () => {
    const res = await fetch("/api/transmilenio", { signal: AbortSignal.timeout(CONSULTA_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = TransmilenioDataSchema.parse(await res.json())
    const motivo = motivoCatalogoNoUsable(data)
    if (motivo) throw new Error(`catálogo no usable: ${motivo}`)
    // Solo reemplaza si es más nuevo: el mismo catálogo no se re-adopta (evita
    // re-renders y avisos de voz repetidos) ni uno más viejo pisa a uno mejor.
    if (!catalogo || Date.parse(data.fetchedAt) > Date.parse(catalogo.fetchedAt)) catalogo = data
    fallo = false
  })()
    .catch(() => {
      fallo = true
    })
    .finally(() => {
      ultimoIntentoEn = Date.now()
      pendiente = null
      avisar()
    })
  avisar()
  return pendiente
}

/** Instante a partir del cual toca volver a consultar. */
function proximaRevisionEn(): number {
  const reintento = ultimoIntentoEn + REINTENTO_MS
  if (!catalogo || fallo || catalogo.source !== "live") return reintento
  const vence = Date.parse(catalogo.fetchedAt) + FRESCO_VIVO_MS
  // Un dato en vivo ya vencido cuando se consultó (el servidor lo sirvió mientras
  // renovaba) no esperaría más: se reintenta pronto, sin bucle.
  return vence > ultimoIntentoEn ? Math.min(vence, ultimoIntentoEn + FRESCO_VIVO_MS) : reintento
}

/** Consulta si ya toca y no hay otra en curso. */
function revisarFrescura(): void {
  if (pendiente === null && Date.now() >= proximaRevisionEn()) void consultar()
}

export type UsarTransmilenio = {
  data: TransmilenioData | null
  /** La última consulta falló (haya o no catálogo conservado que mostrar). */
  error: boolean
  /** Hay una consulta en curso (primera carga o reintento). */
  cargando: boolean
  /** Origen del catálogo mostrado: servicio en vivo o copia guardada. */
  source: TransmilenioData["source"] | null
  /** Fecha ISO en que se consultó el catálogo mostrado. */
  fetchedAt: string | null
  /** Fuerza una nueva consulta sin desmontar la pantalla. */
  reintentar: () => void
}

export function useTransmilenio(): UsarTransmilenio {
  const [data, setData] = useState<TransmilenioData | null>(catalogo)
  const [error, setError] = useState(fallo)
  const [cargando, setCargando] = useState(pendiente !== null)

  useEffect(() => {
    const sincronizar = () => {
      setData(catalogo)
      setError(fallo)
      setCargando(pendiente !== null)
    }
    suscriptores.add(sincronizar)
    sincronizar()
    revisarFrescura()

    const temporizador = setInterval(revisarFrescura, REVISA_MS)
    const alVolver = () => {
      if (document.visibilityState === "visible") revisarFrescura()
    }
    window.addEventListener("online", revisarFrescura)
    document.addEventListener("visibilitychange", alVolver)

    return () => {
      suscriptores.delete(sincronizar)
      clearInterval(temporizador)
      window.removeEventListener("online", revisarFrescura)
      document.removeEventListener("visibilitychange", alVolver)
    }
  }, [])

  const reintentar = useCallback(() => {
    void consultar()
  }, [])

  return {
    data,
    error,
    cargando,
    source: data?.source ?? null,
    fetchedAt: data?.fetchedAt ?? null,
    reintentar,
  }
}
