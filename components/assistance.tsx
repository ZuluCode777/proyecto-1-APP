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
    speak("Asistencia. Toca el botón rojo para llamar a la línea de emergencias 123.")
  }, [speak])

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" aria-label="Asistencia y emergencias">
      <ScreenHeader title="Asistencia" subtitle="Llamadas de emergencia" icon={ShieldAlert} onBack={onBack} />

      <a
        href="tel:123"
        onFocus={() => speak("Botón de emergencia. Llama al 123.")}
        className="flex flex-col items-center gap-3 rounded-3xl border border-brand bg-brand p-6 text-center text-brand-foreground shadow-lg shadow-brand/30 transition active:scale-[0.99]"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-brand-foreground/15">
          <PhoneCall className="size-9" aria-hidden="true" />
        </span>
        <span className="text-2xl font-bold">Llamar al 123</span>
        <span className="text-base text-brand-foreground/80">Emergencias — SOS</span>
      </a>

      <h3 className="mb-3 mt-6 text-base font-bold text-muted-foreground">Otras líneas</h3>
      <ul className="flex flex-col gap-3">
        {contacts.slice(1).map((contact) => (
          <li key={contact.number}>
            <a
              href={`tel:${contact.number}`}
              onFocus={() => speak(`${contact.label}. Número ${contact.number}.`)}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99]"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
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
