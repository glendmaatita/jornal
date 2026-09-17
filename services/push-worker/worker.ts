import webpush from "web-push"

const pocketBaseUrl = (process.env.POCKETBASE_URL || "http://pocketbase:8090").replace(/\/$/, "")
const secret = process.env.JORNAL_PUSH_WORKER_SECRET || ""
const publicKey = process.env.JORNAL_PUSH_VAPID_PUBLIC_KEY || ""
const privateKey = process.env.JORNAL_PUSH_VAPID_PRIVATE_KEY || ""
const subject = process.env.JORNAL_PUSH_VAPID_SUBJECT || "mailto:admin@example.com"
if (!secret || !publicKey || !privateKey) throw new Error("Push worker secrets and VAPID keys are required")
webpush.setVapidDetails(subject, publicKey, privateKey)

type Job = { id: string; leaseId: string; endpoint: string; keys: { p256dh: string; auth: string }; payload: { title: string; body: string; url: string; tag: string } }
async function api(path: string, body: unknown) { const response = await fetch(`${pocketBaseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Jornal-Push-Secret": secret }, body: JSON.stringify(body) }); if (!response.ok) throw new Error(`PocketBase push API ${response.status}`); return response.json() }
async function deliver(job: Job) { try { const validation = await api(`/api/jornal/internal/push/${encodeURIComponent(job.id)}/validate`, { leaseId: job.leaseId }) as { valid: boolean }; if (!validation.valid) return; await webpush.sendNotification({ endpoint: job.endpoint, keys: job.keys }, JSON.stringify(job.payload), { TTL: 86_400, urgency: "normal" }); await api(`/api/jornal/internal/push/${encodeURIComponent(job.id)}/complete`, { leaseId: job.leaseId, outcome: "SENT" }) } catch (cause) { const status = Number((cause as { statusCode?: number }).statusCode || 0); const permanent = status === 404 || status === 410; await api(`/api/jornal/internal/push/${encodeURIComponent(job.id)}/complete`, { leaseId: job.leaseId, outcome: permanent ? "PERMANENT" : "RETRYABLE", error: `web-push:${status || "network"}` }).catch(() => undefined) } }
async function run() { const response = await api("/api/jornal/internal/push/claim", { limit: 25 }) as { items: Job[] }; await Promise.all(response.items.map(deliver)) }
await run(); setInterval(() => void run().catch((error) => console.error(String(error))), 30_000)
