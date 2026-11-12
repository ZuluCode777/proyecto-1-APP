import { normalize } from "@/lib/text"

/**
 * Guardia de seguridad física (EA-27, #53). Regla del equipo: «el modelo nunca
 * decide si es seguro cruzar» y «el asistente no declara el andén libre ni
 * ordena abordar». La app no ve el tráfico, el semáforo, el andén ni el bus, así
 * que una pregunta de PERMISO físico («¿ya puedo cruzar?», «¿puedo subir ya?»)
 * no se responde con una acción: se explica el límite y se manda a una fuente
 * que sí ve (semáforo sonoro, alguien cerca, personal de TransMilenio).
 *
 * Es determinista y no depende del modelo: la resuelven siempre las reglas
 * (ver `soloReglas` en `lib/seleccion-interprete.ts`) y se evalúa ANTES que el
 * Metro, los viajes y el GPS. Solo marca preguntas de permiso o de estado físico
 * del momento; «cómo cruzo a la estación Ricaurte» o «dónde está el puente para
 * cruzar» son de navegación y conservan su intención.
 */

/** Respuesta fija y hablable: ni sí ni no, ni «camino libre», ni ninguna acción. */
export const RESPUESTA_SEGURIDAD_FISICA =
  "No puedo saber si es seguro, porque no veo el tráfico, el semáforo, el andén ni el bus. Usa el semáforo sonoro, o pide ayuda a alguien cerca o al personal de TransMilenio."

/** Hasta dos palabras de relleno entre el disparador y el verbo («puedo ya cruzar»). */
const R = "(?:\\w+ ){0,2}"
const AHORA = "(?: ya| ahora| ahorita| en este momento)?"
const PERMISO = "(?:puedo|podemos|se puede|podria|podriamos|debo|deberia|me animo a)"
const CRUZAR = "(?:cruzar|cruzo|cruzamos|atravesar|pasar la (?:calle|via|avenida|carrera)|pasarme)"
const ACCION_FISICA = "(?:cruzar|pasar|avanzar|seguir|caminar|subir|subirme|bajar|bajarme|entrar|salir|montarme|abordar)"
const VEHICULO = "(?:carro|carros|auto|autos|vehiculo|vehiculos|bus|buses|moto|motos|bicicleta|bicicletas|taxi|taxis|camion|camiones|tractomula)"
const LUGAR = "(?:anden|andenes|puerta|puertas|plataforma|vagon|bus|articulado|acera|camino|paso|cruce|via)"
const LIBRE = "(?:libre|despejad[oa]s?|vacio|vacia|ocupad[oa]s?|abiert[oa]s?|cerrad[oa]s?)"

const PATRONES: RegExp[] = [
  // Cruzar: «¿ya puedo cruzar?», «¿puedo pasar la calle?», «¿es seguro cruzar?», «¿ya cruzo?».
  new RegExp(`\\b${PERMISO}${AHORA} ${R}${CRUZAR}\\b`),
  new RegExp(`\\b(?:es|esta) (?:seguro|segura|peligroso|buen momento)(?: ya| ahora)? ${R}${ACCION_FISICA}\\b`),
  new RegExp(`\\b(?:es|esta) seguro(?: ya| ahora| aqui| ahi| alli)$`),
  /\bhay peligro\b/,
  /^(?:y )?ya (?:cruzo|cruzamos|paso|pasamos|avanzo|avanzamos)$/,
  // Pasar, subir o bajar sin más contexto: «¿puedo pasar?», «¿puedo subir ya?», «¿me subo?».
  new RegExp(`\\b${PERMISO}${AHORA} (?:pasar|subir|subirme|abordar|entrar|bajar|bajarme|montarme|avanzar)${AHORA}$`),
  new RegExp(`\\bya ${PERMISO} (?:pasar|subir|subirme|abordar|entrar|bajar|bajarme|montarme|avanzar)${AHORA}$`),
  new RegExp(`\\b${PERMISO}${AHORA} (?:subir|subirme|abordar|entrar|montarme) (?:al|a la) (?:bus|articulado|vagon|alimentador)\\b`),
  /\b(?:ya )?(?:me subo|nos subimos|me monto|abordo|me bajo)(?: ya| ahora| ahorita)?$/,
  // Semáforo: «¿el semáforo está en verde?», «¿ya cambió el semáforo?».
  /\bsemaforo\b.*\b(?:verde|rojo|amarillo|cambio|cambia|peatonal)\b/,
  /\b(?:verde|rojo|amarillo|cambio|cambia)\b.*\bsemaforo\b/,
  // Vehículos: «¿viene un carro?», «¿viene algún bus?», «¿hay una moto cerca?».
  new RegExp(`\\b(?:viene|vienen|se acerca|se acercan|esta pasando|estan pasando) (?:algun|alguna|algunos|un|una|otro|otra|ningun|ninguna) ${R}${VEHICULO}\\b`),
  new RegExp(`\\bhay (?:algun|alguna|un|una|otro|otra) ${R}${VEHICULO} (?:cerca|viniendo|pasando|acercandose|adelante)\\b`),
  // Andén, puerta y espacio: «¿está libre el andén?», «¿hay espacio?».
  new RegExp(`\\b${LUGAR} ${R}${LIBRE}\\b`),
  new RegExp(`\\b${LIBRE} (?:el |la |los |las )?${R}${LUGAR}\\b`),
  /\bhay (?:espacio|lugar|cupo|campo)(?: \w+){0,3}$/,
  // Obstáculos: «¿hay algo adelante?», «¿hay escalones enfrente?».
  /\bhay (?:algo|alguien|nada|gente|obstaculos?|escalones?|huecos?|un hueco|peligro)(?: \w+){0,2} (?:adelante|enfrente|delante|al frente|en frente|en el camino|por delante)$/,
]

/** ¿La frase pregunta si es seguro o está permitido actuar físicamente AHORA? */
export function esPreguntaSeguridadFisica(texto: string): boolean {
  const t = normalize(texto)
  return t !== "" && PATRONES.some((patron) => patron.test(t))
}
