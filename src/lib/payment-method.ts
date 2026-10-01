const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: "Transfer bank",
  CASH: "Tunai",
  OTHER: "Lainnya",
}

export function paymentMethodLabel(value: string) {
  const method = value.trim()
  if (PAYMENT_METHOD_LABELS[method]) return PAYMENT_METHOD_LABELS[method]
  if (/^[A-Z][A-Z0-9_]*$/.test(method) && method.includes("_")) {
    const words = method.toLowerCase().replaceAll("_", " ")
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return method
}
