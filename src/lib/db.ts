import Dexie, { type EntityTable } from 'dexie'
import { getScheduler, newFsrsCard, recallChance, reviewCard, reviveFsrsCard, strengthDays } from './fsrs'
import { fetchFreeDictionary, fetchSimpleWiktionary, type LookupResult } from './dictionary'
import {
  DEFAULT_SETTINGS,
  DIRECTIONS,
  type AnswerFormat,
  type CardRec,
  type Direction,
  type Grade,
  type ReviewRec,
  type Sense,
  type Settings,
  type SlipKind,
  type Word,
  type WordStatus,
} from './types'
import { addDays, cardIdFor, DAY, deviceName, startOfDay, uid } from './util'
import { planSession, type Plan } from './session'

interface KV { key: string; value: unknown }
interface Lookup { word: string; data: LookupResult | null; simple: Sense[]; at: Date }

class WordGardenDB extends Dexie {
  words!: EntityTable<Word, 'id'>
  cards!: EntityTable<CardRec, 'id'>
  reviews!: EntityTable<ReviewRec, 'id'>
  kv!: EntityTable<KV, 'key'>
  lookups!: EntityTable<Lookup, 'word'>

  constructor() {
    super('word-garden')
    this.version(1).stores({
      words: 'id, status, word, createdAt',
      cards: 'id, wordId, dueAt',
      reviews: 'id, at, wordId, cardId',
      kv: 'key',
      lookups: 'word',
    })
  }
}

export const db = new WordGardenDB()

/* ---------- settings ---------- */

export function mergeSettings(value: unknown): Settings {
  const v = (value ?? {}) as Partial<Settings>
  return { ...DEFAULT_SETTINGS, ...v, directions: { ...DEFAULT_SETTINGS.directions, ...(v.directions ?? {}) } }
}

export async function getSettings(): Promise<Settings> {
  return mergeSettings((await db.kv.get('settings'))?.value)
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings()
  await db.kv.put({ key: 'settings', value: { ...cur, ...patch } })
}

/* ---------- words ---------- */

export type WordDraft = Omit<Word, 'id' | 'createdAt' | 'updatedAt' | 'introducedAt' | 'status'>

export async function addWord(draft: WordDraft, status: WordStatus = 'active'): Promise<string> {
  const s = await getScheduler((await getSettings()).targetRecall)
  const now = new Date()
  const id = uid()
  const word: Word = { ...draft, id, status, createdAt: now, updatedAt: now }
  const cards: CardRec[] = DIRECTIONS.map(direction => {
    const cid = cardIdFor(id, direction)
    return { id: cid, wordId: id, direction, fsrs: newFsrsCard(s, cid, now), dueAt: now, strengthDays: 0, reps: 0, lapses: 0 }
  })
  await db.transaction('rw', db.words, db.cards, async () => {
    await db.words.add(word)
    await db.cards.bulkAdd(cards)
  })
  return id
}

export async function updateWord(id: string, patch: Partial<Word>): Promise<void> {
  await db.words.update(id, { ...patch, updatedAt: new Date() })
}

export async function deleteWord(id: string): Promise<void> {
  await db.transaction('rw', db.words, db.cards, db.reviews, async () => {
    await db.words.delete(id)
    await db.cards.where('wordId').equals(id).delete()
    await db.reviews.where('wordId').equals(id).delete()
  })
}

export async function findWordByText(text: string): Promise<Word | undefined> {
  const t = text.trim().toLowerCase()
  return (await db.words.toArray()).find(w => w.word.toLowerCase() === t)
}

/** Chris meets the word: its first-check card is due now, the other directions from tomorrow. */
export async function introduceWord(wordId: string, checkDir: Direction | null, now = new Date()): Promise<void> {
  const tomorrow = startOfDay(addDays(now, 1))
  await db.transaction('rw', db.words, db.cards, async () => {
    await db.words.update(wordId, { introducedAt: now, updatedAt: now })
    for (const d of DIRECTIONS) await db.cards.update(cardIdFor(wordId, d), { dueAt: d === checkDir ? now : tomorrow })
  })
}

/* ---------- answers ---------- */

export interface AnswerInput {
  cardId: string
  grade: Grade
  correct: boolean
  graded: boolean
  answer: string
  ms: number
  hints: number
  format: AnswerFormat
  slip?: SlipKind
  now?: Date
}

/** Save an answer. Graded answers also reschedule the card with FSRS. Returns the card afterwards. */
export async function recordAnswer(a: AnswerInput): Promise<CardRec> {
  const s = await getScheduler((await getSettings()).targetRecall)
  const now = a.now ?? new Date()
  return db.transaction('rw', db.cards, db.reviews, async () => {
    const card = await db.cards.get(a.cardId)
    if (!card) throw new Error('This card no longer exists.')
    let next = card
    if (a.graded) {
      const f = reviewCard(s, reviveFsrsCard(card.fsrs), a.grade, now)
      next = { ...card, fsrs: f, dueAt: new Date(f.dueAt as Date), strengthDays: strengthDays(s, f), reps: f.reps, lapses: f.lapses }
      await db.cards.put(next)
    }
    await db.reviews.add({
      id: uid(),
      cardId: card.id,
      wordId: card.wordId,
      direction: card.direction,
      at: now,
      grade: a.grade,
      correct: a.correct,
      graded: a.graded,
      answer: a.answer,
      ms: Math.round(a.ms),
      hints: a.hints,
      format: a.format,
      slip: a.slip,
      device: deviceName(),
    })
    return next
  })
}

/* ---------- today's plan ---------- */

export async function buildTodayPlan(now = new Date()): Promise<{ plan: Plan; settings: Settings }> {
  const settings = await getSettings()
  const s = await getScheduler(settings.targetRecall)
  const [words, cards, today] = await Promise.all([
    db.words.toArray(),
    db.cards.toArray(),
    db.reviews.where('at').aboveOrEqual(startOfDay(now)).toArray(),
  ])
  const reviewedToday = new Set(today.filter(r => r.graded).map(r => r.wordId))
  const introducedToday = words.filter(w => w.introducedAt && w.introducedAt >= startOfDay(now)).length
  const plan = planSession({
    now,
    words,
    cards,
    reviewedToday,
    introducedToday,
    settings,
    recall: c => recallChance(s, reviveFsrsCard(c.fsrs), now),
  })
  return { plan, settings }
}

/* ---------- dictionary cache ---------- */

export async function cachedLookup(word: string): Promise<{ data: LookupResult | null; simple: Sense[] }> {
  const key = word.trim().toLowerCase()
  const hit = await db.lookups.get(key)
  if (hit && Date.now() - hit.at.getTime() < 30 * DAY) return { data: hit.data, simple: hit.simple }
  const [data, simple] = await Promise.all([fetchFreeDictionary(key), fetchSimpleWiktionary(key).catch(() => [] as Sense[])])
  await db.lookups.put({ word: key, data, simple, at: new Date() })
  return { data, simple }
}

/* ---------- backup ---------- */

export async function exportData(): Promise<string> {
  const [settings, words, cards, reviews] = await Promise.all([getSettings(), db.words.toArray(), db.cards.toArray(), db.reviews.toArray()])
  return JSON.stringify({ app: 'word-garden', version: 1, exportedAt: new Date(), settings, words, cards, reviews })
}

const toDate = (v: unknown) => (v ? new Date(v as string) : undefined)

export async function importData(json: string): Promise<{ words: number; reviews: number }> {
  const data = JSON.parse(json) as { app?: string; settings?: unknown; words?: Word[]; cards?: CardRec[]; reviews?: ReviewRec[] }
  if (data.app !== 'word-garden' || !Array.isArray(data.words) || !Array.isArray(data.cards)) {
    throw new Error('This file is not a Word Garden backup.')
  }
  const words = data.words.map(w => ({ ...w, createdAt: toDate(w.createdAt)!, updatedAt: toDate(w.updatedAt)!, introducedAt: toDate(w.introducedAt) }))
  const cards = data.cards.map(c => ({ ...c, dueAt: toDate(c.dueAt)!, fsrs: reviveFsrsCard(c.fsrs) }))
  const reviews = (data.reviews ?? []).map(r => ({ ...r, at: toDate(r.at)! }))
  await db.transaction('rw', [db.words, db.cards, db.reviews, db.kv], async () => {
    await Promise.all([db.words.clear(), db.cards.clear(), db.reviews.clear()])
    await db.words.bulkAdd(words)
    await db.cards.bulkAdd(cards)
    await db.reviews.bulkAdd(reviews)
    await db.kv.put({ key: 'settings', value: mergeSettings(data.settings) })
  })
  return { words: words.length, reviews: reviews.length }
}

export async function eraseEverything(): Promise<void> {
  await db.transaction('rw', [db.words, db.cards, db.reviews, db.kv, db.lookups], async () => {
    await Promise.all([db.words.clear(), db.cards.clear(), db.reviews.clear(), db.kv.clear(), db.lookups.clear()])
  })
}
