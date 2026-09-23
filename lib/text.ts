/**
 * Normaliza texto hablado o escrito para compararlo: minúsculas, sin tildes,
 * sin puntuación, con las abreviaturas de las direcciones de Bogotá
 * expandidas ("AV." → "avenida", "CL" → "calle", "KR" → "carrera").
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,;:¿?¡!()"'«»–—\-_/]/g, " ")
    .replace(/\bav\b/g, "avenida")
    .replace(/\b(cl|cll)\b/g, "calle")
    .replace(/\b(kr|cra)\b/g, "carrera")
    .replace(/\btv\b/g, "transversal")
    .replace(/eldorado/g, "el dorado")
    .replace(/\s+/g, " ")
    .trim()
}

/** Palabras que no ayudan a identificar una estación o una ruta. */
const FILLER = new Set(
  "a al como cual cuales de del desde donde el en es esta estacion estaciones hacia hasta ir la las llego llegar llevame lo los me mi mis para por que quiero quisiera ruta rutas se sirve tomo tomar un una voy y ya buscar busca busco necesito puedo".split(
    " ",
  ),
)

/** Palabras con contenido, sin relleno. */
export function contentWords(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !FILLER.has(word))
}
