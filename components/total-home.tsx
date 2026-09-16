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
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-5 pt-2">
      <button
        type="button"
        onClick={onVoice}
        onFocus={() => speak("Hablar. Toca para buscar rutas con la voz.")}
        aria-label="Hablar para buscar rutas con la voz"
        className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-card shadow-sm transition active:scale-[0.99]"
      >
        <span className="flex size-24 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg shadow-brand/30">
          <Mic className="size-12" aria-hidden="true" />
        </span>
        <span className="flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tracking-tight">Habla</span>
          <span className="text-base text-muted-foreground">Buscar rutas con la voz</span>
        </span>
      </button>

      <button
        type="button"
        onClick={onGps}
        onFocus={() => speak("GPS auditivo. Toca para caminar a estaciones cercanas.")}
        aria-label="GPS auditivo para caminar a estaciones cercanas"
        className="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl border border-border bg-card shadow-sm transition active:scale-[0.99]"
      >
        <span className="flex size-24 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Navigation className="size-12" aria-hidden="true" />
        </span>
        <span className="flex flex-col items-center gap-1">
          <span className="text-3xl font-bold tracking-tight">GPS</span>
          <span className="text-base text-muted-foreground">Caminar a estaciones cercanas</span>
        </span>
      </button>
    </div>
  )
}
