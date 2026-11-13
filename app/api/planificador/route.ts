import {
  LIMITE_CONSULTA,
  LIMITE_PLANEAR,
  MAXIMO_BYTES_CUERPO,
  PeticionPlanificadorSchema,
  VENTANA_LIMITE_MS,
  resolverPeticion,
} from "@/lib/contrato-planificador"
import { leerCuerpoLimitado } from "@/lib/cuerpo-peticion"
import { claveCliente } from "@/lib/identidad-cliente"
import { createRateLimiter } from "@/lib/rate-limit"
import { getTransmilenioData } from "@/lib/transmilenio-data"

/**
 * Entrada estructurada del planificador para el iPhone (EA-25, #51): buscar rutas,
 * detalle de una ruta, lugares y viaje entre dos lugares elegidos. Contrato y
 * decisiones en `lib/contrato-planificador.ts`; aquí solo se lee, valida y responde.
 *
 * Pasa por el `proxy` (HTTP Basic), como `/api/transmilenio`. Detrás del `proxy` Next
 * almacena el cuerpo entero antes de llamar al manejador (ver `docs/expoandes/ea-10-recursos-autenticacion.md`):
 * la cota de 1.000 bytes se aplica después de esa carga y limita lo que se procesa, no lo que se recibe.
 *
 * Límite de peticiones propio, con dos cubos que no comparten cuota con `/api/agent`: planear un viaje busca
 * pares de rutas (decenas de milisegundos de CPU síncrona) y tiene el límite estricto; las otras operaciones
 * cuestan menos de 1 ms. `claveCliente()` es una sola clave para todos, así que son techos globales.
 */
const limitePlanear = createRateLimiter({ limit: LIMITE_PLANEAR, windowMs: VENTANA_LIMITE_MS })
const limiteConsulta = createRateLimiter({ limit: LIMITE_CONSULTA, windowMs: VENTANA_LIMITE_MS })

export async function POST(req: Request) {
  const cuerpo = await leerCuerpoLimitado({ cuerpo: req.body, maximoBytes: MAXIMO_BYTES_CUERPO })
  if (cuerpo.kind === "excedido") return Response.json({ error: "cuerpo-demasiado-grande" }, { status: 413 })
  if (cuerpo.kind === "error") return Response.json({ error: "peticion-ilegible" }, { status: 400 })

  let json: unknown
  try {
    json = JSON.parse(cuerpo.texto)
  } catch {
    return Response.json({ error: "peticion-invalida" }, { status: 400 })
  }
  const peticion = PeticionPlanificadorSchema.safeParse(json)
  if (!peticion.success) return Response.json({ error: "peticion-invalida" }, { status: 400 })

  // Después de validar, para elegir el cubo por operación; antes de planificar, que es lo caro.
  const limite = peticion.data.operacion === "planear-viaje" ? limitePlanear : limiteConsulta
  const { allowed, retryAfterSeconds } = limite(claveCliente())
  if (!allowed) {
    return Response.json(
      { error: "demasiadas-peticiones" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    )
  }

  const resolucion = resolverPeticion(peticion.data, await getTransmilenioData(), new Date())
  return Response.json(resolucion.cuerpo, { status: resolucion.estado })
}
