import { createContext, useContext } from "react"

export type DialogTone = "default" | "destructive"

export interface ConfirmDialogOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

export interface AlertDialogOptions {
  title: string
  description: string
  confirmLabel?: string
  tone?: DialogTone
}

export interface PromptDialogOptions extends ConfirmDialogOptions {
  inputLabel: string
  placeholder?: string
  requiredValue?: string
}

export interface DialogApi {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  alert: (options: AlertDialogOptions) => Promise<void>
  prompt: (options: PromptDialogOptions) => Promise<string | null>
}

export const DialogContext = createContext<DialogApi | null>(null)

export function useAppDialog() {
  const value = useContext(DialogContext)
  if (!value) throw new Error("useAppDialog must be used inside DialogProvider")
  return value
}
