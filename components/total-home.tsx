"use client"

import { useEffect } from "react"
import { Mic, Camera } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"

type TotalHomeProps = {
  onVoice: () => void
  onScan: () => void
}

export function TotalHome({ onVoice, onScan }: TotalHomeProps) {
  const { speak } = useSpeech()

  useEffect(() => {
    speak(
      "Modo ceguera total. Botón de arriba: hablar para buscar rutas. Botón de abajo: escanear con la cámara.",
    )
  }, [speak])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5">
      <button
        type="button"
        onClick={onVoice}
        onFocus={() => speak("Hablar. Toca para buscar rutas con la voz.")}
        aria-label="Hablar para buscar rutas con la voz"
        className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-foreground bg-card"
      >
        <span className="flex size-28 items-center justify-center rounded-full border-4 border-brand bg-brand text-brand-foreground">
          <Mic className="size-14" aria-hidden="true" />
        </span>
        <span className="text-3xl font-bold">Habla</span>
      </button>

      <button
        type="button"
        onClick={onScan}
        onFocus={() => speak("Escanear. Toca para abrir la cámara.")}
        aria-label="Escanear un letrero con la cámara"
        className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-foreground bg-card"
      >
        <span className="flex size-28 items-center justify-center rounded-full border-4 border-foreground">
          <Camera className="size-14" aria-hidden="true" />
        </span>
        <span className="text-3xl font-bold">Escanea</span>
      </button>
    </div>
  )
}
