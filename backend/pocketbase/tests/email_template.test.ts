import { describe, expect, test } from "bun:test"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mail = require("../pb_hooks/email_template.js") as {
  emailEscape: (value: unknown) => string
  emailFormatDateTime: (value: unknown) => string
  emailLayout: (options: Record<string, unknown>) => string
}

describe("email template", () => {
  test("formats PocketBase timestamps as Indonesian WIB time", () => {
    expect(mail.emailFormatDateTime("2026-09-25 00:26:57.422Z")).toBe("25 September 2026, 07.26 WIB")
    expect(mail.emailFormatDateTime("2026-12-31T20:00:00Z")).toBe("1 Januari 2027, 03.00 WIB")
    expect(mail.emailFormatDateTime("not a date")).toBe("not a date")
    expect(mail.emailFormatDateTime("")).toBe("")
  })

  test("renders branded layout with logo, button, and fallback link", () => {
    const html = mail.emailLayout({
      publicUrl: "https://jornal.dropify.id/", title: "Undangan", heading: "Halo",
      paragraphs: ["<strong>A</strong> mengundang Anda."], cta: { label: "Terima", url: "https://jornal.dropify.id/invitations/abc?x=1&y=2" }, note: "Catatan",
    })
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('src="https://jornal.dropify.id/pwa-192x192.png"')
    expect(html).toContain("<strong>A</strong> mengundang Anda.")
    expect(html).toContain('href="https://jornal.dropify.id/invitations/abc?x=1&amp;y=2"')
    expect(html).toContain(">Terima</a>")
    expect(html).toContain("Catatan")
    expect(html).toContain("#1b1d4d")
    expect(html).not.toContain("<style")
  })

  test("omits logo and button when public url or cta are missing", () => {
    const html = mail.emailLayout({ paragraphs: ["Isi"], cta: null })
    expect(html).not.toContain("<img")
    expect(html).not.toContain("Buka Jornal")
    expect(html).toContain("Isi")
  })

  test("escapes title and preheader", () => {
    const html = mail.emailLayout({ title: "<b>x</b>", preheader: "<i>y</i>", paragraphs: [] })
    expect(html).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>")
    expect(html).toContain("&lt;i&gt;y&lt;/i&gt;")
  })
})
