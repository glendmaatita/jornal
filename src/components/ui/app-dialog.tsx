import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Info, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DialogContext,
  type AlertDialogOptions,
  type ConfirmDialogOptions,
  type DialogApi,
  type PromptDialogOptions,
} from "@/components/ui/app-dialog-context"
import { cn } from "@/lib/utils"

type DialogRequest =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & ConfirmDialogOptions)
  | ({ kind: "alert"; resolve: () => void } & AlertDialogOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptDialogOptions)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = useState("")
  const requestRef = useRef<DialogRequest | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  const dismissCurrent = useCallback(() => {
    const current = requestRef.current
    if (!current) return
    requestRef.current = null
    setRequest(null)
    if (current.kind === "alert") current.resolve()
    else if (current.kind === "prompt") current.resolve(null)
    else current.resolve(false)
  }, [])

  const completeCurrent = useCallback(() => {
    const current = requestRef.current
    if (!current) return
    if (current.kind === "prompt" && current.requiredValue !== undefined && inputValue !== current.requiredValue) return
    requestRef.current = null
    setRequest(null)
    if (current.kind === "alert") current.resolve()
    else if (current.kind === "prompt") current.resolve(inputValue)
    else current.resolve(true)
  }, [inputValue])

  const open = useCallback((next: DialogRequest) => {
    const current = requestRef.current
    if (current) {
      if (current.kind === "alert") current.resolve()
      else if (current.kind === "prompt") current.resolve(null)
      else current.resolve(false)
    }
    requestRef.current = next
    setInputValue("")
    setRequest(next)
  }, [])

  const api = useMemo<DialogApi>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => open({ ...options, kind: "confirm", resolve })),
    alert: (options) => new Promise<void>((resolve) => open({ ...options, kind: "alert", resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => open({ ...options, kind: "prompt", resolve })),
  }), [open])

  useEffect(() => {
    if (!request) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const frame = window.requestAnimationFrame(() => {
      if (request.kind === "prompt") inputRef.current?.focus()
      else if (request.kind === "alert") confirmRef.current?.focus()
      else cancelRef.current?.focus()
    })
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        dismissCurrent()
        return
      }
      if (event.key !== "Tab") return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [dismissCurrent, request])

  const tone = request?.tone ?? "default"
  const isPromptValid = request?.kind !== "prompt" || request.requiredValue === undefined || inputValue === request.requiredValue
  const Icon = tone === "destructive" ? ShieldAlert : request?.kind === "alert" ? Info : AlertTriangle

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="presentation">
          <button type="button" className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" aria-label="Tutup dialog" onClick={dismissCurrent} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative w-full max-w-md rounded-2xl border border-white/70 bg-white p-5 shadow-[0_24px_80px_rgb(15_23_42/0.3)] sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone === "destructive" ? "bg-red-50 text-destructive" : "bg-[#f1f5fd] text-[#16579d]")}>
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-lg font-bold tracking-tight">{request.title}</h2>
                <p id={descriptionId} className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{request.description}</p>
              </div>
            </div>

            {request.kind === "prompt" && (
              <label className="mt-5 block">
                <span className="mb-1.5 block text-sm font-semibold">{request.inputLabel}</span>
                <input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && isPromptValid) { event.preventDefault(); completeCurrent() } }}
                  placeholder={request.placeholder}
                  autoComplete="off"
                  className="h-11 w-full rounded-[10px] border border-border bg-white px-3 text-sm outline-none transition focus:border-[#16579d] focus:ring-2 focus:ring-[#16579d]/15"
                />
                {request.requiredValue !== undefined && (
                  <span className="mt-1.5 block text-xs text-muted-foreground">Ketik persis: <strong className="text-foreground">{request.requiredValue}</strong></span>
                )}
              </label>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {request.kind !== "alert" && (
                <Button ref={cancelRef} variant="outline" onClick={dismissCurrent} className="sm:min-w-24">
                  {request.cancelLabel ?? "Batal"}
                </Button>
              )}
              <Button
                ref={confirmRef}
                variant={tone === "destructive" ? "destructive" : "default"}
                disabled={!isPromptValid}
                onClick={completeCurrent}
                className="sm:min-w-24"
              >
                {request.confirmLabel ?? (request.kind === "alert" ? "Mengerti" : "Lanjutkan")}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </DialogContext.Provider>
  )
}
