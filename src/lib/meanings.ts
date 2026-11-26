import type { Meaning, Word } from './types'
import { clozeOf } from './util'

type WordLike = Pick<Word, 'word' | 'pos' | 'definition' | 'originalDefinition' | 'meanings' | 'examples' | 'metIn' | 'mySentence'>

/** All meanings of a word, falling back to the single definition on older words. */
export function meaningsOf(w: Pick<Word, 'pos' | 'definition' | 'originalDefinition' | 'meanings'>): Meaning[] {
  if (w.meanings && w.meanings.length > 0) return w.meanings
  return [{ pos: w.pos, definition: w.definition, originalDefinition: w.originalDefinition }]
}

/** Which meaning a review asks about: reviews take turns, so each meaning gets practiced. */
export function meaningIndexFor(w: Pick<Word, 'pos' | 'definition' | 'originalDefinition' | 'meanings'>, reps: number): number {
  return reps % meaningsOf(w).length
}

/**
 * Sentences that use the word in a given meaning, for blanked-out prompts.
 * The first meaning is the one Chris met, so it also gets the general sentences;
 * other meanings only use their own example, so a sentence never contradicts the definition shown.
 */
export function sentencesFor(w: WordLike, meaningIndex: number): string[] {
  const m = meaningsOf(w)[meaningIndex]
  const own = m?.example ? [m.example] : []
  const general = meaningIndex === 0 ? [...w.examples, w.metIn, w.mySentence] : []
  return Array.from(new Set([...own, ...general])).filter(s => s && clozeOf(s, w.word))
}

/** Every sentence that contains the word, whatever the meaning. */
export function allSentences(w: WordLike): string[] {
  return meaningsOf(w).flatMap((_, i) => sentencesFor(w, i)).filter((s, i, a) => a.indexOf(s) === i)
}

/** Keep the old single-definition fields in step with the first meaning. */
export function withPrimary<T extends { meanings?: Meaning[] }>(w: T): T & Pick<Word, 'pos' | 'definition' | 'originalDefinition'> {
  const first = w.meanings?.[0] ?? { pos: '', definition: '', originalDefinition: '' }
  return { ...w, pos: first.pos, definition: first.definition, originalDefinition: first.originalDefinition }
}
