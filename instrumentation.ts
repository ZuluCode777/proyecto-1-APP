/**
 * Se ejecuta una vez al arrancar el servidor. Si hay un modelo de Ollama
 * configurado, lo carga en memoria para que la primera pregunta no espere.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.OLLAMA_MODEL) return
  const { warmUpOllama } = await import("@/lib/ollama")
  void warmUpOllama()
}
