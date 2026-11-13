/**
 * Prueba temporal: mide el tamaño de la ventana y de los cuadros de la grabación
 * con varias configuraciones de Chrome sin ventana, para elegir la que da
 * 390 × 844 a doble densidad (780 × 1688 en el video).
 */
import { createRequire } from "node:module"
import { join, resolve } from "node:path"

const requerir = createRequire(join(resolve(process.env.GRABADOR_DIR ?? process.cwd()), "package.json"))
const { chromium } = requerir("playwright")

function tamanoJpeg(base64) {
  const b = Buffer.from(base64, "base64")
  for (let i = 0; i < b.length - 9; i++) {
    if (b[i] === 0xff && (b[i + 1] === 0xc0 || b[i + 1] === 0xc2)) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`
  }
  return "?"
}

const base = ["--force-device-scale-factor=2", "--window-size=390,844"]
const configuraciones = [
  { nombre: "A ventana", args: base },
  { nombre: "B screen-info 0,0 1920x1080", args: [...base, "--screen-info={0,0 1920x1080}"] },
  { nombre: "C screen-info 1920x1080", args: [...base, "--screen-info={1920x1080}"] },
  { nombre: "D métricas por CDP", args: base, cdp: true },
  { nombre: "E screen-info + CDP", args: [...base, "--screen-info={0,0 1920x1080}"], cdp: true },
]

for (const c of configuraciones) {
  try {
    const browser = await chromium.launch({ channel: "chrome", headless: true, args: c.args })
    const contexto = await browser.newContext({ viewport: null, hasTouch: true })
    const page = await contexto.newPage()
    const cdp = await contexto.newCDPSession(page)
    if (c.cdp) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 0, mobile: true })
    await page.setContent('<body style="margin:0;background:linear-gradient(red,blue);height:100vh">hola</body>')
    const cuadros = []
    cdp.on("Page.screencastFrame", async (f) => {
      cuadros.push(tamanoJpeg(f.data))
      await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined)
    })
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 780, maxHeight: 1688 })
    await page.waitForTimeout(300)
    await page.evaluate(() => document.body.append(" cambio"))
    await page.waitForTimeout(500)
    await cdp.send("Page.stopScreencast")
    const info = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, pantalla: `${screen.width}x${screen.height}` }))
    console.log(`${c.nombre}: ventana ${info.w}x${info.h} dpr ${info.dpr} pantalla ${info.pantalla} cuadros ${[...new Set(cuadros)].join(",")}`)
    await browser.close()
  } catch (e) {
    console.log(`${c.nombre}: error ${e.message.split("\n")[0]}`)
  }
}
