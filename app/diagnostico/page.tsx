import type { Metadata } from "next"
import { Diagnostics } from "@/components/diagnostics"

export const metadata: Metadata = {
  title: "Diagnóstico — TransMiVoz",
  description: "Comprueba en vivo que cada función de TransMiVoz responde en este navegador.",
}

export default function DiagnosticoPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <Diagnostics />
    </main>
  )
}
