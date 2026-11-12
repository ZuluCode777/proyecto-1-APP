import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import * as metro from "./metro"
import * as cartografia from "./metro-cartografia"
import { compilar, nodos, texto } from "./metro-prueba-ui"

/**
 * EA-24 (#50): el mapa del Metro va rotulado como proyecto futuro en el mapa, en
 * el texto y en la voz, con su atribución, y no llega a los mapas operativos.
 * El dibujo se prueba con un Leaflet falso; no hay navegador.
 */

const { CARTOGRAFIA_METRO, PROCEDENCIA_MAPA_METRO } = cartografia
const raiz = process.cwd()
const leer = (archivo: string) => readFileSync(`${raiz}/${archivo}`, "utf8")

// --- Separación ---------------------------------------------------------------

/** Lo que un archivo importa y si dibuja un `TransitMap` con capa ilustrativa, leído del árbol sintáctico. */
function analizar(archivo: string) {
  const fuente = ts.createSourceFile(archivo, leer(archivo), ts.ScriptTarget.Latest, true, archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const importa: string[] = []
  const mapas = new Set<string>()
  let opaco = false
  let mapaConCapa = false
  const visitar = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      importa.push(n.moduleSpecifier.text)
      if (ts.isImportDeclaration(n) && /transit-map$/.test(n.moduleSpecifier.text)) {
        const nombres = n.importClause?.namedBindings
        // Un alias sigue siendo el mapa; un import completo del módulo no se puede seguir.
        if (nombres && ts.isNamedImports(nombres)) for (const e of nombres.elements) if ((e.propertyName ?? e.name).text === "TransitMap") mapas.add(e.name.text)
        if (n.importClause?.name || (nombres && ts.isNamespaceImport(nombres))) opaco = true
      }
    }
    // `import()` y `require()`: con texto literal se anotan; con una expresión no se pueden comprobar.
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const [modulo] = n.arguments
      if (modulo && ts.isStringLiteralLike(modulo)) importa.push(modulo.text)
      else opaco = true
    }
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && mapas.has(n.tagName.getText())) {
      // Una propiedad `overlay` o un `{...props}` pueden llevar la capa.
      if (n.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a) || a.name.getText() === "overlay")) mapaConCapa = true
    }
    ts.forEachChild(n, visitar)
  }
  visitar(fuente)
  return { importa, opaco, mapaConCapa }
}

test("la cartografía solo llega al listado del Metro; los mapas operativos no la dibujan", () => {
  // `scripts/` regenera el archivo de datos; `proxy.ts` e `instrumentation.ts` viven en la raíz.
  const archivos = ["lib", "components", "hooks", "app", "scripts"]
    .flatMap((dir) => readdirSync(`${raiz}/${dir}`, { recursive: true, encoding: "utf8" }).map((f) => `${dir}/${f.replaceAll("\\", "/")}`))
    .concat("proxy.ts", "instrumentation.ts")
    .filter((f) => /\.(?:tsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort()
  assert.ok(archivos.length > 30, `el rastreo solo vio ${archivos.length} archivos`)
  const analisis = new Map(archivos.map((f) => [f, analizar(f)]))

  // Un import que no es texto literal no se puede comprobar. El único conocido es un apoyo de
  // pruebas que carga `lib/ollama.ts` y la ruta del agente por URL; no es código de la app.
  assert.deepEqual(archivos.filter((f) => analisis.get(f)!.opaco), ["lib/ea27-prueba-ollama.ts"])

  // Quién importa cada módulo de la cartografía. El importador de la fuente no llega a `components/`.
  const importadores = Object.fromEntries(
    archivos.map((f) => [f, analisis.get(f)!.importa.filter((m) => m.includes("metro-cartografia")).sort()] as const).filter(([, m]) => m.length),
  )
  assert.deepEqual(importadores, {
    "components/metro-list.tsx": ["@/lib/metro-cartografia"],
    "lib/metro-cartografia-fuente.ts": ["@/lib/metro-cartografia-validacion"],
    "lib/metro-cartografia.ts": ["@/data/metro-cartografia.json", "@/lib/metro-cartografia-validacion", "@/lib/metro-cartografia-validacion"],
    "scripts/analisis-metro-cartografia.ts": ["@/lib/metro-cartografia", "@/lib/metro-cartografia-fuente", "@/lib/metro-cartografia-validacion"],
    "scripts/sync-metro-cartografia.ts": ["@/lib/metro-cartografia-fuente"],
  })
  // Sin catálogo ni TransMilenio: no hay cercanía que calcular.
  assert.deepEqual(analisis.get("lib/metro-cartografia-validacion.ts")!.importa, [])

  assert.deepEqual(archivos.filter((f) => analisis.get(f)!.mapaConCapa), ["components/metro-list.tsx"], "ni el GPS, ni la ruta, ni el viaje pasan una capa ilustrativa")
  // El análisis ve los mapas operativos: si no los viera, lo anterior no probaría nada.
  for (const f of ["components/route-detail.tsx", "components/trip-view.tsx", "components/auditory-gps.tsx"]) {
    assert.ok(analisis.get(f)!.importa.some((m) => /transit-map$/.test(m)), `${f} ya no usa el mapa compartido: actualiza la lista`)
  }
})

// --- Pantalla del Metro ----------------------------------------------------------

type Capa = { lines: [number, number][][]; polygons: { ring: [number, number][]; label: string }[]; label: string; attribution: string }

function listado(modulos: Record<string, unknown> = {}) {
  const voz: string[] = []
  const { MetroList } = compilar("components/metro-list.tsx", {
    "@/lib/metro": metro,
    "@/lib/metro-cartografia": cartografia,
    react: { useEffect: (f: () => void) => void f() },
    "@/hooks/use-speech": { useSpeech: () => ({ speak: (t: string) => voz.push(t), cancel() {} }), esUltimaLocucion: () => false },
    ...modulos,
  })
  return { arbol: MetroList({ onBack() {} }), voz }
}

test("MetroList: el mapa va rotulado como proyecto futuro en el mapa, en el texto y en la voz, con su atribución", () => {
  const { arbol, voz } = listado()
  const visible = texto(arbol)

  const [mapa, ...otros] = nodos(arbol, (n) => n.props?.overlay !== undefined)
  assert.equal(otros.length, 0, "un solo mapa")
  const capa = mapa.props.overlay as Capa
  for (const rotulo of [capa.label, String(mapa.props.label)]) assert.match(rotulo, /proyecto futuro, sin servicio/)
  for (const dato of ["CC BY 4.0", "EMB", "2022", "simplificado"]) assert.ok(capa.attribution.includes(dato), `${dato} en «${capa.attribution}»`)

  // Texto y voz dicen lo mismo; la atribución completa queda visible junto al mapa.
  assert.ok(visible.includes(cartografia.TEXTO_MAPA_METRO) && voz[0].includes(cartografia.TEXTO_MAPA_METRO))
  assert.match(cartografia.TEXTO_MAPA_METRO, /proyecto futuro, sin servicio.*no es una entrada ni indica transbordos/)
  assert.ok(visible.includes(cartografia.ATRIBUCION_MAPA_METRO))
  assert.ok(Object.values(metro.FUENTES_METRO).some((f) => f.url === PROCEDENCIA_MAPA_METRO.trazado.catalogo), "la ficha del trazado está entre las fuentes enlazadas")

  // Leaflet recibe [latitud, longitud]: el orden se invierte en un solo lugar.
  assert.equal(capa.lines.length, 1)
  assert.deepEqual([...capa.lines[0][0]], [CARTOGRAFIA_METRO.trazado[0][1], CARTOGRAFIA_METRO.trazado[0][0]])
  for (const [lat, lon] of [...capa.lines[0], ...capa.polygons.flatMap((p) => p.ring)]) assert.ok(lat > 4 && lat < 5 && lon < -74 && lon > -75, `[${lat}, ${lon}]`)

  // Huellas, no accesos: 16 polígonos con su número, su nombre del catálogo y el aviso.
  assert.equal(capa.polygons.length, 16)
  for (const [i, e] of metro.ESTACIONES_METRO_L1.entries()) {
    assert.equal(capa.polygons[i].label, `${e.idOficial} · ${metro.nombreEstacion(e)}: huella ilustrativa del proyecto; no es una entrada`)
  }
  assert.ok(!("markers" in mapa.props) && !("lines" in mapa.props), "sin marcadores de estación ni rutas en servicio")
})

test("MetroList: el aviso de cada huella también está en el listado, que se recorre con teclado y lector de pantalla", () => {
  const estaciones = nodos(listado().arbol, (n) => n.type === "details").slice(0, 16)
  assert.equal(estaciones.length, 16, "el listado sigue completo")
  for (const estacion of estaciones) assert.ok(texto(estacion).includes("En el mapa: huella ilustrativa del proyecto; no es una entrada."), texto(estacion).slice(0, 40))
})

test("MetroList: una huella sin estación en el catálogo se dice con claridad", () => {
  const sinE16 = { ...metro, ESTACIONES_METRO_L1: metro.ESTACIONES_METRO_L1.slice(0, 15) }
  assert.throws(() => listado({ "@/lib/metro": sinE16 }), /La huella E16 del mapa no corresponde a ninguna estación del catálogo del Metro/)
})

// --- Mapa compartido -----------------------------------------------------------

/** Leaflet falso: anota lo que se dibuja. */
function leafletFalso() {
  type Dibujo = { tipo: string; puntos: unknown; opciones: Record<string, unknown>; rotulo?: unknown; rotuloOpciones?: Record<string, unknown> }
  const dibujos: Dibujo[] = []
  const capa = (tipo: string) => (puntos: unknown, opciones: Record<string, unknown> = {}) => {
    const dibujo: Dibujo = { tipo, puntos, opciones }
    dibujos.push(dibujo)
    const yo = { bindTooltip: (rotulo: unknown, o?: Record<string, unknown>) => ((dibujo.rotulo = rotulo), (dibujo.rotuloOpciones = o), yo), addTo: () => yo }
    return yo
  }
  const mapa = { setView: () => mapa, fitBounds: () => mapa, remove() {} }
  const grupo = { addTo: () => grupo, clearLayers: () => void (dibujos.length = 0) }
  return { dibujos, L: { map: () => mapa, tileLayer: () => grupo, layerGroup: () => grupo, polyline: capa("polyline"), polygon: capa("polygon"), circleMarker: capa("circleMarker") } }
}

/**
 * Monta el mapa con el Leaflet falso, o con el `leaflet` que se pase. `redibujar`
 * repite el efecto que corre cuando cambian las propiedades y `renderizar`
 * vuelve a pintar con el estado que haya quedado.
 */
async function dibujar(props: object, leaflet?: () => unknown) {
  const falso = leafletFalso()
  const efectos: (() => void)[] = []
  let refs = 0
  let estado: unknown
  const react = {
    // La primera referencia es el contenedor: React la llenaría al montar.
    useRef: (v: unknown) => ({ current: refs++ === 0 ? {} : v }),
    useEffect: (f: () => void) => void (efectos.push(f), f()),
    useState: (inicial: unknown) => [estado ?? inicial, (nuevo: unknown) => void (estado = nuevo)],
  }
  const modulos = { "leaflet/dist/leaflet.css": {}, react, get leaflet() { return leaflet ? leaflet() : falso.L } }
  const { TransitMap } = compilar("components/transit-map.tsx", modulos, { getComputedStyle: () => ({ getPropertyValue: () => "" }) })
  const renderizar = () => TransitMap({ label: "Mapa", ...props })
  const arbol = renderizar()
  await new Promise((listo) => setImmediate(listo))
  return { ...falso, arbol, renderizar, redibujar: () => efectos[1]() }
}

const ruta: [number, number][] = [[4.6, -74.1], [4.62, -74.08]]
const capaDePrueba = (cambios: Partial<Capa> = {}): Capa => ({
  label: "Proyecto futuro",
  attribution: "Fuente, CC BY 4.0",
  lines: [ruta, [[4.62, -74.08], [4.63, -74.07]]],
  polygons: [{ ring: [[4.6, -74.1], [4.6, -74.09], [4.61, -74.09], [4.6, -74.1]], label: "E01: huella" }],
  ...cambios,
})
const esMapa = (n: { props: Record<string, unknown> }) => n.props?.role === "region"

test("TransitMap: la capa ilustrativa lleva un solo rótulo fijo, atribución y un trazo distinto al de una ruta", async () => {
  const overlay = capaDePrueba()
  const { arbol, dibujos } = await dibujar({ overlay, lines: [{ path: ruta }, { path: ruta, secondary: true }] })

  // El rótulo es texto del marco del mapa: una vez, sin depender del cursor, del zoom ni de que haya trazo.
  assert.deepEqual(nodos(arbol, (n) => n.type === "p").map(texto), [overlay.label])
  assert.equal(nodos(arbol, esMapa).length, 1)

  // Dos trazos de la capa son una sola pieza: una atribución, no dos.
  const [proyecto, principal, secundaria, ...sobran] = dibujos.filter((d) => d.tipo === "polyline")
  assert.equal(sobran.length, 0)
  assert.equal((proyecto.puntos as unknown[]).length, 2, "las dos líneas de la capa van en un solo trazo")
  assert.equal(proyecto.opciones.attribution, overlay.attribution)
  assert.equal(proyecto.rotulo, overlay.label, "al tocar el trazo también dice qué es")
  assert.ok(proyecto.opciones.dashArray && proyecto.opciones.dashArray !== secundaria.opciones.dashArray && principal.opciones.dashArray === undefined)
  assert.ok(Number(proyecto.opciones.weight) < Number(principal.opciones.weight))
  assert.ok(principal.opciones.attribution === undefined && principal.rotulo === undefined, "las rutas en servicio no heredan el rótulo")

  const [huella] = dibujos.filter((d) => d.tipo === "polygon")
  assert.equal(huella.rotulo, "E01: huella")
  assert.equal(huella.opciones.attribution, overlay.attribution)
  assert.equal(dibujos.filter((d) => d.tipo === "circleMarker").length, 0, "una huella no se dibuja como marcador de estación")
})

test("TransitMap: sin líneas, la capa conserva su rótulo y su atribución", async () => {
  const overlay = capaDePrueba({ lines: [] })
  const { arbol, dibujos } = await dibujar({ overlay })
  assert.deepEqual(dibujos.map((d) => [d.tipo, d.opciones.attribution]), [["polygon", overlay.attribution]])
  assert.ok(texto(arbol).includes(overlay.label))
})

test("TransitMap: al redibujar no apila otro trazo", async () => {
  const { dibujos, redibujar } = await dibujar({ overlay: capaDePrueba() })
  redibujar()
  assert.deepEqual(dibujos.map((d) => d.tipo), ["polyline", "polygon"])
})

test("TransitMap: sin capa ilustrativa es el mismo mapa de antes, sin rótulo", async () => {
  const { arbol, dibujos } = await dibujar({ lines: [{ path: ruta }], markers: [{ lat: 4.6, lng: -74.1, label: "Estación", kind: "station" }] })
  assert.deepEqual(dibujos.map((d) => d.tipo), ["polyline", "circleMarker"])
  assert.ok(esMapa(arbol) && texto(arbol) === "", "la raíz sigue siendo el contenedor del mapa, vacío")
  assert.doesNotMatch(String(arbol.props.className), /rounded-t-none/)
})

test("TransitMap: si Leaflet no carga lo dice a la vista, en vez de dejar un recuadro vacío", async () => {
  const sinLeaflet = () => {
    throw new Error("sin red")
  }
  for (const props of [{ overlay: capaDePrueba() }, { lines: [{ path: ruta }] }]) {
    const { arbol, renderizar, dibujos } = await dibujar(props, sinLeaflet)
    assert.equal(nodos(arbol, (n) => n.props?.role === "status").length, 0, "antes de fallar no hay aviso")
    const [aviso, ...otros] = nodos(renderizar(), (n) => n.props?.role === "status")
    assert.equal(otros.length, 0)
    assert.equal(texto(aviso), "El mapa no cargó; el listado tiene lo mismo.")
    assert.equal(dibujos.length, 0)
  }
})

test("TransitMap: cuando Leaflet carga no hay aviso de fallo", async () => {
  const { renderizar } = await dibujar({ overlay: capaDePrueba() })
  assert.equal(nodos(renderizar(), (n) => n.props?.role === "status").length, 0)
})

test("TransitMap: omitir líneas y marcadores no cambia las dependencias del redibujo entre renders", () => {
  const dependencias: unknown[][] = []
  const { TransitMap } = compilar(
    "components/transit-map.tsx",
    {
      "leaflet/dist/leaflet.css": {},
      react: { useRef: (v: unknown) => ({ current: v }), useState: (v: unknown) => [v, () => {}], useEffect: (_f: unknown, d: unknown[]) => void (d.length && dependencias.push(d)) },
    },
  )
  TransitMap({ label: "Mapa" })
  TransitMap({ label: "Mapa" })
  const [primero, segundo] = dependencias
  assert.equal(primero.length, 3)
  primero.forEach((valor, i) => assert.ok(valor === segundo[i], "un arreglo nuevo en cada render redibujaría y reencuadraría el mapa"))
})
