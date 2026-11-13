// Se inyecta en cada página antes de que cargue la app (Playwright `addInitScript`).
//
// Chrome sin ventana no tiene salida de audio y la grabación de Playwright no
// capta sonido. Para que el video muestre lo que la app dice en voz alta, se
// sustituyen `speechSynthesis.speak` y `speechSynthesis.cancel` por una cola
// que conserva el orden y los eventos que usa la app (`start`, `end`, `error`
// sobre la propia locución) y avisa a la grabación de cada frase con
// `window.__demoVoz`, que la convierte en subtítulo.
//
// La duración de cada frase se estima a 14 caracteres por segundo, cerca de la
// velocidad de una voz en español con `rate = 1`. `getVoices` y
// `onvoiceschanged` siguen siendo los del navegador.
;(() => {
  const sintesis = window.speechSynthesis
  if (!sintesis) return
  const prefijo = Math.random().toString(36).slice(2, 8)
  const cola = []
  let actual = null
  let temporizador = null
  let siguiente = 1

  const avisar = (datos) => {
    try {
      window.__demoVoz?.(datos)
    } catch {
      // La grabación no debe cambiar el comportamiento de la app.
    }
  }
  const duracionMs = (texto) => Math.max(1200, Math.round((String(texto).length / 14) * 1000))

  function terminar(tipo) {
    if (!actual) return
    const locucion = actual
    actual = null
    clearTimeout(temporizador)
    avisar({ id: locucion.__demoId, evento: "fin" })
    locucion.dispatchEvent(new Event(tipo))
    setTimeout(procesar, 0)
  }

  function procesar() {
    if (actual || cola.length === 0) return
    actual = cola.shift()
    avisar({ id: actual.__demoId, evento: "inicio", texto: actual.text })
    actual.dispatchEvent(new Event("start"))
    temporizador = setTimeout(() => terminar("end"), duracionMs(actual.text))
  }

  sintesis.speak = function speak(locucion) {
    locucion.__demoId = `${prefijo}-${siguiente++}`
    cola.push(locucion)
    setTimeout(procesar, 0)
  }
  sintesis.cancel = function cancel() {
    for (const locucion of cola.splice(0)) locucion.dispatchEvent(new Event("error"))
    terminar("error")
  }
  sintesis.pause = function pause() {}
  sintesis.resume = function resume() {}
  Object.defineProperty(sintesis, "speaking", { configurable: true, get: () => actual !== null })
  Object.defineProperty(sintesis, "pending", { configurable: true, get: () => cola.length > 0 })
})()
