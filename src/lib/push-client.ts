import { activeCompany } from "./companies"
import { pb } from "./pb"

function bytes(value: string) { const padding = "=".repeat((4 - value.length % 4) % 4); const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (character) => character.charCodeAt(0)) }
export interface PushPreferences { invoice: boolean; tax: boolean; documents: boolean; hideAmounts: boolean; quietStartHour: number; quietEndHour: number }
export async function enablePushNotifications(preferences: PushPreferences = { invoice: true, tax: true, documents: true, hideAmounts: true, quietStartHour: 21, quietEndHour: 7 }) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push notification tidak didukung browser ini")
  const permission = await Notification.requestPermission(); if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan")
  const config = await pb.send<{ enabled: boolean; publicKey: string }>("/api/jornal/push/config", {}); if (!config.enabled || !config.publicKey) throw new Error("Push notification belum dikonfigurasi server")
  const registration = await navigator.serviceWorker.ready; const existing = await registration.pushManager.getSubscription(); const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(config.publicKey) as BufferSource }); const company = activeCompany(); const json = subscription.toJSON()
  await pb.send("/api/jornal/push/subscriptions", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys, companyIds: company ? [company.id] : [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta", preferences: { invoice: preferences.invoice, tax: preferences.tax, documents: preferences.documents, hideAmounts: preferences.hideAmounts }, quietStartHour: preferences.quietStartHour, quietEndHour: preferences.quietEndHour } }); return subscription
}
export async function disablePushNotifications() { const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (!subscription) return; await pb.send("/api/jornal/push/subscriptions", { method: "DELETE", body: { endpoint: subscription.endpoint } }).catch(() => undefined); await subscription.unsubscribe() }
