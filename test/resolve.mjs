import { statSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)

const isFile = (url) => {
  try {
    return statSync(fileURLToPath(url)).isFile()
  } catch {
    return false
  }
}

/** Prueba `x`, `x.ts`, `x.tsx` y `x/index.ts`, en ese orden. */
function withExtension(url) {
  for (const suffix of ["", ".ts", ".tsx", "/index.ts"]) {
    const candidate = new URL(url.href + suffix)
    if (isFile(candidate)) return candidate.href
  }
  return null
}

export async function resolve(specifier, context, next) {
  let target = null
  if (specifier.startsWith("@/")) {
    target = withExtension(new URL(specifier.slice(2), root))
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    target = withExtension(new URL(specifier, context.parentURL))
  }
  return next(target ?? specifier, context)
}
