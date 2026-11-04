import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { setImmediate as turno } from "node:timers/promises"
import { pathToFileURL } from "node:url"

/**
 * Regresión del issue #32 (frontera HTTP del servidor): `getTransmilenioData`
 * mantiene el último catálogo válido y no lo reemplaza por una respuesta caída
 * o incompleta. Se prueba con el `getTransmilenioData` REAL, mockeando
 * `globalThis.fetch` y `Date.now` —sin exports solo para pruebas— y cargando el
 * módulo fresco por import dinámico con una query distinta en cada caso, para
 * reiniciar su caché de módulo.
 */

const raiz = pathToFileURL(process.cwd() + "/")

const estaciones = {
  features: [
    { attributes: { num_est: "1", nom_est: "Norte" }, geometry: { x: -74.05, y: 4.7 } },
    { attributes: { num_est: "2", nom_est: "Centro" }, geometry: { x: -74.05, y: 4.65 } },
  ],
}
const ruta = (codigo: string) => ({
  attributes: { cod_ruta: codigo, orig_ruta: "Centro", dest_ruta: "Norte", hor_habil: "5-22" },
  geometry: { paths: [[[-74.05, 4.64], [-74.05, 4.71]]] },
})

/** Carga una instancia FRESCA del módulo (caché de módulo reiniciada). */
async function cargarModulo(etiqueta: string) {
  return import(new URL(`lib/transmilenio-data.ts?caso=${etiqueta}`, raiz).href)
}

test("sirve el catálogo en vivo y comparte una sola consulta pendiente", async () => {
  let consultas = 0
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    consultas++
    const rutas = { features: [ruta("X1"), ruta("X2")] }
    return Response.json(String(url).includes("/2/query") ? estaciones : rutas)
  })
  try {
    const { getTransmilenioData } = await cargarModulo("vivo-pendiente")
    const [a, b, c] = await Promise.all([getTransmilenioData(), getTransmilenioData(), getTransmilenioData()])
    assert.equal(a.routes.length, 2)
    assert.equal(a.source, "live")
    assert.equal(a, b)
    assert.equal(b, c)
    assert.equal(consultas, 2, "una sola ronda de consultas (capa 2 y 15) se comparte")
  } finally {
    fetchMock.mock.restore()
  }
})

test("una respuesta incompleta posterior NO reemplaza el catálogo válido", async () => {
  let incompleto = false
  let consultas = 0
  let ahora = 1_800_000_000_000
  const dateMock = mock.method(Date, "now", () => ahora)
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    consultas++
    // Un registro de ruta sin geometría: respuesta mutilada que debe rechazarse.
    const rutas = { features: incompleto ? [ruta("X1"), { attributes: { cod_ruta: "X2" } }] : [ruta("X1"), ruta("X2")] }
    return Response.json(String(url).includes("/2/query") ? estaciones : rutas)
  })
  try {
    const { getTransmilenioData } = await cargarModulo("incompleta")
    const bueno = await getTransmilenioData()
    assert.equal(bueno.routes.length, 2)

    // Expira y el servicio empieza a responder incompleto: debe seguir sirviendo
    // el catálogo bueno (stale-while-revalidate), nunca uno mutilado.
    ahora += 6 * 60 * 60 * 1000 + 1
    incompleto = true
    assert.equal(await getTransmilenioData(), bueno, "devuelve el dato bueno al instante")
    for (let i = 0; i < 8; i++) await turno()
    const posterior = await getTransmilenioData()
    assert.equal(posterior.routes.length, 2, "la respuesta incompleta no reemplazó el catálogo válido")
    assert.deepEqual(posterior.routes.map((r: { code: string }) => r.code), ["X1", "X2"])
  } finally {
    fetchMock.mock.restore()
    dateMock.mock.restore()
  }
})

test("en el arranque sin red usa la copia guardada, y al recuperarse vuelve a vivo", async () => {
  let caido = true
  let ahora = 1_800_000_000_000
  const dateMock = mock.method(Date, "now", () => ahora)
  const fetchMock = mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (caido) throw new Error("sin red")
    const rutas = { features: [ruta("X1"), ruta("X2")] }
    return Response.json(String(url).includes("/2/query") ? estaciones : rutas)
  })
  try {
    const { getTransmilenioData } = await cargarModulo("arranque-sin-red")
    const arranque = await getTransmilenioData()
    assert.equal(arranque.source, "snapshot", "sin catálogo previo y sin red, usa la copia")
    assert.ok(arranque.routes.length > 0)

    // El servicio vuelve; al expirar, la renovación en segundo plano trae vivo.
    caido = false
    ahora += 6 * 60 * 60 * 1000 + 1
    await getTransmilenioData() // dispara renovación de fondo
    for (let i = 0; i < 8; i++) await turno()
    const renovado = await getTransmilenioData()
    assert.equal(renovado.source, "live")
    assert.equal(renovado.routes.length, 2)
  } finally {
    fetchMock.mock.restore()
    dateMock.mock.restore()
  }
})
