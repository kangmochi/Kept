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

const SHORT_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const SHORT_MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function zonedParts(now: Date, timeZone: string): { iso: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value
  const year = pick('year')
  const month = pick('month')
  const day = pick('day')
  const hour = pick('hour')
  const minute = pick('minute')
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new Error(`Could not read the calendar date in ${timeZone}`)
  }
  let hourNum = Number(hour)
  if (hourNum === 24) hourNum = 0
  return { iso: `${year}-${month}-${day}`, hour: hourNum, minute: Number(minute) }
}

export function zonedISO(now: Date, timeZone: string): string {
  return zonedParts(now, timeZone).iso
}

/** Last calendar day of the month that contains `iso`. */
export function endOfMonth(iso: string): string {
  const [year, month] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/** Monday through Sunday, inclusive, in the given zone. */
export function weekBounds(now: Date, timeZone = 'Asia/Jakarta'): { start: string; end: string } {
  const today = zonedISO(now, timeZone)
  const dow = weekdayIndex(today)
  const sinceMonday = dow === 0 ? 6 : dow - 1
  const start = addDays(today, -sinceMonday)
  return { start, end: addDays(start, 6) }
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
  if (/\b(end of (?:the )?month|akhir bulan)\b/.test(raw)) return endOfMonth(today)

  const inDays = raw.match(/\b(?:in\s+)?(\d+)\s+(?:days?|hari)\s*(?:lagi)?\b/)
  if (inDays && (/\bin\s+\d+\s+days?\b/.test(raw) || /\b\d+\s+hari\s+lagi\b/.test(raw))) {
    const n = Number(inDays[1])
    if (n >= 1 && n <= 366) return addDays(today, n)
  }
  const inWeeks = raw.match(/\bin\s+(\d+)\s+weeks?\b/) || raw.match(/\b(\d+)\s+minggu\s+lagi\b/)
  if (inWeeks) {
    const n = Number(inWeeks[1])
    if (n >= 1 && n <= 52) return addDays(today, n * 7)
  }

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
  if (found !== null) {
    const strictNext = /\bnext\b/.test(raw) || /\bdepan\b/.test(raw)
    return upcomingWeekday(today, found, strictNext)
  }
  return clockDate(raw, now, timeZone)
}

/**
 * A clock time with no calendar day is today in the zone, or tomorrow when that
 * time has already passed. "5pm" and "jam 5 sore" are 17:00.
 */
function clockDate(raw: string, now: Date, timeZone: string): string | null {
  const match =
    raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ||
    raw.match(/\bjam\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?\b/) ||
    raw.match(/\b(?:by|at|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|pagi|siang|sore|malam)\b/)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const mer = match[3]
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null
  if (!mer && !/\bjam\s+\d/.test(raw)) return null
  if (mer === 'pm' && hour < 12) hour += 12
  if (mer === 'am' && hour === 12) hour = 0
  if (mer === 'pagi' && hour === 12) hour = 0
  if ((mer === 'sore' || mer === 'malam' || mer === 'siang') && hour < 12) hour += 12
  if (hour > 23) return null
  const parts = zonedParts(now, timeZone)
  const target = hour * 60 + minute
  const current = parts.hour * 60 + parts.minute
  return target > current ? parts.iso : addDays(parts.iso, 1)
}

export function hasDateCue(text: string): boolean {
  const raw = text.toLowerCase()
  if (resolveDue(text, new Date('2026-06-15T00:00:00Z')) !== null) return true
  return (
    /\b(today|tomorrow|tonight|besok|lusa|hari ini|monday|tuesday|wednesday|thursday|friday|saturday|sunday|senin|selasa|rabu|kamis|jumat|sabtu|minggu|next week|weekend|end of (?:the )?month|akhir bulan|hari lagi|minggu lagi|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}[/-]\d{1,2}|20\d{2}-\d{2}-\d{2})\b/.test(
      raw,
    ) ||
    /\b(?:may|mei)\s+\d{1,2}\b/.test(raw) ||
    /\b\d{1,2}\s+(?:may|mei)\b/.test(raw) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.test(raw) ||
    /\bjam\s+\d{1,2}\b/.test(raw) ||
    /\bin\s+\d+\s+(?:days?|weeks?)\b/.test(raw)
  )
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
