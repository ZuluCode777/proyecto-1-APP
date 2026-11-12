"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AppHeader } from "@/components/app-header"
import { Assistance } from "@/components/assistance"
import { AuditoryGps } from "@/components/auditory-gps"
import { Avisos } from "@/components/avisos"
import { MetroList } from "@/components/metro-list"
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
import { Bot, RefreshCw } from "lucide-react"

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
  | "metro"

const STORAGE_KEY = "transmivoz-mode"
const FLUOR_KEY = "transmivoz-fluor"

export function TransMiVozApp() {
  const { speak } = useSpeech()
  const { data, error, cargando, reintentar } = useTransmilenio()
  const favorites = useFavorites()

  const [mode, setMode] = useState<Mode>("parcial")
  const [history, setHistory] = useState<Screen[]>(["home"])
  const [menuOpen, setMenuOpen] = useState(false)
  const [avisosOpen, setAvisosOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [fluor, setFluor] = useState(false)
  const [query, setQuery] = useState("")
  /**
   * Consulta CONFIRMADA (ya ejecutada), separada del texto que se está
   * escribiendo. Los resultados se DERIVAN de ella y del catálogo actual, así
   * que al renovarse el catálogo la lista y su cabecera citan el mismo dato.
   */
  const [consultaConfirmada, setConsultaConfirmada] = useState<string | null>(null)
  const [routeCode, setRouteCode] = useState<string | null>(null)
  const [trip, setTrip] = useState<TripLegSummary[] | null>(null)

  const results = useMemo<BusRoute[]>(
    () => (data && consultaConfirmada ? searchRoutes(consultaConfirmada, data) : []),
    [data, consultaConfirmada],
  )

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
      // Se guarda la CONSULTA, no la lista: los resultados se derivan del
      // catálogo actual para que no queden objetos viejos con cabecera nueva.
      setConsultaConfirmada(text)
      go("buscar")
      // La procedencia del catálogo la dice la lista al mostrarse (RouteList).
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
      switch (reply.action) {
        case "search":
          setQuery(reply.station)
          setConsultaConfirmada(reply.station)
          go("buscar")
          break
        case "frequent":
          go("frecuentes")
          break
        case "gps":
          go("gps")
          break
        case "route":
          openRoute(reply.routeCode)
          break
        case "trip":
          setTrip(reply.trip)
          go("viaje")
          break
      }
    },
    [go, openRoute],
  )

  const selectedRoute = data && routeCode ? data.routes.find((r) => r.code === routeCode) : undefined
  const loading = (
    <p className="m-4 rounded-2xl border-3 border-border bg-card p-6 text-center text-xl" role="status">
      {cargando ? "Cargando rutas de TransMilenio…" : "Rutas de TransMilenio no disponibles por ahora."}
    </p>
  )

  /**
   * Aviso de fallo con reintento, ÚNICO y accesible: se muestra en cualquier
   * pantalla y modo cuando la última consulta falló, haya o no catálogo
   * conservado (en modo ceguera total sin catálogo ninguna pantalla pasa por
   * `loading`). Reintenta sin recargar ni cambiar de modo.
   */
  const avisoReintento = error ? (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border-3 border-fail bg-card p-3" role="alert">
      <p className="min-w-0 flex-1 text-base">
        {data
          ? "No pude actualizar las rutas de TransMilenio. Sigues viendo los últimos datos cargados."
          : "No pude cargar las rutas de TransMilenio. Revisa la conexión."}
      </p>
      <button
        type="button"
        onClick={() => {
          reintentar()
          speak("Reintentando cargar las rutas de TransMilenio.")
        }}
        disabled={cargando}
        className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl border-3 border-border bg-brand px-4 text-base font-bold text-brand-foreground disabled:opacity-60"
      >
        <RefreshCw className={cargando ? "size-5 animate-spin" : "size-5"} aria-hidden="true" />
        Reintentar
      </button>
    </div>
  ) : null

  /**
   * Estado recuperable cuando algo que estaba abierto ya no existe en el
   * catálogo actual (una ruta o un plan que desapareció al renovar). No deja una
   * carga eterna: explica y ofrece volver.
   */
  const recuperable = (mensaje: string) => (
    <div className="m-4 flex flex-col gap-3 rounded-2xl border-3 border-border bg-card p-6 text-center" role="alert">
      <p className="text-xl">{mensaje}</p>
      <button
        type="button"
        onClick={back}
        className="mx-auto min-h-14 rounded-2xl border-3 border-border bg-brand px-6 text-lg font-bold text-brand-foreground"
      >
        Volver
      </button>
    </div>
  )

  return (
    <div
      className={[
        "mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background text-foreground transition-colors duration-300",
        fluor ? "fluor" : "",
      ].join(" ")}
    >
      <AppHeader onMenu={() => setMenuOpen(true)} onNotifications={() => setAvisosOpen(true)} />
      <Avisos open={avisosOpen} onClose={() => setAvisosOpen(false)} catalogo={data} errorCatalogo={error} />

      {avisoReintento}

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
          onMetro={() => go("metro")}
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
            title={consultaConfirmada ? `Rutas para “${consultaConfirmada}”` : "Resultados"}
            routes={results}
            emptyMessage="No encontré rutas. Prueba con el nombre de una estación o un código como B23."
            fetchedAt={data.fetchedAt}
            source={data.source}
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
            source={data.source}
            onOpen={(r) => openRoute(r.code)}
            onBack={back}
          />
        ) : (
          loading
        ))}

      {screen === "detalle" &&
        (!data ? (
          loading
        ) : selectedRoute ? (
          <RouteDetail
            route={selectedRoute}
            data={data}
            favorite={favorites.isFavorite(selectedRoute.code)}
            onToggleFavorite={() => favorites.toggle(selectedRoute.code)}
            onBack={back}
          />
        ) : (
          recuperable(`La ruta ${routeCode ?? ""} ya no está en el catálogo actualizado de TransMilenio.`)
        ))}

      {screen === "viaje" &&
        (!data ? loading : trip ? <TripView legs={trip} data={data} onOpenRoute={openRoute} onBack={back} /> : recuperable("Ese plan de viaje ya no está disponible."))}

      {screen === "asistencia" && <Assistance onBack={back} />}

      {screen === "vision" && <VisionAssist onBack={back} />}

      {screen === "metro" && <MetroList onBack={back} />}

      {screen === "gps" && (data ? <AuditoryGps data={data} onBack={back} /> : loading)}

      <ModeMenu open={menuOpen} mode={mode} onClose={() => setMenuOpen(false)} onSelect={changeMode} />

      <VoiceOverlay open={voiceOpen} onClose={() => setVoiceOpen(false)} onTranscript={handleVoiceTranscript} />
    </div>
  )
}
