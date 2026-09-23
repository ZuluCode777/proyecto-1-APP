"use client"

import { useEffect, useRef, type ReactNode } from "react"

type ModalProps = {
  open: boolean
  onClose: () => void
  label: string
  className?: string
  children: ReactNode
}

/**
 * Diálogo modal nativo. `showModal()` deja el resto de la página inerte,
 * atrapa el foco dentro del diálogo y cierra con Escape, sin código propio.
 */
export function Modal({ open, onClose, label, className = "", children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className={`fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-background/95 p-0 text-foreground backdrop:bg-black/60 ${className}`}
    >
      {open && children}
    </dialog>
  )
}
