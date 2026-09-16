"use client"

import { useCallback, useEffect, useState } from "react"
import { Mic, X } from "lucide-react"
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
      speak("Te escucho. Di el nombre de una estación o ruta.")
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

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-background/95 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Comando de voz"
    >
      <button
        type="button"
        onClick={close}
        aria-label="Cerrar micrófono"
        className="absolute right-4 top-5 flex size-12 items-center justify-center rounded-xl border-2 border-foreground"
      >
        <X className="size-6" aria-hidden="true" />
      </button>

      <div
        className={[
          "flex size-40 items-center justify-center rounded-full border-4 transition-colors",
          listening ? "border-brand bg-brand text-brand-foreground animate-pulse" : "border-foreground",
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
        className="rounded-2xl border-2 border-foreground px-8 py-4 text-lg font-bold disabled:opacity-50"
      >
        {listening ? "Detener" : "Hablar de nuevo"}
      </button>
    </div>
  )
}
