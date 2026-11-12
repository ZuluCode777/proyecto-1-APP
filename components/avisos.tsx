"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { Modal } from "@/components/modal"
import { esUltimaLocucion, useSpeech } from "@/hooks/use-speech"
import { AnunciosRespuestaSchema, type AnunciosRespuesta } from "@/lib/anuncios"
import { AVISO_SIN_GARANTIA, ETIQUETA_EFECTO, ETIQUETA_ESTADO, lineaFuente, textoHablado, vigenciaTexto } from "@/lib/anuncios-texto"
import { procedenciaCatalogo, type TransmilenioData } from "@/lib/transmilenio"

/** Espera máxima por `/api/anuncios` (la fuente tiene la suya, menor). */
const CONSULTA_TIMEOUT_MS = 12_000

const TEXTO_NO_CONSULTADO = `No pude consultar los anuncios de TransMilenio. ${AVISO_SIN_GARANTIA}`
const TEXTO_CONSULTANDO = "Consultando los anuncios de TransMilenio."
/** Escenario fijo de la app: el Metro no tiene servicio comercial y no genera anuncios. */
const TEXTO_ESCENARIO_METRO =
  "El Metro de Bogotá es un escenario educativo, sin servicio comercial. No genera anuncios ni indica horarios o abordaje."

type Consulta = { tipo: "consultando" } | { tipo: "error" } | { tipo: "ok"; datos: AnunciosRespuesta }

type AvisosProps = {
  open: boolean
  onClose: () => void
  /** Catálogo de rutas, para el aviso propio de la app sobre la procedencia de sus datos. */
  catalogo: TransmilenioData | null
  /** La última actualización del catálogo falló. */
  errorCatalogo: boolean
}

/** Marca de origen, siempre en texto (no solo color) para que la lea el lector de pantalla. */
function Origen({ children }: { children: string }) {
  return <span className="inline-block rounded-lg border-3 border-border bg-bar px-2 py-0.5 text-base font-bold">{children}</span>
}

/**
 * Panel que abre la campana (EA-26, #52). Separa tres orígenes que nunca se
 * mezclan: anuncios OFICIALES del operador (con el estado de su fuente), avisos
 * PROPIOS de la app y el escenario SIMULADO del Metro. Sin fuente conectada o
 * con la consulta caída no dice que no haya incidentes: dice que no puede saberlo.
 */
export function Avisos({ open, onClose, catalogo, errorCatalogo }: AvisosProps) {
  const { speak, cancel } = useSpeech()
  // Sin voz del navegador la app no habla: el resultado se anuncia como región viva (un solo canal a la vez).
  const sinVoz = typeof window !== "undefined" && !("speechSynthesis" in window)
  const [consulta, setConsulta] = useState<Consulta>({ tipo: "consultando" })

  useEffect(() => {
    if (!open) return
    setConsulta({ tipo: "consultando" })
    let vigente = true
    const controlador = new AbortController()
    const limite = setTimeout(() => controlador.abort(), CONSULTA_TIMEOUT_MS)
    let ultima = speak(TEXTO_CONSULTANDO)
    void (async () => {
      try {
        const res = await fetch("/api/anuncios", { signal: controlador.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const datos = AnunciosRespuestaSchema.parse(await res.json())
        if (!vigente) return
        setConsulta({ tipo: "ok", datos })
        ultima = speak(textoHablado(datos))
      } catch {
        if (!vigente) return // se cerró el panel: nadie espera este resultado
        setConsulta({ tipo: "error" })
        ultima = speak(TEXTO_NO_CONSULTADO)
      }
    })()
    return () => {
      vigente = false
      clearTimeout(limite)
      controlador.abort()
      // Al cerrar el panel (o desmontarlo) calla SOLO su propia locución: no sigue leyendo cinco anuncios fuera de la pantalla.
      if (esUltimaLocucion(ultima)) cancel()
    }
  }, [open, speak, cancel])

  const avisoCatalogo = errorCatalogo
    ? "No pude actualizar las rutas de TransMilenio. Sigues viendo los últimos datos cargados."
    : catalogo?.source === "snapshot"
      ? procedenciaCatalogo(catalogo)
      : null

  return (
    <Modal open={open} onClose={onClose} label="Avisos" className="open:flex open:flex-col">
      <div className="flex items-center justify-between border-b-3 border-border bg-bar px-4 pb-3 pt-5">
        <h2 className="text-2xl font-bold tracking-tight">Avisos</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar avisos"
          className="flex size-12 items-center justify-center rounded-2xl border-3 border-border bg-bar transition active:scale-95"
        >
          <X className="size-6" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <section aria-labelledby="avisos-operador" className="flex flex-col gap-3">
          <h3 id="avisos-operador" className="text-xl font-bold">
            Anuncios del operador
          </h3>
          {/* Región viva solo si no hay voz del navegador; con voz, la de la app ya lo dice y un lector de pantalla lo repetiría. */}
          <div className="rounded-2xl border-3 border-border bg-card p-4 text-base" aria-live={sinVoz ? "polite" : undefined}>
            {consulta.tipo === "consultando" && <p>{TEXTO_CONSULTANDO}</p>}
            {consulta.tipo === "error" && <p>{TEXTO_NO_CONSULTADO}</p>}
            {consulta.tipo === "ok" && (
              <>
                <p className="font-bold">{ETIQUETA_ESTADO[consulta.datos.fuente.estado]}</p>
                <p className="mt-1">{consulta.datos.fuente.mensaje}</p>
                {lineaFuente(consulta.datos.fuente) && <p className="mt-1 text-base">{lineaFuente(consulta.datos.fuente)}</p>}
              </>
            )}
          </div>
          {consulta.tipo === "ok" && consulta.datos.anuncios.length > 0 && (
            <ul className="flex flex-col gap-3">
              {consulta.datos.anuncios.map((a) => (
                <li key={a.identificador} className="flex flex-col gap-1 rounded-2xl border-3 border-border bg-card p-4">
                  <Origen>{`Anuncio oficial · ${a.entidad}`}</Origen>
                  <h4 className="text-lg font-bold">{a.titulo}</h4>
                  {a.descripcion && a.descripcion !== a.titulo && <p className="text-base">{a.descripcion}</p>}
                  <p className="text-base">
                    Afectación: {ETIQUETA_EFECTO[a.afectacion.efecto]}
                    {a.afectacion.rutas.length > 0 && `. Servicios (identificador de la fuente): ${a.afectacion.rutas.join(", ")}`}
                  </p>
                  <p className="text-base">{vigenciaTexto(a)}. Identificador {a.identificador}.</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="avisos-app" className="flex flex-col gap-3">
          <h3 id="avisos-app" className="text-xl font-bold">
            Avisos de la app
          </h3>
          <div className="flex flex-col gap-1 rounded-2xl border-3 border-border bg-card p-4 text-base">
            <Origen>Aviso de la app</Origen>
            <p>{avisoCatalogo ?? "La app no tiene avisos propios ahora. No es un anuncio del operador."}</p>
          </div>
        </section>

        <section aria-labelledby="avisos-simulado" className="flex flex-col gap-3">
          <h3 id="avisos-simulado" className="text-xl font-bold">
            Escenario simulado
          </h3>
          <div className="flex flex-col gap-1 rounded-2xl border-3 border-border bg-card p-4 text-base">
            <Origen>Simulado</Origen>
            <p>{TEXTO_ESCENARIO_METRO}</p>
          </div>
        </section>
      </div>
    </Modal>
  )
}
