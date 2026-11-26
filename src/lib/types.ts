import type { FsrsCard } from './fsrs'

export type Direction = 'hear' | 'see' | 'recall'
export const DIRECTIONS: Direction[] = ['hear', 'see', 'recall']
export const DIRECTION_LABEL: Record<Direction, string> = { hear: 'Hear it', see: 'See it', recall: 'Recall it' }

export type WordStatus = 'inbox' | 'active' | 'paused'

export interface Sense {
  pos: string
  definition: string
  example?: string
  source: 'wiktionary' | 'simple'
}

/** One meaning of a word. A word can have several; reviews take turns between them. */
export interface Meaning {
  pos: string
  definition: string
  /** The dictionary wording this meaning was based on, kept for credit. */
  originalDefinition: string
  /** A sentence that uses the word in this meaning. */
  example?: string
}

export interface Word {
  id: string
  word: string
  /** pos, definition and originalDefinition always mirror meanings[0]. */
  pos: string
  definition: string
  /** The dictionary wording the definition was based on, kept for credit. */
  originalDefinition: string
  /** All meanings Chris learns. Missing on words saved before meanings existed. */
  meanings?: Meaning[]
  examples: string[]
  metIn: string
  ipa: string
  audioUrl: string
  syllables: string[]
  stress: number
  altSpellings: string[]
  watchOut: string
  tags: string[]
  addedBy: string
  status: WordStatus
  mySentence: string
  hook: string
  sourceUrl: string
  /** Candidate senses kept while a word waits in the Inbox. */
  senses?: Sense[]
  createdAt: Date
  updatedAt: Date
  introducedAt?: Date
}

export interface CardRec {
  id: string
  wordId: string
  direction: Direction
  fsrs: FsrsCard
  dueAt: Date
  /** Days until predicted recall falls to 90%. 0 for cards never reviewed. */
  strengthDays: number
  reps: number
  lapses: number
}

export type Grade = 1 | 2 | 3 | 4
export type AnswerFormat = 'choice' | 'typed' | 'flip' | 'cloze'
export type SlipKind = 'double' | 'silent' | 'vowel' | 'other'

export interface ReviewRec {
  id: string
  cardId: string
  wordId: string
  direction: Direction
  at: Date
  grade: Grade
  correct: boolean
  /** false for in-session retries, which practise but do not reschedule. */
  graded: boolean
  answer: string
  ms: number
  hints: number
  format: AnswerFormat
  slip?: SlipKind
  device: string
}

export interface Settings {
  learner: string
  newPerDay: number
  sessionMinutes: number
  targetRecall: number
  voice: 'en-US' | 'en-GB'
  acceptBritish: boolean
  directions: Record<Direction, boolean>
  addedBy: string
  installHintDismissed: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  learner: 'Chris',
  newPerDay: 8,
  sessionMinutes: 15,
  targetRecall: 0.9,
  voice: 'en-US',
  acceptBritish: true,
  directions: { hear: true, see: true, recall: true },
  addedBy: 'Parent',
  installHintDismissed: false,
}
