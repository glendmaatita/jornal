import { describe, expect, test } from "bun:test"

import { ALL_CATEGORIES, categoriesForKind, categoryById, categoryName, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "./categories"

describe("categories", () => {
  test("kinds are disjoint and complete", () => {
    expect(categoriesForKind("income")).toBe(INCOME_CATEGORIES)
    expect(categoriesForKind("expense")).toBe(EXPENSE_CATEGORIES)
    expect(ALL_CATEGORIES).toHaveLength(INCOME_CATEGORIES.length + EXPENSE_CATEGORIES.length)
  })

  test("categoryById", () => {
    expect(categoryById(null)).toBeNull()
    expect(categoryById("exp-marketing")?.name).toBe("Marketing")
    expect(categoryById("nope")).toBeNull()
  })

  test("categoryName fallback", () => {
    expect(categoryName(null)).toBe("Tanpa Kategori")
    expect(categoryName("nope")).toBe("Tanpa Kategori")
  })
})
