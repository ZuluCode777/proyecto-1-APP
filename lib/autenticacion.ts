import { estaAutorizado } from "@/lib/access"

/**
 * Política de acceso del `proxy` (HTTP Basic) para EA-10 (#36).
 *
 * `lib/access.ts` resuelve solo la pregunta criptográfica «¿esta credencial
 * coincide con la clave?» y, por contrato histórico, deja pasar todo cuando NO
 * hay clave (desarrollo local e integración continua corren sin secreto). Ese
 * contrato se conserva intacto.
 *
 * Lo que este módulo añade es la DECISIÓN de servicio alrededor de esa pregunta:
 * en producción, una `APP_PASSWORD` ausente, vacía o solo con espacios NO debe
 * dejar la app abierta por descuido (hallazgo de EA-10). En ese caso se falla
 * cerrado (`cerrado-sin-clave`) en vez de servir sin pedir nada. Fuera de
 * producción se conserva el desarrollo local explícito sin secreto.
 *
 * El secreto solo vive en el entorno: este módulo no lo registra, no lo expone
 * en las respuestas ni lo compara fuera de `estaAutorizado` (comparación en
 * tiempo constante). El motivo de un `cerrado-sin-clave` se comunica sin revelar
 * si había o no clave configurada.
 */

/** Entorno de ejecución relevante para la política de acceso. */
export type EntornoAcceso = "produccion" | "desarrollo"

/**
 * Decisión de acceso, como unión discriminada por `kind` para que la pantalla
 * (el `proxy`) no pueda confundir «falta clave» con «clave incorrecta».
 *
 * - `permitido`: la petición sigue (había clave válida, o no se exige clave en
 *   desarrollo).
 * - `clave-requerida`: hay secreto configurado y la credencial falta o no
 *   coincide → 401 con `WWW-Authenticate`.
 * - `cerrado-sin-clave`: producción sin secreto utilizable → 503, la app NO se
 *   expone sin clave. Reversión segura: suspende la exposición hasta configurar
 *   el secreto.
 */
export type DecisionAcceso =
  | { kind: "permitido" }
  | { kind: "clave-requerida" }
  | { kind: "cerrado-sin-clave" }

/**
 * ¿La `APP_PASSWORD` del entorno es un secreto utilizable? Una variable ausente,
 * vacía o compuesta solo de espacios NO lo es: se trata como «sin clave». Un
 * valor con contenido real se considera configurado y se compara TAL CUAL en
 * `estaAutorizado` (no se recorta), para no alterar inadvertidamente una clave
 * válida que incluya espacios al principio o al final.
 */
export function claveUtilizable(clave: string | undefined): boolean {
  return clave !== undefined && clave.trim() !== ""
}

/**
 * Resuelve la política de acceso de una petición.
 *
 * `entorno` se inyecta para poder probar producción y desarrollo sin tocar
 * variables globales. En producción, sin clave utilizable se devuelve
 * `cerrado-sin-clave` (fallar cerrado); en desarrollo, sin clave utilizable se
 * permite (desarrollo local e integración continua). Con clave utilizable, la
 * credencial debe coincidir en ambos entornos.
 */
export function decidirAcceso({
  autorizacion,
  clave,
  entorno,
}: {
  autorizacion: string | null
  clave: string | undefined
  entorno: EntornoAcceso
}): DecisionAcceso {
  if (!claveUtilizable(clave)) {
    return entorno === "produccion" ? { kind: "cerrado-sin-clave" } : { kind: "permitido" }
  }
  return estaAutorizado(autorizacion, clave) ? { kind: "permitido" } : { kind: "clave-requerida" }
}

/**
 * Decide el acceso leyendo el entorno real (`NODE_ENV` y `APP_PASSWORD`) una
 * sola vez. Es la MISMA guardia que comparten el `proxy` (toda la app/UI) y el
 * manejador de `/api/agent` (GET y POST): la API se excluye del `proxy` para que
 * Next no clone ni almacene su cuerpo (ver EA-10 #36, hallazgo del límite de
 * ingreso), así que debe aplicar aquí la misma protección para no abrir un hueco
 * de autenticación. El secreto no se registra ni se devuelve en las respuestas.
 */
export function decidirAccesoDeEntorno({ autorizacion }: { autorizacion: string | null }): DecisionAcceso {
  const entorno: EntornoAcceso = process.env.NODE_ENV === "production" ? "produccion" : "desarrollo"
  return decidirAcceso({ autorizacion, clave: process.env.APP_PASSWORD, entorno })
}

/**
 * Forma serializable de una respuesta de acceso DENEGADO (401 o 503), para que
 * el `proxy` (que devuelve `NextResponse`) y el manejador de la API (que
 * devuelve `Response`) construyan EXACTAMENTE la misma respuesta sin divergir.
 * Un `permitido` no produce respuesta aquí (cada llamador continúa a su modo).
 */
export type RespuestaAccesoDenegado = {
  estado: 401 | 503
  cuerpo: string
  cabeceras?: Record<string, string>
}

/**
 * Traduce una decisión de acceso denegado a su respuesta. Separar la decisión de
 * su representación evita que proxy y API escriban mensajes o cabeceras
 * distintos para el mismo caso.
 */
export function respuestaDeDecision(decision: Exclude<DecisionAcceso, { kind: "permitido" }>): RespuestaAccesoDenegado {
  switch (decision.kind) {
    case "clave-requerida":
      return {
        estado: 401,
        cuerpo: "Hace falta la clave de TransMiVoz.",
        cabeceras: { "WWW-Authenticate": 'Basic realm="TransMiVoz", charset="UTF-8"' },
      }
    case "cerrado-sin-clave":
      return { estado: 503, cuerpo: "TransMiVoz no está disponible: falta configurar la clave de acceso." }
    default: {
      const _exhaustivo: never = decision
      return _exhaustivo
    }
  }
}
