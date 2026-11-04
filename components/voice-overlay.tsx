"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, X } from "lucide-react"
import { Modal } from "@/components/modal"
import { ESCUCHA_ESPERA_SUPERPOSICION_MS, useSpeech, useVoiceRecognition } from "@/hooks/use-speech"

type VoiceOverlayProps = {
  open: boolean
  onClose: () => void
  onTranscript: (transcript: string) => void
}

/**
 * Aviso breve y accesible de privacidad de la BÚSQUEDA POR VOZ, visible antes de
 * capturar (EA-08, hallazgo 8/estándares 6). Dice lo que esta pantalla hace de
 * verdad: la búsqueda se resuelve en el dispositivo con los datos ya cargados,
 * sin enviar tu frase a este servidor; solo el reconocimiento de voz puede
 * enviar el audio a un servicio del navegador. Hay alternativa por texto.
 */
const AVISO_PRIVACIDAD =
  "El reconocimiento de voz puede procesarse en el navegador o enviar el audio a un servicio del navegador; no es necesariamente local. La búsqueda se hace en tu dispositivo con los datos ya cargados: tu frase no se envía a este servidor. Si prefieres, cierra y escribe tu búsqueda."

export function VoiceOverlay({ open, onClose, onTranscript }: VoiceOverlayProps) {
  const { speak, cancel } = useSpeech()
  const [transcript, setTranscript] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  /**
   * ¿Está abierta la superposición? En una ref para que los callbacks del
   * reconocimiento descarten eventos TARDÍOS que lleguen después de cerrar
   * (EA-08, hallazgo 6): un `onresult` o un `onerror` posterior al cierre no
   * debe buscar ni hablar.
   */
  const abiertaRef = useRef(open)
  useEffect(() => {
    abiertaRef.current = open
  }, [open])

  const handleResult = useCallback(
    (text: string) => {
      if (!abiertaRef.current) return
      setTranscript(text)
      onTranscript(text)
    },
    [onTranscript],
  )

  const handleError = useCallback(
    (error: string) => {
      // Un aborto propio (pulsar «Detener» o cerrar) no es un error: `abort()`
      // emite `onerror` con `error: "aborted"` en el navegador (EA-08,
      // hallazgo 3/estándares 2). Igual que en el asistente de voz.
      if (!abiertaRef.current || error === "aborted") return
      const message =
        error === "not-allowed"
          ? "No hay permiso para usar el micrófono."
          : error === "no-speech"
            ? "No se escuchó nada. Toca «Hablar de nuevo» para reintentar."
            : "Ocurrió un error con el micrófono."
      setErrorMessage(message)
      speak(message)
    },
    [speak],
  )

  const { listening, supported, start, abort } = useVoiceRecognition({
    onResult: handleResult,
    onError: handleError,
  })

  // Al abrir: anuncia y arranca la escucha UNA sola vez. No se reprograma al
  // terminar una captura (antes un `setTimeout` de 900 ms reiniciaba la escucha
  // sin intención nueva, EA-08 hallazgo 6). `start` es estable, así que este
  // efecto solo corre al cambiar `open` o el soporte. La breve espera antes de
  // arrancar separa el anuncio del inicio de la captura; no se ha medido que
  // baste para toda la locución, así que si la persona oye parte del anuncio al
  // hablar puede reintentar con «Hablar de nuevo».
  useEffect(() => {
    if (!open) return
    setTranscript("")
    setErrorMessage("")
    if (!supported) {
      setErrorMessage("Este dispositivo no permite reconocimiento de voz.")
      speak("Este dispositivo no permite reconocimiento de voz.")
      return
    }
    speak("Te escucho. Di el nombre de una estación o un código de ruta.")
    const temporizador = setTimeout(() => start(), ESCUCHA_ESPERA_SUPERPOSICION_MS)
    return () => clearTimeout(temporizador)
  }, [open, supported, speak, start])

  const close = useCallback(() => {
    // Cerrar ABORTA la captura (no `stop`): descarta lo que ya oyó para que no
    // llegue una búsqueda tardía, y calla la voz.
    abort()
    cancel()
    onClose()
  }, [abort, cancel, onClose])

  return (
    <Modal open={open} onClose={close} label="Comando de voz" className="open:flex open:flex-col open:items-center open:justify-center open:gap-8 open:p-6">
      <button
        type="button"
        onClick={close}
        aria-label="Cerrar micrófono"
        className="absolute right-4 top-5 flex size-12 items-center justify-center rounded-2xl border-3 border-border bg-card shadow-sm transition active:scale-95"
      >
        <X className="size-6" aria-hidden="true" />
      </button>

      <div
        className={[
          "flex size-40 items-center justify-center rounded-full transition-colors",
          listening
            ? "animate-pulse border-3 border-border bg-brand text-brand-foreground"
            : "border-3 border-border bg-brand-soft text-brand-ink",
        ].join(" ")}
      >
        <Mic className="size-16" aria-hidden="true" />
      </div>

      <p className="text-center text-xl font-semibold" aria-live="polite">
        {listening ? "Escuchando..." : transcript ? "Listo" : "Toca para hablar"}
      </p>

      {transcript && (
        <p className="max-w-sm text-center text-lg text-muted-foreground">“{transcript}”</p>
      )}
      {errorMessage && (
        <p className="max-w-sm text-center text-lg text-brand-ink" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="button"
        onClick={() => (listening ? abort() : start())}
        disabled={!supported}
        className="rounded-2xl border-3 border-border bg-card px-8 py-4 text-lg font-bold shadow-sm transition active:scale-[0.98] disabled:opacity-50"
      >
        {listening ? "Detener" : "Hablar de nuevo"}
      </button>

      <p className="max-w-sm text-center text-sm text-muted-foreground" role="note">
        {AVISO_PRIVACIDAD}
      </p>
    </Modal>
  )
}
