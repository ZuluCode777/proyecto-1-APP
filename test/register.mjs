// Permite que `node --test` cargue el código de la app tal como lo escribe
// Next.js: con el alias `@/` y sin extensión en los imports relativos.
import { register } from "node:module"

register("./resolve.mjs", import.meta.url)
