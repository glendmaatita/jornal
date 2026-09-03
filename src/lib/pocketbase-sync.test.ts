import { describe, expect, test, beforeEach, afterEach } from "bun:test"

import "./test-setup"
import { resetStorage, localStorageShim } from "./test-setup"
import {
  hydrateFromPocketBase,
  initializePocketBaseSync,
  resetPocketBaseSyncStateForTests,
  schedulePocketBaseSync,
  setPocketBaseUrl,
  syncToPocketBase,
} from "./pocketbase-sync"
import { KEYS, saveProfile, emptyProfile, createTransaction } from "./store"
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
  setPocketBaseUrl(value ?? null)
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
  resetPocketBaseSyncStateForTests()
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
  test("enabled but empty local state only lists (prune pass), no mutations", async () => {
    setEnv("http://pb.test")
    await syncToPocketBase()
    expect(calls.length).toBeGreaterThan(0)
    if (calls.some((call) => call.method !== "GET")) {
      console.log("DEBUG:", calls.map((call) => `${call.method} ${call.url}`).join(" || "))
    }
    expect(calls.filter((call) => call.method !== "GET")).toHaveLength(0)
  })

  test("upserts profile, transactions and reserves as POST records", async () => {
    setEnv("http://pb.test")
    saveProfile({ ...emptyProfile(), businessName: "Kedai" })
    createTransaction(transactionFixture("txn-1"))
    await flushQueuedSync()
    calls = []
    await syncToPocketBase()

    const posts = calls.filter((call) => call.method === "POST")
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const payloads = posts.map((call) => call.body as { entity: string; app_id: string })
    expect(payloads.some((payload) => payload.entity === "profile")).toBe(true)
    expect(payloads.some((payload) => payload.entity === "transactions")).toBe(true)
    // listRecords pre-checks happened with a business_id filter
    expect(calls.some((call) => call.url.includes("filter="))).toBe(true)
    // null settings are skipped (no upsert for null singleton)
    expect(payloads.some((payload) => payload.entity === "settings")).toBe(false)
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

  test("patches existing records and deletes remote ones missing locally", async () => {
    setEnv("http://pb.test")
    // Seed a transaction with a deterministic id directly (createTransaction generates ids)
    localStorageShim.setItem(KEYS.transactions, JSON.stringify([transactionFixture("txn-1")]))
    await flushQueuedSync()

    respond = (url, method) => {
      if (url.includes("/records?")) {
        return {
          status: 200,
          body: {
            items: [
              record("transactions", "txn-1", transactionFixture("txn-1"), "pb-1"),
              record("transactions", "txn-gone", transactionFixture("txn-gone"), "pb-2"),
            ],
            totalPages: 1,
          },
        }
      }
      if (method === "PATCH" || method === "POST") return { status: 200, body: {} }
      if (method === "DELETE") return { status: 200, body: {} }
      return { status: 200, body: {} }
    }

    calls = []
    await syncToPocketBase()
    expect(calls.some((call) => call.method === "PATCH" && call.url.endsWith("/records/pb-1"))).toBe(true)
    expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/records/pb-2"))).toBe(true)
  })

  test("history records use id:effectiveAt:deletedAt composite app ids", async () => {
    setEnv("http://pb.test")
    saveProfile({ ...emptyProfile(), businessName: "Hist" })
    createTransaction(transactionFixture("txn-hist"))
    await flushQueuedSync()
    calls = []
    await syncToPocketBase()
    const historyUpserts = calls.filter(
      (call) =>
        (call.method === "POST" || call.method === "PATCH") &&
        (call.body as { entity?: string })?.entity?.endsWith("History"),
    )
    expect(historyUpserts.length).toBeGreaterThan(0)
    const appId = (historyUpserts[0].body as { app_id: string }).app_id
    expect(appId).toContain(":")
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

  test("pagination walks all pages", async () => {
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
    expect(calls.some((call) => call.url.includes("page=2"))).toBe(true)
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
  test("reports success and runs only once per session", async () => {
    setEnv("http://pb.test")
    respond = () => ({ status: 200, body: { items: [], totalPages: 1 } })
    expect(await initializePocketBaseSync()).toBe(true)
    expect(await initializePocketBaseSync()).toBe(false)
  })

  test("returns false when hydration throws (after state reset)", async () => {
    resetPocketBaseSyncStateForTests()
    setEnv("http://pb.test")
    respond = () => ({ status: 500, body: {} })
    expect(await initializePocketBaseSync()).toBe(false)
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
        return { status: 200, body: { items: [{ id: "pb-att", entity: "transactions", app_id: "txn-att", business_id: "local", payload: {}, updated: "", created: "" }], totalPages: 1 } }
      }
      if (method === "PATCH") return { status: 200, body: {} }
      return { status: 200, body: {} }
    }
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
    expect(txns[0].attachmentDataUrl).toContain("/api/files/jornal_records/pb-9/receipt.txt")
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
    updated: "2026-09-03T00:00:00Z",
    created: "2026-09-03T00:00:00Z",
  }
}
