"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Camera } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"

type ScanCameraProps = {
  onBack: () => void
}

export function ScanCamera({ onBack }: ScanCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { speak } = useSpeech()
  const [status, setStatus] = useState<"loading" | "active" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState("")

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
        speak("Cámara lista. Apunta hacia el letrero del bus o la estación.")
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

  return (
    <section className="flex flex-1 flex-col p-4" aria-label="Escanear con la cámara">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border-2 border-foreground bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="size-full object-cover"
          aria-label="Vista de la cámara"
        />
        {status !== "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
            <Camera className="size-12" aria-hidden="true" />
            <p className="text-lg font-semibold" role={status === "error" ? "alert" : undefined}>
              {status === "loading" ? "Abriendo cámara..." : errorMessage}
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-base text-muted-foreground">
        Apunta al letrero del bus o de la estación para identificarlo.
      </p>
    </section>
  )
}
