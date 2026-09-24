"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Eye, Pause, Play, ScanText, ZoomIn } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"

type VisionAssistProps = {
  onBack: () => void
}

type FilterMode = "contraste" | "fluor" | "byn" | "invertir"

const FILTERS: Record<FilterMode, { label: string; css: string; hint: string }> = {
  contraste: {
    label: "Alto contraste",
    css: "contrast(1.9) brightness(1.12) saturate(1.3)",
    hint: "Alto contraste",
  },
  fluor: {
    label: "Fluorescente",
    css: "contrast(1.6) saturate(3.2) brightness(1.15)",
    hint: "Colores fluorescentes",
  },
  byn: {
    label: "Blanco y negro",
    css: "grayscale(1) contrast(2.4) brightness(1.1)",
    hint: "Blanco y negro",
  },
  invertir: {
    label: "Invertir",
    css: "invert(1) contrast(1.5) brightness(1.05)",
    hint: "Colores invertidos",
  },
}

const FILTER_ORDER: FilterMode[] = ["contraste", "fluor", "byn", "invertir"]

export function VisionAssist({ onBack }: VisionAssistProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { speak } = useSpeech()
  const [status, setStatus] = useState<"loading" | "active" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState("")
  const [mode, setMode] = useState<FilterMode>("contraste")
  const [zoom, setZoom] = useState(1)
  const [frozen, setFrozen] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error")
        setErrorMessage("Este dispositivo no tiene cámara disponible.")
        speak("Este dispositivo no tiene cámara disponible.")
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setStatus("active")
        speak("Lupa lista. Apunta al letrero para verlo más grande y con más contraste.", { queue: true })
      } catch {
        setStatus("error")
        setErrorMessage("No se pudo acceder a la cámara. Revisa los permisos.")
        speak("No se pudo acceder a la cámara. Revisa los permisos.")
      }
    }

    startCamera()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [speak])

  const filterCss = useMemo(() => FILTERS[mode].css, [mode])

  const changeMode = (next: FilterMode) => {
    setMode(next)
    speak(FILTERS[next].hint)
  }

  const toggleFreeze = () => {
    const video = videoRef.current
    if (!video || status !== "active") return
    setFrozen((prev) => {
      const next = !prev
      if (next) {
        video.pause()
        speak("Imagen congelada.")
      } else {
        video.play().catch(() => undefined)
        speak("Imagen en vivo.")
      }
      return next
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4" aria-label="Lupa">
      <div className="mb-3 flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-sm transition active:scale-95"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>
        <span className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <ScanText className="size-6 text-brand-ink" aria-hidden="true" />
          Lupa
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border bg-black shadow-sm">
        <video
          ref={videoRef}
          playsInline
          muted
          className="size-full object-cover transition-transform"
          style={{ filter: filterCss, transform: `scale(${zoom})` }}
          aria-label="Vista de la cámara con contraste aumentado"
        />

        {status === "active" && frozen && (
          <span className="absolute left-3 top-3 rounded-full border-[3px] border-border bg-brand px-3 py-1 text-lg font-bold text-brand-foreground shadow-sm">
            Congelada
          </span>
        )}

        {status !== "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
            <Eye className="size-12" aria-hidden="true" />
            <p className="text-lg font-semibold" role={status === "error" ? "alert" : undefined}>
              {status === "loading" ? "Abriendo cámara..." : errorMessage}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modo de color">
          {FILTER_ORDER.map((key) => {
            const active = key === mode
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => changeMode(key)}
                className={[
                  "rounded-xl border py-2.5 text-base font-bold shadow-sm transition active:scale-[0.97]",
                  active
                    ? "border-border bg-brand text-brand-foreground"
                    : "border-border bg-card",
                ].join(" ")}
              >
                {FILTERS[key].label}
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
          <ZoomIn className="size-5 shrink-0 text-brand-ink" aria-hidden="true" />
          <span className="sr-only">Nivel de acercamiento</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Acercar la imagen"
            className="h-2 w-full accent-brand"
          />
          <span className="w-12 shrink-0 text-right text-base font-bold tabular-nums">
            {zoom.toFixed(1)}x
          </span>
        </label>

        <button
          type="button"
          onClick={toggleFreeze}
          disabled={status !== "active"}
          className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-lg font-bold shadow-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          {frozen ? (
            <>
              <Play className="size-5" aria-hidden="true" />
              Reanudar
            </>
          ) : (
            <>
              <Pause className="size-5" aria-hidden="true" />
              Congelar imagen
            </>
          )}
        </button>
      </div>
    </section>
  )
}
