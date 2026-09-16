"use client"

import { useCallback, useEffect, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { ModeMenu } from "@/components/mode-menu"
import { PartialHome } from "@/components/partial-home"
import { TotalHome } from "@/components/total-home"
import { RouteList } from "@/components/route-list"
import { Assistance } from "@/components/assistance"
import { VisionAssist } from "@/components/vision-assist"
import { AuditoryGps } from "@/components/auditory-gps"
import { VoiceOverlay } from "@/components/voice-overlay"
import { useSpeech } from "@/hooks/use-speech"
import { searchRoutes, frequentRoutes, type BusRoute } from "@/lib/routes"

export type Mode = "parcial" | "total"
type Screen = "home" | "buscar" | "frecuentes" | "asistencia" | "vision" | "gps"

const STORAGE_KEY = "transmivoz-mode"
const FLUOR_KEY = "transmivoz-fluor"

export function TransMiVozApp() {
  const { speak } = useSpeech()
  const [mode, setMode] = useState<Mode>("parcial")
  const [screen, setScreen] = useState<Screen>("home")
  const [menuOpen, setMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [fluor, setFluor] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BusRoute[]>([])

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "total" || saved === "parcial") setMode(saved)
    setFluor(window.localStorage.getItem(FLUOR_KEY) === "on")
  }, [])

  const toggleFluor = useCallback(() => {
    setFluor((prev) => {
      const next = !prev
      window.localStorage.setItem(FLUOR_KEY, next ? "on" : "off")
      speak(next ? "Colores fluorescentes activados." : "Colores fluorescentes desactivados.")
      return next
    })
  }, [speak])

  const changeMode = useCallback(
    (next: Mode) => {
      setMode(next)
      setScreen("home")
      setMenuOpen(false)
      window.localStorage.setItem(STORAGE_KEY, next)
      speak(
        next === "total"
          ? "Modo ceguera total activado."
          : "Modo baja visión activado.",
      )
    },
    [speak],
  )

  const goHome = useCallback(() => setScreen("home"), [])

  const runSearch = useCallback(
    (text: string) => {
      const found = searchRoutes(text)
      setResults(found)
      setScreen("buscar")
      if (found.length === 0) {
        speak(`No encontré rutas para ${text}.`)
      } else {
        speak(
          `Encontré ${found.length} ${found.length === 1 ? "ruta" : "rutas"} para ${text || "tu búsqueda"}.`,
        )
      }
    },
    [speak],
  )

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      setQuery(transcript)
      setVoiceOpen(false)
      runSearch(transcript)
    },
    [runSearch],
  )

  const openFrequent = useCallback(() => {
    setResults(frequentRoutes())
    setScreen("frecuentes")
    speak("Rutas frecuentes.")
  }, [speak])

  const openAssistance = useCallback(() => setScreen("asistencia"), [])
  const openVision = useCallback(() => {
    setScreen("vision")
    speak("Asistente de visión. Usa la cámara para leer letreros con más contraste.")
  }, [speak])
  const openGps = useCallback(() => {
    setScreen("gps")
    speak("GPS auditivo. Activa tu ubicación para conocer las estaciones cercanas.")
  }, [speak])

  return (
    <div
      className={[
        "mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background text-foreground",
        fluor ? "fluor" : "",
      ].join(" ")}
    >
      <AppHeader
        onMenu={() => setMenuOpen(true)}
        onNotifications={() => speak("No tienes notificaciones nuevas.")}
      />

      {screen === "home" && mode === "parcial" && (
        <PartialHome
          query={query}
          onQueryChange={setQuery}
          onSubmitSearch={() => runSearch(query)}
          onVoice={() => setVoiceOpen(true)}
          onFrequent={openFrequent}
          onSearch={() => runSearch(query)}
          onAssistance={openAssistance}
          onVision={openVision}
          onGps={openGps}
          fluor={fluor}
          onToggleFluor={toggleFluor}
        />
      )}

      {screen === "home" && mode === "total" && (
        <TotalHome onVoice={() => setVoiceOpen(true)} onGps={openGps} />
      )}

      {screen === "buscar" && (
        <RouteList
          title="Resultados de búsqueda"
          routes={results}
          emptyMessage="No se encontraron rutas. Intenta con otra estación."
          onBack={goHome}
        />
      )}

      {screen === "frecuentes" && (
        <RouteList
          title="Rutas frecuentes"
          routes={results}
          emptyMessage="Aún no tienes rutas frecuentes."
          onBack={goHome}
        />
      )}

      {screen === "asistencia" && <Assistance onBack={goHome} />}

      {screen === "vision" && <VisionAssist onBack={goHome} />}

      {screen === "gps" && <AuditoryGps onBack={goHome} />}

      <ModeMenu
        open={menuOpen}
        mode={mode}
        onClose={() => setMenuOpen(false)}
        onSelect={changeMode}
      />

      <VoiceOverlay
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onTranscript={handleVoiceTranscript}
      />
    </div>
  )
}
