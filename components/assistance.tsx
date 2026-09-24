"use client"

import { useEffect } from "react"
import { PhoneCall, ShieldAlert } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"
import { ScreenHeader } from "@/components/screen-header"

type AssistanceProps = {
  onBack: () => void
}

const contacts = [
  { label: "Línea de emergencias", number: "123" },
  { label: "Policía de TransMilenio", number: "156" },
  { label: "Atención al usuario TransMilenio", number: "195" },
]

export function Assistance({ onBack }: AssistanceProps) {
  const { speak } = useSpeech()

  useEffect(() => {
    speak("Emergencia. Toca el botón rojo para llamar a la línea 123.", { queue: true })
  }, [speak])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Asistencia y emergencias">
      <ScreenHeader title="Emergencia" subtitle="Llamadas de ayuda" icon={ShieldAlert} onBack={onBack} />

      <a
        href="tel:123"
        onFocus={() => speak("Botón de emergencia. Llama al 123.")}
        className="flex flex-col items-center gap-3 rounded-3xl border-5 border-sos-border bg-sos p-6 text-center text-sos-foreground"
      >
        <span className="flex size-16 items-center justify-center rounded-full border-3 border-current">
          <PhoneCall className="size-9" aria-hidden="true" />
        </span>
        <span className="text-2xl font-bold">Llamar al 123</span>
        <span className="text-xl">Emergencias</span>
      </a>

      <h3 className="mb-3 mt-6 text-xl font-bold">Otras líneas</h3>
      <ul className="flex flex-col gap-3">
        {contacts.slice(1).map((contact) => (
          <li key={contact.number}>
            <a
              href={`tel:${contact.number}`}
              onFocus={() => speak(`${contact.label}. Número ${contact.number}.`)}
              className="flex items-center gap-3 rounded-2xl border-3 border-border bg-card p-4 shadow-sm transition active:scale-[0.99]"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                <PhoneCall className="size-5" aria-hidden="true" />
              </span>
              <span className="flex-1 text-lg font-semibold">{contact.label}</span>
              <span className="text-lg font-bold tabular-nums">{contact.number}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
