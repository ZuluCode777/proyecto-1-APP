async (page) => {
  const errores = []
  const peticiones = []
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()) })
  page.on('request', (r) => { if (!r.url().startsWith('data:') && r.url() !== 'about:blank') peticiones.push(r.url()) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(__HTML__)
  const resultado = await page.evaluate(() => {
    const P = window.prototipo
    const nombres = Object.keys(P.PREPARADOS)
    const configuraciones = [
      { texto: 100, bajaVision: false }, { texto: 200, bajaVision: false }, { texto: 310, bajaVision: false },
      { texto: 100, bajaVision: true }, { texto: 310, bajaVision: true },
    ]
    const filas = []
    const fallos = []
    for (const variante of ['A', 'B']) {
      for (const nombre of nombres) {
        if (nombre === 'mas' && variante === 'A') continue
        for (const c of configuraciones) {
          let r
          try { r = P.preparar(nombre, { variante, ...c }) } catch (e) { fallos.push(`${variante} ${nombre} ${JSON.stringify(c)}: EXCEPCIÓN ${e.message}`); continue }
          const problemas = []
          if (r.pequenos.length) problemas.push('pequeños: ' + r.pequenos.join('; '))
          if (r.sinNombre.length) problemas.push('sin nombre: ' + r.sinNombre.join('; '))
          if (r.nombresRepetidos.length) problemas.push('nombres repetidos: ' + r.nombresRepetidos.join('; '))
          if (r.contrasteMinimo < 7) problemas.push('contraste: ' + r.contrasteBajo.join('; '))
          if (r.desbordes.length) problemas.push('desborde: ' + r.desbordes.join('; '))
          if (r.tonosSinTexto.length) problemas.push('tono sin texto: ' + r.tonosSinTexto.join('; '))
          if (!r.dialogo && r.h1 !== 1) problemas.push('h1=' + r.h1)
          const foco = document.activeElement
          if (!r.dialogo && !(foco && foco.tagName === 'H1')) problemas.push('foco no en h1: ' + (foco ? foco.tagName + (foco.dataset.id ? '#' + foco.dataset.id : '') : 'ninguno'))
          if (problemas.length) fallos.push(`${variante} ${nombre} t${c.texto}${c.bajaVision ? ' bv' : ''}: ${problemas.join(' | ')}`)
          filas.push({ variante, nombre, ...c, contraste: r.contrasteMinimo, interactivos: r.interactivos, paradas: r.paradas, partidas: r.palabrasPartidas })
        }
      }
    }
    const minimo = Math.min(...filas.map((f) => f.contraste))
    const resumen = {}
    for (const f of filas) {
      const k = `${f.variante} t${f.texto}${f.bajaVision ? ' bv' : ''}`
      const r = resumen[k] || (resumen[k] = { pantallas: 0, partidas: 0, pantallasConPartidas: 0, ejemplos: new Set(), paradasMedia: 0, interactivosMedia: 0 })
      r.pantallas++; r.partidas += f.partidas.length; if (f.partidas.length) r.pantallasConPartidas++
      f.partidas.slice(0, 3).forEach((p) => r.ejemplos.add(p)); r.paradasMedia += f.paradas; r.interactivosMedia += f.interactivos
    }
    for (const r of Object.values(resumen)) { r.ejemplos = [...r.ejemplos].slice(0, 8); r.paradasMedia = +(r.paradasMedia / r.pantallas).toFixed(1); r.interactivosMedia = +(r.interactivosMedia / r.pantallas).toFixed(1) }
    const porPantalla = filas.filter((f) => f.texto === 100 && !f.bajaVision).map((f) => `${f.variante} ${f.nombre}: ${f.paradas} paradas, ${f.interactivos} controles`)
    // Alto que ocupan las franjas fijas en Inicio con una sesión activa.
    const franjasFijas = []
    for (const variante of ['A', 'B']) for (const texto of [100, 200, 310]) {
      P.preparar('inicio-activa', { variante, texto, bajaVision: false })
      const fijas = [...document.querySelectorAll('#app *')].filter((el) => getComputedStyle(el).position === 'sticky')
      const alto = Math.round(fijas.reduce((s, el) => s + el.getBoundingClientRect().height, 0))
      franjasFijas.push(`${variante} ${texto} %: ${alto} px (${Math.round((100 * alto) / innerHeight)} %)`)
    }
    const sinFoco = filas.length - filas.filter((f) => ['hoja-ubicacion', 'sistema-ubicacion'].includes(f.nombre)).length
    return { combinaciones: filas.length, combinacionesConFocoComprobado: sinFoco, contrasteMinimoGlobal: minimo, fallos: fallos.slice(0, 60), totalFallos: fallos.length, resumen, porPantalla, franjasFijas }
  })
  return { ...resultado, errores, peticiones }
}
