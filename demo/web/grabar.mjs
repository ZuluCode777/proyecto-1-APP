/**
 * Graba videos de demostración de la app web con Playwright y Chrome sin
 * ventana, en tamaño de celular (390 × 844, a doble densidad).
 *
 * Cada video es un recorrido a ritmo de persona. Por cada uno se guardan:
 *   - `<id>.webm`: la grabación cruda de Playwright, sin sonido.
 *   - `<id>.json`: título, cuándo empieza y termina el recorrido y los
 *     subtítulos: lo que se hace («Toca…», «Escribe…»), lo que la app dice en
 *     voz alta y, en Ceguera total, la frase simulada de la persona.
 * `demo/componer.py` los convierte en MP4 con los subtítulos en una franja
 * bajo la pantalla.
 *
 * Lo que no es real, y el video lo dice en sus subtítulos:
 *   - la ubicación es fija, en la estación Ricaurte (la misma de `pnpm verificar`);
 *   - la cámara de la Lupa es una imagen de prueba (`DEMO_CAMARA`) o el patrón
 *     de prueba de Chrome;
 *   - la voz de la app no suena: se muestra como subtítulo;
 *   - en Ceguera total, la frase de la persona la pone el script.
 *
 * Uso (con la app ya arrancada):
 *   GRABADOR_DIR=/carpeta/con/playwright APP_PASSWORD=clave node demo/web/grabar.mjs
 * Variables:
 *   DEMO_BASE     origen de la app (por defecto http://127.0.0.1:3000)
 *   DEMO_SALIDA   carpeta de salida (por defecto demo/salida/crudo-web)
 *   DEMO_CAMARA   archivo .mjpeg o .y4m para la cámara simulada (opcional)
 *   DEMO_SOLO     ids separados por comas, para grabar solo esos videos
 *   GRABADOR_DIR  carpeta donde está instalado el paquete `playwright`
 * Termina con código 1 si algún recorrido falló; los demás se graban igual.
 */
import { createRequire } from "node:module"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const requerir = createRequire(join(resolve(process.env.GRABADOR_DIR ?? process.cwd()), "package.json"))
const { chromium } = requerir("playwright")

const BASE = (process.env.DEMO_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "")
const ORIGEN = new URL(BASE).origin
const CLAVE = process.env.APP_PASSWORD ?? ""
const SALIDA = resolve(process.env.DEMO_SALIDA ?? "demo/salida/crudo-web")
const CAMARA = process.env.DEMO_CAMARA && existsSync(process.env.DEMO_CAMARA) ? resolve(process.env.DEMO_CAMARA) : null
const SOLO = (process.env.DEMO_SOLO ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const RICAURTE = { latitude: 4.6124, longitude: -74.0935, accuracy: 20 }
const ANCHO = 390
const ALTO = 844
const ESCALA = 2

mkdirSync(SALIDA, { recursive: true })

// La grabación de Playwright toma los cuadros en píxeles CSS: con `deviceScaleFactor: 2` saldrían a 390 × 844 con
// relleno gris. Con la densidad fijada en el propio Chrome y sin viewport emulado, los cuadros salen a 780 × 1688.
const browser = await chromium.launch({
  channel: process.env.DEMO_CANAL ?? "chrome",
  headless: true,
  args: [
    `--force-device-scale-factor=${ESCALA}`,
    `--window-size=${ANCHO},${ALTO}`,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(CAMARA ? [`--use-file-for-fake-video-capture=${CAMARA}`] : []),
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const fallos = []

/**
 * Graba un recorrido. `recorrido(d)` recibe las ayudas de la grabación (ver
 * `crearAyudas`) y tiene que llamar a `d.marcarInicio()` cuando la app ya está
 * en pantalla: el video empieza ahí y se descarta la carga en blanco.
 */
async function grabar(id, titulo, recorrido, opciones = {}) {
  if (SOLO.length && !SOLO.includes(id)) return
  console.log(`\n▶ ${id}: ${titulo}`)
  try {
    await grabarUno(id, titulo, recorrido, opciones)
  } catch (e) {
    // Un fallo al preparar o guardar la grabación no detiene las demás.
    console.log(`  ✗ ${id} no se pudo grabar: ${e instanceof Error ? e.stack ?? e.message : e}`)
    if (!fallos.includes(id)) fallos.push(id)
  }
}

async function grabarUno(id, titulo, recorrido, { reconocimientoSimulado = false } = {}) {
  const carpetaTemporal = join(SALIDA, `.tmp-${id}`)
  rmSync(carpetaTemporal, { recursive: true, force: true })
  const contexto = await browser.newContext({
    viewport: null,
    hasTouch: true,
    locale: "es-CO",
    timezoneId: "America/Bogota",
    geolocation: RICAURTE,
    permissions: ["geolocation", "camera", "microphone"],
    ...(CLAVE ? { httpCredentials: { username: "demo", password: CLAVE, origin: ORIGEN, send: "always" } } : {}),
    recordVideo: { dir: carpetaTemporal, size: { width: ANCHO * ESCALA, height: ALTO * ESCALA } },
  })

  const eventos = []
  let t0 = Date.now()
  const ahora = () => (Date.now() - t0) / 1000
  const voces = new Map()
  await contexto.exposeBinding("__demoVoz", (_origen, datos) => {
    if (datos?.evento === "inicio") {
      const evento = { tipo: "voz", t: ahora(), texto: String(datos.texto ?? "") }
      voces.set(datos.id, evento)
      eventos.push(evento)
    } else if (datos?.evento === "fin") {
      const evento = voces.get(datos.id)
      if (evento && evento.fin === undefined) evento.fin = ahora()
    }
  })
  await contexto.exposeBinding("__demoPersona", (_origen, texto) => {
    eventos.push({ tipo: "persona", t: ahora(), texto: String(texto ?? "") })
  })
  await contexto.addInitScript({ path: join(AQUI, "navegador", "voz-con-subtitulos.js") })
  await contexto.addInitScript({ path: join(AQUI, "navegador", "indicador-toques.js") })
  if (reconocimientoSimulado) await contexto.addInitScript({ path: join(AQUI, "navegador", "reconocimiento-simulado.js") })

  t0 = Date.now()
  const page = await contexto.newPage()
  page.setDefaultTimeout(20_000)
  page.on("pageerror", (error) => console.log(`  [error en la página] ${error.message}`))

  const estado = { inicio: 0, fin: 0 }
  const d = crearAyudas({ page, contexto, eventos, ahora, estado })
  let error = null
  try {
    await recorrido(d)
    await d.pausa(1500)
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)
    console.log(`  ✗ ${id} falló: ${error}`)
    fallos.push(id)
    await page.screenshot({ path: join(SALIDA, `${id}.fallo.png`) }).catch(() => undefined)
    await d.pausa(800).catch(() => undefined)
  }
  estado.fin = ahora()

  const video = page.video()
  await contexto.close()
  const crudo = await video.path()
  renameSync(crudo, join(SALIDA, `${id}.webm`))
  rmSync(carpetaTemporal, { recursive: true, force: true })
  writeFileSync(
    join(SALIDA, `${id}.json`),
    JSON.stringify(
      {
        id,
        plataforma: "web",
        titulo,
        video: `${id}.webm`,
        inicio: estado.inicio,
        fin: estado.fin,
        // Hora de Bogotá: de ella dependen el horario y el calendario que da la app.
        grabado: `${new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).replace(" ", "T")}-05:00`,
        error,
        eventos,
      },
      null,
      2,
    ),
  )
  console.log(`  ✓ ${id}.webm (${(estado.fin - estado.inicio).toFixed(1)} s, ${eventos.length} subtítulos)`)
}

function crearAyudas({ page, contexto, eventos, ahora, estado }) {
  const d = {
    page,
    contexto,
    pausa: (ms) => page.waitForTimeout(ms),
    marcarInicio() {
      estado.inicio = Math.max(0, ahora() - 0.4)
    },
    /** Lo que se hace, en amarillo bajo la pantalla. */
    accion(texto) {
      eventos.push({ tipo: "accion", t: ahora(), texto })
    },
    /** Una aclaración (qué es simulado, qué se ve), en gris. */
    nota(texto) {
      eventos.push({ tipo: "nota", t: ahora(), texto })
    },
    /** Desplaza suavemente un elemento al centro si no se ve entero. */
    async mostrar(localizador) {
      await localizador.waitFor({ state: "visible" })
      const visible = await localizador.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return r.top >= 70 && r.bottom <= window.innerHeight - 10
      })
      if (!visible) {
        await localizador.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }))
        await page.waitForTimeout(900)
      }
    },
    async tocar(localizador, texto) {
      await d.mostrar(localizador)
      if (texto) d.accion(texto)
      await page.waitForTimeout(500)
      await localizador.tap()
      await page.waitForTimeout(400)
    },
    async escribir(localizador, texto) {
      await d.mostrar(localizador)
      d.accion(`Escribe: «${texto}»`)
      await localizador.tap()
      await localizador.fill("")
      await localizador.pressSequentially(texto, { delay: 60 })
      await page.waitForTimeout(500)
    },
    /** Desplaza el contenedor con scroll más grande de la pantalla, en pasos suaves. */
    async desplazar(px, pasos = 3) {
      for (let i = 0; i < pasos; i++) {
        await page.evaluate((delta) => {
          const candidatos = [document.scrollingElement, ...document.querySelectorAll("*")].filter((el) => {
            if (!el || el.scrollHeight - el.clientHeight < 20) return false
            const estilo = getComputedStyle(el)
            return el === document.scrollingElement || /(auto|scroll)/.test(estilo.overflowY)
          })
          candidatos.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))
          candidatos[0]?.scrollBy({ top: delta, behavior: "smooth" })
        }, px / pasos)
        await page.waitForTimeout(450)
      }
      await page.waitForTimeout(500)
    },
    /** Espera a que la app termine de hablar (con un máximo, como haría una persona impaciente). */
    async esperarVoz(maximoMs = 15_000) {
      await page.waitForTimeout(400)
      await page
        .waitForFunction(() => !window.speechSynthesis?.speaking && !window.speechSynthesis?.pending, null, {
          timeout: maximoMs,
          polling: 200,
        })
        .catch(() => undefined)
      await page.waitForTimeout(500)
    },
    boton: (nombre, exacto = false) => page.getByRole("button", { name: nombre, exact: exacto }),
    async volver() {
      await d.tocar(page.getByRole("button", { name: "Volver", exact: true }).first(), "Toca «Volver»")
    },
  }
  return d
}

/** Abre el inicio y espera a que las rutas de TransMilenio estén cargadas. */
async function abrirInicio(d) {
  const catalogo = d.page
    .waitForResponse((r) => r.url().includes("/api/transmilenio") && r.ok(), { timeout: 40_000 })
    .catch(() => null)
  await d.page.goto(`${BASE}/`)
  await d.page.getByRole("heading", { name: "¿Qué necesitas?" }).waitFor({ timeout: 40_000 })
  await catalogo
  await d.pausa(900)
  d.marcarInicio()
  await d.pausa(1200)
}

/** Si la respuesta abrió otra pantalla, vuelve al asistente; si no, se queda. */
async function volverAlAsistente(d) {
  const enAsistente = await d.page.locator('section[aria-label="Asistente de voz"]').isVisible().catch(() => false)
  if (enAsistente) return
  await d.volver()
  await d.page.locator('section[aria-label="Asistente de voz"]').waitFor()
  await d.esperarVoz(5000)
}

/** Envía una pregunta escrita al asistente y espera a que responda. */
async function preguntarAlAsistente(d, texto) {
  const campo = d.page.getByLabel("Escribe tu pregunta")
  await d.escribir(campo, texto)
  await d.tocar(d.boton("Enviar pregunta"), "Toca «Enviar»")
  await esperarRespuesta(d)
}

/**
 * Espera a que el asistente empiece a escuchar o a pensar y luego a que
 * termine (o a que la pantalla cambie porque la respuesta abrió otra).
 */
async function esperarRespuesta(d) {
  // Las dos esperas leen lo mismo: "fuera" (la respuesta abrió otra pantalla),
  // "ocupado" (escucha o piensa) o "libre".
  await d.page
    .waitForFunction(
      () => {
        const boton = document.querySelector('section[aria-label="Asistente de voz"] button')
        return !boton || /Pensando…|Escuchando…/.test(boton.innerText)
      },
      null,
      { timeout: 4000, polling: "raf" },
    )
    .catch(() => undefined)
  await d.page.waitForFunction(
    () => {
      const boton = document.querySelector('section[aria-label="Asistente de voz"] button')
      return !boton || !/Pensando…|Escuchando…/.test(boton.innerText)
    },
    null,
    { timeout: 30_000, polling: 100 },
  )
  await d.pausa(600)
}

// ─── Recorridos ──────────────────────────────────────────────────────────────

await grabar("web-01-diagnostico", "Diagnóstico: nueve pruebas en vivo", async (d) => {
  await d.page.goto(`${BASE}/diagnostico`)
  await d.page.locator("[data-ready]").waitFor({ timeout: 40_000 })
  await d.pausa(700)
  d.marcarInicio()
  d.nota("La pantalla /diagnostico prueba cada función en este navegador.")
  await d.pausa(2500)
  await d.tocar(d.boton("Probar todo", true), "Toca «Probar todo»")
  d.nota("Cámara, micrófono y ubicación simulados por Chrome; los permisos ya están concedidos.")
  await d.page.waitForFunction(
    () => {
      const filas = [...document.querySelectorAll("li")].filter((li) => li.dataset.state)
      return filas.length > 0 && filas.every((li) => li.dataset.state === "ok" || li.dataset.state === "fail")
    },
    null,
    { timeout: 120_000, polling: 300 },
  )
  await d.pausa(1200)
  const resumen = await d.page.getByRole("status").first().innerText().catch(() => "")
  if (resumen) d.nota(`Resultado: ${resumen.trim()}`)
  await d.pausa(2000)
  await d.desplazar(700, 4)
  await d.pausa(1800)
  await d.desplazar(900, 4)
  await d.pausa(2500)
})

await grabar("web-02-asistente-rutas", "Asistente: ayuda, recorrido y horario", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Asistente/), "Toca «Asistente»")
  await d.esperarVoz(6000)
  d.nota("Sin micrófono en la grabación: las preguntas se escriben. El asistente usa las reglas (sin Ollama).")
  await preguntarAlAsistente(d, "¿qué puedes hacer?")
  // La ayuda no tiene pasos; si los hubiera, se muestran.
  const pasos = d.page.getByRole("heading", { name: /Lo que hice/ })
  if (await pasos.isVisible().catch(() => false)) await d.mostrar(pasos)
  await d.esperarVoz(12_000)
  await d.pausa(1000)

  await preguntarAlAsistente(d, "información de la B23")
  await d.page.getByRole("heading", { name: "Ruta B23" }).waitFor()
  d.nota("El asistente abre el detalle de la ruta.")
  await d.esperarVoz(14_000)
  await d.desplazar(500, 3)
  await d.pausa(1500)
  await d.desplazar(600, 3)
  await d.pausa(1500)
  await volverAlAsistente(d)

  await preguntarAlAsistente(d, "¿a qué hora pasa la H54?")
  await d.esperarVoz(16_000)
  await d.desplazar(450, 3)
  await d.pausa(2500)
})

await grabar("web-03-asistente-viajes", "Asistente: cómo llegar", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Asistente/), "Toca «Asistente»")
  await d.esperarVoz(6000)
  await preguntarAlAsistente(d, "cómo llego de Ricaurte a Calle 72")
  d.nota("Sin paradas verificadas, no da órdenes de abordaje: avisa y muestra las rutas que pasan cerca.")
  await d.esperarVoz(18_000)
  await d.desplazar(500, 3)
  await d.pausa(2000)
  await volverAlAsistente(d)

  d.nota("Ubicación simulada: estación Ricaurte. Sin origen, el asistente usa la ubicación.")
  await preguntarAlAsistente(d, "cómo llego a Calle 72")
  await d.esperarVoz(18_000)
  await d.desplazar(500, 3)
  await d.pausa(2500)
})

await grabar("web-04-rutas", "Rutas: buscar, ver el detalle y guardar", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Rutas/), "Toca «Rutas»")
  await d.esperarVoz(5000)
  const buscador = d.page.getByRole("searchbox", { name: "Buscar estación o ruta" })
  await d.escribir(buscador, "A52")
  d.accion("Pulsa Intro para buscar")
  await buscador.press("Enter")
  await d.page.getByRole("heading", { name: /Rutas para/ }).waitFor()
  await d.esperarVoz(6000)
  await d.tocar(d.boton(/^A52/).first(), "Toca la ruta A52")
  await d.page.getByRole("heading", { name: "Ruta A52" }).waitFor()
  d.nota("Recorrido en el mapa (OpenStreetMap), horario publicado y estaciones cercanas al trazado.")
  await d.pausa(2500)
  await d.tocar(d.boton("Guardar", true), "Toca «Guardar»")
  await d.page.getByRole("button", { name: "Guardada", exact: true }).waitFor()
  await d.esperarVoz(5000)
  await d.desplazar(550, 3)
  await d.pausa(1800)
  await d.desplazar(650, 3)
  await d.pausa(1800)
  await d.desplazar(900, 3)
  await d.pausa(1500)
  await d.volver()
  await d.esperarVoz(3000)
  await d.volver()
  await d.esperarVoz(3000)
  await d.tocar(d.boton(/^Rutas frecuentes/), "Toca «Rutas frecuentes»")
  await d.page.getByRole("heading", { name: "Rutas frecuentes" }).waitFor()
  d.nota("B23, H54 y M83 vienen guardadas; la A52 se acaba de agregar.")
  await d.esperarVoz(8000)
  await d.desplazar(400, 2)
  await d.pausa(2500)
})

await grabar("web-05-mapa-y-gps", "Mapa y GPS auditivo", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Mapa y GPS/), "Toca «Mapa y GPS»")
  await d.esperarVoz(6000)
  d.nota("Ubicación simulada: estación Ricaurte. Sin brújula en Chrome sin ventana: la orientación es por puntos cardinales.")
  await d.tocar(d.boton("Activar mi ubicación", true), "Toca «Activar mi ubicación»")
  await d.page.getByRole("button", { name: "Repetir indicación" }).waitFor({ timeout: 30_000 })
  await d.pausa(3000)
  await d.esperarVoz(10_000)
  await d.mostrar(d.page.getByText("Estaciones cercanas", { exact: true }).first())
  await d.pausa(1500)
  await d.tocar(d.boton("Oriéntame por voz", true).first(), "Toca «Oriéntame por voz»")
  await d.esperarVoz(16_000)
  await d.desplazar(450, 3)
  await d.pausa(1500)
  await d.tocar(d.boton("Repetir indicación"), "Toca «Repetir indicación»")
  await d.esperarVoz(12_000)
  await d.pausa(1500)
})

await grabar("web-06-lupa", "Lupa: aumento, filtros y congelar", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Lupa/), "Toca «Lupa»")
  await d.page.getByText("Abriendo cámara...").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined)
  d.nota(
    CAMARA
      ? "Cámara simulada: Chrome muestra una imagen de prueba de un letrero, no una cámara real."
      : "Cámara simulada: Chrome muestra su patrón de prueba, no una cámara real.",
  )
  await d.esperarVoz(6000)
  await d.pausa(1500)
  const deslizador = d.page.getByRole("slider", { name: "Acercar la imagen" })
  await d.mostrar(deslizador)
  d.accion("Mueve el control de aumento")
  for (const valor of ["1.4", "1.8", "2.2", "2.6"]) {
    // Con el setter nativo y un evento `input`, React ve el cambio como si se arrastrara el control.
    await deslizador.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }, valor)
    await d.pausa(600)
  }
  await d.pausa(1200)
  for (const filtro of ["Fluorescente", "Blanco y negro", "Invertir", "Alto contraste"]) {
    await d.tocar(d.page.getByRole("group", { name: "Modo de color" }).getByRole("button", { name: filtro, exact: true }), `Toca «${filtro}»`)
    await d.pausa(1600)
  }
  await d.tocar(d.boton("Congelar imagen", true), "Toca «Congelar imagen»")
  await d.pausa(2500)
  await d.tocar(d.boton("Reanudar", true), "Toca «Reanudar»")
  await d.pausa(2000)
})

await grabar(
  "web-07-ceguera-total",
  "Modo Ceguera total: toda la pantalla escucha",
  async (d) => {
    await abrirInicio(d)
    await d.tocar(d.page.getByRole("button", { name: "Abrir menú de accesibilidad" }), "Abre el menú de accesibilidad")
    await d.pausa(1200)
    await d.tocar(
      d.page.getByRole("dialog", { name: "Menú de modo de visualización" }).getByRole("button", { name: /^Ceguera total/ }),
      "Elige «Ceguera total»",
    )
    await d.page.getByRole("button", { name: /^Asistente de voz\. Toca para hablar/ }).waitFor()
    await d.esperarVoz(8000)
    d.nota("Sin micrófono en la grabación: la frase de la persona es simulada; el resto es la app tal cual.")
    await d.pausa(1500)

    await d.page.evaluate(() => {
      window.__demoFrase = "información de la B23"
    })
    await d.tocar(d.page.getByRole("button", { name: /^Asistente de voz\. Toca para hablar/ }), "Toca cualquier parte de la pantalla")
    await esperarRespuesta(d)
    await d.page.getByRole("heading", { name: "Ruta B23" }).waitFor()
    await d.esperarVoz(14_000)
    await volverAlAsistente(d)

    await d.page.evaluate(() => {
      window.__demoFrase = "¿dónde estoy?"
    })
    await d.tocar(d.page.getByRole("button", { name: /^Asistente de voz\. Toca para hablar/ }), "Toca cualquier parte de la pantalla")
    await esperarRespuesta(d)
    await d.esperarVoz(16_000)
    await d.pausa(2000)
  },
  { reconocimientoSimulado: true },
)

await grabar("web-08-alto-contraste", "Tema Alto contraste", async (d) => {
  await abrirInicio(d)
  d.nota("El tema claro es «cabecera lima». El único tema oscuro es «Alto contraste».")
  await d.pausa(2000)
  await d.tocar(d.page.getByRole("switch", { name: /Alto contraste/ }), "Activa «Alto contraste»")
  await d.esperarVoz(4000)
  await d.pausa(2000)
  await d.tocar(d.boton(/^Rutas/), "Toca «Rutas»")
  await d.esperarVoz(5000)
  await d.tocar(d.boton(/^Rutas frecuentes/), "Toca «Rutas frecuentes»")
  await d.esperarVoz(6000)
  await d.tocar(d.boton(/^B23/).first(), "Toca la ruta B23")
  await d.page.getByRole("heading", { name: "Ruta B23" }).waitFor()
  await d.pausa(3000)
  await d.desplazar(600, 3)
  await d.pausa(2000)
  await d.volver()
  await d.volver()
  await d.volver()
  await d.tocar(d.page.getByRole("switch", { name: /Alto contraste/ }), "Desactiva «Alto contraste»")
  await d.esperarVoz(4000)
  await d.pausa(1500)
})

await grabar("web-09-metro", "Metro de Bogotá: escenario futuro", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Metro de Bogotá/), "Toca «Metro de Bogotá»")
  await d.page.getByRole("heading", { name: "Metro de Bogotá" }).first().waitFor()
  d.nota("El Metro está en construcción y no tiene servicio: la app lo presenta como escenario educativo.")
  await d.esperarVoz(10_000)
  await d.desplazar(500, 3)
  await d.pausa(1800)
  await d.desplazar(500, 3)
  await d.pausa(1000)
  await d.tocar(d.page.getByText(/^E01 ·/).first(), "Toca la estación E01")
  await d.pausa(2500)
  await d.desplazar(700, 3)
  await d.pausa(1800)
  await d.desplazar(900, 3)
  await d.pausa(2500)
})

await grabar("web-10-emergencia-y-avisos", "Emergencia y avisos", async (d) => {
  await abrirInicio(d)
  await d.tocar(d.boton(/^Emergencia/), "Toca «Emergencia»")
  await d.page.getByRole("heading", { name: "Emergencia" }).first().waitFor()
  await d.esperarVoz(6000)
  d.nota("Los botones abren el marcador del teléfono (enlaces tel:). En la grabación no se llama.")
  for (const nombre of [/Llamar al 123/, /Policía de TransMilenio/, /Atención al usuario/]) {
    const enlace = d.page.getByRole("link", { name: nombre }).first()
    await d.mostrar(enlace)
    await enlace.focus()
    await d.esperarVoz(5000)
  }
  await d.volver()
  await d.esperarVoz(3000)
  await d.tocar(d.page.getByRole("button", { name: "Avisos y anuncios" }), "Toca la campana de avisos")
  const dialogo = d.page.getByRole("dialog", { name: "Avisos" })
  await dialogo.waitFor()
  await dialogo.getByText("Consultando los anuncios de TransMilenio.").waitFor({ state: "detached", timeout: 20_000 }).catch(() => undefined)
  d.nota("Anuncios del operador: se consultan en vivo a TransMilenio en el momento de la grabación.")
  await d.esperarVoz(14_000)
  await d.pausa(1500)
  await dialogo.evaluate((el) => el.scrollBy({ top: 500, behavior: "smooth" })).catch(() => undefined)
  await d.pausa(2500)
  await d.tocar(d.page.getByRole("button", { name: "Cerrar avisos" }), "Toca «Cerrar avisos»")
  await d.pausa(1500)
})

await browser.close()
if (fallos.length) {
  console.log(`\nFallaron: ${fallos.join(", ")}`)
  process.exit(1)
}
console.log("\nTodos los recorridos se grabaron.")
