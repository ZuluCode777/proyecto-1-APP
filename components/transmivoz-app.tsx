"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { Assistance } from "@/components/assistance"
import { AuditoryGps } from "@/components/auditory-gps"
import { ModeMenu } from "@/components/mode-menu"
import { PartialHome } from "@/components/partial-home"
import { PartialRoutes } from "@/components/partial-routes"
import { RouteDetail } from "@/components/route-detail"
import { RouteList } from "@/components/route-list"
import { ScreenHeader } from "@/components/screen-header"
import { TotalAgent } from "@/components/total-agent"
import { TripView } from "@/components/trip-view"
import { VisionAssist } from "@/components/vision-assist"
import { VoiceOverlay } from "@/components/voice-overlay"
import { useFavorites } from "@/hooks/use-favorites"
import { useSpeech } from "@/hooks/use-speech"
import { useTransmilenio } from "@/hooks/use-transmilenio"
import type { AgentReply, TripLegSummary } from "@/lib/local-agent"
import { searchRoutes, type BusRoute } from "@/lib/routes"
import { Bot } from "lucide-react"

export type Mode = "parcial" | "total"
type Screen =
  | "home"
  | "rutas"
  | "buscar"
  | "frecuentes"
  | "detalle"
  | "viaje"
  | "asistente"
  | "asistencia"
  | "vision"
  | "gps"

const STORAGE_KEY = "transmivoz-mode"
const FLUOR_KEY = "transmivoz-fluor"

export function TransMiVozApp() {
  const { speak } = useSpeech()
  const { data, error } = useTransmilenio()
  const favorites = useFavorites()

  const [mode, setMode] = useState<Mode>("parcial")
  const [history, setHistory] = useState<Screen[]>(["home"])
  const [menuOpen, setMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [fluor, setFluor] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BusRoute[]>([])
  const [routeCode, setRouteCode] = useState<string | null>(null)
  const [trip, setTrip] = useState<TripLegSummary[] | null>(null)

  const screen = history[history.length - 1]
  const go = useCallback((next: Screen) => setHistory((h) => (h[h.length - 1] === next ? h : [...h, next])), [])
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), [])
  const goHome = useCallback(() => setHistory(["home"]), [])

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
      goHome()
      setMenuOpen(false)
      window.localStorage.setItem(STORAGE_KEY, next)
      speak(next === "total" ? "Modo ceguera total activado." : "Modo baja visión activado.")
    },
    [speak, goHome],
  )

  const runSearch = useCallback(
    (text: string) => {
      if (!data) return speak("Todavía estoy cargando las rutas. Intenta en un momento.")
      const found = searchRoutes(text, data)
      setResults(found)
      go("buscar")
      speak(
        found.length === 0
          ? `No encontré rutas para ${text}.`
          : `Encontré ${found.length} ${found.length === 1 ? "ruta" : "rutas"} para ${text}.`,
      )
    },
    [data, go, speak],
  )

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      setQuery(transcript)
      setVoiceOpen(false)
      runSearch(transcript)
    },
    [runSearch],
  )

  const favoriteRoutes = useMemo(
    () => (data ? favorites.codes.flatMap((c) => data.routes.filter((r) => r.code === c)) : []),
    [data, favorites.codes],
  )

  const openRoute = useCallback(
    (code: string) => {
      setRouteCode(code)
      go("detalle")
    },
    [go],
  )

  // El asistente ya dijo su respuesta; aquí solo se navega.
  const handleAgentAction = useCallback(
    (reply: AgentReply) => {
      if (!data) return
      if (reply.action === "search") {
        setQuery(reply.query)
        setResults(searchRoutes(reply.query, data))
        go("buscar")
      } else if (reply.action === "frequent") {
        go("frecuentes")
      } else if (reply.action === "gps") {
        go("gps")
      } else if (reply.action === "route") {
        openRoute(reply.query)
      } else if (reply.action === "trip" && reply.trip) {
        setTrip(reply.trip)
        go("viaje")
      }
    },
    [data, go, openRoute],
  )

  const selectedRoute = data && routeCode ? data.routes.find((r) => r.code === routeCode) : undefined
  const loading = (
    <p className="m-4 rounded-2xl border-2 border-border bg-card p-6 text-center text-xl" role="status">
      {error ? "No pude cargar las rutas de TransMilenio. Revisa la conexión." : "Cargando rutas de TransMilenio…"}
    </p>
  )

  return (
    <div
      className={[
        "mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background text-foreground transition-colors duration-300",
        fluor ? "fluor" : "",
      ].join(" ")}
    >
      <AppHeader onMenu={() => setMenuOpen(true)} onNotifications={() => speak("No tienes notificaciones nuevas.")} />

      {screen === "home" && mode === "parcial" && (
        <PartialHome
          fluor={fluor}
          onToggleFluor={toggleFluor}
          onAgent={() => go("asistente")}
          onRoutes={() => {
            go("rutas")
            speak("Rutas. Busca por estación o por código de ruta.")
          }}
          onVision={() => {
            go("vision")
            speak("Asistente visual.")
          }}
          onGps={() => {
            go("gps")
            speak("Mapa y GPS. Activa tu ubicación para ver las estaciones cercanas.")
          }}
          onAssistance={() => go("asistencia")}
        />
      )}

      {screen === "home" && mode === "total" && <TotalAgent data={data} onAction={handleAgentAction} />}

      {screen === "asistente" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-4">
            <ScreenHeader title="Asistente" subtitle="Pregunta cómo llegar, por una ruta o su horario" icon={Bot} onBack={back} />
          </div>
          <TotalAgent data={data} onAction={handleAgentAction} />
        </div>
      )}

      {screen === "rutas" && (
        <PartialRoutes
          query={query}
          onQueryChange={setQuery}
          onSubmitSearch={() => runSearch(query)}
          onVoice={() => setVoiceOpen(true)}
          onFrequent={() => {
            go("frecuentes")
            speak("Rutas frecuentes.")
          }}
          onBack={back}
        />
      )}

      {screen === "buscar" &&
        (data ? (
          <RouteList
            title={query ? `Rutas para “${query}”` : "Resultados"}
            routes={results}
            emptyMessage="No encontré rutas. Prueba con el nombre de una estación o un código como B23."
            fetchedAt={data.fetchedAt}
            onOpen={(r) => openRoute(r.code)}
            onBack={back}
          />
        ) : (
          loading
        ))}

      {screen === "frecuentes" &&
        (data ? (
          <RouteList
            title="Rutas frecuentes"
            routes={favoriteRoutes}
            emptyMessage="Aún no tienes rutas frecuentes. Abre una ruta y toca Guardar."
            fetchedAt={data.fetchedAt}
            onOpen={(r) => openRoute(r.code)}
            onBack={back}
          />
        ) : (
          loading
        ))}

      {screen === "detalle" &&
        (data && selectedRoute ? (
          <RouteDetail
            route={selectedRoute}
            data={data}
            favorite={favorites.isFavorite(selectedRoute.code)}
            onToggleFavorite={() => favorites.toggle(selectedRoute.code)}
            onBack={back}
          />
        ) : (
          loading
        ))}

      {screen === "viaje" &&
        (data && trip ? <TripView legs={trip} data={data} onOpenRoute={openRoute} onBack={back} /> : loading)}

      {screen === "asistencia" && <Assistance onBack={back} />}

      {screen === "vision" && <VisionAssist onBack={back} />}

      {screen === "gps" && (data ? <AuditoryGps data={data} onBack={back} /> : loading)}

      <ModeMenu open={menuOpen} mode={mode} onClose={() => setMenuOpen(false)} onSelect={changeMode} />

      <VoiceOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} onTranscript={handleVoiceTranscript} />
    </div>
  )
}
