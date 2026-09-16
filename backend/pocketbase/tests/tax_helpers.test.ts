import { describe, expect, test } from "bun:test"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const helpers = require("../pb_hooks/tax_helpers.js") as {
  findAllRecords: (
    app: { findRecordsByFilter: (...args: unknown[]) => Array<{ id: number }> },
    collection: string,
    filter: string,
    sort: string,
    params?: Record<string, unknown>,
    batchSize?: number,
  ) => Array<{ id: number }>
}

describe("tax record pagination", () => {
  test("walks every page instead of truncating at 500 records", () => {
    const source = Array.from({ length: 1_205 }, (_, id) => ({ id }))
    const offsets: number[] = []
    const app = {
      findRecordsByFilter: (_collection: unknown, _filter: unknown, _sort: unknown, limit: unknown, offset: unknown) => {
        offsets.push(Number(offset))
        return source.slice(Number(offset), Number(offset) + Number(limit))
      },
    }
    const records = helpers.findAllRecords(app, "tax_obligations", "payment_status = 'UNPAID'", "effective_due_date", {}, 500)
    expect(records).toHaveLength(1_205)
    expect(records.at(-1)?.id).toBe(1_204)
    expect(offsets).toEqual([0, 500, 1_000])
  })
})
