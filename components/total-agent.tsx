"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, Loader2, Ear } from "lucide-react"
import { useSpeech, useVoiceRecognition } from "@/hooks/use-speech"
import { interpretCommand, type AgentAction, type AgentReply } from "@/lib/local-agent"

export type { AgentAction }

type TotalAgentProps = {
  onAction: (action: AgentAction, query: string) => void
}

type Status = "idle" | "listening" | "thinking" | "error"

export function TotalAgent({ onAction }: TotalAgentProps) {
  const { speak } = useSpeech()
  const [status, setStatus] = useState<Status>("idle")
  const [caption, setCaption] = useState("Toca la pantalla y dime a dónde quieres ir")
  const busyRef = useRef(false)

  const askAgent = useCallback(
    async (message: string) => {
      setStatus("thinking")
      setCaption("Un momento…")
      let data: AgentReply
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        })
        if (!res.ok) throw new Error("bad status")
        data = (await res.json()) as AgentReply
      } catch (error) {
        console.log("[v0] agent request failed, using local interpreter:", error)
        data = interpretCommand(message)
      }
      speak(data.reply)
      setCaption(data.reply)
      if (data.action !== "none") onAction(data.action, data.query)
      busyRef.current = false
      setStatus("idle")
    },
    [onAction, speak],
  )

  const handleResult = useCallback(
    (text: string) => {
      setCaption(`“${text}”`)
      askAgent(text)
    },
    [askAgent],
  )

  const handleError = useCallback(
    (error: string) => {
      busyRef.current = false
      setStatus("error")
      const message =
        error === "not-allowed"
          ? "No tengo permiso para el micrófono. Actívalo e intenta de nuevo."
          : error === "no-speech"
            ? "No te escuché. Toca la pantalla e inténtalo otra vez."
            : "Hubo un problema con el micrófono. Toca para reintentar."
      setCaption(message)
      speak(message)
    },
    [speak],
  )

  const { listening, supported, start, stop } = useVoiceRecognition({
    onResult: handleResult,
    onError: handleError,
  })

  useEffect(() => {
    speak("Modo asistente. Toca la pantalla y dime a dónde quieres ir.")
    return () => stop()
  }, [speak, stop])

  const handleTap = useCallback(() => {
    if (busyRef.current || status === "thinking") return
    if (listening) {
      stop()
      return
    }
    if (!supported) {
      const message = "Este dispositivo no permite reconocimiento de voz."
      setStatus("error")
      setCaption(message)
      speak(message)
      return
    }
    busyRef.current = true
    setStatus("listening")
    setCaption("Escuchando…")
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40)
    speak("Te escucho.")
    window.setTimeout(() => start(), 650)
  }, [listening, status, supported, start, stop, speak])

  const active = status === "listening" || listening
  const thinking = status === "thinking"

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label="Asistente de voz. Toca la pantalla para hablar y pedir rutas o el GPS."
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-brand/25 via-background to-background px-6 text-center transition active:scale-[0.99]"
    >
      {/* Anillos que laten mientras escucha */}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {active &&
          [0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute rounded-full border border-brand/40"
              style={{
                width: `${180 + i * 90}px`,
                height: `${180 + i * 90}px`,
                animation: "ping 1.8s cubic-bezier(0,0,0.2,1) infinite",
                animationDelay: `${i * 0.4}s`,
              }}
            />
          ))}
      </span>

      {/* Círculo central */}
      <span
        className={[
          "relative z-10 flex size-40 items-center justify-center rounded-full text-brand-foreground shadow-lg transition-all duration-300",
          active
            ? "bg-brand shadow-brand/50 scale-105"
            : thinking
              ? "bg-brand shadow-brand/40"
              : "bg-brand shadow-brand/30",
        ].join(" ")}
      >
        {thinking ? (
          <Loader2 className="size-16 animate-spin" aria-hidden="true" />
        ) : active ? (
          <Ear className="size-16" aria-hidden="true" />
        ) : (
          <Mic className="size-16" aria-hidden="true" />
        )}
      </span>

      <span className="relative z-10 mt-10 flex flex-col items-center gap-2">
        <span className="text-2xl font-bold tracking-tight">
          {active ? "Escuchando…" : thinking ? "Pensando…" : "Asistente de voz"}
        </span>
        <span
          className="min-h-[3.5rem] max-w-xs text-pretty text-base text-muted-foreground"
          aria-live="polite"
        >
          {caption}
        </span>
      </span>

      {/* Barra inferior tipo Shazam */}
      <span className="relative z-10 mt-8 flex items-end gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-brand/70"
            style={{
              height: active ? `${10 + ((i % 3) + 1) * 8}px` : "8px",
              animation: active ? "pulse 1s ease-in-out infinite" : "none",
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </span>
    </button>
  )
}
