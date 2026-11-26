import type { Direction } from './types'

/** Random id that also works on plain-HTTP pages, where crypto.randomUUID is missing. */
export function uid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export const cardIdFor = (wordId: string, direction: Direction) => `${wordId}:${direction}`

export const DAY = 86_400_000

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
/** Local calendar date as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** "in a few minutes", "later today", "tomorrow", "in 6 days", "in about 3 months". */
export function whenText(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime()
  if (ms < 60 * 60 * 1000) return 'in a few minutes'
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY)
  if (days <= 0) return 'later today'
  if (days === 1) return 'tomorrow'
  if (days < 60) return `in ${days} days`
  if (days < 365) return `in about ${Math.round(days / 30)} months`
  return 'in about a year'
}

export function daysText(d: number): string {
  if (d <= 0) return 'not started'
  if (d < 1) return 'under a day'
  if (d < 60) return `${Math.round(d)} ${Math.round(d) === 1 ? 'day' : 'days'}`
  if (d < 365) return `${Math.round(d / 30)} months`
  return `${(d / 365).toFixed(1)} years`
}

export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  return 'Computer'
}

export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replace the word (and simple inflections) in a sentence with a blank. Returns null if absent. */
export function clozeOf(sentence: string, word: string): string | null {
  const re = new RegExp(`\\b${escapeRegExp(word)}(s|es|d|ed|ing|er|ers|est|ly)?\\b`, 'i')
  if (!re.test(sentence)) return null
  return sentence.replace(new RegExp(re.source, 'gi'), '_____')
}
