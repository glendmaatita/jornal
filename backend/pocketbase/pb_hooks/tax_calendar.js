// National holidays and nationally declared collective leave that may shift
// general tax payment deadlines under PMK 81/2024 art. 100. Local/document
// taxes remain manual because their governing authority may use another rule.
const CALENDARS = {
  2025: {
    source: "SKB 1017/2024, 2/2024, 2/2024 as amended 7 Aug 2025",
    dates: ["2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-03-28", "2025-03-29", "2025-03-31", "2025-04-01", "2025-04-02", "2025-04-03", "2025-04-04", "2025-04-07", "2025-04-18", "2025-04-20", "2025-05-01", "2025-05-12", "2025-05-13", "2025-05-29", "2025-05-30", "2025-06-01", "2025-06-06", "2025-06-09", "2025-06-27", "2025-08-17", "2025-08-18", "2025-09-05", "2025-12-25", "2025-12-26"],
  },
  2026: {
    source: "SKB hari libur nasional dan cuti bersama 2026 (19 Sep 2025)",
    dates: ["2026-01-01", "2026-01-16", "2026-02-16", "2026-02-17", "2026-03-18", "2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-04-03", "2026-04-05", "2026-05-01", "2026-05-14", "2026-05-15", "2026-05-27", "2026-05-28", "2026-05-31", "2026-06-01", "2026-06-16", "2026-08-17", "2026-08-25", "2026-12-24", "2026-12-25"],
  },
  2027: {
    source: "SKB 1205/2026, 3/2026, 2/2026",
    dates: ["2027-01-01", "2027-01-05", "2027-02-05", "2027-02-06", "2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12", "2027-03-15", "2027-03-25", "2027-03-26", "2027-03-28", "2027-05-01", "2027-05-06", "2027-05-17", "2027-05-18", "2027-05-19", "2027-05-20", "2027-06-01", "2027-06-06", "2027-08-15", "2027-08-17", "2027-12-24", "2027-12-25", "2027-12-26"],
  },
}

function adjustDueDate(dateText) {
  if (!dateText) return { date: null, status: "PROVISIONAL", source: "Tanggal belum tersedia" }
  const year = Number(String(dateText).slice(0, 4)); const calendar = CALENDARS[year]
  const blocked = new Set(calendar ? calendar.dates : [])
  const date = new Date(`${dateText}T00:00:00Z`)
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6 || blocked.has(date.toISOString().slice(0, 10))) date.setUTCDate(date.getUTCDate() + 1)
  return {
    date: date.toISOString().slice(0, 10), status: calendar ? "VERIFIED" : "PROVISIONAL",
    source: calendar ? `${calendar.source}; PMK 81/2024 Pasal 100` : `Kalender libur resmi ${year} belum dipasang; hanya akhir pekan yang diperhitungkan`,
  }
}

module.exports = { CALENDARS, adjustDueDate }
