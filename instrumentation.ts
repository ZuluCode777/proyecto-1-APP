/**
 * Se ejecuta una vez al arrancar el servidor. Avisa si la app queda sin clave
 * en producción y, si hay un modelo de Ollama configurado, lo carga en memoria
 * para que la primera pregunta no espere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NODE_ENV === "production") {
    // EA-10 (#36): sin clave utilizable (ausente, vacía o solo espacios) la app
    // NO se expone; el `proxy` responde 503 en vez de abrir. El aviso lo deja
    // claro en el arranque. `claveUtilizable` no registra el valor del secreto.
    const { claveUtilizable } = await import("@/lib/autenticacion")
    if (!claveUtilizable(process.env.APP_PASSWORD)) {
      console.warn(
        "APP_PASSWORD no está configurada: la app responderá 503 y no se publicará sin clave. Configura el secreto en el entorno antes de exponerla.",
      )
    }
  }
  if (!process.env.OLLAMA_MODEL) return
  const { warmUpOllama } = await import("@/lib/ollama")
  void warmUpOllama()
}
