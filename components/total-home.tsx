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
      "Modo visión total. Botón de arriba: hablar para buscar rutas. Botón de abajo: escanear con la cámara.",
    )
  }, [speak])

  return (
    <div className="flex flex-1 flex-col justify-center gap-8 px-6 pb-10">
      <button
        type="button"
        onClick={onVoice}
        onFocus={() => speak("Hablar. Toca para buscar rutas con la voz.")}
        aria-label="Hablar para buscar rutas con la voz"
        className="flex flex-col items-center gap-4 rounded-3xl border-2 border-foreground py-10"
      >
        <span className="flex size-32 items-center justify-center rounded-full border-4 border-foreground">
          <Mic className="size-16" aria-hidden="true" />
        </span>
        <span className="text-3xl font-bold">Habla</span>
      </button>

      <button
        type="button"
        onClick={onScan}
        onFocus={() => speak("Escanear. Toca para abrir la cámara.")}
        aria-label="Escanear un letrero con la cámara"
        className="flex flex-col items-center gap-4 rounded-3xl border-2 border-foreground py-10"
      >
        <span className="flex size-32 items-center justify-center rounded-full border-4 border-foreground">
          <Camera className="size-16" aria-hidden="true" />
        </span>
        <span className="text-3xl font-bold">Escanea</span>
      </button>
    </div>
  )
}
