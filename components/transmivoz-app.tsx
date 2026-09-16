"use client"

import { useCallback, useEffect, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { ModeMenu } from "@/components/mode-menu"
import { PartialHome } from "@/components/partial-home"
import { TotalHome } from "@/components/total-home"
import { RouteList } from "@/components/route-list"
import { Assistance } from "@/components/assistance"
import { ScanCamera } from "@/components/scan-camera"
import { VoiceOverlay } from "@/components/voice-overlay"
import { useSpeech } from "@/hooks/use-speech"
import { searchRoutes, frequentRoutes, type BusRoute } from "@/lib/routes"

export type Mode = "parcial" | "total"
type Screen = "home" | "buscar" | "frecuentes" | "asistencia" | "escanear"

const STORAGE_KEY = "transmivoz-mode"

export function TransMiVozApp() {
  const { speak } = useSpeech()
  const [mode, setMode] = useState<Mode>("parcial")
  const [screen, setScreen] = useState<Screen>("home")
  const [menuOpen, setMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BusRoute[]>([])

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === "total" || saved === "parcial") setMode(saved)
  }, [])

  const changeMode = useCallback(
    (next: Mode) => {
      setMode(next)
      setScreen("home")
      setMenuOpen(false)
      window.localStorage.setItem(STORAGE_KEY, next)
      speak(
        next === "total"
          ? "Modo visión total activado."
          : "Modo visión parcial activado.",
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
  const openScan = useCallback(() => setScreen("escanear"), [])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
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
        />
      )}

      {screen === "home" && mode === "total" && (
        <TotalHome onVoice={() => setVoiceOpen(true)} onScan={openScan} />
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

      {screen === "escanear" && <ScanCamera onBack={goHome} />}

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
