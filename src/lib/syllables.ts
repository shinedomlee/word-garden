import hyphen from 'hyphen/en-us/index.js'

/** Split a word into syllable-like chunks using TeX hyphenation patterns. Editable in the app. */
export function syllabify(word: string): string[] {
  const w = word.trim()
  if (!w || /\s/.test(w)) return w ? [w] : []
  return hyphen.hyphenateSync(w, { hyphenChar: '·', minWordLength: 4 }).split('·').filter(Boolean)
}

const IPA_VOWELS = /[aeiouyæɑɒɔəɛɜɪʊʌɐɚɝøœɯɤɵʉɨɘ]+/g

/**
 * Index of the stressed syllable, read from the primary stress mark in an IPA string:
 * the number of vowel groups before ˈ. "/ɹɪˈlʌktənt/" gives 1 (re·LUC·tant).
 */
export function stressIndex(ipa: string, syllableCount: number): number {
  const s = ipa.replace(/[/[\]]/g, '')
  const at = s.indexOf('ˈ')
  if (at < 0 || syllableCount <= 1) return 0
  const before = s.slice(0, at).match(IPA_VOWELS)
  const idx = before ? before.length : 0
  return Math.max(0, Math.min(syllableCount - 1, idx))
}
