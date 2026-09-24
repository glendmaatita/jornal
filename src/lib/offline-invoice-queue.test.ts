import { beforeEach, describe, expect, test } from "bun:test"

import "./test-setup"
import { localStorageShim, resetStorage } from "./test-setup"
import { queueCustomerCreate, queueInvoiceDraft } from "./invoice-client"

const company = {
  id: "company-offline", tenantId: "local", name: "Offline Co", status: "ACTIVE",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z", legacyDefault: true,
  dataEpoch: 1, revision: 1, membershipRevision: 1, logoAssetId: null,
  archivedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
}

beforeEach(() => {
  resetStorage()
  localStorageShim.setItem("jornal.local.companies.v1", JSON.stringify([company]))
  localStorageShim.setItem("jornal.local.selected-company.v1", company.id)
})

describe("offline invoice commands", () => {
  test("keeps only the latest idempotent snapshot for one compose form", async () => {
    const base = {
      customerId: "customer-1", issueDate: "2026-09-24", dueDate: "2026-09-25",
      items: [{ id: "item-1", description: "Produk", quantityScaled: 1000, unitLabel: "pcs", unitPrice: 10_000, sortOrder: 0 }],
    }
    await queueInvoiceDraft(base, false, "compose-a")
    await queueInvoiceDraft({ ...base, shippingAmount: 5_000 }, true, "compose-a")
    const rows = JSON.parse(localStorageShim.getItem("jornal.local.company-offline.1.invoice-pending-drafts.v1")!)
    expect(rows).toHaveLength(1)
    expect(rows[0].publish).toBe(true)
    expect(rows[0].input.shippingAmount).toBe(5_000)
    expect(rows[0].commandKey).not.toBe(rows[0].issueCommandKey)
  })

  test("persists a customer create for reconnect processing", async () => {
    await queueCustomerCreate({
      name: "Aksa", email: null, phone: null, addressLine1: null, addressLine2: null,
      district: null, city: null, province: null, postalCode: null,
    }, "customer-compose-a")
    const rows = JSON.parse(localStorageShim.getItem("jornal.local.company-offline.1.customer-pending-creates.v1")!)
    expect(rows).toHaveLength(1)
    expect(rows[0].input.name).toBe("Aksa")
    expect(rows[0].commandKey).toBeTruthy()
  })
})
