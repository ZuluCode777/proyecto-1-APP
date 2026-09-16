"use client"

import { useEffect } from "react"
import { ArrowLeft, PhoneCall, ShieldAlert } from "lucide-react"
import { useSpeech } from "@/hooks/use-speech"

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
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-2 self-start rounded-xl border-2 border-foreground px-4 py-3 text-base font-bold"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
        Volver
      </button>

      <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
        <ShieldAlert className="size-7 text-brand" aria-hidden="true" />
        Asistencia
      </h2>

      <a
        href="tel:123"
        onFocus={() => speak("Botón de emergencia. Llama al 123.")}
        className="flex flex-col items-center gap-2 rounded-2xl border-4 border-brand bg-brand p-6 text-center text-brand-foreground"
      >
        <PhoneCall className="size-10" aria-hidden="true" />
        <span className="text-2xl font-bold">Llamar al 123</span>
        <span className="text-base">Emergencias — SOS</span>
      </a>

      <ul className="mt-4 flex flex-col gap-3">
        {contacts.slice(1).map((contact) => (
          <li key={contact.number}>
            <a
              href={`tel:${contact.number}`}
              onFocus={() => speak(`${contact.label}. Número ${contact.number}.`)}
              className="flex items-center justify-between rounded-2xl border-2 border-foreground p-4"
            >
              <span className="text-lg font-semibold">{contact.label}</span>
              <span className="flex items-center gap-2 text-lg font-bold">
                <PhoneCall className="size-5" aria-hidden="true" />
                {contact.number}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
