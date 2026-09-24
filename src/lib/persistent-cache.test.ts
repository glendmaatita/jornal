import { beforeEach, describe, expect, test } from "bun:test"

import "./test-setup"
import { localStorageShim, resetStorage } from "./test-setup"
import { clearPersistentCache, clearPersistentCachePrefix, staleWhileRevalidate, writePersistentCache } from "./persistent-cache"

beforeEach(() => resetStorage())

describe("persistent stale-while-revalidate cache", () => {
  test("returns the local snapshot before a slow refresh finishes", async () => {
    await writePersistentCache("cache.invoice.summary", { total: 10 })
    let finish!: (value: { total: number }) => void
    const pending = new Promise<{ total: number }>((resolve) => { finish = resolve })

    expect(await staleWhileRevalidate("invoice", "cache.invoice.summary", () => pending)).toEqual({ total: 10 })
    expect(JSON.parse(localStorageShim.getItem("cache.invoice.summary")!)).toEqual({ total: 10 })

    finish({ total: 20 })
    await pending
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(JSON.parse(localStorageShim.getItem("cache.invoice.summary")!)).toEqual({ total: 20 })
  })

  test("deduplicates concurrent refreshes for the same key", async () => {
    await writePersistentCache("cache.tax.agenda", { items: [] })
    let calls = 0
    const load = async () => { calls += 1; return { items: [1] } }
    await Promise.all([
      staleWhileRevalidate("tax", "cache.tax.agenda", load),
      staleWhileRevalidate("tax", "cache.tax.agenda", load),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
  })

  test("clears every local entry under a company cache prefix", async () => {
    await writePersistentCache("company-a.invoice.list", [1])
    await writePersistentCache("company-a.invoice.summary", { total: 1 })
    await writePersistentCache("company-b.invoice.list", [2])
    await clearPersistentCachePrefix("company-a.invoice.")
    expect(localStorageShim.getItem("company-a.invoice.list")).toBeNull()
    expect(localStorageShim.getItem("company-a.invoice.summary")).toBeNull()
    expect(localStorageShim.getItem("company-b.invoice.list")).not.toBeNull()
  })

  test("does not reuse an in-flight pre-mutation refresh after invalidation", async () => {
    let finishOld!: (value: { total: number }) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const oldRequest = new Promise<{ total: number }>((resolve) => { finishOld = resolve })
    const first = staleWhileRevalidate("invoice", "cache.invoice.summary", () => { markStarted(); return oldRequest })

    await started
    await clearPersistentCache("cache.invoice.summary")
    const fresh = await staleWhileRevalidate("invoice", "cache.invoice.summary", async () => ({ total: 30 }))
    expect(fresh).toEqual({ total: 30 })

    finishOld({ total: 10 })
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(JSON.parse(localStorageShim.getItem("cache.invoice.summary")!)).toEqual({ total: 30 })
  })
})
