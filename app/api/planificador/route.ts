import { MAXIMO_BYTES_CUERPO, PeticionPlanificadorSchema, resolverPeticion } from "@/lib/contrato-planificador"
import { leerCuerpoLimitado } from "@/lib/cuerpo-peticion"
import { getTransmilenioData } from "@/lib/transmilenio-data"

/**
 * Entrada estructurada del planificador para el iPhone (EA-25, #51): buscar rutas,
 * detalle de una ruta, lugares y viaje entre dos lugares elegidos. Contrato y
 * decisiones en `lib/contrato-planificador.ts`; aquí solo se lee, valida y responde.
 *
 * Pasa por el `proxy` (HTTP Basic), como `/api/transmilenio`: el cuerpo es de
 * unos cientos de bytes, así que no necesita la excepción de `/api/agent`. No
 * lleva límite de peticiones propio: no consulta ningún modelo ni servicio externo.
 */
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

  const resolucion = resolverPeticion(peticion.data, await getTransmilenioData(), new Date())
  return Response.json(resolucion.cuerpo, { status: resolucion.estado })
}
