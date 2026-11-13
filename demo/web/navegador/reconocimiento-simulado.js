// Se inyecta SOLO en el video del modo Ceguera total.
//
// Chrome sin ventana no tiene micrófono real ni el servicio de reconocimiento
// de Google, así que tocar la pantalla terminaría en un error. Este falso
// sustituye `SpeechRecognition` con la misma interfaz que usa
// `hooks/use-speech.ts` (`start`, `abort`, `onstart`, `onresult`, `onerror`,
// `onend`) y devuelve la frase que la grabación deja en `window.__demoFrase`.
// Avisa a la grabación con `window.__demoPersona` para que el video la rotule
// como «voz simulada»: la frase no sale de un micrófono.
;(() => {
  class ReconocimientoSimulado {
    constructor() {
      this.lang = "es-CO"
      this.continuous = false
      this.interimResults = false
      this.maxAlternatives = 1
      this.onstart = null
      this.onresult = null
      this.onerror = null
      this.onend = null
      this.temporizadores = []
    }

    programar(ms, accion) {
      this.temporizadores.push(setTimeout(accion, ms))
    }

    start() {
      const frase = window.__demoFrase ?? ""
      window.__demoFrase = null
      this.programar(80, () => this.onstart?.(new Event("start")))
      if (!frase) {
        this.programar(2500, () => {
          this.onerror?.({ error: "no-speech" })
          this.onend?.(new Event("end"))
        })
        return
      }
      // La persona empieza a hablar un instante después y tarda lo que tarda
      // en decir la frase (unos 13 caracteres por segundo).
      this.programar(450, () => {
        try {
          window.__demoPersona?.(frase)
        } catch {
          // Sin grabación no hay subtítulo.
        }
      })
      this.programar(450 + Math.max(1400, Math.round((frase.length / 13) * 1000)), () => {
        this.temporizadores = []
        this.onresult?.({ resultIndex: 0, results: [[{ transcript: frase, confidence: 0.95 }]] })
        this.onend?.(new Event("end"))
      })
    }

    stop() {
      this.abort()
    }

    abort() {
      const habia = this.temporizadores.length > 0
      this.temporizadores.forEach(clearTimeout)
      this.temporizadores = []
      if (!habia) return
      this.onerror?.({ error: "aborted" })
      this.onend?.(new Event("end"))
    }

    addEventListener() {}
    removeEventListener() {}
  }

  window.SpeechRecognition = ReconocimientoSimulado
  window.webkitSpeechRecognition = ReconocimientoSimulado
})()
