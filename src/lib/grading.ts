import type { Grade, SlipKind } from './types'

export const normalize = (s: string) =>
  s.normalize('NFKC').trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ')

type Op = { op: 'keep' | 'sub' | 'del' | 'ins'; t: number; a: number }

/** Levenshtein alignment of answer against target, with the operations that turn one into the other. */
export function align(target: string, answer: string): { dist: number; ok: boolean[]; ops: Op[] } {
  const n = target.length
  const m = answer.length
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (target[i - 1] === answer[j - 1] ? 0 : 1))
    }
  }
  const ok = new Array<boolean>(n).fill(false)
  const ops: Op[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && target[i - 1] === answer[j - 1] && d[i][j] === d[i - 1][j - 1]) {
      ok[i - 1] = true
      ops.push({ op: 'keep', t: i - 1, a: j - 1 })
      i--
      j--
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', t: i - 1, a: j - 1 })
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'del', t: i - 1, a: j })
      i--
    } else {
      ops.push({ op: 'ins', t: i, a: j - 1 })
      j--
    }
  }
  ops.reverse()
  return { dist: d[n][m], ok, ops }
}

export interface TypedCheck {
  correct: boolean
  /** One letter off in a word of six or more letters. */
  nearMiss: boolean
  /** Set when an accepted alternative (British) spelling was typed. */
  variant?: string
  empty: boolean
  dist: number
  ok: boolean[]
}

export function checkTyped(target: string, answer: string, accepted: string[] = []): TypedCheck {
  const t = normalize(target)
  const a = normalize(answer)
  if (!a) return { correct: false, nearMiss: false, empty: true, dist: t.length, ok: new Array(t.length).fill(false) }
  if (a === t) return { correct: true, nearMiss: false, empty: false, dist: 0, ok: new Array(t.length).fill(true) }
  const alt = accepted.map(normalize).find(v => v === a)
  if (alt) return { correct: true, nearMiss: false, variant: alt, empty: false, dist: 0, ok: new Array(t.length).fill(true) }
  const r = align(t, a)
  return { correct: false, nearMiss: r.dist === 1 && t.length >= 6, empty: false, dist: r.dist, ok: r.ok }
}

/** Typical time to type the word, in ms. Used to call an answer slow or fast. */
export const expectedMs = (target: string) => 3000 + 350 * target.length

export function rateTyped(c: TypedCheck, o: { hints: number; ms: number; target: string; strengthDays: number }): Grade {
  if (c.empty || (!c.correct && !c.nearMiss)) return 1
  if (c.nearMiss) return 2
  const exp = expectedMs(o.target)
  if (o.hints > 0 || o.ms > exp * 3) return 2
  if (o.strengthDays >= 21 && o.ms < exp * 0.6) return 4
  return 3
}

export function rateChoice(correct: boolean, ms: number): Grade {
  if (!correct) return 1
  return ms > 15_000 ? 2 : 3
}

const VOWELS = new Set('aeiouy')
const SILENT_PAIRS = ['rh', 'gh', 'wh', 'kn', 'mb', 'wr', 'gn', 'mn', 'ps', 'sc', 'tch', 'stl', 'bt', 'lk', 'lm', 'gu']

/** Classify a misspelling so the Progress page can show which patterns trip Chris up. */
export function classifySlip(target: string, answer: string): SlipKind | null {
  const t = normalize(target)
  const a = normalize(answer)
  if (!a || a === t) return null
  const { ops } = align(t, a)
  const edits = ops.filter(o => o.op !== 'keep')
  if (edits.length === 0) return null
  if (edits.length > 3) return 'other'
  for (const e of edits) {
    if (e.op === 'del' && (t[e.t - 1] === t[e.t] || t[e.t + 1] === t[e.t])) return 'double'
    if (e.op === 'ins' && (a[e.a - 1] === a[e.a] || a[e.a + 1] === a[e.a])) return 'double'
  }
  for (const e of edits) {
    if (e.op !== 'del') continue
    for (const pair of SILENT_PAIRS) {
      for (let start = Math.max(0, e.t - pair.length + 1); start <= e.t; start++) {
        if (t.startsWith(pair, start)) return 'silent'
      }
    }
  }
  const isVowelEdit = (e: Op) =>
    (e.op === 'sub' && VOWELS.has(t[e.t]) && VOWELS.has(a[e.a])) ||
    (e.op === 'del' && VOWELS.has(t[e.t])) ||
    (e.op === 'ins' && VOWELS.has(a[e.a]))
  if (edits.every(isVowelEdit)) return 'vowel'
  return 'other'
}

export const SLIP_LABEL: Record<SlipKind, string> = {
  double: 'Double letters',
  silent: 'Silent letters',
  vowel: 'Vowel sounds',
  other: 'Other slips',
}

/** Plausible misspellings of a word, used as look-alike choices for words Chris keeps missing. */
export function lookAlikes(word: string, others: string[], count = 3): string[] {
  const w = normalize(word)
  const out = new Set<string>()
  const swaps: Record<string, string> = { a: 'e', e: 'a', i: 'e', o: 'u', u: 'o', y: 'i' }
  for (let i = 0; i < w.length && out.size < 8; i++) {
    const ch = w[i]
    if (swaps[ch]) out.add(w.slice(0, i) + swaps[ch] + w.slice(i + 1))
    if (i > 0 && w[i] === w[i - 1]) out.add(w.slice(0, i) + w.slice(i + 1))
    else if (!VOWELS.has(ch) && i > 0 && i < w.length - 1) out.add(w.slice(0, i) + ch + w.slice(i))
  }
  const near = others
    .map(normalize)
    .filter(o => o !== w)
    .map(o => ({ o, d: align(w, o).dist }))
    .filter(x => x.d <= 3)
    .sort((x, y) => x.d - y.d)
    .map(x => x.o)
  const pool = [...near.slice(0, 1), ...Array.from(out)].filter(x => x !== w && x.length > 1)
  return Array.from(new Set(pool)).slice(0, count)
}
