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
    (text: string, { queue = false }: SpeakOptions = {}) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return
      if (!queue) window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = LANG
      utterance.rate = 1
      utterance.pitch = 1
      window.speechSynthesis.speak(utterance)
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
    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onerror = (event) => {
      setListening(false)
      onError?.(event.error)
    }
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ""
      onResult(transcript)
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
      setListening(false)
    }
  }, [onResult, onError])

  const start = useCallback(() => {
    if (!recognitionRef.current || listening) return
    try {
      recognitionRef.current.start()
    } catch {
      // start() lanza un error si ya está escuchando; se ignora.
    }
  }, [listening])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  /** Deja de escuchar y descarta lo que ya oyó: no llega ningún resultado. */
  const abort = useCallback(() => {
    recognitionRef.current?.abort()
  }, [])

  return { listening, supported, start, stop, abort }
}
