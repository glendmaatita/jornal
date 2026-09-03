// Seed categories per prd.md §20. Categories are a layer distinct from classification.

import type { Category, CategoryKind } from "./types"

export const EXPENSE_CATEGORIES: Category[] = [
  { id: "exp-inventory", name: "Pembelian Barang", kind: "expense", keywords: ["beli barang", "stok", "bahan baku", "restock", "supplier"] },
  { id: "exp-payroll", name: "Gaji & Upah", kind: "expense", keywords: ["gaji", "upah", "payroll", "bonus karyawan", " THR ", "thr"] },
  { id: "exp-marketing", name: "Marketing", kind: "expense", keywords: ["iklan", "ads", "meta", "facebook", "google ads", "tiktok ads", "marketing", "promo", "boost"] },
  { id: "exp-transport", name: "Transportasi", kind: "expense", keywords: ["bensin", "oli", "parkir", "tol", "gojek", "grab", "ojek", "kirim", "ongkir", "pengiriman", "transport"] },
  { id: "exp-rent", name: "Sewa", kind: "expense", keywords: ["sewa", "kontrakan", "rent", "sewa tempat", "sewa kantor"] },
  { id: "exp-utilities", name: "Utilitas", kind: "expense", keywords: ["listrik", "air", "wifi", "internet", "pulsa", "token", "pln"] },
  { id: "exp-software", name: "Software & Subscription", kind: "expense", keywords: ["workspace", "google workspace", "canva", "notion", "figma", "chatgpt", "openai", "domain", "hosting", "subscription", "langganan", "software"] },
  { id: "exp-professional", name: "Professional Services", kind: "expense", keywords: ["konsultan", "jasa", "notaris", "legal", "akuntan", "freelance", "desainer"] },
  { id: "exp-bank-fees", name: "Bank & Payment Fees", kind: "expense", keywords: ["biaya admin", "biaya transfer", "fee", "administrasi bank", "gateway", "midtrans", "xendit"] },
  { id: "exp-maintenance", name: "Maintenance", kind: "expense", keywords: ["servis", "perbaikan", "maintenance", "service"] },
  { id: "exp-office", name: "Office Expenses", kind: "expense", keywords: ["atk", "kantor", "kertas", "print", "fotokopi", "office"] },
  { id: "exp-entertainment", name: "Entertainment", kind: "expense", keywords: ["makan klien", "entertain", "gathering", "hiburan"] },
  { id: "exp-tax", name: "Pajak", kind: "expense", keywords: ["pajak", "pph", "ppn", "tax"] },
  { id: "exp-other", name: "Lainnya", kind: "expense", keywords: [] },
]

export const INCOME_CATEGORIES: Category[] = [
  { id: "inc-sales", name: "Penjualan", kind: "income", keywords: ["penjualan", "jual", "sales", "order", "po "] },
  { id: "inc-services", name: "Jasa", kind: "income", keywords: ["jasa", "service", "project", "proyek", "konsultasi", "fee project"] },
  { id: "inc-commission", name: "Komisi", kind: "income", keywords: ["komisi", "commission", "afiliasi", "affiliate", "referral"] },
  { id: "inc-other-revenue", name: "Omzet Lain", kind: "income", keywords: ["omzet lain"] },
  { id: "inc-other-income", name: "Pemasukan Lain", kind: "income", keywords: ["bunga", "hadiah", "refund", "pengembalian"] },
]

export const ALL_CATEGORIES: Category[] = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]

export function categoriesForKind(kind: CategoryKind): Category[] {
  return kind === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
}

export function categoryById(id: string | null): Category | null {
  if (!id) return null
  return ALL_CATEGORIES.find((category) => category.id === id) ?? null
}

export function categoryName(id: string | null): string {
  return categoryById(id)?.name ?? "Tanpa Kategori"
}
