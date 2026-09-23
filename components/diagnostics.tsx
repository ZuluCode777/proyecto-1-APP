"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react"

type Result = { state: "idle" | "running" | "ok" | "fail"; detail: string }

type Check = {
  id: string
  title: string
  /** Qué demuestra la prueba, en palabras de quien la mira. */
  proves: string
  run: () => Promise<string>
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string) =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))])

const CHECKS: Check[] = [
  {
    id: "secure",
    title: "Contexto seguro",
    proves: "El navegador permite micrófono, cámara y ubicación en esta dirección.",
    run: async () => {
      if (!window.isSecureContext) throw new Error("Abre la app por HTTPS o en localhost.")
      return location.origin
    },
  },
  {
    id: "transmilenio",
    title: "Datos reales de TransMilenio",
    proves: "La app consulta el servicio público de TransMilenio y recibe estaciones y rutas.",
    run: async () => {
      const res = await fetch("/api/transmilenio")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { stations: unknown[]; routes: unknown[]; source: string; fetchedAt: string }
      const origin = data.source === "live" ? "en vivo" : "copia guardada"
      return `${data.stations.length} estaciones y ${data.routes.length} rutas troncales (${origin}, ${new Date(data.fetchedAt).toLocaleString("es-CO")})`
    },
  },
  {
    id: "agent",
    title: "Asistente",
    proves: "El asistente entiende una pregunta y planea un viaje con los datos reales.",
    run: async () => {
      const [info, res] = await Promise.all([
        fetch("/api/agent").then((r) => r.json() as Promise<{ engine: string; model?: string; reachable?: boolean; hasModel?: boolean }>),
        fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "cómo llego de Portal Usme a Molinos" }),
        }),
      ])
      const reply = (await res.json()) as { reply: string; action: string; steps: unknown[]; engine: string }
      if (reply.action !== "trip") throw new Error(`Respondió "${reply.reply}"`)
      const engine =
        info.engine === "ollama"
          ? `Ollama (${info.model}${info.reachable ? "" : ", sin conexión: usa reglas"})`
          : "reglas locales"
      return `Motor: ${engine}. ${reply.steps.length} pasos. «${reply.reply}»`
    },
  },
  {
    id: "map",
    title: "Mapa",
    proves: "Los mapas de OpenStreetMap cargan desde esta red.",
    run: async () => {
      const img = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("No cargó el mapa base"))
      })
      img.src = `https://tile.openstreetmap.org/12/1204/1995.png?t=${Date.now()}`
      await withTimeout(loaded, 8_000, "El mapa tardó demasiado")
      return "Mapa base de OpenStreetMap disponible"
    },
  },
  {
    id: "tts",
    title: "Voz de la app",
    proves: "La app puede hablar en español.",
    run: async () => {
      if (!("speechSynthesis" in window)) throw new Error("Este navegador no puede hablar.")
      const voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const now = speechSynthesis.getVoices()
        if (now.length) return resolve(now)
        speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices())
        setTimeout(() => resolve(speechSynthesis.getVoices()), 1500)
      })
      const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith("es"))
      const u = new SpeechSynthesisUtterance("Prueba de voz de TransMiVoz.")
      u.lang = "es-CO"
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
      return spanish.length ? `${spanish.length} voces en español. Debiste oír «Prueba de voz».` : "Sin voz en español instalada: usará la voz por defecto."
    },
  },
  {
    id: "stt",
    title: "Reconocimiento de voz",
    proves: "El navegador puede entender lo que dices.",
    run: async () => {
      const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
      if (!w.SpeechRecognition && !w.webkitSpeechRecognition) throw new Error("No disponible. Usa Chrome.")
      return "Disponible"
    },
  },
  {
    id: "mic",
    title: "Micrófono",
    proves: "La app puede escuchar.",
    run: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      return "Permiso concedido"
    },
  },
  {
    id: "camera",
    title: "Cámara",
    proves: "La lupa puede usar la cámara.",
    run: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      const label = stream.getVideoTracks()[0]?.label || "cámara"
      stream.getTracks().forEach((t) => t.stop())
      return `Permiso concedido (${label})`
    },
  },
  {
    id: "gps",
    title: "Ubicación",
    proves: "El GPS auditivo puede saber dónde estás.",
    run: () =>
      new Promise<string>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("No disponible"))
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)} (±${Math.round(p.coords.accuracy)} m)`),
          (e) => reject(new Error(e.message || "Permiso denegado")),
          { timeout: 15_000 },
        )
      }),
  },
]

/**
 * Pantalla de diagnóstico: corre cada prueba en este navegador y muestra el
 * resultado. Sirve como prueba en vivo de que las funciones principales
 * responden, y para encontrar rápido qué falla el día de la presentación.
 */
export function Diagnostics() {
  const [results, setResults] = useState<Record<string, Result>>({})
  // Marca que la página ya responde a clics; lo usa `pnpm verificar`.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  const run = useCallback(async (check: Check) => {
    setResults((r) => ({ ...r, [check.id]: { state: "running", detail: "" } }))
    try {
      const detail = await check.run()
      setResults((r) => ({ ...r, [check.id]: { state: "ok", detail } }))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setResults((r) => ({ ...r, [check.id]: { state: "fail", detail } }))
    }
  }, [])

  const runAll = useCallback(async () => {
    for (const check of CHECKS) await run(check)
  }, [run])

  const passed = CHECKS.filter((c) => results[c.id]?.state === "ok").length

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4" data-ready={ready || undefined}>
      <h1 className="text-3xl font-bold">Diagnóstico</h1>
      <p className="text-lg">Comprueba en vivo, en este navegador, que cada función de TransMiVoz responde.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runAll}
          className="min-h-14 rounded-2xl bg-brand px-6 text-xl font-bold text-brand-foreground"
        >
          Probar todo
        </button>
        <a href="/" className="min-h-14 rounded-2xl border-2 border-border px-6 py-3 text-xl font-bold">
          Volver a la app
        </a>
        <span className="text-xl font-bold" role="status" aria-live="polite">
          {passed} de {CHECKS.length} correctas
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {CHECKS.map((check) => {
          const result = results[check.id] ?? { state: "idle", detail: "" }
          const Icon =
            result.state === "ok" ? CheckCircle2 : result.state === "fail" ? XCircle : result.state === "running" ? Loader2 : CircleDashed
          const color = result.state === "ok" ? "text-green-700 dark:text-green-400" : result.state === "fail" ? "text-emergency dark:text-red-400" : ""
          return (
            <li key={check.id} className="flex items-start gap-3 rounded-2xl border-2 border-border bg-card p-4">
              <Icon className={`mt-1 size-7 shrink-0 ${color} ${result.state === "running" ? "animate-spin" : ""}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold">{check.title}</h2>
                <p className="text-base text-muted-foreground">{check.proves}</p>
                {result.detail && (
                  <p className={`mt-1 break-words text-lg ${color}`}>
                    <span className="sr-only">{result.state === "ok" ? "Correcto: " : "Falló: "}</span>
                    {result.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => run(check)}
                className="min-h-12 shrink-0 rounded-xl border-2 border-border px-4 text-lg font-bold"
              >
                Probar
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
