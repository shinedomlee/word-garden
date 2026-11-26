import type { CardRec, Direction, Settings, Word } from './types'
import { endOfDay } from './util'

export type Step =
  | { kind: 'meet'; wordId: string }
  | { kind: 'review'; wordId: string; cardId: string; direction: Direction; check?: boolean }
  /** meaning: which of the word's meanings was missed, so the retry asks about that one again. */
  | { kind: 'retry'; wordId: string; cardId: string; direction: Direction; attempt: number; meaning?: number }

export interface PlanInput {
  now: Date
  words: Word[]
  cards: CardRec[]
  /** Words that already had a graded answer today: one direction per word per day. */
  reviewedToday: Set<string>
  introducedToday: number
  settings: Settings
  /** Predicted recall for a card right now (0 for never-reviewed cards). */
  recall: (c: CardRec) => number
}

export interface Plan {
  steps: Step[]
  dueCount: number
  reviewCount: number
  newWords: string[]
  minutes: number
}

export const SECONDS = { review: 20, meet: 45, check: 15 }
/** With more reviews than this waiting, no new words are added that day. */
export const BACKLOG_LIMIT = 60

/** The direction used for a new word's first check. */
export function firstCheckDirection(s: Settings): Direction | null {
  return (['see', 'recall', 'hear'] as Direction[]).find(d => s.directions[d]) ?? null
}

export function planSession(input: PlanInput): Plan {
  const { now, words, cards, reviewedToday, introducedToday, settings, recall } = input
  const active = new Map(words.filter(w => w.status === 'active').map(w => [w.id, w]))
  const until = endOfDay(now)

  // 1. Due cards of words Chris has already met, one card per word.
  const best = new Map<string, { card: CardRec; r: number }>()
  for (const c of cards) {
    const w = active.get(c.wordId)
    if (!w || !w.introducedAt || !settings.directions[c.direction]) continue
    if (c.dueAt > until || reviewedToday.has(c.wordId)) continue
    const r = recall(c)
    const cur = best.get(c.wordId)
    if (!cur || r < cur.r) best.set(c.wordId, { card: c, r })
  }
  const due = Array.from(best.values()).sort((a, b) => a.r - b.r).map(x => x.card)

  // 2. Fit reviews into the time limit; the rest wait for tomorrow.
  const budget = settings.sessionMinutes * 60
  const reviews = due.slice(0, Math.max(0, Math.floor(budget / SECONDS.review)))
  let used = reviews.length * SECONDS.review

  // 3. New words, if there is room in the day's limit, the backlog and the time.
  const checkDir = firstCheckDirection(settings)
  const fresh: Word[] = []
  if (checkDir && due.length <= BACKLOG_LIMIT) {
    const room = Math.max(0, settings.newPerDay - introducedToday)
    const seeds = words
      .filter(w => w.status === 'active' && !w.introducedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    for (const w of seeds) {
      if (fresh.length >= room) break
      if (used + SECONDS.meet + SECONDS.check > budget && reviews.length + fresh.length > 0) break
      fresh.push(w)
      used += SECONDS.meet + SECONDS.check
    }
  }

  // 4. Interleave: a new word every third slot; its first check lands three items after Meet.
  const steps: Step[] = []
  const pending: { at: number; step: Step }[] = []
  const rq = reviews.slice()
  const nq = fresh.slice()
  while (rq.length || nq.length || pending.length) {
    const ready = pending.findIndex(p => steps.length >= p.at)
    if (ready >= 0) {
      steps.push(pending.splice(ready, 1)[0].step)
      continue
    }
    if (nq.length && (steps.length % 3 === 0 || rq.length === 0)) {
      const w = nq.shift()!
      steps.push({ kind: 'meet', wordId: w.id })
      pending.push({ at: steps.length + 3, step: { kind: 'review', wordId: w.id, cardId: `${w.id}:${checkDir}`, direction: checkDir!, check: true } })
      continue
    }
    if (rq.length) {
      const c = rq.shift()!
      steps.push({ kind: 'review', wordId: c.wordId, cardId: c.id, direction: c.direction })
      continue
    }
    pending.sort((a, b) => a.at - b.at)
    steps.push(pending.shift()!.step)
  }

  return {
    steps,
    dueCount: due.length,
    reviewCount: reviews.length,
    newWords: fresh.map(w => w.id),
    minutes: Math.max(1, Math.round(used / 60)),
  }
}

/** Put a retry of a missed card a few steps later (or at the end if the session is short). */
export function insertRetry(steps: Step[], index: number, step: Step, gap = 4): Step[] {
  const at = Math.min(steps.length, index + 1 + gap)
  return [...steps.slice(0, at), step, ...steps.slice(at)]
}
