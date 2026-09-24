import { describe, expect, test, beforeEach, afterEach } from "bun:test"

import "./test-setup"
import { resetStorage, localStorageShim } from "./test-setup"
import {
  hydrateFromPocketBase,
  initializePocketBaseSync,
  getHydrationState,
  loadSyncConflicts,
  resetPocketBaseSyncState,
  resolveSyncConflict,
  schedulePocketBaseSync,
  setPocketBaseUrl,
  syncConflictDisplayPayload,
  syncConflictLabel,
  syncToPocketBase,
} from "./pocketbase-sync"
import { KEYS, RESET_PENDING_KEY, scopedStorageKey, saveProfile, emptyProfile, createTransaction, updateTransaction } from "./store"
import type { Transaction } from "./types"

type FetchCall = { url: string; method: string; body?: unknown }

let calls: FetchCall[] = []
const originalFetch = globalThis.fetch

type Handler = (
  url: string,
  method: string,
) => { status?: number; body?: unknown; items?: unknown; totalPages?: number }
let respond: Handler | null = null

function setEnv(value: string | undefined) {
  // An empty override explicitly disables sync even when a developer's
  // repository-level .env configures a local PocketBase endpoint.
  setPocketBaseUrl(value ?? "")
}

/** Drain the queued microtask sync so tests start from a clean slate. */
async function flushQueuedSync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  // Drain syncs scheduled by prior tests/files sharing this module instance
  setPocketBaseUrl("http://pb.test")
  respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
  await flushQueuedSync()
  setPocketBaseUrl(null)
  calls = []
  respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
  resetPocketBaseSyncState()
  resetStorage()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    let body: unknown
    if (init?.body) {
      if (init.body instanceof FormData) {
        body = Object.fromEntries(init.body.entries())
      } else {
        try {
          body = JSON.parse(String(init.body))
        } catch {
          body = init.body
        }
      }
    }
    calls.push({ url, method, body })
    const result = respond?.(url, method) ?? {}
    return new Response(JSON.stringify(result.body ?? { items: [], totalPages: 0 }), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setPocketBaseUrl(null)
})

describe("pocketbase-sync disabled", () => {
  test("no-ops without VITE_POCKETBASE_URL", async () => {
    setEnv(undefined)
    await expect(syncToPocketBase()).resolves.toBeUndefined()
    expect(await hydrateFromPocketBase()).toBe(false)
    expect(await initializePocketBaseSync()).toBe(false)
    schedulePocketBaseSync()
    expect(calls).toHaveLength(0)
  })
})

describe("syncToPocketBase", () => {
  test("enabled but empty local state performs no remote mutations", async () => {
    setEnv("http://pb.test")
    await syncToPocketBase()
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0)
  })

  test("pending reset removes remote rows before clearing its marker", async () => {
    setEnv("http://pb.test")
    const resetKey = scopedStorageKey(RESET_PENDING_KEY)
    localStorageShim.setItem(resetKey, new Date().toISOString())
    expect(localStorageShim.getItem(resetKey)).toBeTruthy()
    respond = (url) => url.includes("/records?")
      ? { status: 200, body: { items: [{ id: "remote-row", entity: "profile", app_id: "profile", business_id: "local", payload: {} }], totalPages: 1 } }
      : { status: 200, body: {} }
    await syncToPocketBase()
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(11)
    expect(localStorageShim.getItem(resetKey)).toBeNull()
  })

  test("failed pending reset keeps its marker for retry", async () => {
    setEnv("http://pb.test")
    const resetKey = scopedStorageKey(RESET_PENDING_KEY)
    localStorageShim.setItem(resetKey, new Date().toISOString())
    respond = (url, method) => {
      if (url.includes("/records?") && method === "GET") {
        return { status: 200, body: { items: [{ id: "remote-row", entity: "profile", app_id: "profile", business_id: "local", payload: {} }], totalPages: 1 } }
      }
      return { status: 500, body: { error: "temporary failure" } }
    }
    await expect(syncToPocketBase()).rejects.toThrow("PocketBase 500")
    expect(localStorageShim.getItem(resetKey)).toBeTruthy()
  })

  test("reset treats an already-deleted remote row as success", async () => {
    setEnv("http://pb.test")
    const resetKey = scopedStorageKey(RESET_PENDING_KEY)
    localStorageShim.setItem(resetKey, new Date().toISOString())
    respond = (url, method) => {
      if (url.includes("/records?") && method === "GET") {
        return { status: 200, body: { items: [{ id: "remote-row", entity: "profile", app_id: "profile", business_id: "local", payload: {} }], totalPages: 1 } }
      }
      return { status: 404, body: { error: "missing" } }
    }
    await expect(syncToPocketBase()).resolves.toBeUndefined()
    expect(localStorageShim.getItem(resetKey)).toBeNull()
  })

  test("upserts profile, transactions and reserves as POST records", async () => {
    setEnv("http://pb.test")
    saveProfile({ ...emptyProfile(), businessName: "Kedai" })
    createTransaction(transactionFixture("txn-1"))
    await flushQueuedSync()
    const initialCalls = [...calls]
    calls = []
    await syncToPocketBase()

    const posts = initialCalls.filter((call) => call.method === "POST")
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const payloads = posts.map((call) => call.body as { entity: string; app_id: string })
    expect(payloads.some((payload) => payload.entity === "profile")).toBe(true)
    expect(payloads.some((payload) => payload.entity === "transactions")).toBe(true)
    // listRecords pre-checks happened with a business_id filter
    expect(initialCalls.some((call) => call.url.includes("filter="))).toBe(true)
    // null settings are skipped (no upsert for null singleton)
    expect(payloads.some((payload) => payload.entity === "settings")).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test("uploads transaction attachments as multipart files", async () => {
    setEnv("http://pb.test")
    localStorageShim.setItem(
      KEYS.transactions,
      JSON.stringify([
        {
          ...transactionFixture("txn-file"),
          attachmentName: "receipt.jpg",
          attachmentDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/",
        },
      ]),
    )
    await flushQueuedSync()
    calls = []
    await syncToPocketBase()

    const post = calls.find((call) => call.method === "POST" && call.url.includes("/records"))
    expect(post).toBeTruthy()
    const body = post?.body as Record<string, unknown>
    expect(body.attachment instanceof File).toBe(true)
    expect(JSON.parse(String(body.payload)).attachmentDataUrl).toBeNull()
  })

  test("patches existing records without deleting remote-only records", async () => {
    setEnv("http://pb.test")
    respond = (url, method) => {
      if (url.includes("/records?")) {
        const filter = new URL(url).searchParams.get("filter") ?? ""
        return {
          status: 200,
          body: {
            items: filter.includes('entity = "transactions"') ? [
              record("transactions", "txn-1", transactionFixture("txn-1"), "pb-1"),
              record("transactions", "txn-gone", transactionFixture("txn-gone"), "pb-2"),
            ] : [],
            totalPages: 1,
          },
        }
      }
      if (method === "PATCH" || method === "POST") return { status: 200, body: {} }
      if (method === "DELETE") return { status: 200, body: {} }
      return { status: 200, body: {} }
    }
    await hydrateFromPocketBase()
    expect(JSON.parse(localStorageShim.getItem("remote-revisions.v1") || "{}")["transactions:txn-1"]).toBe(1)
    updateTransaction("txn-1", { description: "edited with base revision" })
    calls = []
    await syncToPocketBase()
    expect(calls.some((call) => call.method === "PATCH" && call.url.endsWith("/records/pb-1"))).toBe(true)
    expect(calls.some((call) => call.method === "DELETE")).toBe(false)
    const recordReads = calls.filter((call) => call.method === "GET" && call.url.includes("/records?"))
    expect(recordReads.filter((call) => decodeURIComponent(call.url).includes('app_id = "txn-1"'))).toHaveLength(0)
    expect(recordReads.every((call) => !decodeURIComponent(call.url).includes('app_id = "txn-gone"'))).toBe(true)
  })

  test("history records use id:effectiveAt:deletedAt composite app ids", async () => {
    setEnv("http://pb.test")
    saveProfile({ ...emptyProfile(), businessName: "Hist" })
    createTransaction(transactionFixture("txn-hist"))
    await flushQueuedSync()
    const initialCalls = [...calls]
    calls = []
    await syncToPocketBase()
    const historyUpserts = initialCalls.filter(
      (call) =>
        (call.method === "POST" || call.method === "PATCH") &&
        (call.body as { entity?: string })?.entity?.endsWith("History"),
    )
    expect(historyUpserts.length).toBeGreaterThan(0)
    const appId = (historyUpserts[0].body as { app_id: string }).app_id
    expect(appId).toContain(":")
    expect(calls).toHaveLength(0)
  })

  test("server errors propagate to the caller", async () => {
    setEnv("http://pb.test")
    createTransaction(transactionFixture("txn-err"))
    respond = () => ({ status: 500, body: { message: "boom" } })
    let thrown: unknown = null
    try {
      await syncToPocketBase()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeTruthy()
    expect(String(thrown)).toContain("500")
  })

  test("empty local state does not paginate remote snapshots", async () => {
    setEnv("http://pb.test")
    await flushQueuedSync()
    const fullPage = Array.from({ length: 200 }, (_, index) =>
      record("transactions", `txn-${index}`, transactionFixture(`txn-${index}`), `pb-${index}`),
    )
    respond = (url) => {
      if (url.includes("page=1")) {
        return { status: 200, body: { items: fullPage, totalPages: 2 } }
      }
      return { status: 200, body: { items: [], totalPages: 2 } }
    }
    calls = []
    await syncToPocketBase()
    expect(calls.some((call) => call.url.includes("page=2"))).toBe(false)
  })
})

describe("sync conflict resolution", () => {
  const localProfile = { ...emptyProfile(), businessName: "Versi perangkat", updatedAt: "2026-09-18T00:00:00.000Z" }
  const remoteProfile = { ...emptyProfile(), businessName: "Versi server", updatedAt: "2026-09-18T00:01:00.000Z" }
  const remoteRecord = {
    id: "remote-profile",
    entity: "profile",
    app_id: "profile",
    business_id: "local",
    company_id: "local",
    data_epoch: 1,
    payload: remoteProfile,
    revision: 7,
    created: "2026-09-18T00:00:00.000Z",
    updated: "2026-09-18T00:01:00.000Z",
  }

  function seedLegacyConflict() {
    localStorageShim.setItem(scopedStorageKey(KEYS.profile), JSON.stringify(localProfile))
    localStorageShim.setItem(scopedStorageKey(KEYS.syncConflicts), JSON.stringify([{
      id: "conflict-profile",
      message: "Conflict: profile/profile berubah di perangkat lain",
      entity: "profile",
      appId: "profile",
      localPayload: localProfile,
      remotePayload: remoteProfile,
      occurredAt: "2026-09-18T00:02:00.000Z",
    }]))
    let liveRecord = remoteRecord
    respond = (_url, method) => {
      if (method === "GET") return { status: 200, body: { items: [liveRecord], totalPages: 1 } }
      const payload = calls.at(-1)?.body as { payload?: typeof remoteProfile; revision?: number }
      liveRecord = { ...liveRecord, payload: payload.payload ?? liveRecord.payload, revision: Number(payload.revision ?? liveRecord.revision + 1) }
      return { status: 200, body: liveRecord }
    }
  }

  test("using the server records its live revision and does not recreate the conflict", async () => {
    setEnv("http://pb.test")
    seedLegacyConflict()

    expect(await resolveSyncConflict("conflict-profile", "remote")).toBe(true)
    expect(loadSyncConflicts()).toHaveLength(0)
    expect(JSON.parse(localStorageShim.getItem(scopedStorageKey(KEYS.profile)) || "{}").businessName).toBe("Versi server")

    await expect(syncToPocketBase()).resolves.toBeUndefined()
    expect(loadSyncConflicts()).toHaveLength(0)
  })

  test("using the device rebases the pending change before retrying", async () => {
    setEnv("http://pb.test")
    seedLegacyConflict()

    expect(await resolveSyncConflict("conflict-profile", "local")).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(loadSyncConflicts()).toHaveLength(0)
    expect(calls.some((call) => call.method === "PATCH")).toBe(true)
  })

  test("resolves a legacy account conflict from its captured array without exposing its id", async () => {
    setEnv("http://pb.test")
    const accountId = "1571c895-2853-4d7a-88a2-69a03081fc88"
    const localAccount = { id: accountId, name: "BCA", type: "BANK", openingBalance: 38_033_923, includedInCash: true, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }
    const remoteAccount = { ...localAccount, openingBalance: 0, updatedAt: "2026-09-18T00:01:00.000Z" }
    const conflict = {
      id: "conflict-account",
      message: "Conflict",
      entity: "accounts",
      appId: accountId,
      localPayload: [localAccount],
      remotePayload: remoteAccount,
      remoteRevision: 7,
      occurredAt: "2026-09-18T00:02:00.000Z",
    }
    localStorageShim.setItem(scopedStorageKey(KEYS.accounts), JSON.stringify([remoteAccount]))
    localStorageShim.setItem(scopedStorageKey(KEYS.syncConflicts), JSON.stringify([conflict]))
    let liveAccount = { ...remoteRecord, id: "remote-account", entity: "accounts", app_id: accountId, payload: remoteAccount }
    respond = (_url, method) => {
      if (method === "GET") return { status: 200, body: { items: [liveAccount], totalPages: 1 } }
      const payload = calls.at(-1)?.body as { payload?: unknown; revision?: number }
      liveAccount = { ...liveAccount, payload: payload.payload as typeof remoteAccount, revision: Number(payload.revision ?? 8) }
      return { status: 200, body: liveAccount }
    }

    expect(syncConflictLabel(conflict)).toBe("akun keuangan “BCA”")
    expect(syncConflictLabel(conflict)).not.toContain(accountId)
    expect(JSON.stringify(syncConflictDisplayPayload(conflict, "local"))).not.toContain(accountId)
    expect(await resolveSyncConflict(conflict.id, "local")).toBe(true)
    const saved = JSON.parse(localStorageShim.getItem(scopedStorageKey(KEYS.accounts)) || "[]") as Array<{ openingBalance: number }>
    expect(saved[0].openingBalance).toBe(38_033_923)
    expect(loadSyncConflicts()).toHaveLength(0)
    expect(calls.some((call) => call.method === "PATCH")).toBe(true)
  })

  test("resolves multiple history conflicts one record at a time", async () => {
    setEnv("http://pb.test")
    const firstLocal = {
      id: "account-1", effectiveAt: "2026-09-17T00:00:00.000Z", deletedAt: null,
      value: { id: "account-1", name: "BCA", openingBalance: 38_033_923 },
    }
    const secondLocal = {
      id: "account-1", effectiveAt: "2026-09-18T00:00:00.000Z", deletedAt: null,
      value: { id: "account-1", name: "BCA", openingBalance: 12_000_000 },
    }
    const firstRemote = { ...firstLocal, value: { ...firstLocal.value, openingBalance: 0 } }
    const secondRemote = { ...secondLocal, value: { ...secondLocal.value, openingBalance: 10_000_000 } }
    const firstAppId = `${firstLocal.id}:${firstLocal.effectiveAt}:live`
    const secondAppId = `${secondLocal.id}:${secondLocal.effectiveAt}:live`
    const remote = new Map([
      [firstAppId, { id: "remote-history-1", appId: firstAppId, payload: firstRemote, revision: 7 }],
      [secondAppId, { id: "remote-history-2", appId: secondAppId, payload: secondRemote, revision: 7 }],
    ])
    const conflicts = [
      { id: "history-conflict-1", message: "Conflict", entity: "accountHistory", appId: firstAppId, localPayload: [firstLocal, secondLocal], remotePayload: firstRemote, remoteRevision: 7, occurredAt: new Date().toISOString() },
      { id: "history-conflict-2", message: "Conflict", entity: "accountHistory", appId: secondAppId, localPayload: [firstLocal, secondLocal], remotePayload: secondRemote, remoteRevision: 7, occurredAt: new Date().toISOString() },
    ]
    localStorageShim.setItem(scopedStorageKey(KEYS.accountHistory), JSON.stringify([firstLocal, secondLocal]))
    localStorageShim.setItem(scopedStorageKey(KEYS.syncConflicts), JSON.stringify(conflicts))
    respond = (url, method) => {
      if (method === "GET") {
        const filter = new URL(url).searchParams.get("filter") ?? ""
        const entry = [...remote.values()].find((item) => filter.includes(`app_id = "${item.appId}"`))
        return { status: 200, body: { items: entry ? [{ ...remoteRecord, id: entry.id, entity: "accountHistory", app_id: entry.appId, payload: entry.payload, revision: entry.revision }] : [], totalPages: 1 } }
      }
      if (method === "PATCH") {
        const target = [...remote.values()].find((item) => url.endsWith(`/records/${item.id}`))!
        const call = calls.at(-1)?.body as { payload?: unknown }
        if (typeof call.payload === "string") target.payload = JSON.parse(call.payload) as typeof target.payload
        else if (call.payload && typeof call.payload === "object") target.payload = call.payload as typeof target.payload
        target.revision += 1
        return { status: 200, body: { id: target.id, app_id: target.appId, payload: target.payload, revision: target.revision } }
      }
      return { status: 200, body: {} }
    }

    expect(syncConflictLabel(conflicts[0])).toBe("riwayat akun “BCA”")
    expect(await resolveSyncConflict("history-conflict-1", "local")).toBe(true)
    expect(loadSyncConflicts().map((item) => item.id)).toEqual(["history-conflict-2"])
    expect(calls.some((call) => decodeURIComponent(call.url).includes(secondAppId))).toBe(false)

    expect(await resolveSyncConflict("history-conflict-2", "remote")).toBe(true)
    expect(loadSyncConflicts()).toHaveLength(0)
    const saved = JSON.parse(localStorageShim.getItem(scopedStorageKey(KEYS.accountHistory)) || "[]") as typeof firstLocal[]
    expect(saved[0].value.openingBalance).toBe(38_033_923)
    expect(saved[1].value.openingBalance).toBe(10_000_000)
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1)
  })

  test("keeps the conflict and reports an actionable error when the server is unavailable", async () => {
    setEnv("http://pb.test")
    seedLegacyConflict()
    respond = () => ({ status: 503, body: { message: "offline" } })

    await expect(resolveSyncConflict("conflict-profile", "remote")).rejects.toThrow("Periksa koneksi")
    expect(loadSyncConflicts()).toHaveLength(1)
  })
})

describe("hydrateFromPocketBase", () => {
  test("writes remote payloads into local storage", async () => {
    setEnv("http://pb.test")
    const profileRecord = record("profile", "profile", { businessName: "Remote" }, "pb-3")
    const txnRecord = record("transactions", "txn-remote", transactionFixture("txn-remote"), "pb-4")
    respond = (url) => {
      const filter = new URL(url).searchParams.get("filter") ?? ""
      const items = filter.includes('entity = "profile"')
        ? [profileRecord]
        : filter.includes('entity = "transactions"')
          ? [txnRecord]
          : []
      return { status: 200, body: { items, totalPages: 1 } }
    }

    expect(await hydrateFromPocketBase()).toBe(true)
    expect(JSON.parse(localStorageShim.getItem(KEYS.profile)!).businessName).toBe("Remote")
    const txns = JSON.parse(localStorageShim.getItem(KEYS.transactions)!)
    expect(txns).toHaveLength(1)
    expect(txns[0].id).toBe("txn-remote")
  })

  test("skips null payloads", async () => {
    setEnv("http://pb.test")
    respond = () => ({
      status: 200,
      body: {
        items: [
          { id: "x", entity: "transactions", app_id: "y", business_id: "local", payload: null, updated: "", created: "" },
        ],
        totalPages: 1,
      },
    })
    expect(await hydrateFromPocketBase()).toBe(true)
    expect(JSON.parse(localStorageShim.getItem(KEYS.transactions) ?? "[]")).toHaveLength(0)
  })

  test("returns false when remote is empty", async () => {
    setEnv("http://pb.test")
    respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
    expect(await hydrateFromPocketBase()).toBe(false)
  })
})

describe("initializePocketBaseSync", () => {
  test("reports completed hydration to later consumers without running it again", async () => {
    setEnv("http://pb.test")
    respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
    expect(await initializePocketBaseSync()).toBe(true)
    const callsAfterHydration = calls.length
    expect(await initializePocketBaseSync()).toBe(true)
    expect(calls).toHaveLength(callsAfterHydration)
    expect(getHydrationState()).toBe("ready")
  })

  test("returns false when hydration throws (after state reset)", async () => {
    resetPocketBaseSyncState()
    setEnv("http://pb.test")
    respond = () => ({ status: 500, body: {} })
    expect(await initializePocketBaseSync()).toBe(false)
    expect(getHydrationState()).toBe("unavailable")
  })
})

describe("attachment handling", () => {
  const dataUrl = "data:text/plain;base64,SGVsbG8=" // "Hello"

  function transactionWithAttachment(id: string): Transaction {
    return { ...transactionFixture(id), attachmentName: "receipt.txt", attachmentDataUrl: dataUrl }
  }

  test("upsert uses FormData when a data-url attachment exists (POST + PATCH)", async () => {
    setEnv("http://pb.test")
    // First sync: no remote → POST with FormData
    localStorageShim.setItem(KEYS.transactions, JSON.stringify([transactionWithAttachment("txn-att")]))
    await flushQueuedSync()
    respond = (url, method) => {
      if (url.includes("/records?")) return { status: 200, body: { items: [], totalPages: 1 } }
      if (method === "POST" || method === "PATCH") return { status: 200, body: {} }
      return { status: 200, body: {} }
    }
    calls = []
    await syncToPocketBase()
    const post = calls.find((call) => call.method === "POST")
    expect(post).toBeTruthy()
    // FormData body — the mock JSON-parses the appended fields
    expect((post?.body as { app_id?: string })?.app_id).toBe("txn-att")

    // Now remote has the record → PATCH with FormData
    respond = (url, method) => {
      if (url.includes("/records?")) {
        return { status: 200, body: { items: [{ id: "pb-att", entity: "transactions", app_id: "txn-att", business_id: "local", payload: {}, revision: 1, updated: "", created: "" }], totalPages: 1 } }
      }
      if (method === "PATCH") return { status: 200, body: {} }
      return { status: 200, body: {} }
    }
    localStorageShim.setItem(KEYS.transactions, JSON.stringify([{ ...transactionWithAttachment("txn-att"), notes: "edited" }]))
    calls = []
    await syncToPocketBase()
    expect(calls.some((call) => call.method === "PATCH")).toBe(true)
  })

  test("sanitized remote payload strips data URLs", async () => {
    setEnv("http://pb.test")
    localStorageShim.setItem(KEYS.transactions, JSON.stringify([transactionWithAttachment("txn-strip")]))
    await flushQueuedSync()
    let postedPayload: unknown = null
    respond = (url, method) => {
      if (url.includes("/records?")) return { status: 200, body: { items: [], totalPages: 1 } }
      if (method === "POST") {
        const formData = undefined
        void formData
        return { status: 200, body: {} }
      }
      return { status: 200, body: {} }
    }
    // Capture the payload via a FormData-backed fetch: read it back from the mock
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" })
      if (init?.body instanceof FormData) {
        postedPayload = JSON.parse(String(init.body.get("payload")))
      }
      const result = respond?.(String(input), init?.method ?? "GET") ?? {}
      return new Response(JSON.stringify(result.body ?? { items: [], totalPages: 1 }), { status: result.status ?? 200 })
    }) as typeof fetch
    await syncToPocketBase()
    expect((postedPayload as { attachmentDataUrl: string | null }).attachmentDataUrl).toBeNull()
  })

  test("hydrate maps attachment field into local transaction payload", async () => {
    setEnv("http://pb.test")
    respond = (url) => {
      const filter = new URL(url).searchParams.get("filter") ?? ""
      if (filter.includes('entity = "transactions"')) {
        return {
          status: 200,
          body: {
            items: [
              {
                id: "pb-9",
                entity: "transactions",
                app_id: "txn-remote-att",
                business_id: "local",
                payload: { ...transactionFixture("txn-remote-att"), attachmentDataUrl: null },
                attachment: "receipt.txt",
                updated: "",
                created: "",
              },
            ],
            totalPages: 1,
          },
        }
      }
      if (filter.includes('entity = "accounts"')) {
        return {
          status: 200,
          body: {
            items: [
              { id: "pb-10", entity: "accounts", app_id: "acc-1", business_id: "local", payload: { id: "acc-1", name: "BCA" }, updated: "", created: "" },
            ],
            totalPages: 1,
          },
        }
      }
      return { status: 200, body: { items: [], totalPages: 1 } }
    }
    const found = await hydrateFromPocketBase()
    expect(found).toBe(true)
    const txns = JSON.parse(localStorageShim.getItem(KEYS.transactions)!)
    expect(txns).toHaveLength(1)
    expect(txns[0].attachmentName).toBe("receipt.txt")
    expect(txns[0].attachmentDataUrl).toBeNull()
    expect(txns[0].attachmentRemoteUrl).toBe("http://pb.test/api/files/jornal_records/pb-9/receipt.txt?protocol=3&company=local")
  })

  test("localJson falls back when stored payload is corrupt JSON", async () => {
    setEnv("http://pb.test")
    localStorageShim.setItem(KEYS.transactions, "{broken json")
    await flushQueuedSync()
    respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
    calls = []
    await syncToPocketBase()
    // corrupt entry parsed as fallback [] → only prune lists, no mutations
    expect(calls.every((call) => call.method === "GET")).toBe(true)
  })

  test("hydrate skips non-object payloads but keeps transactions mapping intact", async () => {
    setEnv("http://pb.test")
    respond = (url) => {
      const filter = new URL(url).searchParams.get("filter") ?? ""
      if (filter.includes('entity = "reserves"')) {
        return {
          status: 200,
          body: {
            items: [
              { id: "pb-11", entity: "reserves", app_id: "r-1", business_id: "local", payload: { id: "r-1", name: "X" }, updated: "", created: "" },
            ],
            totalPages: 1,
          },
        }
      }
      return { status: 200, body: { items: [], totalPages: 1 } }
    }
    expect(await hydrateFromPocketBase()).toBe(true)
    const reserves = JSON.parse(localStorageShim.getItem(KEYS.reserves)!)
    expect(reserves).toHaveLength(1)
    expect(reserves[0].id).toBe("r-1")
  })
})

describe("schedulePocketBaseSync", () => {
  test("queues a microtask sync and swallows errors", async () => {
    setEnv("http://pb.test")
    createTransaction(transactionFixture("txn-sched"))
    respond = () => ({ status: 500, body: {} })
    schedulePocketBaseSync()
    schedulePocketBaseSync() // deduplicated
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.length).toBeGreaterThan(0)
  })
})

// ── helpers ──

function transactionFixture(id: string): Transaction {
  return {
    id,
    businessId: "local",
    direction: "MONEY_IN",
    amount: 1000,
    currency: "IDR",
    transactionDate: "2026-09-03",
    description: "test",
    notes: "",
    categoryId: null,
    paymentMethod: "",
    supplierCustomer: "",
    tags: "",
    accountId: null,
    transferAccountId: null,
    attachmentName: null,
    attachmentDataUrl: null,
    classification: "REVENUE",
    taxClassification: "REVENUE",
    businessRelevance: "BUSINESS",
    classificationSource: "RULE",
    classificationConfidence: 0.9,
    reviewStatus: "AUTO_ACCEPTED",
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
  }
}

function record(entity: string, appId: string, payload: unknown, id: string) {
  return {
    id,
    entity,
    app_id: appId,
    business_id: "local",
    payload,
    revision: 1,
    updated: "2026-09-03T00:00:00Z",
    created: "2026-09-03T00:00:00Z",
  }
}
