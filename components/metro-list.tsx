"use client"

import { useEffect } from "react"
import { ExternalLink, Info, TrainFront } from "lucide-react"
import { ScreenHeader } from "@/components/screen-header"
import { esUltimaLocucion, useSpeech } from "@/hooks/use-speech"
import {
  ATRIBUCION_METRO,
  ESTACIONES_METRO_L1,
  FUENTES_METRO,
  LINEA_2,
  METRO_CORTE_HABLADO,
  TEXTO_LIMITES,
  TEXTO_LINEA_1,
  TEXTO_LINEA_2,
  describirConexion,
  describirNombre,
  nombreEstacion,
} from "@/lib/metro"

type MetroListProps = {
  onBack: () => void
}

/**
 * Listado accesible del Metro de Bogotá (EA-13). Es una pantalla de consulta,
 * sin mapa: cada estación se abre con el teclado o el lector de pantalla, y la
 * voz dice el mismo estado que muestra el texto. No usa las rutas, el GPS ni el
 * planificador de TransMilenio.
 */
export function MetroList({ onBack }: MetroListProps) {
  const { speak, cancel } = useSpeech()

  // Dice el estado una vez al entrar, con las mismas palabras que la pantalla. Al
  // salir corta SOLO su propia locución: si el padre habló después (p. ej. el
  // anuncio de cambio de modo), esa voz no es suya y no se toca.
  useEffect(() => {
    const locucion = speak(`${TEXTO_LINEA_1} ${TEXTO_LIMITES}`, { queue: true })
    return () => {
      if (esUltimaLocucion(locucion)) cancel()
    }
  }, [speak, cancel])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Metro de Bogotá">
      <ScreenHeader
        title="Metro de Bogotá"
        subtitle="Línea 1 · en construcción · sin servicio"
        icon={TrainFront}
        onBack={onBack}
      />

      <p className="mb-3 flex items-start gap-2 rounded-2xl border-3 border-border bg-card p-3 text-base" role="note">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span>
          {TEXTO_LINEA_1} {TEXTO_LIMITES} Datos al {METRO_CORTE_HABLADO}.
        </span>
      </p>

      <h3 className="mb-2 text-xl font-extrabold">Estaciones de la Línea 1</h3>
      <ol className="flex flex-col gap-3" aria-label="Estaciones de la Línea 1 del Metro, de E01 a E16">
        {ESTACIONES_METRO_L1.map((estacion) => (
          <li key={estacion.clave}>
            <details className="rounded-2xl border-3 border-border bg-card p-4">
              <summary className="flex min-h-12 cursor-pointer flex-col gap-1 text-xl font-bold">
                <span>
                  {estacion.idOficial} · {nombreEstacion(estacion)}
                </span>
                <span className="text-base font-semibold text-muted-foreground">{estacion.corredor}</span>
              </summary>
              <div className="mt-3 flex flex-col gap-2 text-base">
                <p>{describirNombre(estacion)}</p>
                <p>Nombre técnico de referencia: {estacion.aliasSig} (archivo de 2022).</p>
                <p>{describirConexion(estacion)}</p>
                <p>No tengo ubicación exacta ni accesos validados.</p>
                <p className="text-muted-foreground">
                  Fuentes: {estacion.fuentes.filter((id, i, ids) => ids.indexOf(id) === i).join(", ")}
                </p>
              </div>
            </details>
          </li>
        ))}
      </ol>

      <h3 className="mb-2 mt-6 text-xl font-extrabold">Línea 2</h3>
      <details className="rounded-2xl border-3 border-border bg-card p-4">
        <summary className="min-h-12 cursor-pointer text-xl font-bold">
          Línea 2 · en contratación · {LINEA_2.estacionesProyectadas} estaciones proyectadas
        </summary>
        <p className="mt-3 text-base">{TEXTO_LINEA_2}</p>
      </details>

      <h3 className="mb-2 mt-6 text-xl font-extrabold">Fuentes y fechas</h3>
      <p className="mb-2 text-base text-muted-foreground">{ATRIBUCION_METRO}</p>
      <ul className="flex flex-col gap-2 pb-4">
        {Object.values(FUENTES_METRO).map((fuente) => (
          <li key={fuente.id} className="text-base">
            <a
              href={fuente.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-start gap-2 font-semibold underline"
            >
              <ExternalLink className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <span>
                {fuente.id} · {fuente.entidad}: {fuente.titulo} ({fuente.fecha})
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
