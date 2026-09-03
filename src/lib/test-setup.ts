// Shared test setup: in-memory localStorage + window shim for bun (no DOM).

import { appendFileSync } from "node:fs"

const memoryStorage = new Map<string, string>()

const storeCallbackLog = process.env.STORE_CALLBACK_LOG ?? ""
const wrapArrayMethod = <K extends keyof Array<any>>(name: K) => {
  const original = Array.prototype[name] as unknown as Function
  Object.defineProperty(Array.prototype, name, {
    configurable: true,
    writable: true,
    value(this: unknown[], ...args: unknown[]) {
      const callback = args[0]
      if (typeof callback === "function") {
        const stack = new Error().stack ?? ""
        if (stack.includes("src/lib/store.ts")) {
          const snippet = callback
            .toString()
            .replace(/\s+/g, " ")
            .replace(/^function\s*/u, "function ")
            .slice(0, 120)
          if (storeCallbackLog) appendFileSync(storeCallbackLog, `${String(name)}:${snippet}\n`)
        }
      }
      return original.apply(this, args as never)
    },
  })
}

for (const method of ["map", "filter", "find", "findIndex", "some"] as const) {
  wrapArrayMethod(method)
}

export const localStorageShim = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryStorage.set(key, value),
  removeItem: (key: string) => void memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  get length() {
    return memoryStorage.size
  },
}

export function resetStorage() {
  memoryStorage.clear()
}

const windowShim = {
  localStorage: localStorageShim,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
}

;(globalThis as unknown as { window: unknown }).window = windowShim
