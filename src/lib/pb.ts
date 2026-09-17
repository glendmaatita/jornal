import PocketBase from "pocketbase"

// Same-origin path proxied to PocketBase by server.ts (VITE_POCKETBASE_URL=/pb).
const baseUrl = import.meta.env.VITE_POCKETBASE_URL?.trim() || ""

export const pocketBaseConfigured = Boolean(baseUrl)

export const pb = new PocketBase(baseUrl || undefined)

/** The authenticated tenant (PocketBase user record), if any. */
export function currentUser(): { id: string; email: string; name: string } | null {
  const record = pb.authStore.record
  if (!pb.authStore.isValid || !record) return null
  return { id: record.id, email: record.email ?? "", name: (record.name as string) || record.email }
}

export async function loginWithGoogle(): Promise<void> {
  await pb.collection("users").authWithOAuth2({
    provider: "google",
    // Let PocketBase create the user record on first sign-in.
    createData: {},
  })
}

export function logout(): void {
  pb.authStore.clear()
  try {
    window.sessionStorage.removeItem("jornal.pending-route")
    window.sessionStorage.removeItem("jornal.create-company-intent")
    window.sessionStorage.removeItem("jornal.company-creation-return.v1")
  } catch { /* logout must still complete when session storage is unavailable */ }
}
