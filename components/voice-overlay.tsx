"use client"

import { useCallback, useEffect, useState } from "react"
import { Mic, X } from "lucide-react"
import { Modal } from "@/components/modal"
import { useSpeech, useVoiceRecognition } from "@/hooks/use-speech"

type VoiceOverlayProps = {
  open: boolean
  onClose: () => void
  onTranscript: (transcript: string) => void
}

export function VoiceOverlay({ open, onClose, onTranscript }: VoiceOverlayProps) {
  const { speak, cancel } = useSpeech()
  const [transcript, setTranscript] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  const handleResult = useCallback(
    (text: string) => {
      setTranscript(text)
      onTranscript(text)
    },
    [onTranscript],
  )

  const handleError = useCallback(
    (error: string) => {
      const message =
        error === "not-allowed"
          ? "No hay permiso para usar el micrófono."
          : error === "no-speech"
            ? "No se escuchó nada. Intenta de nuevo."
            : "Ocurrió un error con el micrófono."
      setErrorMessage(message)
      speak(message)
    },
    [speak],
  )

  const { listening, supported, start, stop } = useVoiceRecognition({
    onResult: handleResult,
    onError: handleError,
  })

  useEffect(() => {
    if (!open) return
    setTranscript("")
    setErrorMessage("")
    if (supported) {
      speak("Te escucho. Di el nombre de una estación o un código de ruta.")
      const timer = setTimeout(() => start(), 900)
      return () => clearTimeout(timer)
    }
    setErrorMessage("Este dispositivo no permite reconocimiento de voz.")
    speak("Este dispositivo no permite reconocimiento de voz.")
  }, [open, supported, speak, start])

  const close = useCallback(() => {
    stop()
    cancel()
    onClose()
  }, [stop, cancel, onClose])

  return (
    <Modal open={open} onClose={close} label="Comando de voz" className="open:flex open:flex-col open:items-center open:justify-center open:gap-8 open:p-6">
      <button
        type="button"
        onClick={close}
        aria-label="Cerrar micrófono"
        className="absolute right-4 top-5 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-sm transition active:scale-95"
      >
        <X className="size-6" aria-hidden="true" />
      </button>

      <div
        className={[
          "flex size-40 items-center justify-center rounded-full transition-colors",
          listening
            ? "animate-pulse bg-brand text-brand-foreground shadow-lg shadow-brand/40"
            : "bg-brand-soft text-brand",
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
        <p className="max-w-sm text-center text-lg text-brand" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="button"
        onClick={() => (listening ? stop() : start())}
        disabled={!supported}
        className="rounded-2xl border border-border bg-card px-8 py-4 text-lg font-bold shadow-sm transition active:scale-[0.98] disabled:opacity-50"
      >
        {listening ? "Detener" : "Hablar de nuevo"}
      </button>
    </Modal>
  )
}
