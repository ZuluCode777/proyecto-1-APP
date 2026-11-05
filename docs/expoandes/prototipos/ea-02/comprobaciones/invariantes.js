async (page) => {
  const errores = []
  page.on('pageerror', (e) => errores.push(e.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(__HTML__)
  const esperar = (ms) => page.waitForTimeout(ms)
  const ev = (fn, arg) => page.evaluate(fn, arg)
  const resultados = []
  // Mediciones que no son pruebas (por ejemplo, pulsaciones de Tab): van aparte para no inflar el conteo.
  const datos = {}
  const prueba = async (nombre, fn) => { try { const r = await fn(); resultados.push({ nombre, ok: r === true, detalle: r === true ? '' : String(r) }) } catch (e) { resultados.push({ nombre, ok: false, detalle: 'excepción: ' + e.message }) } }
  const clic = (id) => ev((id) => { const el = document.querySelector(`#disenio [data-id="${id}"]`); if (!el) throw new Error('no existe ' + id); el.focus(); el.click() }, id)
  const texto = () => ev(() => document.querySelector('#contenido').innerText)
  const activo = () => ev(() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id || document.activeElement.tagName : null)
  for (const v of ['A', 'B']) {
    const libre = () => ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('libre') }, v)
    await prueba(`${v} cancelar consulta de viaje con Escape: no llega resultado tardío`, async () => {
      await libre(); await clic(v === 'A' ? 'nav-viaje' : 'tab-viaje')
      await ev(() => { const E = window.prototipo.E; E.viaje.origen = 'Terminal'; E.viaje.destino = 'Calle 72' })
      await clic('consultar-viaje'); await esperar(300); await page.keyboard.press('Escape'); await esperar(2000)
      const t = await texto(); const fase = await ev(() => window.prototipo.E.viaje.fase)
      return fase === 'cancelado' && !/Sube a la/.test(t) ? true : `fase=${fase}`
    })
    await prueba(`${v} salir de Rutas durante la consulta la cancela`, async () => {
      await libre(); await clic(v === 'A' ? 'nav-viaje' : 'tab-viaje')
      await ev(() => { const E = window.prototipo.E; E.viaje.origen = 'Terminal'; E.viaje.destino = 'Calle 72' })
      await clic('consultar-viaje'); await esperar(200); await ev(() => window.prototipo.irArea('inicio')); await esperar(2000)
      const r = await ev(() => [window.prototipo.E.viaje.fase, window.prototipo.E.voz.texto])
      return r[0] === 'cancelado' && /Saliste/.test(r[1]) ? true : r.join(' / ')
    })
    await prueba(`${v} cancelar al asistente mientras piensa descarta la respuesta`, async () => {
      await libre(); await clic(v === 'A' ? 'nav-asistente' : 'tab-asistente')
      await ev(() => { const E = window.prototipo.E; E.asis.envioAceptado = true; E.asis.texto = 'horario 8 G' })
      await clic('enviar-pregunta'); await esperar(300); await clic('cancelar-asistente'); await esperar(2000)
      const r = await ev(() => [window.prototipo.E.asis.fase, !!document.querySelector('#respuesta-h2')])
      return r[0] === 'cancelado' && !r[1] ? true : r.join(' / ')
    })
    await prueba(`${v} la medición vence a los 3 s y no se repite la distancia`, async () => {
      await ev((v) => { const P = window.prototipo; P.E.variante = v; P.aplicarEscenario('T1'); P.E.permisos.bluetooth = 'concedido' }, v)
      await clic(v === 'A' ? 'sesion-principal' : 'fila-sesion'); await esperar(1700)
      await ev(() => window.prototipo.ACCIONES_PANEL['medicion-frente']())
      const durante = await texto(); await esperar(3300); const despues = await texto()
      const r = await ev(() => [window.prototipo.E.acc.estado, window.prototipo.E.avisos.some((a) => a.clave === 'dato-vencido')])
      return /1,2 m/.test(durante) && !/1,2 m/.test(despues) && r[0] === 'sinDatos' && r[1] ? true : `estado=${r[0]} aviso=${r[1]} durante=${/1,2 m/.test(durante)} después=${/1,2 m/.test(despues)}`
    })
    await prueba(`${v} un aviso de proximidad corta la escucha y no la reanuda`, async () => {
      await ev((v) => { const P = window.prototipo; P.E.variante = v; P.aplicarEscenario('T6'); Object.assign(P.E.permisos, { microfono: 'concedido', voz: 'concedido' }); Object.assign(P.E.acc, { elegido: 'TMV-01', estado: 'sinDeteccion' }); P.E.permisos.bluetooth = 'concedido'; P.irArea('asistente') }, v)
      await clic('hablar'); await esperar(400); await ev(() => window.prototipo.ACCIONES_PANEL['medicion-frente']()); await esperar(3000)
      const r = await ev(() => [window.prototipo.E.asis.fase, !!document.querySelector('#respuesta-h2')])
      return r[0] === 'interrumpido' && !r[1] ? true : r.join(' / ')
    })
    await prueba(`${v} ubicación imprecisa, antigua o aproximada: sin llegada, sin distancia y sin orientar`, async () => {
      const malos = []
      for (const nombre of ['gps-imprecisa', 'gps-vieja', 'gps-aproximada']) {
        await ev(({ v, nombre }) => window.prototipo.preparar(nombre, { variante: v }), { v, nombre })
        const principal = await ev(() => document.querySelector('[data-id="gps-principal"]').textContent)
        await clic('gps-principal')
        const t = (await texto()) + ' ' + (await ev(() => window.prototipo.E.voz.texto))
        if (/has llegado|ya llegaste|llegaste a /i.test(t)) malos.push(`${nombre}: llegada`)
        if (/\ba \d+ (m|metros)\b/.test(t)) malos.push(`${nombre}: distancia`)
        if (/orientarme/i.test(principal) || (await ev(() => window.prototipo.E.gps.guiando))) malos.push(`${nombre}: orienta`)
      }
      return malos.length ? malos.join(', ') : true
    })
    await prueba(`${v} si la ubicación empeora durante la orientación, se detiene y se avisa`, async () => {
      await ev((v) => { window.prototipo.preparar('gps-guiando', { variante: v }); window.prototipo.CAMPOS_PANEL.gps('imprecisa'); window.prototipo.repintar() }, v)
      const r = await ev(() => [window.prototipo.E.gps.guiando, window.prototipo.E.voz.texto])
      return r[0] === false && /Orientación detenida/.test(r[1]) ? true : JSON.stringify(r)
    })
    await prueba(`${v} «sin detección» siempre dice que no es camino libre, en pantalla y en voz`, async () => {
      const malos = []
      for (const destino of ['inicio', 'accesorio']) {
        await ev(({ v, destino }) => { const P = window.prototipo; P.preparar('inicio', { variante: v }); Object.assign(P.E.acc, { elegido: 'TMV-01', estado: 'sinDeteccion' }); P.irArea(destino) }, { v, destino })
        const t = await texto()
        if (/sin detección/i.test(t) && !/no significa que el camino esté libre/i.test(t)) malos.push(destino)
      }
      await ev((v) => { const P = window.prototipo; P.preparar('accesorio-medicion', { variante: v }); P.ACCIONES_PANEL['sin-deteccion']() }, v)
      const voz = await ev(() => window.prototipo.E.voz.texto)
      if (!/no significa que el camino esté libre/i.test(voz)) malos.push('voz: ' + voz)
      return malos.length ? malos.join(', ') : true
    })
    await prueba(`${v} el foco nunca queda en la página tras cancelar o cuando desaparece el botón pulsado`, async () => {
      const malos = []
      const enCuerpo = async (caso) => { const f = await ev(() => document.activeElement === document.body || !document.querySelector('#disenio').contains(document.activeElement)); if (f) malos.push(caso) }
      await libre(); await clic(v === 'A' ? 'nav-viaje' : 'tab-viaje')
      await ev(() => { const E = window.prototipo.E; E.viaje.origen = 'Terminal'; E.viaje.destino = 'Calle 72' })
      await clic('consultar-viaje'); await esperar(200); await clic('cancelar-viaje'); await enCuerpo('cancelar-viaje (franja)')
      await clic('consultar-viaje'); await esperar(200); await clic('cancelar-viaje-local'); await enCuerpo('cancelar-viaje-local')
      await ev((v) => { const P = window.prototipo; P.E.variante = v; P.aplicarEscenario('T6'); Object.assign(P.E.permisos, { microfono: 'concedido', voz: 'concedido' }); P.irArea('asistente') }, v)
      await clic('hablar'); await esperar(300); await clic('cancelar-escucha'); await enCuerpo('cancelar-escucha')
      await ev((v) => { const P = window.prototipo; P.preparar('asistente-aviso-envio', { variante: v }) }, v)
      await clic('envio-aceptar'); await enCuerpo('envio-aceptar'); await esperar(1700)
      await ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('T9') }, v)
      await clic('cancelar-sesion'); await enCuerpo('cancelar-sesion (franja)')
      await ev((v) => window.prototipo.preparar('accesorio-buscando', { variante: v }), v)
      await clic('elegir-tmv01'); await enCuerpo('elegir-tmv01'); await esperar(1700)
      await ev((v) => window.prototipo.preparar('viaje-sin-red', { variante: v }), v)
      await ev(() => { window.prototipo.E.red = 'ok' }); await clic('reintentar-viaje'); await enCuerpo('reintentar-viaje'); await esperar(1800)
      return malos.length ? malos.join(', ') : true
    })
    await prueba(`${v} solo el viaje verificado dice dónde subir y bajar`, async () => {
      const malos = []
      // Con copia guardada el backend aplica la misma evidencia GTFS: indica abordaje y añade la procedencia.
      for (const nombre of ['viaje-verificado', 'viaje-incierto', 'viaje-candidato', 'viaje-sin-red', 'viaje-401', 'viaje-timeout', 'viaje-5xx', 'viaje-copia', 'asistente-respuesta']) {
        await ev(({ v, nombre }) => window.prototipo.preparar(nombre, { variante: v }), { v, nombre })
        const t = await texto(), ordena = /sube a la|bájate en|toma la 8/i.test(t)
        const debe = ['viaje-verificado', 'asistente-respuesta', 'viaje-copia'].includes(nombre)
        if (ordena !== debe) malos.push(`${nombre}: ordena=${ordena}`)
      }
      return malos.length ? malos.join(', ') : true
    })
    await prueba(`${v} Metro nunca da indicaciones de abordaje y declara que no hay servicio`, async () => {
      const malos = []
      for (const nombre of ['metro', 'metro-estacion']) {
        await ev(({ v, nombre }) => window.prototipo.preparar(nombre, { variante: v }), { v, nombre })
        const t = await texto()
        if (/sube a|bájate/i.test(t) || !/sin servicio comercial|no tiene servicio comercial/i.test(t)) malos.push(nombre)
      }
      return malos.length ? malos.join(', ') : true
    })
  }
  await prueba('A al volver, el foco regresa al botón que abrió la pantalla', async () => {
    await ev(() => { window.prototipo.E.variante = 'A'; window.prototipo.aplicarEscenario('libre') })
    await clic('nav-metro'); const enMetro = await activo(); await clic('metro-E12'); await clic('volver'); const f1 = await activo(); await clic('volver'); const f2 = await activo()
    return enMetro === 'titulo' && f1 === 'metro-E12' && f2 === 'nav-metro' ? true : `${enMetro} ${f1} ${f2}`
  })
  await prueba('B al volver, el foco regresa al botón que abrió la pantalla', async () => {
    await ev(() => { window.prototipo.E.variante = 'B'; window.prototipo.aplicarEscenario('libre') })
    await clic('tab-mas'); await clic('mas-lupa'); await clic('volver'); const f = await activo()
    return f === 'mas-lupa' ? true : f
  })
  await prueba('El foco se conserva cuando un evento repinta la pantalla', async () => {
    await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('T9') })
    await ev(() => document.querySelector('[data-id="repetir-voz"]').focus())
    await ev(() => window.prototipo.ACCIONES_PANEL.desconectar())
    const f = await activo()
    return f === 'repetir-voz' ? true : f
  })
  await prueba('Cada locución aparece como texto visible y en la región viva', async () => {
    await ev(() => { window.prototipo.E.variante = 'B'; window.prototipo.aplicarEscenario('libre') })
    await clic('tab-viaje'); await clic('frecuente-1'); await esperar(1900)
    const r = await ev(() => [window.prototipo.E.voz.texto, document.querySelector('#voz-texto').textContent, document.querySelector('#anuncio-cortes').textContent])
    return r[0] === r[1] && r[1] === r[2] && r[0].length > 20 ? true : JSON.stringify(r)
  })
  await prueba('Ubicación denegada: «Usar mi ubicación» explica y lleva el foco al campo Origen', async () => {
    await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('T4'); P.E.permisos.ubicacion = 'denegado' })
    await clic('nav-viaje'); await clic('origen-gps')
    const r = await ev(() => [document.activeElement.dataset.id, document.querySelector('#error-origen') ? document.querySelector('#error-origen').innerText : '', document.querySelector('#campo-origen').getAttribute('aria-invalid')])
    return r[0] === 'origen' && /permiso/.test(r[1]) && r[2] === 'true' ? true : JSON.stringify(r)
  })
  await prueba('Escape en la explicación propia equivale a «Ahora no»; el aviso del sistema exige respuesta', async () => {
    await ev(() => { window.prototipo.E.variante = 'A'; window.prototipo.aplicarEscenario('libre') })
    await clic('nav-lupa'); await clic('abrir-camara')
    const abierta = await ev(() => document.querySelector('#hoja').open)
    await page.keyboard.press('Escape'); const cerrada = await ev(() => !document.querySelector('#hoja').open)
    const foco = await activo()
    await clic('abrir-camara'); await clic('hoja-seguir'); await page.keyboard.press('Escape')
    const sistema = await ev(() => document.querySelector('#sistema').open)
    await clic('sistema-no')
    const permiso = await ev(() => window.prototipo.E.permisos.camara)
    return abierta && cerrada && foco === 'abrir-camara' && sistema && permiso === 'denegado' ? true : JSON.stringify({ abierta, cerrada, foco, sistema, permiso })
  })
  await prueba('El comprobador detecta un control pequeño, sin nombre, con contraste bajo y nombres repetidos', async () => {
    const r = await ev(() => {
      const P = window.prototipo
      P.preparar('inicio', { variante: 'A' })
      const b = document.createElement('button'); b.style.cssText = 'min-height:20px;min-width:20px;height:20px;width:20px;padding:0'
      const p = document.createElement('p'); p.textContent = 'gris claro'; p.style.color = '#aaaaaa'
      const d1 = document.createElement('button'), d2 = document.createElement('button'); d1.textContent = d2.textContent = 'Duplicado'
      document.querySelector('#contenido').append(b, p, d1, d2)
      const c = P.comprobar(); b.remove(); p.remove(); d1.remove(); d2.remove()
      return { pequenos: c.pequenos.length, sinNombre: c.sinNombre.length, minimo: c.contrasteMinimo, repetidos: c.nombresRepetidos }
    })
    return r.pequenos >= 1 && r.sinNombre >= 1 && r.minimo < 7 && r.repetidos.includes('duplicado ×2') ? true : JSON.stringify(r)
  })
  await prueba('Aviso de ubicación de iOS: el interruptor «Ubicación exacta» existe y apagarlo deja la ubicación aproximada', async () => {
    await ev(() => { window.prototipo.E.variante = 'A'; window.prototipo.aplicarEscenario('libre') })
    await clic('nav-gps'); await clic('gps-principal'); await clic('hoja-seguir')
    const objeto = await ev(() => document.querySelector('#sistema').innerText.includes('[object'))
    await clic('sistema-exacta'); await clic('sistema-al-usar'); await esperar(1400)
    const r = await ev(() => [window.prototipo.E.permisos.exacta, document.querySelector('#contenido').innerText])
    return !objeto && r[0] === false && /aproximada/i.test(r[1]) && /Escribir mi origen/.test(r[1]) ? true : JSON.stringify({ objeto, exacta: r[0] })
  })
  await prueba('Ningún texto visible contiene «[object»', async () => {
    const malos = await ev(() => {
      const P = window.prototipo, m = []
      for (const v of ['A', 'B']) for (const n of Object.keys(P.PREPARADOS)) { if (n === 'mas' && v === 'A') continue; P.preparar(n, { variante: v }); if (document.body.innerText.includes('[object')) m.push(v + ' ' + n) }
      return m
    })
    return malos.length ? malos.join(', ') : true
  })
  await prueba('Al desplazar, la franja de actividad (A) y las pestañas con actividad (B) siguen en pantalla', async () => {
    const r = await ev(() => {
      const P = window.prototipo, out = {}
      P.preparar('inicio-activa', { variante: 'A', texto: 100 }); window.scrollTo(0, 600)
      const a = document.querySelector('#actividad').getBoundingClientRect(); out.A = a.top >= -1 && a.bottom <= innerHeight
      P.preparar('inicio-activa', { variante: 'B', texto: 100 }); window.scrollTo(0, 300)
      const t = document.querySelector('#pestanas').getBoundingClientRect(), c = document.querySelector('[data-id="cancelar-sesion"]').getBoundingClientRect()
      out.B = Math.abs(t.bottom - innerHeight) <= 1 && c.top >= 0 && c.bottom <= innerHeight
      P.preparar('inicio-activa', { variante: 'B', texto: 310 }); window.scrollTo(0, 2000)
      const t3 = document.querySelector('#pestanas').getBoundingClientRect(); out.B310 = Math.abs(t3.bottom - innerHeight) <= 1
      window.scrollTo(0, 0)
      return out
    })
    return r.A && r.B && r.B310 ? true : JSON.stringify(r)
  })
  // Un evento asíncrono (desconexión) no debe mover la lectura de la persona. Se comprueba que el bloque
  // visible arriba sigue en el mismo sitio y el foco en el mismo control. Si el evento cambia el alto de lo
  // que hay encima (aviso urgente en la franja, fila más larga), scrollY cambia lo justo para compensarlo.
  for (const v of ['A', 'B']) for (const tamano of [100, 200]) {
    await prueba(`${v} ${tamano} %: un evento asíncrono conserva lo visible, el desplazamiento y el foco`, async () => {
      const r = await ev(({ v, tamano }) => {
        const P = window.prototipo
        P.preparar('inicio-activa', { variante: v, texto: tamano })
        document.querySelector('#contenido h1').focus({ preventScroll: true })
        window.scrollTo(0, 700)
        const tapa = () => { const f = document.querySelector('#actividad'); return f && !f.hidden && getComputedStyle(f).position === 'sticky' ? Math.max(0, f.getBoundingClientRect().bottom) : 0 }
        // Bloque de referencia: el primer control visible con identificador estable.
        const bloques = () => [...document.querySelectorAll('#contenido [data-id]')].filter((el) => el.getBoundingClientRect().height > 0)
        const ancla = bloques().find((el) => el.getBoundingClientRect().bottom > tapa())
        const clave = ancla.dataset.id, sepAntes = ancla.getBoundingClientRect().top - tapa()
        const antes = window.scrollY, docAntes = ancla.getBoundingClientRect().top + window.scrollY
        P.ACCIONES_PANEL.desconectar()
        const despues = window.scrollY
        const igual = bloques().find((el) => el.dataset.id === clave)
        const sepDespues = igual ? igual.getBoundingClientRect().top - tapa() : null
        const crecioEncima = igual ? igual.getBoundingClientRect().top + window.scrollY - docAntes : null
        window.scrollTo(0, 0)
        return { antes, despues, crecioEncima, sepAntes, sepDespues, foco: document.activeElement.dataset.id }
      }, { v, tamano })
      // Lo que se exige: el bloque que se leía queda a la misma distancia del borde visible (debajo de la
      // franja fija, si la hay) y el foco sigue en su control. scrollY solo cambia lo necesario para eso.
      return r.antes > 0 && r.sepDespues !== null && Math.abs(r.sepDespues - r.sepAntes) <= 1 && r.foco === 'titulo' ? true : JSON.stringify(r)
    })
  }
  // Referencia independiente del ancla del prototipo: bloques de texto que se ven enteros antes del
  // evento (debajo de la franja fija y dentro de la ventana). Después, los mismos bloques (misma etiqueta
  // y texto) deben seguir en el mismo sitio. Se usa con eventos síncronos y con temporizadores reales.
  const tomarReferencias = () => ev(() => {
    const f = document.querySelector('#actividad')
    const tapa = f && !f.hidden && getComputedStyle(f).position === 'sticky' ? Math.max(0, f.getBoundingClientRect().bottom) : 0
    return [...document.querySelectorAll('#contenido :is(h1, h2, h3, p, li, dt, dd, summary, button, label)')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && r.top >= tapa && r.bottom <= innerHeight)
      .map(({ el, r }) => ({ etiqueta: el.tagName, texto: el.textContent.trim().slice(0, 80), arriba: r.top }))
  })
  // Se recorren de arriba abajo. Hasta el primer bloque que el evento cambió (otro texto o eliminado),
  // ninguno puede moverse. Lo que queda debajo de un bloque que cambió de alto se desplaza a la fuerza.
  const compararReferencias = (antes) => ev((antes) => {
    const todos = [...document.querySelectorAll('#contenido :is(h1, h2, h3, p, li, dt, dd, summary, button, label)')]
    const movidos = [], encontrados = []
    for (const ref of [...antes].sort((x, y) => x.arriba - y.arriba)) {
      const el = todos.find((x) => x.tagName === ref.etiqueta && x.textContent.trim().slice(0, 80) === ref.texto)
      if (!el) break
      const arriba = el.getBoundingClientRect().top
      encontrados.push(ref.texto)
      if (Math.abs(arriba - ref.arriba) > 1) movidos.push(`«${ref.texto.slice(0, 30)}» ${ref.arriba.toFixed(1)}→${arriba.toFixed(1)}`)
    }
    return { encontrados: encontrados.length, movidos }
  }, antes)
  const sinPanel = (fn) => async () => {
    await ev(() => { document.querySelector('#panel').hidden = true })
    try { return await fn() } finally { await ev(() => { document.querySelector('#panel').hidden = false; window.scrollTo(0, 0) }) }
  }
  await prueba('R2-1: B, 200 %, Accesorio con detalles abiertos: desconectar no mueve el texto visible', sinPanel(async () => {
    await ev(() => {
      const P = window.prototipo
      P.preparar('accesorio-medicion', { variante: 'B', texto: 200 })
      document.querySelector('[data-id="significado-estados"]').parentElement.open = true
      document.querySelector('#contenido h1').focus({ preventScroll: true })
      window.scrollTo(0, 700)
    })
    const antes = await tomarReferencias()
    await ev(() => window.prototipo.ACCIONES_PANEL.desconectar())
    const r = await compararReferencias(antes)
    return antes.length > 0 && r.encontrados > 0 && !r.movidos.length ? true : JSON.stringify({ visibles: antes.length, ...r })
  }))
  await prueba('Temporizador real: el vencimiento a 3 s no mueve el texto visible (B, 200 %, Accesorio)', sinPanel(async () => {
    await ev(() => {
      const P = window.prototipo
      P.preparar('accesorio-sin-elegir', { variante: 'B', texto: 200 })
      Object.assign(P.E.permisos, { bluetooth: 'concedido' }); Object.assign(P.E.acc, { elegido: 'TMV-01', estado: 'sinDeteccion' }); P.repintar()
      document.querySelector('[data-id="significado-estados"]').parentElement.open = true
      P.ACCIONES_PANEL['medicion-frente']()
      window.scrollTo(0, 700)
    })
    const antes = await tomarReferencias()
    await esperar(3400)
    const estado = await ev(() => window.prototipo.E.acc.estado)
    const r = await compararReferencias(antes)
    return estado === 'sinDatos' && antes.length > 0 && r.encontrados > 0 && !r.movidos.length ? true : JSON.stringify({ estado, visibles: antes.length, ...r })
  }))
  await prueba('Temporizador real: el fin de la búsqueda de ubicación no mueve el texto visible (A, 200 %, Ubicación)', sinPanel(async () => {
    await ev(() => {
      const P = window.prototipo
      P.preparar('gps-guiando', { variante: 'A', texto: 200 })
      document.querySelector('[data-id="gps-actualizar"]').click()
      window.scrollTo(0, 400)
    })
    const antes = await tomarReferencias()
    await esperar(1500)
    const fase = await ev(() => window.prototipo.E.gps.fase)
    const r = await compararReferencias(antes)
    return fase === 'listo' && antes.length > 0 && r.encontrados > 0 && !r.movidos.length ? true : JSON.stringify({ fase, visibles: antes.length, ...r })
  }))
  await prueba('R2-2: la secuencia de T9 del guion (panel, «Desconectar en 20 s», aplicar) desconecta a los 20 s', async () => {
    await ev(() => {
      document.querySelector('#panel').hidden = true
      document.querySelector('.aviso-prototipo').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    await esperar(1700)
    await ev(() => {
      document.querySelector('.aviso-prototipo').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      document.querySelector('#panel-escenario').value = 'T9'
      document.querySelector('[data-panel="desconectar-20"]').click()
      document.querySelector('[data-panel="aplicar-escenario"]').click()
    })
    const antes = await ev(() => [window.prototipo.E.acc.estado, document.querySelector('#panel').hidden])
    await esperar(20600)
    const despues = await ev(() => [window.prototipo.E.acc.estado, window.prototipo.E.acc.motivo, document.querySelector('#panel-salida').textContent])
    await ev(() => { document.querySelector('#panel').hidden = false })
    return antes[0] === 'sinDeteccion' && antes[1] && despues[0] === 'sinDatos' && /se perdió/.test(despues[1]) && /desconectado/.test(despues[2]) ? true : JSON.stringify({ antes, despues })
  })
  // Con clics reales de Playwright: «Reiniciar estado» descarta la desconexión pedida antes, aunque luego se aplique T9.
  await prueba('R3-1: «Desconectar en 20 s», «Reiniciar estado» y aplicar T9 no desconecta a los 20 s', async () => {
    await ev(() => { const panel = document.querySelector('#panel'); panel.hidden = false; panel.querySelector('details').open = true })
    await page.click('#panel [data-panel="desconectar-20"]')
    await page.click('#panel [data-panel="reiniciar"]')
    await page.selectOption('#panel-escenario', 'T9')
    await page.click('#panel [data-panel="aplicar-escenario"]')
    const antes = await ev(() => window.prototipo.E.acc.estado)
    await esperar(20600)
    const despues = await ev(() => [window.prototipo.E.acc.estado, window.prototipo.E.avisos.some((a) => a.clave === 'accesorio-desconectado'), document.querySelector('#panel-salida').textContent])
    await ev(() => window.scrollTo(0, 0))
    return antes === 'sinDeteccion' && despues[0] === 'sinDeteccion' && !despues[1] && !/desconectado/.test(despues[2]) ? true : JSON.stringify({ antes, despues })
  })
  for (const v of ['A', 'B']) {
    await prueba(`${v}: los «details» abiertos siguen abiertos tras un evento`, async () => {
      const r = await ev((v) => {
        const P = window.prototipo, abierto = (id) => { const s = document.querySelector(`[data-id="${id}"]`); return s ? s.parentElement.open : null }
        const salida = {}
        if (v === 'A') {
          P.preparar('inicio-activa', { variante: v })
          document.querySelector('[data-id="detalles-estado"]').parentElement.open = true
          P.ACCIONES_PANEL.desconectar()
          salida.inicio = abierto('detalles-estado')
        }
        P.preparar('accesorio-medicion', { variante: v })
        document.querySelector('[data-id="significado-estados"]').parentElement.open = true
        P.ACCIONES_PANEL['sin-deteccion']()
        salida.accesorio = abierto('significado-estados')
        return salida
      }, v)
      return Object.values(r).every((x) => x === true) ? true : JSON.stringify(r)
    })
  }
  await prueba('A: con sesión activa, «Detener sesión» de la franja está tres paradas antes del título (cifra de la spec §1)', async () => {
    const r = await ev(() => {
      const P = window.prototipo
      P.preparar('inicio-activa', { variante: 'A' })
      const ps = P.paradasLectura()
      return { titulo: ps.findIndex((x) => x.id === 'titulo'), detener: ps.findIndex((x) => x.id === 'cancelar-sesion') }
    })
    return r.titulo - r.detener === 3 ? true : JSON.stringify(r)
  })
  for (const v of ['A', 'B']) {
    await prueba(`${v}: T1, T4 y T6 ensayan la explicación previa y el aviso simulado de iOS`, async () => {
      const malos = []
      const abierto = (id) => ev((id) => document.querySelector('#' + id).open, id)
      await ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('T1') }, v)
      await clic(v === 'A' ? 'sesion-principal' : 'fila-sesion')
      if (!(await abierto('hoja'))) malos.push('T1 sin hoja previa')
      await clic('hoja-seguir'); if (!(await abierto('sistema'))) malos.push('T1 sin aviso de iOS')
      await clic('sistema-si'); await esperar(1700)
      if ((await ev(() => window.prototipo.E.acc.estado)) !== 'sinDeteccion') malos.push('T1 no inició la sesión')
      await ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('T4') }, v)
      await clic(v === 'A' ? 'nav-viaje' : 'tab-viaje'); await clic('origen-gps'); await clic('hoja-seguir'); await clic('sistema-no')
      const t4 = await ev(() => [window.prototipo.E.permisos.ubicacion, document.activeElement.dataset.id])
      if (t4[0] !== 'denegado' || t4[1] !== 'origen') malos.push('T4: ' + t4.join(' / '))
      await ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('T6') }, v)
      await clic(v === 'A' ? 'nav-asistente' : 'tab-asistente'); await clic('hablar'); await clic('hoja-seguir'); await clic('sistema-si'); await clic('sistema-si')
      if ((await ev(() => window.prototipo.E.asis.fase)) !== 'escuchando') malos.push('T6 no escucha')
      await clic('cancelar-escucha')
      return malos.length ? malos.join(', ') : true
    })
  }
  await prueba('T5: preguntar al asistente si llegó nunca confirma la llegada con ubicación imprecisa', async () => {
    const r = await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('T5'); return P.responderAsistente('ya llegué a la estación?').texto })
    return /no puedo saber si llegaste/.test(r) && !/has llegado/i.test(r) ? true : r
  })
  await prueba('Mantener pulsado el aviso de arriba muestra el panel y aplicar una tarea lo vuelve a ocultar', async () => {
    await ev(() => { document.querySelector('#panel').hidden = true; document.querySelector('.aviso-prototipo').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    await esperar(1700)
    const visible = await ev(() => !document.querySelector('#panel').hidden)
    await ev(() => { document.querySelector('.aviso-prototipo').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); document.querySelector('#panel-escenario').value = 'T2'; document.querySelector('[data-panel="aplicar-escenario"]').click() })
    const oculto = await ev(() => [document.querySelector('#panel').hidden, document.title])
    await ev(() => { document.querySelector('#panel').hidden = false })
    return visible && oculto[0] && /Inicio$/.test(oculto[1]) ? true : JSON.stringify({ visible, oculto })
  })
  await prueba('Paridad: las frases de seguridad aparecen igual en A y en B', async () => {
    const casos = [
      ['gps-imprecisa', /no puedo saber si llegaste/i], ['gps-aproximada', /ubicación exacta/i], ['gps-vieja', /actualiza/i],
      ['accesorio-desconectado', /no hay avisos de proximidad/i], ['accesorio-medicion', /relativa al sensor/i],
      ['metro', /sin servicio comercial|no tiene servicio comercial/i], ['metro-estacion', /no se puede viajar hoy/i],
      ['viaje-incierto', /no te indico dónde subir/i], ['viaje-copia', /copia guardada/i], ['inicio-copia', /copia guardada/i], ['inicio-sin-red', /conexión con el servidor/i], ['viaje-timeout', /tardó demasiado/i], ['viaje-5xx', /tuvo un error/i], ['lupa-cerrada', /no lee letreros/i],
    ]
    const malos = []
    for (const [nombre, frase] of casos) for (const v of ['A', 'B']) {
      await ev(({ v, nombre }) => window.prototipo.preparar(nombre, { variante: v }), { v, nombre })
      if (!frase.test(await texto())) malos.push(`${v} ${nombre}`)
    }
    await ev(() => { const P = window.prototipo; P.preparar('inicio', { variante: 'B' }); Object.assign(P.E.acc, { elegido: 'TMV-01', estado: 'sinDeteccion' }); P.repintar() })
    if (!/no significa que el camino esté libre/i.test(await texto())) malos.push('B inicio sin detección')
    return malos.length ? malos.join(', ') : true
  })
  for (const v of ['A', 'B']) {
    await prueba(`${v} teclado: T2 se completa solo con Tab, Enter y escritura`, async () => {
      await ev((v) => { window.prototipo.E.variante = v; window.prototipo.aplicarEscenario('T2') }, v)
      let tabs = 0
      const hasta = async (id) => {
        for (let i = 0; i < 80; i++) { if ((await activo()) === id) return true; await page.keyboard.press('Tab'); tabs++ }
        return false
      }
      if (!(await hasta(v === 'A' ? 'nav-viaje' : 'tab-viaje'))) return 'no llegué a Rutas'
      await page.keyboard.press('Enter')
      if (!(await hasta('origen'))) return 'no llegué a Origen'
      await page.keyboard.type('Terminal')
      if (!(await hasta('destino'))) return 'no llegué a Destino'
      await page.keyboard.type('Calle 72'); await page.keyboard.press('Enter'); await esperar(1800)
      const t = await texto()
      const positivos = await ev(() => document.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').length)
      datos[`${v} pulsaciones de Tab en T2`] = tabs
      return /Sube a la 8 G en Terminal/.test(t) && positivos === 0 ? true : `resultado=${/Sube a la/.test(t)} tabindex>0=${positivos}`
    })
  }
  await prueba('El aviso simulado de iOS no se descarta con Escape repetido', async () => {
    await ev(() => window.prototipo.preparar('sistema-ubicacion', { variante: 'A' }))
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    // El navegador puede cerrarlo y el prototipo lo reabre en el cuadro siguiente: se espera hasta 1,5 s.
    let abierto = false
    for (let i = 0; i < 15 && !abierto; i++) { await esperar(100); abierto = await ev(() => document.querySelector('#sistema').open) }
    await clic('sistema-no')
    return abierto ? true : 'se cerró sin respuesta'
  })
  await prueba('Búsqueda de ubicación: salir de Rutas la cancela y no rellena el origen después', async () => {
    await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('libre'); P.E.permisos.ubicacion = 'concedido'; P.irArea('viaje') })
    await clic('origen-gps'); await esperar(300); await ev(() => window.prototipo.irArea('ajustes')); await esperar(1400)
    const r = await ev(() => [window.prototipo.E.viaje.origen, window.prototipo.E.gps.fase, document.activeElement.dataset.id || document.activeElement.tagName])
    return r[0] === '' && r[1] === 'inactivo' ? true : JSON.stringify(r)
  })
  await prueba('Búsqueda cancelada no completa una búsqueda posterior', async () => {
    await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('libre'); P.E.permisos.ubicacion = 'concedido'; P.irArea('viaje') })
    await clic('origen-gps'); await esperar(300); await clic('cancelar-gps')
    await ev(() => window.prototipo.irArea('gps')); await clic('gps-principal'); await esperar(1500)
    const r = await ev(() => [window.prototipo.E.viaje.origen, window.prototipo.E.gps.fase])
    return r[0] === '' && r[1] === 'listo' ? true : JSON.stringify(r)
  })
  // Tres caminos para cancelar la actualización: la franja, salir con «Volver» y cambiar de pestaña en B.
  for (const [nombre, variante, salir] of [['la franja', 'A', 'franja'], ['«Volver»', 'A', 'volver'], ['otra pestaña', 'B', 'pestana']]) {
    await prueba(`Cancelar «Actualizar ubicación» durante la orientación desde ${nombre} la detiene y lo dice`, async () => {
      const r = await ev(({ variante, salir }) => {
        const P = window.prototipo
        P.preparar('gps-guiando', { variante })
        document.querySelector('[data-id="gps-actualizar"]').click()
        const id = { franja: 'cancelar-gps', volver: 'volver', pestana: 'tab-inicio' }[salir]
        document.querySelector(`[data-id="${id}"]`).click()
        return [P.E.gps.guiando, P.E.gps.fase, P.E.voz.texto, !!document.querySelector('[data-id="cancelar-guia"]')]
      }, { variante, salir })
      return r[0] === false && r[1] === 'inactivo' && /Orientación detenida/.test(r[2]) && !r[3] ? true : JSON.stringify(r)
    })
  }
  await prueba('Salir de Rutas con consulta y búsqueda de ubicación en curso: un solo anuncio con ambas', async () => {
    await ev(() => { const P = window.prototipo; P.E.variante = 'A'; P.aplicarEscenario('libre'); P.E.permisos.ubicacion = 'concedido'; P.irArea('viaje'); Object.assign(P.E.viaje, { origen: 'Terminal', destino: 'Calle 72' }) })
    await clic('consultar-viaje'); await clic('origen-gps'); await esperar(200); await ev(() => window.prototipo.irArea('inicio'))
    const voz = await ev(() => window.prototipo.E.voz.texto)
    return /consulta del viaje/.test(voz) && /búsqueda de ubicación/.test(voz) ? true : voz
  })
  await prueba('«Calle 1» no se confunde con «Calle 187»; «Calle 72» sigue encontrándose', async () => {
    const r = await ev(() => { const P = window.prototipo; P.preparar('viaje-vacio', { variante: 'A' }); const a = P.planear('Terminal', 'Calle 1').tipo; const b = P.planear('Terminal', 'Calle 72').tipo; return [a, b] })
    return r[0] === 'desconocida' && r[1] === 'verificado' ? true : r.join(' / ')
  })
  await prueba('Con copia guardada, el horario del asistente dice la procedencia', async () => {
    const r = await ev(() => { const P = window.prototipo; P.preparar('asistente-inicial', { variante: 'A' }); P.E.catalogo = 'copia'; return P.responderAsistente('horario 8 G').texto })
    return /copia guardada de TransMilenio del 24\/9\/2026/.test(r) ? true : r
  })
  for (const v of ['A', 'B']) {
    await prueba(`${v}: «Actualizar datos» está en Inicio y en Rutas con copia guardada o sin conexión, y funciona`, async () => {
      const malos = []
      const control = (ids) => ev((ids) => ids.map((id) => document.querySelector(`#contenido [data-id="${id}"]`)).find(Boolean)?.dataset.id || null, ids)
      for (const caso of ['copia', 'sin-red', 'timeout', '5xx']) {
        await ev(({ v, caso }) => { const P = window.prototipo; P.preparar('inicio', { variante: v }); if (caso === 'copia') P.E.catalogo = 'copia'; else P.E.red = caso; P.repintar() }, { v, caso })
        if (!(await control(['actualizar-datos', 'fila-datos']))) malos.push(`Inicio ${caso}`)
        await ev(() => window.prototipo.irArea('viaje'))
        if (!(await control(['actualizar-datos-viaje']))) malos.push(`Rutas ${caso}`)
      }
      await ev((v) => { const P = window.prototipo; P.preparar('inicio-copia', { variante: v }) }, v)
      await clic(v === 'A' ? 'actualizar-datos' : 'fila-datos'); await esperar(1700)
      const ok = await ev(() => [window.prototipo.E.catalogo, !!document.querySelector('#contenido [data-id="actualizar-datos"], #contenido [data-id="fila-datos"]'), document.activeElement === document.body])
      if (ok[0] !== 'vivo' || ok[1] || ok[2]) malos.push('actualizar con servidor: ' + JSON.stringify(ok))
      await ev((v) => { const P = window.prototipo; P.preparar('viaje-vacio', { variante: v }); P.E.catalogo = 'copia'; P.E.red = 'sin-red'; P.repintar() }, v)
      await clic('actualizar-datos-viaje'); await esperar(1700)
      const falla = await ev(() => [window.prototipo.E.catalogo, window.prototipo.E.voz.texto])
      if (falla[0] !== 'copia' || !/No pude actualizar/.test(falla[1])) malos.push('actualizar sin red: ' + JSON.stringify(falla))
      await ev(() => { window.prototipo.E.red = 'ok' }); await clic('actualizar-datos-viaje'); await esperar(200); await clic('cancelar-datos'); await esperar(1600)
      const cancelada = await ev(() => [window.prototipo.E.catalogo, window.prototipo.E.datos.fase])
      if (cancelada[0] !== 'copia' || cancelada[1] !== 'inactivo') malos.push('cancelar: ' + JSON.stringify(cancelada))
      return malos.length ? malos.join(', ') : true
    })
  }
  await prueba('Encender Bluetooth retira el aviso urgente que dejó al apagarlo', async () => {
    const r = await ev(() => {
      const P = window.prototipo, b = document.createElement('button')
      P.preparar('inicio-activa', { variante: 'A' }); P.ACCIONES_PANEL['bluetooth-apagado'](b); const antes = !!P.E.voz.urgente
      P.ACCIONES_PANEL['bluetooth-apagado'](b); return [antes, !!P.E.voz.urgente, P.E.avisos.some((a) => a.clave === 'accesorio-desconectado')]
    })
    return r[0] && !r[1] && !r[2] ? true : JSON.stringify(r)
  })
  await prueba('Olvidar el accesorio con sesión activa dice ambas cosas en un solo anuncio', async () => {
    await ev(() => window.prototipo.preparar('accesorio-medicion', { variante: 'A' }))
    await clic('olvidar-accesorio')
    const voz = await ev(() => window.prototipo.E.voz.texto)
    return /Sesión detenida/.test(voz) && /olvidado/.test(voz) ? true : voz
  })
  await prueba('Escape sin actividad transitoria vuelve a la pantalla anterior', async () => {
    await ev(() => { window.prototipo.E.variante = 'A'; window.prototipo.aplicarEscenario('libre') })
    await clic('nav-ajustes'); await page.keyboard.press('Escape')
    const r = await ev(() => [document.title, document.activeElement.dataset.id])
    return /Inicio$/.test(r[0]) && r[1] === 'nav-ajustes' ? true : r.join(' / ')
  })
  return { pruebas: resultados.length, aprobadas: resultados.filter((r) => r.ok).length, resultados, datos, errores }
}
