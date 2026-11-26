import type { CardRec, Direction, ReviewRec, Settings, SlipKind, Word } from './types'
import { addDays, dayKey, endOfDay, startOfDay } from './util'

export type Stage = 0 | 1 | 2 | 3 | 4
export const STAGES = ['Seed', 'Sprout', 'Growing', 'Strong', 'Mastered'] as const
export const STAGE_HINT = ['not met yet', 'under 3 days', '3–21 days', '21–90 days', '90+ days'] as const

/** A word's stage is its weakest enabled direction, measured in days until recall drops to 90%. */
export function stageOf(word: Word, cards: CardRec[], settings: Settings): Stage {
  if (!word.introducedAt) return 0
  const own = cards.filter(c => c.wordId === word.id && settings.directions[c.direction])
  if (own.length === 0) return 1
  const min = Math.min(...own.map(c => c.strengthDays))
  if (min < 3) return 1
  if (min < 21) return 2
  if (min < 90) return 3
  return 4
}

/** Due today and not yet practiced today (each word is asked once a day). */
export function isDueToday(word: Word, cards: CardRec[], settings: Settings, now: Date, doneToday: Set<string> = new Set()): boolean {
  if (word.status !== 'active' || !word.introducedAt || doneToday.has(word.id)) return false
  const until = endOfDay(now)
  return cards.some(c => c.wordId === word.id && settings.directions[c.direction] && c.dueAt <= until)
}

const gradedOnly = (reviews: ReviewRec[]) => reviews.filter(r => r.graded)

/** Consecutive days with practice, counting back from today (or yesterday if today has none yet). */
export function streak(reviews: ReviewRec[], now: Date): number {
  const days = new Set(gradedOnly(reviews).map(r => dayKey(r.at)))
  let d = startOfDay(now)
  if (!days.has(dayKey(d))) d = addDays(d, -1)
  let n = 0
  while (days.has(dayKey(d))) {
    n++
    d = addDays(d, -1)
  }
  return n
}

export function practiceDays(reviews: ReviewRec[], now: Date, window = 30): number {
  const from = startOfDay(addDays(now, -(window - 1)))
  return new Set(gradedOnly(reviews).filter(r => r.at >= from).map(r => dayKey(r.at))).size
}

export function firstTryRate(reviews: ReviewRec[], now: Date, direction?: Direction, window = 30): number | null {
  const from = startOfDay(addDays(now, -(window - 1)))
  const rs = gradedOnly(reviews).filter(r => r.at >= from && (!direction || r.direction === direction))
  if (rs.length === 0) return null
  return rs.filter(r => r.correct).length / rs.length
}

/**
 * Cards Chris will see on each of the next seven days. Overdue cards count toward today, and,
 * like the session planner, each word shows one direction per day (extra cards move to later days).
 */
export function dueForecast(words: Word[], cards: CardRec[], settings: Settings, now: Date, doneToday: Set<string> = new Set()): { day: Date; count: number }[] {
  const met = new Set(words.filter(w => w.status === 'active' && w.introducedAt).map(w => w.id))
  const days = Array.from({ length: 7 }, (_, i) => ({ day: startOfDay(addDays(now, i)), count: 0 }))
  const byWord = new Map<string, CardRec[]>()
  for (const c of cards) {
    if (!met.has(c.wordId) || !settings.directions[c.direction]) continue
    byWord.set(c.wordId, [...(byWord.get(c.wordId) ?? []), c])
  }
  for (const [wordId, own] of byWord) {
    let next = doneToday.has(wordId) ? 1 : 0
    for (const c of own.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
      const idx = Math.max(next, Math.round((startOfDay(c.dueAt).getTime() - days[0].day.getTime()) / 86_400_000))
      if (idx < 7) days[idx].count++
      next = idx + 1
    }
  }
  return days
}

/** Words with a graded answer today. */
export function doneTodaySet(reviews: ReviewRec[], now: Date): Set<string> {
  const from = startOfDay(now)
  return new Set(reviews.filter(r => r.graded && r.at >= from).map(r => r.wordId))
}

export interface Tricky { word: Word; lapses: number; direction: Direction }

export function trickyWords(words: Word[], cards: CardRec[], min = 4): Tricky[] {
  const out: Tricky[] = []
  for (const w of words) {
    const own = cards.filter(c => c.wordId === w.id)
    const lapses = own.reduce((n, c) => n + c.lapses, 0)
    if (lapses >= min) {
      const worst = own.slice().sort((a, b) => b.lapses - a.lapses)[0]
      out.push({ word: w, lapses, direction: worst.direction })
    }
  }
  return out.sort((a, b) => b.lapses - a.lapses)
}

export function slipSummary(reviews: ReviewRec[], words: Word[], now: Date, window = 30): { kind: SlipKind; count: number; examples: string[] }[] {
  const from = startOfDay(addDays(now, -(window - 1)))
  const byId = new Map(words.map(w => [w.id, w.word]))
  const groups = new Map<SlipKind, { count: number; examples: string[] }>()
  for (const r of reviews) {
    if (!r.slip || r.at < from) continue
    const g = groups.get(r.slip) ?? { count: 0, examples: [] }
    g.count++
    const target = byId.get(r.wordId)
    const ex = `${r.answer} for ${target}`
    if (target && g.examples.length < 3 && !g.examples.includes(ex)) g.examples.push(ex)
    groups.set(r.slip, g)
  }
  return Array.from(groups, ([kind, g]) => ({ kind, ...g })).sort((a, b) => b.count - a.count)
}
