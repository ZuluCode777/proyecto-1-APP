async (page) => {
  const errores = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(__HTML__)
  const esperar = (ms) => page.waitForTimeout(ms)
  // Recorrido lineal aproximado: deslizamientos desde el foco actual hasta el objetivo.
  const paso = (p) => page.evaluate((p) => {
    const P = window.prototipo
    const ps = P.paradasLectura()
    const a = document.activeElement
    let actual = a && a.dataset && a.dataset.id ? ps.findIndex((x) => x.id === a.dataset.id) : -1
    if (actual < 0) actual = 0
    const ids = [].concat(p.ir || p.escribir || [])
    let objetivo = -1
    if (ids.length) {
      const candidatos = ids.map((id) => ps.findIndex((x) => x.id === id)).filter((i) => i >= 0)
      objetivo = candidatos.sort((x, y) => Math.abs(x - actual) - Math.abs(y - actual))[0] ?? -1
    } else if (p.leer) {
      // Si el texto aparece en varios lugares (por ejemplo, también en «La app dijo»), se toma el más cercano al foco.
      const coincidencias = ps.map((x, i) => (x.texto.toLowerCase().includes(p.leer.toLowerCase()) ? i : -1)).filter((i) => i >= 0)
      objetivo = coincidencias.sort((x, y) => Math.abs(x - actual) - Math.abs(y - actual))[0] ?? -1
    }
    if (objetivo < 0) return { error: `no encontré ${JSON.stringify(p)} en ${ps.length} paradas: ` + ps.map((x) => x.id || x.texto.slice(0, 25)).join(' / ') }
    const deslizamientos = Math.abs(objetivo - actual)
    if (p.ir) {
      const el = document.querySelector(`[data-id="${CSS.escape(ps[objetivo].id)}"]`)
      el.focus(); el.click()
    } else if (p.escribir) {
      const el = document.querySelector(`[data-id="${CSS.escape(ps[objetivo].id)}"]`)
      el.focus(); el.value = p.valor; el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      // Leer: el cursor de VoiceOver queda en ese texto; se aproxima enfocando el elemento más cercano.
    }
    return { deslizamientos, activacion: p.ir ? 1 : 0, texto: p.escribir ? 1 : 0 }
  }, p)
  const TAREAS = {
    // T1, T4 y T6 incluyen la explicación previa y el aviso simulado de iOS: sus permisos empiezan sin preguntar.
    T1: { A: [{ ir: 'sesion-principal' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { esperar: 1700 }, { leer: 'sin detección' }, { ir: ['sesion-principal', 'cancelar-sesion'] }],
      B: [{ ir: 'fila-sesion' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { esperar: 1700 }, { leer: 'sin detección' }, { ir: ['fila-sesion', 'cancelar-sesion'] }] },
    T2: { A: [{ ir: 'nav-viaje' }, { escribir: 'origen', valor: 'Terminal' }, { escribir: 'destino', valor: 'Calle 72' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'Sube a la' }, { leer: 'Bájate en' }],
      B: [{ ir: 'tab-viaje' }, { escribir: 'origen', valor: 'Terminal' }, { escribir: 'destino', valor: 'Calle 72' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'Sube a la' }, { leer: 'Bájate en' }] },
    T3: { A: [{ ir: 'nav-viaje' }, { escribir: 'origen', valor: 'Portal Usme' }, { escribir: 'destino', valor: 'Molinos' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'no te indico dónde subir' }],
      B: [{ ir: 'tab-viaje' }, { escribir: 'origen', valor: 'Portal Usme' }, { escribir: 'destino', valor: 'Molinos' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'no te indico dónde subir' }] },
    T4: { A: [{ ir: 'nav-viaje' }, { ir: 'origen-gps' }, { ir: 'hoja-seguir' }, { ir: 'sistema-no' }, { escribir: 'origen', valor: 'Terminal' }, { escribir: 'destino', valor: 'Calle 72' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'Sube a la' }],
      B: [{ ir: 'tab-viaje' }, { ir: 'origen-gps' }, { ir: 'hoja-seguir' }, { ir: 'sistema-no' }, { escribir: 'origen', valor: 'Terminal' }, { escribir: 'destino', valor: 'Calle 72' }, { ir: 'consultar-viaje' }, { esperar: 1800 }, { leer: 'Sube a la' }] },
    T5: { A: [{ ir: 'nav-gps' }, { leer: 'no puedo saber si llegaste' }], B: [{ ir: 'fila-gps' }, { leer: 'no puedo saber si llegaste' }] },
    T6: { A: [{ ir: 'nav-asistente' }, { ir: 'hablar' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { ir: 'sistema-si' }, { esperar: 400 }, { ir: ['cancelar-escucha', 'hablar'] }, { esperar: 3000 }, { leer: 'No envié nada' }],
      B: [{ ir: 'tab-asistente' }, { ir: 'hablar' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { ir: 'sistema-si' }, { esperar: 400 }, { ir: ['cancelar-escucha', 'hablar'] }, { esperar: 3000 }, { leer: 'No envié nada' }] },
    T7: { A: [{ ir: 'nav-avisos' }, { leer: 'Origen: Audio' }, { leer: 'EJEMPLO FICTICIO' }, { leer: 'no hay anuncios suyos' }],
      B: [{ ir: 'tab-avisos' }, { leer: 'Origen: Audio' }, { leer: 'EJEMPLO FICTICIO' }, { leer: 'no hay anuncios suyos' }] },
    T8: { A: [{ ir: 'nav-metro' }, { ir: 'metro-E12' }, { leer: 'no se puede viajar hoy' }],
      B: [{ ir: 'tab-mas' }, { ir: 'mas-metro' }, { ir: 'metro-E12' }, { leer: 'no se puede viajar hoy' }] },
    T9: { A: [{ panel: 'desconectar' }, { leer: 'Se perdió la conexión' }, { ir: 'nav-accesorio' }, { ir: 'acc-principal' }, { esperar: 1700 }, { leer: 'sin detección' }],
      B: [{ panel: 'desconectar' }, { leer: 'Se perdió la conexión' }, { ir: 'fila-accesorio' }, { ir: 'acc-principal' }, { esperar: 1700 }, { leer: 'sin detección' }] },
    T10: { A: [{ ir: 'nav-lupa' }, { ir: 'abrir-camara' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { ir: 'lupa-acercar' }, { ir: 'lupa-congelar' }],
      B: [{ ir: 'tab-mas' }, { ir: 'mas-lupa' }, { ir: 'abrir-camara' }, { ir: 'hoja-seguir' }, { ir: 'sistema-si' }, { ir: 'lupa-acercar' }, { ir: 'lupa-congelar' }] },
  }
  const tabla = []
  for (const tarea of Object.keys(TAREAS)) {
    for (const v of ['A', 'B']) {
      await page.evaluate(({ v, tarea }) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario(tarea) }, { v, tarea })
      const fila = { tarea, variante: v, deslizamientos: 0, activaciones: 0, textos: 0, error: null }
      for (const p of TAREAS[tarea][v]) {
        if (p.esperar) { await esperar(p.esperar); continue }
        if (p.panel) { await page.evaluate((a) => window.prototipo.ACCIONES_PANEL[a](), p.panel); continue }
        const r = await paso(p)
        if (r.error) { fila.error = r.error; break }
        fila.deslizamientos += r.deslizamientos; fila.activaciones += r.activacion; fila.textos += r.texto
        await esperar(30)
      }
      fila.final = await page.evaluate(() => ({ pantalla: document.title.split(' · ').pop(), voz: window.prototipo.E.voz.texto.slice(0, 90) }))
      tabla.push(fila)
    }
  }
  return { tabla, errores }
}
