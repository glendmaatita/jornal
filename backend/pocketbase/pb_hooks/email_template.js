// Shared transactional email layout for Jornal.
// Pure module: no $app / $os access so it can be unit tested with bun.
// Email clients strip <style> blocks and block data: URIs, so everything is
// table-based with inline styles and the logo is a hosted PNG from the app.

const EMAIL_BRAND = { navy: "#1b1d4d", sky: "#97daff", ink: "#1b1d4d", muted: "#5b5f7a", line: "#e3e6ee", canvas: "#edf0f2", card: "#ffffff" }
const EMAIL_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

function emailEscape(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]) }

// Formats a PocketBase datetime ("2026-09-25 00:26:57.422Z" or ISO) as
// "25 September 2026, 07.26 WIB". Falls back to the raw value when unparseable.
function emailFormatDateTime(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"))
  if (Number.isNaN(parsed)) return String(value || "")
  const wib = new Date(parsed + 7 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, "0")
  return `${wib.getUTCDate()} ${EMAIL_MONTHS[wib.getUTCMonth()]} ${wib.getUTCFullYear()}, ${pad(wib.getUTCHours())}.${pad(wib.getUTCMinutes())} WIB`
}

function emailParagraph(html) {
  return `<p style="margin:0 0 16px 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:${EMAIL_BRAND.ink};">${html}</p>`
}

function emailButton(label, url) {
  const safeUrl = emailEscape(url); const safeLabel = emailEscape(label)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${EMAIL_BRAND.navy}" style="border-radius:12px;">` +
    `<a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;background-color:${EMAIL_BRAND.navy};">${safeLabel}</a>` +
    `</td></tr></table>`
}

// options: { publicUrl, title, preheader, heading, paragraphs: [html], cta: { label, url }, note, footer }
function emailLayout(options) {
  const o = options || {}
  const publicUrl = String(o.publicUrl || "").replace(/\/$/, "")
  const logo = publicUrl ? `<img src="${emailEscape(`${publicUrl}/pwa-192x192.png`)}" width="40" height="40" alt="Jornal" style="display:block;width:40px;height:40px;border-radius:10px;border:0;" />` : ""
  const font = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;"
  const body = (o.paragraphs || []).map(emailParagraph).join("")
  const cta = o.cta && o.cta.url ? emailButton(o.cta.label || "Buka Jornal", o.cta.url) : ""
  const ctaFallback = o.cta && o.cta.url
    ? `<p style="margin:0 0 16px 0;${font}font-size:13px;line-height:20px;color:${EMAIL_BRAND.muted};">Jika tombol tidak berfungsi, salin tautan ini ke browser Anda:<br /><a href="${emailEscape(o.cta.url)}" style="color:${EMAIL_BRAND.navy};word-break:break-all;">${emailEscape(o.cta.url)}</a></p>`
    : ""
  const note = o.note ? `<p style="margin:0;${font}font-size:13px;line-height:20px;color:${EMAIL_BRAND.muted};">${o.note}</p>` : ""
  const footer = o.footer || "Email ini dikirim otomatis oleh Jornal. Jika Anda tidak mengharapkan email ini, abaikan saja."
  const preheader = o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${emailEscape(o.preheader)}</div>` : ""
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${emailEscape(o.title || "Jornal")}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_BRAND.canvas};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_BRAND.canvas}" style="background-color:${EMAIL_BRAND.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 0 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
${logo ? `<td style="padding-right:12px;vertical-align:middle;">${logo}</td>` : ""}
<td style="vertical-align:middle;${font}font-size:22px;font-weight:700;color:${EMAIL_BRAND.navy};letter-spacing:-0.2px;">Jornal</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${EMAIL_BRAND.card}" style="background-color:${EMAIL_BRAND.card};border-radius:16px;border:1px solid ${EMAIL_BRAND.line};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="height:6px;background-color:${EMAIL_BRAND.sky};border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 24px 32px;">
${o.heading ? `<h1 style="margin:0 0 20px 0;${font}font-size:24px;line-height:32px;font-weight:700;color:${EMAIL_BRAND.navy};">${o.heading}</h1>` : ""}
${body}
${cta}
${ctaFallback}
${note}
</td></tr>
</table>
</td></tr>
<tr><td style="padding:20px 8px 0 8px;${font}font-size:12px;line-height:18px;color:${EMAIL_BRAND.muted};" align="center">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

module.exports = { emailEscape, emailFormatDateTime, emailLayout }
