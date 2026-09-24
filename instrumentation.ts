/**
 * Se ejecuta una vez al arrancar el servidor. Avisa si la app queda sin clave
 * y, si hay un modelo de Ollama configurado, lo carga en memoria para que la
 * primera pregunta no espere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NODE_ENV === "production" && !process.env.APP_PASSWORD) {
    console.warn("APP_PASSWORD está vacía: la app no pide clave. No la publiques con Tailscale Funnel así.")
  }
  if (!process.env.OLLAMA_MODEL) return
  const { warmUpOllama } = await import("@/lib/ollama")
  void warmUpOllama()
}
