import { describe, expect, it } from 'vitest'
import { insertRetry, planSession, type PlanInput } from '../src/lib/session'
import { dueForecast, streak, stageOf } from '../src/lib/stats'
import { DEFAULT_SETTINGS, type CardRec, type Direction, type ReviewRec, type Word } from '../src/lib/types'

const now = new Date('2026-11-22T16:00:00')
const yesterday = new Date('2026-11-21T10:00:00')

function word(id: string, opts: Partial<Word> = {}): Word {
  return {
    id, word: id, pos: 'noun', definition: `meaning of ${id}`, originalDefinition: '', examples: [], metIn: '', ipa: '', audioUrl: '',
    syllables: [id], stress: 0, altSpellings: [], watchOut: '', tags: [], addedBy: 'Parent', status: 'active', mySentence: '', hook: '',
    sourceUrl: '', createdAt: new Date('2026-11-01T10:00:00'), updatedAt: new Date('2026-11-01T10:00:00'), ...opts,
  }
}
function card(wordId: string, direction: Direction, dueAt: Date, strengthDays = 5): CardRec {
  return { id: `${wordId}:${direction}`, wordId, direction, fsrs: {} as CardRec['fsrs'], dueAt, strengthDays, reps: 1, lapses: 0 }
}
function input(over: Partial<PlanInput>): PlanInput {
  return { now, words: [], cards: [], reviewedToday: new Set(), introducedToday: 0, settings: DEFAULT_SETTINGS, recall: () => 0.8, ...over }
}

describe('planSession', () => {
  it('puts the most-forgotten word first and asks one direction per word', () => {
    const words = [word('a', { introducedAt: yesterday }), word('b', { introducedAt: yesterday })]
    const cards = [card('a', 'hear', yesterday), card('a', 'see', yesterday), card('b', 'recall', yesterday)]
    const recall = (c: CardRec) => ({ 'a:hear': 0.7, 'a:see': 0.5, 'b:recall': 0.3 })[c.id] ?? 1
    const plan = planSession(input({ words, cards, recall, settings: { ...DEFAULT_SETTINGS, newPerDay: 0 } }))
    expect(plan.steps.map(s => (s.kind === 'meet' ? s.wordId : s.cardId))).toEqual(['b:recall', 'a:see'])
  })

  it('introduces new words with a first check three steps after Meet', () => {
    const met = ['a', 'b', 'c', 'd'].map(id => word(id, { introducedAt: yesterday }))
    const seeds = [word('n1', { createdAt: new Date('2026-11-20') }), word('n2', { createdAt: new Date('2026-11-21') })]
    const cards = met.map(w => card(w.id, 'see', yesterday))
    const plan = planSession(input({ words: [...met, ...seeds], cards }))
    const order = plan.steps.map(s => (s.kind === 'meet' ? `meet:${s.wordId}` : s.kind === 'review' && s.check ? `check:${s.wordId}` : s.cardId))
    const meet1 = order.indexOf('meet:n1')
    expect(order.indexOf('check:n1') - meet1).toBe(4)
    expect(plan.newWords).toEqual(['n1', 'n2'])
  })

  it('respects the daily new-word limit and the backlog limit', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => word(`s${i}`))
    expect(planSession(input({ words: seeds, introducedToday: 6 })).newWords).toHaveLength(2)
    const met = Array.from({ length: 70 }, (_, i) => word(`m${i}`, { introducedAt: yesterday }))
    const cards = met.map(w => card(w.id, 'see', yesterday))
    const plan = planSession(input({ words: [...met, ...seeds], cards }))
    expect(plan.newWords).toHaveLength(0)
    expect(plan.reviewCount).toBe(45) // 15 minutes at 20 seconds a card
  })

  it('skips paused words, disabled directions and words already practised today', () => {
    const words = [word('a', { introducedAt: yesterday }), word('b', { introducedAt: yesterday, status: 'paused' }), word('c', { introducedAt: yesterday })]
    const cards = [card('a', 'hear', yesterday), card('b', 'see', yesterday), card('c', 'see', yesterday)]
    const settings = { ...DEFAULT_SETTINGS, newPerDay: 0, directions: { hear: false, see: true, recall: true } }
    expect(planSession(input({ words, cards, settings })).steps).toEqual([{ kind: 'review', wordId: 'c', cardId: 'c:see', direction: 'see' }])
    expect(planSession(input({ words, cards, settings, reviewedToday: new Set(['c']) })).steps).toEqual([])
  })

  it('inserts a retry a few steps later', () => {
    const steps = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ kind: 'meet' as const, wordId: id }))
    const out = insertRetry(steps, 0, { kind: 'retry', wordId: 'a', cardId: 'a:see', direction: 'see', attempt: 1 })
    expect(out.findIndex(s => s.kind === 'retry')).toBe(5)
  })
})

describe('stats', () => {
  it('uses the weakest direction for the stage', () => {
    const w = word('a', { introducedAt: yesterday })
    const cards = [card('a', 'hear', now, 30), card('a', 'see', now, 100), card('a', 'recall', now, 2)]
    expect(stageOf(w, cards, DEFAULT_SETTINGS)).toBe(1)
    expect(stageOf(w, cards, { ...DEFAULT_SETTINGS, directions: { hear: true, see: true, recall: false } })).toBe(3)
    expect(stageOf(word('b'), cards, DEFAULT_SETTINGS)).toBe(0)
  })
  it('forecasts one direction per word per day, starting tomorrow for words done today', () => {
    const w = word('a', { introducedAt: yesterday })
    const cards = [card('a', 'hear', yesterday), card('a', 'see', yesterday), card('a', 'recall', yesterday)]
    expect(dueForecast([w], cards, DEFAULT_SETTINGS, now).map(d => d.count)).toEqual([1, 1, 1, 0, 0, 0, 0])
    expect(dueForecast([w], cards, DEFAULT_SETTINGS, now, new Set(['a'])).map(d => d.count)).toEqual([0, 1, 1, 1, 0, 0, 0])
  })
  it('counts the streak back from today or yesterday', () => {
    const r = (d: string): ReviewRec => ({ id: d, cardId: 'a:see', wordId: 'a', direction: 'see', at: new Date(d), grade: 3, correct: true, graded: true, answer: '', ms: 1, hints: 0, format: 'choice', device: 'test' })
    expect(streak([r('2026-11-20T09:00:00'), r('2026-11-21T09:00:00')], now)).toBe(2)
    expect(streak([r('2026-11-21T09:00:00'), r('2026-11-22T09:00:00')], now)).toBe(2)
    expect(streak([r('2026-11-19T09:00:00')], now)).toBe(0)
  })
})
