"use client"

import { useEffect } from "react"
import { Mic, Navigation } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"

type TotalHomeProps = {
  onVoice: () => void
  onGps: () => void
}

export function TotalHome({ onVoice, onGps }: TotalHomeProps) {
  const { speak } = useSpeech()

  useEffect(() => {
    speak(
      "Modo ceguera total. Botón de arriba: hablar para buscar rutas. Botón de abajo: GPS auditivo para caminar a estaciones cercanas.",
    )
  }, [speak])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
      <button
        type="button"
        onClick={onVoice}
        onFocus={() => speak("Hablar. Toca para buscar rutas con la voz.")}
        aria-label="Hablar para buscar rutas con la voz"
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-foreground bg-card"
      >
        <span className="flex size-20 items-center justify-center rounded-full border-4 border-brand bg-brand text-brand-foreground">
          <Mic className="size-10" aria-hidden="true" />
        </span>
        <span className="text-2xl font-bold">Habla</span>
      </button>

      <button
        type="button"
        onClick={onGps}
        onFocus={() => speak("GPS auditivo. Toca para caminar a estaciones cercanas.")}
        aria-label="GPS auditivo para caminar a estaciones cercanas"
        className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-foreground bg-card"
      >
        <span className="flex size-20 items-center justify-center rounded-full border-4 border-foreground">
          <Navigation className="size-10" aria-hidden="true" />
        </span>
        <span className="text-2xl font-bold">GPS</span>
      </button>
    </div>
  )
}
