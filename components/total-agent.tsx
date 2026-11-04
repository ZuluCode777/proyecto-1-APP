"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { CheckCircle2, Ear, Loader2, Mic, Send } from "lucide-react"
import { useSpeech, useVoiceRecognition } from "@/hooks/use-speech"
import type { LatLng } from "@/lib/geo"
import {
  AgentReplySchema,
  contieneImperativoDeViaje,
  interpretCommand,
  plainReply,
  textoViajeDesdeResumen,
  type AgentReply,
  type AgentStep,
} from "@/lib/local-agent"
import type { TransmilenioData } from "@/lib/routes"

type TotalAgentProps = {
  data: TransmilenioData | null
  onAction: (reply: AgentReply) => void
}

type Status = "idle" | "listening" | "thinking" | "error"

/** Pausa entre pasos, para que se vea y se oiga el razonamiento del asistente. */
const STEP_DELAY_MS = 450
/** Tiempo que se queda la respuesta en pantalla antes de abrir el resultado. */
const NAVIGATE_DELAY_MS = 2500
/** Texto en reposo, a la espera de un toque. */
const IDLE_CAPTION = "Toca la pantalla y dime a dónde quieres ir"

/** Aviso seguro cuando un viaje no puede confirmarse ahora, sin instrucciones. */
const VIAJE_NO_CONFIRMABLE =
  "No puedo confirmar las paradas y el horario de ese viaje con los datos actuales, así que no te doy indicaciones de abordaje. Confirma la ruta con TransMilenio."

/**
 * Deja una respuesta lista para mostrar/hablar/navegar con seguridad. Las
 * acciones que no son de viaje no dan órdenes de abordaje y pasan igual. Una
 * respuesta de viaje se revalida contra el catálogo MÁS RECIENTE y el reloj
 * actual, y su texto y pasos se RECONSTRUYEN desde el resumen validado con la
 * función responsable compartida; nunca se confía en la prosa recibida. Si no
 * es prescriptible ahora (esquema viejo, otros datos, fuera de franja, sin
 * catálogo), se degrada a un aviso seguro sin instrucciones.
 */
function sanear(reply: AgentReply, data: TransmilenioData | null): AgentReply {
  if (reply.action === "trip") {
    if (!data) return plainReply(VIAJE_NO_CONFIRMABLE, reply.engine)
    const reconstruido = textoViajeDesdeResumen(reply.trip, data, new Date())
    if (!reconstruido) return plainReply(VIAJE_NO_CONFIRMABLE, reply.engine)
    return { ...reply, reply: reconstruido.reply, steps: reconstruido.steps }
  }
  // Una acción que no es de viaje tampoco puede traer órdenes de abordaje en su
  // texto o en sus pasos (p. ej. un `search` con «Toma la H72 en Calle 127…»):
  // si las trae, se descarta por seguro y se conserva la acción sin instrucciones.
  const pasoInseguro = reply.steps.some(
    (s) => contieneImperativoDeViaje(s.label) || (s.detail ? contieneImperativoDeViaje(s.detail) : false),
  )
  if (contieneImperativoDeViaje(reply.reply) || pasoInseguro) {
    return { ...reply, reply: VIAJE_NO_CONFIRMABLE, steps: [] }
  }
  return reply
}

/**
 * Asistente de voz. Toda la pantalla es el botón para hablar. Debajo muestra
 * los pasos que siguió para responder y un campo para escribir, útil cuando
 * hay ruido o el micrófono no está disponible.
 */
export function TotalAgent({ data, onAction }: TotalAgentProps) {
  const { speak } = useSpeech()
  const [status, setStatus] = useState<Status>("idle")
  const [caption, setCaption] = useState(IDLE_CAPTION)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [engine, setEngine] = useState<AgentReply["engine"] | null>(null)
  const [typed, setTyped] = useState("")
  /** Verdadero mientras el asistente piensa una respuesta. */
  const busyRef = useRef(false)
  const startTimerRef = useRef<number | undefined>(undefined)
  /** Número de la última pregunta: una respuesta vieja no navega si ya hay otra. */
  const lastAskRef = useRef(0)
  const positionRef = useRef<LatLng | undefined>(undefined)
  /**
   * Catálogo más reciente, en una ref: la revalidación de un viaje debe usar los
   * datos actuales y no los capturados por el cierre cuando empezó el fetch o
   * durante las pausas antes de navegar.
   */
  const dataRef = useRef<TransmilenioData | null>(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  /** Pide la ubicación sin bloquear: si llega, el asistente la usa como origen. */
  const locate = useCallback(() => {
    if (positionRef.current || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        positionRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      },
      () => undefined,
      { maximumAge: 60_000, timeout: 10_000 },
    )
  }, [])

  const askAgent = useCallback(
    async (message: string) => {
      const ask = ++lastAskRef.current
      busyRef.current = true
      setStatus("thinking")
      setCaption("Pensando…")
      setSteps([])

      let reply: AgentReply
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, position: positionRef.current }),
        })
        if (!res.ok && res.status !== 429 && res.status !== 413) throw new Error(`HTTP ${res.status}`)
        reply = AgentReplySchema.parse(await res.json())
      } catch {
        // Sin servidor: el mismo intérprete corre en el navegador con los datos ya cargados.
        const actual = dataRef.current
        if (!actual) {
          reply = plainReply("No tengo conexión con el servidor. Inténtalo de nuevo.")
        } else {
          reply = interpretCommand(message, actual, { position: positionRef.current, now: new Date() })
        }
      }

      // Cuántos pasos mostrará la respuesta, para animar la espera. El texto de
      // los pasos NO se fija aquí: una respuesta de viaje puede dejar de ser
      // prescriptible durante la animación, así que los pasos reales se
      // reconstruyen al final, tras revalidar. Durante la espera solo avanza un
      // marcador neutro, sin instrucciones que puedan quedar viejas.
      const pasosPrevios = sanear(reply, dataRef.current).steps.length
      for (let i = 0; i < pasosPrevios; i++) {
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS))
        if (ask !== lastAskRef.current) return
      }

      // Guardia JUSTO antes de subtítulo, voz y pasos, DESPUÉS de todas las
      // esperas: se revalida la respuesta ORIGINAL contra el catálogo más
      // reciente y el reloj actual. Un viaje que era válido al llegar puede
      // haber salido de su franja durante la animación; en ese caso aquí se
      // degrada a un aviso seguro, y nunca se habla ni se muestran instrucciones
      // viejas.
      if (ask !== lastAskRef.current) return
      const seguro = sanear(reply, dataRef.current)
      setSteps(seguro.steps)
      setEngine(seguro.engine)
      setCaption(seguro.reply)
      speak(seguro.reply)
      busyRef.current = false
      setStatus("idle")
      if (seguro.action === "none") return
      // Deja ver los pasos y la respuesta antes de cambiar de pantalla. Si en
      // esa pausa llega otra pregunta, esta respuesta ya no navega.
      if (seguro.steps.length > 0) await new Promise((r) => setTimeout(r, NAVIGATE_DELAY_MS))
      if (ask !== lastAskRef.current) return
      // Revalida otra vez justo antes de navegar contra el catálogo actual: el
      // tiempo o los datos pudieron cambiar durante la pausa.
      const navegable = sanear(reply, dataRef.current)
      if (seguro.action === "trip" && navegable.action !== "trip") {
        // El viaje dejó de ser prescriptible en la pausa: no se abre; se avisa,
        // reemplazando también los pasos viejos.
        setSteps(navegable.steps)
        setCaption(navegable.reply)
        speak(navegable.reply)
        return
      }
      onAction(navegable)
    },
    [onAction, speak],
  )

  const handleResult = useCallback(
    (text: string) => {
      if (busyRef.current) return
      setCaption(`“${text}”`)
      void askAgent(text)
    },
    [askAgent],
  )

  const handleError = useCallback(
    (error: string) => {
      // Cancelar la escucha (abort) no es un error.
      if (busyRef.current || error === "aborted") return
      setStatus("error")
      const message =
        error === "not-allowed"
          ? "No tengo permiso para el micrófono. Actívalo o escribe tu pregunta abajo."
          : error === "no-speech"
            ? "No te escuché. Toca la pantalla e inténtalo otra vez."
            : "Hubo un problema con el micrófono. Toca para reintentar o escribe abajo."
      setCaption(message)
      speak(message)
    },
    [speak],
  )

  const { listening, supported, start, abort } = useVoiceRecognition({ onResult: handleResult, onError: handleError })
  const active = status === "listening" || listening
  const thinking = status === "thinking"

  /**
   * Deja de escuchar, incluso si el micrófono aún no había arrancado, y
   * descarta lo que ya oyó para que no llegue una respuesta tardía.
   */
  const stopListening = useCallback(() => {
    window.clearTimeout(startTimerRef.current)
    abort()
  }, [abort])

  const backToIdle = useCallback(() => {
    setStatus("idle")
    setCaption(IDLE_CAPTION)
  }, [])

  useEffect(() => {
    speak("Asistente de voz. Toca la pantalla y dime a dónde quieres ir.", { queue: true })
    return () => {
      stopListening()
      // Si la persona sale en la pausa antes de navegar, la respuesta ya no abre su pantalla.
      lastAskRef.current++
    }
  }, [speak, stopListening])

  // Si el micrófono se apaga sin oír nada, vuelve a esperar un toque.
  const wasListeningRef = useRef(false)
  useEffect(() => {
    if (wasListeningRef.current && !listening && status === "listening") backToIdle()
    wasListeningRef.current = listening
  }, [listening, status, backToIdle])

  const handleTap = useCallback(() => {
    if (busyRef.current) return
    if (active) {
      stopListening()
      backToIdle()
      return
    }
    locate()
    if (!supported) {
      const message = "Este navegador no reconoce la voz. Escribe tu pregunta abajo."
      setStatus("error")
      setCaption(message)
      speak(message)
      return
    }
    // Una pregunta nueva: la respuesta anterior ya no abre su pantalla.
    lastAskRef.current++
    setStatus("listening")
    setCaption("Escuchando…")
    navigator.vibrate?.(40)
    speak("Te escucho.")
    startTimerRef.current = window.setTimeout(() => start(), 650)
  }, [active, supported, start, stopListening, backToIdle, speak, locate])

  const handleTyped = (event: FormEvent) => {
    event.preventDefault()
    const text = typed.trim()
    if (!text || busyRef.current) return
    // Escribir mientras escucha: deja el micrófono y responde a lo escrito.
    stopListening()
    locate()
    setTyped("")
    setCaption(`“${text}”`)
    void askAgent(text)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Asistente de voz">
      <button
        type="button"
        onClick={handleTap}
        aria-label="Asistente de voz. Toca para hablar y pedir rutas, horarios o tu ubicación."
        className="relative flex min-h-[55%] shrink-0 flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-bar via-background to-background px-6 py-8 text-center"
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          {active &&
            [0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute rounded-full border-3 border-brand-ink/50"
                style={{
                  width: `${180 + i * 90}px`,
                  height: `${180 + i * 90}px`,
                  animation: "ping 1.8s cubic-bezier(0,0,0.2,1) infinite",
                  animationDelay: `${i * 0.4}s`,
                }}
              />
            ))}
        </span>

        <span className="relative z-10 flex size-40 items-center justify-center rounded-full border-3 border-border bg-brand text-brand-foreground shadow-lg">
          {thinking ? (
            <Loader2 className="size-16 animate-spin" aria-hidden="true" />
          ) : active ? (
            <Ear className="size-16" aria-hidden="true" />
          ) : (
            <Mic className="size-16" aria-hidden="true" />
          )}
        </span>

        <span className="relative z-10 mt-8 text-3xl font-bold tracking-tight">
          {active ? "Escuchando…" : thinking ? "Pensando…" : "Asistente de voz"}
        </span>
        <span className="relative z-10 mt-3 min-h-[4rem] max-w-sm text-pretty text-xl" aria-live="polite">
          {caption}
        </span>
      </button>

      <div className="flex flex-col gap-4 px-4 pb-4">
        {steps.length > 0 && (
          <div className="rounded-2xl border-3 border-border bg-card p-4">
            <h3 className="flex items-center justify-between text-lg font-bold">
              Lo que hice
              {engine && (
                <span className="rounded-full border-3 border-border px-3 py-1 text-base font-semibold">
                  Motor: {engine === "ollama" ? "Ollama" : "reglas"}
                </span>
              )}
            </h3>
            <ol className="mt-2 flex flex-col gap-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-lg">
                  <CheckCircle2 className="mt-1 size-5 shrink-0 text-brand-ink" aria-hidden="true" />
                  <span>
                    {step.label}
                    {step.detail && <span className="block text-base text-muted-foreground">{step.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <form onSubmit={handleTyped} className="flex gap-2">
          <label htmlFor="agent-text" className="sr-only">
            Escribe tu pregunta
          </label>
          <input
            id="agent-text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="O escribe: cómo llego a Ricaurte"
            className="min-h-14 min-w-0 flex-1 rounded-2xl border-3 border-border bg-card px-4 text-lg placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Enviar pregunta"
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-3 border-border bg-brand text-brand-foreground"
          >
            <Send className="size-6" aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  )
}
