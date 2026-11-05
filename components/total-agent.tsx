"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { CheckCircle2, Ear, Loader2, Mic, Send } from "lucide-react"
import { ESCUCHA_ESPERA_MS, esUltimaLocucion, useSpeech, useVoiceRecognition } from "@/hooks/use-speech"
import { leerPosicionNavegador, ubicacionVigente, type LecturaUbicacion } from "@/lib/ubicacion"
import { consultarAgente } from "@/lib/consulta-agente"
import {
  parseIntent,
  plainReply,
  respuestaSinImperativos,
  textoViajeDesdeResumen,
  type AgentReply,
  type AgentStep,
} from "@/lib/local-agent"
import { intencionUsaUbicacion } from "@/lib/seleccion-interprete"
import type { TransmilenioData } from "@/lib/routes"

type TotalAgentProps = {
  data: TransmilenioData | null
  onAction: (reply: AgentReply) => void
}

type Status = "idle" | "listening" | "thinking" | "error"

/**
 * Plazo máximo para obtener la POSICIÓN una vez el permiso ya está concedido.
 * NO cuenta el tiempo en que la persona responde al aviso de permiso (la
 * especificación de Geolocation aclara que su `timeout` no corre mientras el
 * aviso está abierto), por eso la espera del permiso se trata aparte.
 */
const UBICACION_ESPERA_MS = 2_000
/**
 * Cota TOTAL mientras el permiso está en `prompt`. La persona necesita tiempo
 * (p. ej. con lector de pantalla), pero el asistente no puede quedar ocupado
 * indefinidamente: al vencer, la pregunta sigue SIN coordenada, se libera
 * `busyRef` y se avisa que puede decir o escribir su origen (EA-08, decisión F).
 */
const UBICACION_PERMISO_ESPERA_MS = 15_000
/** Texto en reposo, a la espera de un toque. */
const IDLE_CAPTION = "Toca la pantalla y dime a dónde quieres ir"
/** Subtítulo mientras se espera que la persona conceda el permiso de ubicación. */
const SUBTITULO_ESPERANDO_PERMISO = "Esperando permiso de ubicación… Toca para cancelar."
/**
 * Aviso NEUTRO que se antepone al texto Y al subtítulo de la respuesta cuando
 * vence la espera del permiso (decisión F/G1/R5-2): la consulta sigue sin
 * coordenada y la misma locución de la respuesta empieza por este aviso (no una
 * segunda locución ni cola, para no interferir con la identidad de locución de
 * E). Es NEUTRO a propósito: no pide el origen, porque la propia respuesta ya lo
 * pide cuando hace falta (un viaje sin origen), y con «dónde estoy» no tendría
 * sentido pedirlo. Así no suena raro ni se repite la petición.
 */
const SIN_PERMISO_UBICACION = "No recibí permiso de ubicación a tiempo."

/**
 * Aviso de privacidad del ASISTENTE, breve y accesible, visible antes de
 * capturar (EA-08, hallazgo 8/decisión B/R3-4). Explica el procesamiento real:
 * el audio del reconocimiento puede ir a un servicio del navegador (no es
 * necesariamente local); la frase viaja al servidor y, si está activo, al
 * modelo; dar la ubicación es OPCIONAL (puedes decir o escribir el origen); al
 * abrir Google Maps se comparte el origen. Hay alternativa por texto.
 */
const AVISO_PRIVACIDAD =
  "El reconocimiento de voz puede enviar tu audio al servicio del navegador (no es necesariamente local). Tu frase viaja a este servidor y, si está activo, a un modelo local. La ubicación es opcional: puedes decir o escribir tu origen; si preguntas dónde estás o cómo llegar sin origen, tu ubicación se envía a este servidor. Al abrir Google Maps se comparte tu origen. Puedes escribir en vez de hablar."

/** Aviso seguro cuando un viaje no puede confirmarse ahora, sin instrucciones. */
const VIAJE_NO_CONFIRMABLE =
  "No puedo confirmar las paradas y el horario de ese viaje con los datos actuales, así que no te doy indicaciones de abordaje. Confirma la ruta con TransMilenio."

/** Aviso recuperable cuando la consulta falla por algo que no es un aborto. */
const ERROR_RECUPERABLE = "Tuve un problema para responder. Toca la pantalla e inténtalo de nuevo."

/**
 * Deja una respuesta lista para mostrar/hablar/navegar con seguridad. Las
 * acciones que no son de viaje se descartan si traen órdenes de abordaje. Una
 * respuesta de viaje se revalida contra el catálogo MÁS RECIENTE y el reloj
 * actual, y su texto y pasos se RECONSTRUYEN desde el resumen validado con la
 * función responsable compartida; nunca se confía en la prosa recibida. Si no
 * es prescriptible ahora (esquema viejo, otros datos, fuera de franja, sin
 * catálogo), se degrada a un aviso seguro sin instrucciones.
 */
function sanear(reply: AgentReply, data: TransmilenioData | null): AgentReply {
  const ahora = new Date()
  if (reply.action === "trip") {
    // Sin catálogo no se puede revalidar: incertidumbre segura para el viaje.
    if (!data) return plainReply(VIAJE_NO_CONFIRMABLE, reply.engine)
    // El texto y los pasos de un viaje se RECONSTRUYEN desde el resumen
    // revalidado; nunca se confía en la prosa recibida.
    const reconstruido = textoViajeDesdeResumen(reply.trip, data, ahora)
    if (!reconstruido) return plainReply(VIAJE_NO_CONFIRMABLE, reply.engine)
    return { ...reply, reply: reconstruido.reply, steps: reconstruido.steps }
  }
  // Una acción informativa es válida salvo que traiga órdenes de abordaje en su
  // texto o en sus pasos. Es la MISMA decisión que usa el diagnóstico y la
  // guardia compartida (`respuestaSinImperativos`), para no divergir entre voz
  // y diagnóstico. Sin catálogo igual se puede mostrar una respuesta segura.
  if (respuestaSinImperativos(reply)) return reply
  return { ...reply, reply: VIAJE_NO_CONFIRMABLE, steps: [] }
}

/**
 * Asistente de voz. Toda la pantalla es el botón para hablar. Debajo muestra
 * los pasos que siguió para responder y un campo para escribir, útil cuando
 * hay ruido o el micrófono no está disponible.
 */
export function TotalAgent({ data, onAction }: TotalAgentProps) {
  const { speak, cancel } = useSpeech()
  const [status, setStatus] = useState<Status>("idle")
  const [caption, setCaption] = useState(IDLE_CAPTION)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [engine, setEngine] = useState<AgentReply["engine"] | null>(null)
  const [typed, setTyped] = useState("")
  /** Verdadero mientras el asistente piensa una respuesta. */
  const busyRef = useRef(false)
  const startTimerRef = useRef<number | undefined>(undefined)
  /** Número de la última pregunta: una respuesta vieja no habla ni navega. */
  const lastAskRef = useRef(0)
  /** Aborta el `fetch` (y la espera de ubicación) al salir, cancelar o preguntar de nuevo. */
  const controladorRef = useRef<AbortController | null>(null)
  const positionRef = useRef<LecturaUbicacion | undefined>(undefined)
  /**
   * ¿El desmontaje lo provocó la navegación que ordenó la respuesta vigente?
   * Se marca justo antes de `onAction`. Si está puesta, la limpieza NO calla la
   * voz (la respuesta que navega debe oírse completa); si no, y el asistente
   * tiene una locución propia sonando, la limpieza la calla (la persona salió).
   * Decisión A (EA-08).
   */
  const navegoPorRespuestaRef = useRef(false)
  /**
   * LOCUCIÓN propia que está sonando ahora (el objeto, no un booleano). Permite
   * callar al salir solo la voz propia, y de forma fiable frente a los eventos
   * de cancelación ASÍNCRONOS del navegador: un `end`/`error` tardío de una
   * locución YA cancelada no borra la marca si no es la locución actual. Y al
   * salir solo se calla si esta locución sigue siendo la ÚLTIMA entregada a la
   * síntesis global, de modo que un anuncio de otra pantalla posterior (p. ej.
   * «Modo baja visión activado» de `changeMode`) no se corta. Decisión E (EA-08).
   */
  const locucionPropiaRef = useRef<SpeechSynthesisUtterance | null>(null)
  /**
   * Catálogo más reciente, en una ref: la revalidación de un viaje y el respaldo
   * local deben usar los datos actuales y no los capturados por el cierre cuando
   * empezó el fetch.
   */
  const dataRef = useRef<TransmilenioData | null>(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  /**
   * Habla y RASTREA la locución propia por IDENTIDAD: guarda el objeto en
   * `locucionPropiaRef` y, en `end`/`error`, solo lo borra si sigue siendo esa
   * misma locución (así un evento tardío de una locución cancelada no afecta a
   * la nueva). Decisión E (EA-08).
   */
  const hablar = useCallback(
    (texto: string, opciones?: { queue?: boolean }) => {
      const locucion = speak(texto, opciones)
      if (!locucion) return
      locucionPropiaRef.current = locucion
      const terminar = () => {
        if (locucionPropiaRef.current === locucion) locucionPropiaRef.current = null
      }
      locucion.addEventListener("end", terminar, { once: true })
      locucion.addEventListener("error", terminar, { once: true })
    },
    [speak],
  )

  /**
   * Consigue la ubicación SOLO cuando la pregunta puede usarla (GPS o viaje sin
   * origen). Si ya se tenía, la devuelve sin pedir permiso. Según el estado del
   * permiso:
   * - `granted`: obtiene la posición con la cota `UBICACION_ESPERA_MS` (2 s).
   * - `prompt`: anuncia «Esperando permiso…» y espera hasta `UBICACION_PERMISO_ESPERA_MS`
   *   (15 s) o hasta que la persona responda o cancele con un toque. Al vencer,
   *   resuelve SIN coordenada y llama `alVencer` (que marca que debe anteponerse
   *   el aviso de permiso vencido al texto de la respuesta; ver `askAgent`). A
   *   diferencia de EA-08, la adquisición NO queda viva al vencer: se LIBERA con
   *   `clearWatch` (política #33), para no dejar un watcher pendiente ni cachear
   *   una posición por un permiso concedido tarde.
   * - `denied` (o aborto antes/durante la consulta de permiso): resuelve SIN
   *   coordenada de inmediato, sin anunciar espera (decisión F/G).
   * Nunca deja la interfaz colgada ni `busyRef` bloqueado.
   *
   * EA-07 (#33): la lectura guardada se REUTILIZA solo si sigue fresca
   * (`ubicacionVigente`); una coordenada vencida no se reenvía. La adquisición es
   * de UNA TOMA, con `watchPosition` + `clearWatch` para una cancelación
   * EFECTIVA: al abortar (salir, cancelar o pregunta nueva) o al vencer, se libera
   * el watcher de verdad, en vez de fingir cancelar un `getCurrentPosition`. El
   * callback solo escribe la caché/resuelve si la adquisición SIGUE VIVA: un
   * callback de una adquisición ya cancelada no sobreescribe `positionRef` ni
   * afecta a otra pregunta (contraejemplo A cancelada/B vigente/A tardía).
   */
  const obtenerUbicacion = useCallback((señal: AbortSignal, alVencer: () => void): Promise<LecturaUbicacion | undefined> => {
    const vigente = ubicacionVigente(positionRef.current)
    if (vigente) return Promise.resolve(vigente)
    // Una lectura vencida no se reutiliza: se descarta y se intenta renovar.
    positionRef.current = undefined
    if (señal.aborted || typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(undefined)

    const permisos = navigator.permissions
    const estadoPermiso = permisos?.query
      ? permisos.query({ name: "geolocation" as PermissionName }).then((p) => p.state).catch(() => "prompt" as const)
      : Promise.resolve<"prompt">("prompt")

    return estadoPermiso.then((estado) => {
      // G: si se canceló/salió mientras la consulta de permiso estaba pendiente,
      // o el permiso está denegado, no se anuncia espera ni se pide la posición.
      if (señal.aborted || estado === "denied") return undefined
      return new Promise<LecturaUbicacion | undefined>((resolver) => {
        let resuelto = false
        let temporizador: number | undefined
        let watchId: number | null = null
        const liberarWatcher = () => {
          if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId)
          watchId = null
        }
        const terminar = (valor: LecturaUbicacion | undefined, vencioPermiso = false) => {
          if (resuelto) return
          resuelto = true
          liberarWatcher() // cancelación efectiva de la adquisición
          if (temporizador !== undefined) window.clearTimeout(temporizador)
          señal.removeEventListener("abort", alAbortar)
          if (vencioPermiso) alVencer()
          resolver(valor)
        }
        const alAbortar = () => terminar(undefined)
        señal.addEventListener("abort", alAbortar, { once: true })

        // `granted`: cota de 2 s para la fijación. `prompt`: se anuncia y hay una
        // cota TOTAL de 15 s (el `timeout` de la API no cuenta el aviso); al
        // vencer se sigue sin coordenada y se avisa por voz.
        if (estado === "granted") {
          temporizador = window.setTimeout(() => terminar(undefined), UBICACION_ESPERA_MS)
        } else {
          setCaption(SUBTITULO_ESPERANDO_PERMISO)
          temporizador = window.setTimeout(() => terminar(undefined, true), UBICACION_PERMISO_ESPERA_MS)
        }
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            // Si esta adquisición ya terminó (cancelada, abortada o vencida), su
            // callback NO toca la caché ni resuelve: una A cancelada que llega
            // tarde no puede sobreescribir la posición de B ni filtrarse a C.
            if (resuelto) {
              liberarWatcher()
              return
            }
            // Solo una lectura VIGENTE se cachea y resuelve: una vencida, sin hora
            // o inválida no finaliza la adquisición; se espera otra o el plazo.
            const lectura = ubicacionVigente(leerPosicionNavegador(pos))
            if (!lectura) return
            positionRef.current = lectura
            terminar(lectura)
          },
          () => {
            if (resuelto) return
            terminar(undefined)
          },
          { enableHighAccuracy: true, maximumAge: 60_000, timeout: UBICACION_PERMISO_ESPERA_MS },
        )
        // Un doble/navegador que llamó al callback antes de devolver el id: se libera ya.
        if (resuelto) liberarWatcher()
      })
    })
  }, [])

  const askAgent = useCallback(
    async (message: string) => {
      const ask = ++lastAskRef.current
      // Una pregunta nueva aborta la anterior: ni su voz ni su navegación llegan.
      controladorRef.current?.abort()
      const control = new AbortController()
      controladorRef.current = control
      busyRef.current = true
      setStatus("thinking")
      setCaption("Pensando…")
      setSteps([])

      /** ¿Sigue vigente esta pregunta? Se comprueba antes de CADA efecto. */
      const vigente = () => ask === lastAskRef.current && !control.signal.aborted

      try {
        const actual = dataRef.current
        // La ubicación se decide con la intención de REGLAS en el cliente, sin
        // red, y SOLO se pide/envía si la frase la usa (GPS o viaje sin origen).
        // Una frase que las reglas no entienden (`unknown`) NO lleva coordenada
        // (decisión B/AC4): si el servidor la resuelve con el modelo como `gps`
        // o viaje sin origen, responde por su camino de falta de ubicación (pide
        // origen o permiso). El aviso de privacidad coincide con esto.
        const intencion = actual ? parseIntent(message, actual) : null
        let permisoVencido = false
        const position =
          intencion && intencionUsaUbicacion(intencion)
            ? await obtenerUbicacion(control.signal, () => { permisoVencido = true })
            : undefined
        if (!vigente()) return
        setCaption("Pensando…") // borra el subtítulo «Esperando permiso…» si lo hubo

        const reply = await consultarAgente({
          message,
          position,
          data: dataRef.current,
          signal: control.signal,
          now: () => new Date(),
        })
        if (!vigente()) return

        // Guardia ÚNICA justo antes de los efectos (texto, voz, pasos,
        // navegación): se sanea la respuesta contra el catálogo más reciente y
        // el reloj actual (revalidación EA-05). Sin pausas ya no hay `await`
        // entre aquí y `onAction`, así que una sola comprobación basta.
        const seguro = sanear(reply, dataRef.current)
        // Si venció la espera del permiso (decisión F/G1), el aviso va DELANTE
        // del texto de la respuesta, en la MISMA locución y subtítulo (no una
        // segunda locución ni cola, para no interferir con la identidad de
        // locución de E). Se aplica tras `sanear` y solo si la pregunta sigue
        // vigente.
        const textoFinal = permisoVencido ? `${SIN_PERMISO_UBICACION} ${seguro.reply}` : seguro.reply
        setSteps(seguro.steps)
        setEngine(seguro.engine)
        setCaption(textoFinal)
        hablar(textoFinal)
        setStatus("idle")
        if (seguro.action === "none") return
        // Navega: marca que el desmontaje que provoque esta navegación NO debe
        // callar la voz de esta respuesta (decisión A). Una pregunta nueva o la
        // salida de la persona la habrían invalidado antes por `vigente()`.
        navegoPorRespuestaRef.current = true
        onAction(seguro)
      } catch (error) {
        // Un aborto (salir, cancelar o pregunta nueva) no muestra nada. Un fallo
        // real (p. ej. catálogo corrupto en el respaldo local) no se traga: se
        // avisa de forma recuperable y se vuelve a reposo (EA-08, estándares 11).
        if (control.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return
        if (!vigente()) return
        setStatus("idle")
        setSteps([])
        setCaption(ERROR_RECUPERABLE)
        hablar(ERROR_RECUPERABLE)
      } finally {
        // `busyRef` se libera cuando esta pregunta sigue siendo la vigente,
        // aunque fallara, para no bloquear preguntas nuevas (EA-08, hallazgo 7).
        // Si otra pregunta ya tomó el relevo, es ella quien gobierna `busyRef`.
        if (ask === lastAskRef.current) busyRef.current = false
      }
    },
    [onAction, hablar, obtenerUbicacion],
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
      hablar(message)
    },
    [hablar],
  )

  const { listening, supported, start, abort } = useVoiceRecognition({ onResult: handleResult, onError: handleError })
  const active = status === "listening" || listening
  const thinking = status === "thinking"

  /**
   * Deja de escuchar, incluso si el micrófono aún no había arrancado, y
   * descarta lo que ya oyó para que no llegue una respuesta tardía. También
   * aborta cualquier consulta o espera de ubicación en curso. NO calla la voz:
   * eso lo decide quien llama (la cancelación explícita o la limpieza al salir).
   */
  const stopListening = useCallback(() => {
    window.clearTimeout(startTimerRef.current)
    abort()
    controladorRef.current?.abort()
  }, [abort])

  const backToIdle = useCallback(() => {
    setStatus("idle")
    setCaption(IDLE_CAPTION)
  }, [])

  useEffect(() => {
    hablar("Asistente de voz. Toca la pantalla y dime a dónde quieres ir.", { queue: true })
    const invalidar = () => {
      // Al desmontar: invalida respuestas en vuelo y aborta captura, consulta y
      // espera de ubicación. Decisión A/E: si el desmontaje lo provocó la
      // navegación de la respuesta vigente (`navegoPorRespuestaRef`), su voz
      // sigue sonando; si la persona SALIÓ y hay una locución PROPIA que además
      // sigue siendo la ÚLTIMA entregada a la síntesis, se calla. Si otra pantalla
      // habló después (p. ej. «Modo baja visión» de `changeMode`), esa ya no es
      // la última propia, así que no se corta.
      lastAskRef.current++
      stopListening()
      if (!navegoPorRespuestaRef.current && locucionPropiaRef.current && esUltimaLocucion(locucionPropiaRef.current)) cancel()
    }
    return invalidar
  }, [hablar, cancel, stopListening])

  // Si el micrófono se apaga sin oír nada, vuelve a esperar un toque. No
  // reinicia la escucha por su cuenta: hace falta otro toque (EA-08, hallazgo 6).
  const wasListeningRef = useRef(false)
  useEffect(() => {
    if (wasListeningRef.current && !listening && status === "listening") backToIdle()
    wasListeningRef.current = listening
  }, [listening, status, backToIdle])

  const handleTap = useCallback(() => {
    if (active || thinking) {
      // Cancelación EXPLÍCITA de la persona (escuchando o pensando): invalida la
      // pregunta en vuelo, calla la voz, aborta captura, consulta y espera de
      // ubicación, libera `busyRef` y vuelve a reposo. Sí silencia.
      lastAskRef.current++
      stopListening()
      cancel()
      busyRef.current = false
      backToIdle()
      return
    }
    if (busyRef.current) return
    if (!supported) {
      const message = "Este navegador no reconoce la voz. Escribe tu pregunta abajo."
      setStatus("error")
      setCaption(message)
      hablar(message)
      return
    }
    // Una pregunta nueva: la respuesta anterior ya no habla ni navega.
    lastAskRef.current++
    setStatus("listening")
    setCaption("Escuchando…")
    navigator.vibrate?.(40)
    hablar("Te escucho.")
    startTimerRef.current = window.setTimeout(() => start(), ESCUCHA_ESPERA_MS)
  }, [active, thinking, supported, start, stopListening, cancel, backToIdle, hablar])

  const handleTyped = (event: FormEvent) => {
    event.preventDefault()
    const text = typed.trim()
    if (!text || busyRef.current) return
    // Escribir mientras escucha: deja el micrófono y responde a lo escrito.
    stopListening()
    setTyped("")
    setCaption(`“${text}”`)
    void askAgent(text)
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Asistente de voz">
      <button
        type="button"
        onClick={handleTap}
        aria-label={
          active || thinking
            ? "Cancelar. Toca para detener la escucha o la respuesta en curso."
            : "Asistente de voz. Toca para hablar y pedir rutas, horarios o tu ubicación."
        }
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

        <p className="rounded-2xl border-3 border-border bg-card p-3 text-sm text-muted-foreground" role="note">
          {AVISO_PRIVACIDAD}
        </p>

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
