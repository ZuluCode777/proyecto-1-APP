"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionResultEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

const LANG = "es-CO"

/**
 * Espera antes de arrancar la captura tras el anuncio «Te escucho», para no
 * capturar la propia síntesis. Único lugar donde se define, compartido por el
 * asistente de voz y la superposición de búsqueda (EA-08, estándares 6). No se
 * ha medido que baste para toda la locución; es un margen inicial, no una
 * garantía de accesibilidad. La superposición anuncia una frase más larga («Te
 * escucho. Di el nombre de una estación o un código de ruta.»), así que usa su
 * propio margen mayor (`ESCUCHA_ESPERA_SUPERPOSICION_MS`).
 */
export const ESCUCHA_ESPERA_MS = 650
/** Margen mayor de la superposición, cuyo anuncio inicial es más largo. */
export const ESCUCHA_ESPERA_SUPERPOSICION_MS = 900

/**
 * Última locución entregada a `speechSynthesis.speak`, a nivel de MÓDULO porque
 * `speechSynthesis` es un singleton global del navegador: la última voz que
 * suena es compartida por todas las pantallas. Permite que una pantalla decida
 * si la voz que está sonando es «suya» o la emitió otra después (p. ej. el
 * anuncio de cambio de modo del padre). Decisión E (EA-08).
 */
let ultimaLocucion: SpeechSynthesisUtterance | undefined

/** ¿`locucion` sigue siendo la última entregada a la síntesis (nadie habló después)? */
export function esUltimaLocucion(locucion: SpeechSynthesisUtterance | undefined): boolean {
  return locucion !== undefined && ultimaLocucion === locucion
}

type SpeakOptions = {
  /**
   * Espera a que termine lo que se está diciendo en vez de cortarlo. Úsalo
   * para anuncios que siguen a otro, como el de una pantalla que se abre justo
   * después de que se anunció el cambio.
   */
  queue?: boolean
}

/** Lee texto en voz alta para quien no puede ver la pantalla. */
export function useSpeech() {
  const speak = useCallback(
    (text: string, { queue = false }: SpeakOptions = {}): SpeechSynthesisUtterance | undefined => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined
      if (!queue) window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = LANG
      utterance.rate = 1
      utterance.pitch = 1
      window.speechSynthesis.speak(utterance)
      // Registra la última locución entregada (singleton global) y la devuelve,
      // para que quien llama sepa cuándo termina y si sigue siendo la última.
      ultimaLocucion = utterance
      return utterance
    },
    [],
  )

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
  }, [])

  return { speak, cancel }
}

type VoiceRecognitionOptions = {
  onResult: (transcript: string) => void
  onError?: (error: string) => void
}

/** Reconocimiento de voz con la Web Speech API. */
export function useVoiceRecognition({ onResult, onError }: VoiceRecognitionOptions) {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const manejadores = useRef({ onResult, onError })
  /**
   * ¿Está escuchando ahora? En una ref para que `start` y `abort` sean ESTABLES
   * (sin depender de `listening`). Antes `start` se recreaba al cambiar
   * `listening`, y un consumidor que lo tenía como dependencia (la superposición
   * de voz) reprogramaba la escucha al terminar una captura (EA-08, hallazgo 6).
   */
  const escuchandoRef = useRef(false)

  // Renovar el catálogo actualiza los receptores sin cortar la captura activa.
  useEffect(() => {
    manejadores.current = { onResult, onError }
  }, [onResult, onError])

  useEffect(() => {
    if (typeof window === "undefined") return
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) return
    setSupported(true)
    const recognition = new Ctor()
    recognition.lang = LANG
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      escuchandoRef.current = true
      setListening(true)
    }
    recognition.onend = () => {
      escuchandoRef.current = false
      setListening(false)
    }
    recognition.onerror = (event) => {
      escuchandoRef.current = false
      setListening(false)
      manejadores.current.onError?.(event.error)
    }
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ""
      manejadores.current.onResult(transcript)
    }
    recognitionRef.current = recognition
    return () => {
      recognition.onresult = null
      recognition.onend = null
      recognition.onerror = null
      recognition.onstart = null
      recognition.abort()
      recognitionRef.current = null
      // onend ya no llega: sin esto, "escuchando" quedaría encendido para siempre.
      escuchandoRef.current = false
      setListening(false)
    }
  }, [])

  const start = useCallback(() => {
    if (!recognitionRef.current || escuchandoRef.current) return
    try {
      recognitionRef.current.start()
    } catch {
      // start() lanza un error si ya está escuchando; se ignora.
    }
  }, [])

  /** Deja de escuchar y descarta lo que ya oyó: no llega ningún resultado. */
  const abort = useCallback(() => {
    recognitionRef.current?.abort()
  }, [])

  return { listening, supported, start, abort }
}
