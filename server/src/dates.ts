/** Calendar dates in a fixed IANA zone. Kept always defaults to Asia/Jakarta. */

const WEEKDAYS: { name: string; dow: number }[] = [
  { name: 'sunday', dow: 0 },
  { name: 'monday', dow: 1 },
  { name: 'tuesday', dow: 2 },
  { name: 'wednesday', dow: 3 },
  { name: 'thursday', dow: 4 },
  { name: 'friday', dow: 5 },
  { name: 'saturday', dow: 6 },
  { name: 'minggu', dow: 0 },
  { name: 'senin', dow: 1 },
  { name: 'selasa', dow: 2 },
  { name: 'rabu', dow: 3 },
  { name: 'kamis', dow: 4 },
  { name: 'jumat', dow: 5 },
  { name: "jum'at", dow: 5 },
  { name: 'sabtu', dow: 6 },
]

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const SHORT_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function zonedISO(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!year || !month || !day) throw new Error(`Could not read the calendar date in ${timeZone}`)
  return `${year}-${month}-${day}`
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + days)
  return utc.toISOString().slice(0, 10)
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [year, month, day] = iso.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Upcoming weekday. `strictNext` skips today (used for "next Friday" / "Jumat depan"). */
export function upcomingWeekday(todayISO: string, targetDow: number, strictNext: boolean): string {
  let delta = (targetDow - weekdayIndex(todayISO) + 7) % 7
  if (delta === 0 && strictNext) delta = 7
  return addDays(todayISO, delta)
}

function monthDay(text: string, todayISO: string): string | null {
  const year = Number(todayISO.slice(0, 4))
  const named =
    text.match(
      /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/,
    ) ||
    text.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/,
    )
  if (!named) return null
  const a = named[1]
  const b = named[2]
  const day = /^\d+$/.test(a) ? Number(a) : Number(b)
  const monthName = /^\d+$/.test(a) ? b : a
  const month = MONTHS[monthName]
  if (!month || day < 1 || day > 31) return null
  let iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isValidISO(iso)) return null
  if (iso < todayISO) iso = `${year + 1}-${iso.slice(5)}`
  return isValidISO(iso) ? iso : null
}

/**
 * Resolve a due date that the utterance actually states.
 * Returns null when the text does not name a day. Never guesses.
 */
export function resolveDue(text: string, now: Date, timeZone = 'Asia/Jakarta'): string | null {
  const today = zonedISO(now, timeZone)
  const raw = text.toLowerCase().replace(/’/g, "'")

  const explicit = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (explicit && isValidISO(explicit[1])) return explicit[1]

  const fromMonth = monthDay(raw, today)
  if (fromMonth) return fromMonth

  if (/\b(lusa|day after tomorrow)\b/.test(raw)) return addDays(today, 2)
  if (/\b(tomorrow|besok)\b/.test(raw)) return addDays(today, 1)
  if (/\b(today|tonight|hari ini)\b/.test(raw)) return today

  const otherWeekday =
    /\b(senin|selasa|rabu|kamis|jumat|jum'at|sabtu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      raw,
    )
  if (/\b(minggu depan|next week)\b/.test(raw) && !otherWeekday) return addDays(today, 7)

  let found: number | null = null
  for (const entry of WEEKDAYS) {
    if (entry.name === 'minggu' && /\bminggu depan\b/.test(raw)) continue
    const pattern = new RegExp(`\\b${entry.name.replace("'", "'")}\\b`)
    if (pattern.test(raw)) {
      found = entry.dow
      break
    }
  }
  if (found === null) return null
  const strictNext = /\bnext\b/.test(raw) || /\bdepan\b/.test(raw)
  return upcomingWeekday(today, found, strictNext)
}

export function hasDateCue(text: string): boolean {
  const raw = text.toLowerCase()
  if (resolveDue(text, new Date('2026-06-15T00:00:00Z')) !== null) return true
  return /\b(today|tomorrow|tonight|besok|lusa|hari ini|monday|tuesday|wednesday|thursday|friday|saturday|sunday|senin|selasa|rabu|kamis|jumat|sabtu|minggu|next week|weekend|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}[/-]\d{1,2}|20\d{2}-\d{2}-\d{2})\b/.test(
    raw,
  ) || /\b(?:may|mei)\s+\d{1,2}\b/.test(raw) || /\b\d{1,2}\s+(?:may|mei)\b/.test(raw)
}

export function dueLabel(dueISO: string | null, now: Date, timeZone = 'Asia/Jakarta'): string {
  if (!dueISO) return '----'
  const today = zonedISO(now, timeZone)
  if (dueISO === today) return 'TODAY'
  if (dueISO === addDays(today, 1)) return 'TOMORROW'
  const [year, month, day] = dueISO.split('-').map(Number)
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${SHORT_WEEK[dow]} ${day} ${SHORT_MONTH[month - 1]}`
}
