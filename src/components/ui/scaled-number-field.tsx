import { useState } from "react"
import { TextField, type TextFieldProps } from "./text-field"
import { formatNumberInput, parseAmountInput, parseScaledDecimal } from "@/lib/format"

export function MoneyField({ value, onChange, ...props }: Omit<TextFieldProps, "value" | "onChange" | "type"> & { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<{ value: number; text: string } | null>(null)
  const text = draft && Object.is(draft.value, value) ? draft.text : Number.isFinite(value) ? formatNumberInput(value) : ""
  return <TextField {...props} type="amount" value={text} error={props.error ?? (!Number.isSafeInteger(value) ? "Masukkan nominal rupiah utuh yang valid." : undefined)} onChange={(text) => {
    const parsed = parseAmountInput(text)
    setDraft({ value: parsed, text })
    onChange(parsed)
  }} />
}

/** Keep partial decimal edits ("1," / "1,0") while storing exact integers. */
export function ScaledNumberField({ value, onChange, digits, ...props }: Omit<TextFieldProps, "value" | "onChange" | "type"> & { value: number; onChange: (value: number) => void; digits: number }) {
  const [draft, setDraft] = useState<{ value: number; text: string } | null>(null)
  const text = draft && Object.is(draft.value, value) ? draft.text : Number.isFinite(value) ? String(value / 10 ** digits).replace(".", ",") : ""
  return <TextField {...props} type="decimal" value={text} error={props.error ?? (!Number.isSafeInteger(value) ? `Masukkan angka dengan maksimal ${digits} angka desimal.` : undefined)} onChange={(text) => {
    const parsed = parseScaledDecimal(text, digits)
    setDraft({ value: parsed, text })
    onChange(parsed)
  }} />
}
