import { describe, expect, test } from "bun:test"

import { accountOptionLabel } from "./account-display"
import type { Account } from "./types"

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    name: "BCA",
    type: "BANK",
    bankName: "BCA",
    accountHolder: "Glend Steven Maatita",
    accountNumber: "1234567890",
    enabled: true,
    openingBalance: 0,
    includedInCash: true,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  }
}

describe("accountOptionLabel", () => {
  test("shows the account number and holder without repeating the bank name", () => {
    expect(accountOptionLabel(account())).toBe("BCA · 1234567890 · a.n. Glend Steven Maatita")
  })

  test("includes a distinct bank name and tolerates incomplete legacy accounts", () => {
    expect(accountOptionLabel(account({ name: "Operasional", bankName: "BCA" }))).toBe("Operasional · BCA · 1234567890 · a.n. Glend Steven Maatita")
    expect(accountOptionLabel(account({ name: "Cash", type: "CASH", bankName: null, accountNumber: null, accountHolder: null }))).toBe("Cash")
  })
})
