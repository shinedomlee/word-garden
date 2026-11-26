import { DefaultScheduler } from 'ts-fsrs'
import type { Grade } from './types'

export type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>

/**
 * The card state ts-fsrs (FSRS-7) produces, as stored in IndexedDB. The library's own types are a
 * union across model versions, so values cross into the library through `lib()` casts only.
 */
export interface FsrsCard {
  stability: number
  stabilityFast?: number
  difficulty: number
  state: 0 | 1 | 2 | 3
  scheduleStatus: string
  dueAt: Date
  lastReviewAt: Date | null
  cardId: string | number
  reps: number
  lapses: number
  scheduledDays: number
  learningStep?: number
}

const lib = (c: FsrsCard) => c as never
const cache = new Map<number, Promise<Scheduler>>()

/**
 * FSRS scheduler (FSRS-7 via ts-fsrs). Short-term learning steps are off because the
 * session itself re-asks missed cards a few cards later. Intervals are capped at a year.
 */
export function getScheduler(targetRecall = 0.9): Promise<Scheduler> {
  const key = Math.round(targetRecall * 100) / 100
  let s = cache.get(key)
  if (!s) {
    s = DefaultScheduler({ desiredRetention: key, enableShortTerm: false, enableFuzz: true, maximumInterval: 365 })
    cache.set(key, s)
  }
  return s
}

export function newFsrsCard(s: Scheduler, cardId: string, now: Date): FsrsCard {
  return s.newCard({ now, cardId } as never) as unknown as FsrsCard
}

const isNew = (c: FsrsCard) => c.state === 0 || !c.lastReviewAt

/** Days until predicted recall drops to 90%: the "memory strength" shown in the garden. */
export function strengthDays(s: Scheduler, c: FsrsCard): number {
  if (isNew(c)) return 0
  const d = s.model.nextInterval(lib(c), 0.9)
  return Number.isFinite(d) ? d : 0
}

/** Predicted chance of recalling the card now (0–1). New cards count as 0. */
export function recallChance(s: Scheduler, c: FsrsCard, now: Date): number {
  if (isNew(c)) return 0
  const elapsed = Math.max(0, s.chrono.difference(new Date(c.lastReviewAt as Date), now))
  const r = s.model.forgettingCurve(lib(c), elapsed)
  return Number.isFinite(r) ? r : 0
}

export function reviewCard(s: Scheduler, c: FsrsCard, grade: Grade, now: Date): FsrsCard {
  return s.review({ card: lib(c), grade, now }).card as unknown as FsrsCard
}

/** Dates come back as strings after a JSON backup; ts-fsrs needs real Date objects. */
export function reviveFsrsCard(c: FsrsCard): FsrsCard {
  const x = { ...c } as Record<string, unknown>
  for (const k of ['dueAt', 'lastReviewAt']) {
    if (typeof x[k] === 'string') x[k] = new Date(x[k] as string)
  }
  return x as unknown as FsrsCard
}
