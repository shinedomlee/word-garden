import { describe, expect, it } from 'vitest'
import { checkTyped, classifySlip, lookAlikes, rateChoice, rateTyped } from '../src/lib/grading'
import { britishCandidates } from '../src/lib/spelling'
import { stressIndex, syllabify } from '../src/lib/syllables'
import { parseFreeDictionary, parseSimpleWikitext } from '../src/lib/dictionary'
import { clozeOf, whenText } from '../src/lib/util'
import { getScheduler, newFsrsCard, recallChance, reviewCard, reviveFsrsCard, strengthDays } from '../src/lib/fsrs'

describe('typed answers', () => {
  it('accepts exact answers regardless of case and spaces', () => {
    expect(checkTyped('reluctant', ' Reluctant ').correct).toBe(true)
  })
  it('treats one slip in a long word as a near miss and marks the missing letter', () => {
    const c = checkTyped('reluctant', 'relucant')
    expect(c.correct).toBe(false)
    expect(c.nearMiss).toBe(true)
    expect(c.ok.map((ok, i) => (ok ? '' : 'reluctant'[i])).join('')).toBe('t')
  })
  it('does not give near misses on short words', () => {
    expect(checkTyped('swift', 'swit').nearMiss).toBe(false)
  })
  it('accepts a listed British spelling and reports it', () => {
    const c = checkTyped('harbor', 'Harbour', ['harbour'])
    expect(c.correct).toBe(true)
    expect(c.variant).toBe('harbour')
  })
  it('maps results to FSRS grades', () => {
    const base = { target: 'harbor', strengthDays: 5, hints: 0, ms: 5000 }
    expect(rateTyped(checkTyped('harbor', ''), base)).toBe(1)
    expect(rateTyped(checkTyped('harbor', 'harber'), base)).toBe(2)
    expect(rateTyped(checkTyped('harbor', 'harbor'), { ...base, hints: 1 })).toBe(2)
    expect(rateTyped(checkTyped('harbor', 'harbor'), base)).toBe(3)
    expect(rateTyped(checkTyped('harbor', 'harbor'), { ...base, strengthDays: 30, ms: 2000 })).toBe(4)
    expect(rateTyped(checkTyped('harbor', 'harbor'), { ...base, ms: 60_000 })).toBe(2)
    expect(rateChoice(false, 1000)).toBe(1)
    expect(rateChoice(true, 4000)).toBe(3)
  })
})

describe('spelling slips', () => {
  it('classifies common patterns', () => {
    expect(classifySlip('necessary', 'necesary')).toBe('double')
    expect(classifySlip('occasion', 'occassion')).toBe('double')
    expect(classifySlip('rhythm', 'rythm')).toBe('silent')
    expect(classifySlip('harbor', 'harber')).toBe('vowel')
    expect(classifySlip('harbor', 'harbor')).toBeNull()
  })
  it('makes distinct look-alikes that are not the word itself', () => {
    const l = lookAlikes('reluctant', ['relevant', 'harbor'])
    expect(l).toHaveLength(3)
    expect(l).not.toContain('reluctant')
    expect(new Set(l).size).toBe(3)
  })
})

describe('British spellings', () => {
  it('suggests likely variants', () => {
    expect(britishCandidates('harbor')).toContain('harbour')
    expect(britishCandidates('favorite')).toContain('favourite')
    expect(britishCandidates('center')).toContain('centre')
    expect(britishCandidates('organize')).toContain('organise')
    expect(britishCandidates('traveled')).toContain('travelled')
    expect(britishCandidates('gray')).toContain('grey')
    expect(britishCandidates('glimpse')).toEqual([])
  })
})

describe('syllables and stress', () => {
  it('splits words and finds the stressed syllable from IPA', () => {
    expect(syllabify('reluctant')).toEqual(['re', 'luc', 'tant'])
    expect(stressIndex('/ɹɪˈlʌktənt/', 3)).toBe(1)
    expect(stressIndex('/ˈkʌɹənt/', 2)).toBe(0)
    expect(stressIndex('/ɡlɪmps/', 1)).toBe(0)
  })
})

describe('dictionary parsing', () => {
  it('reads the Free Dictionary format and prefers US audio', () => {
    const r = parseFreeDictionary([
      {
        word: 'glimpse',
        phonetic: '/ɡlɪmps/',
        phonetics: [
          { text: '/ɡlɪmps/', audio: 'https://x/glimpse-uk.mp3' },
          { text: '/ɡlɪmps/', audio: 'https://x/glimpse-us.mp3' },
        ],
        meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: 'A brief look, glance, or peek.', example: 'I only got a glimpse of the car.' }] },
          { partOfSpeech: 'verb', definitions: [{ definition: 'To see or view briefly or incompletely.' }] },
        ],
        license: { name: 'CC BY-SA 3.0' },
        sourceUrls: ['https://en.wiktionary.org/wiki/glimpse'],
      },
    ])
    expect(r?.audioUrl).toBe('https://x/glimpse-us.mp3')
    expect(r?.senses).toHaveLength(2)
    expect(r?.senses[0]).toMatchObject({ pos: 'noun', example: 'I only got a glimpse of the car.' })
    expect(parseFreeDictionary({ title: 'No Definitions Found' })).toBeNull()
  })
  it('reads Simple English Wiktionary wikitext', () => {
    const senses = parseSimpleWikitext(
      "=== Pronunciation ===\n* {{IPA|/ɡlɪmps/}}\n\n== Noun ==\n{{noun}}\n# (countable) When you catch a '''glimpse''' of something, you see it only for a moment.\n#: ''I caught a '''glimpse''' of baby {{w|Prince George}} as his parents left the [[hospital]].''\n",
    )
    expect(senses[0].definition).toBe('When you catch a glimpse of something, you see it only for a moment.')
    expect(senses[0].example).toBe('I caught a glimpse of baby Prince George as his parents left the hospital.')
    expect(senses[0].pos).toBe('noun')
  })
})

describe('helpers', () => {
  it('blanks the word and its simple inflections', () => {
    expect(clozeOf('The boats waited in the harbor.', 'harbor')).toBe('The boats waited in the _____.')
    expect(clozeOf('He glimpsed a fox.', 'glimpse')).toBe('He _____ a fox.')
    expect(clozeOf('A quick look at a fox.', 'glimpse')).toBeNull()
    expect(clozeOf('Two harbors met.', 'harbor')).toBe('Two _____ met.')
  })
  it('describes when a card comes back', () => {
    const now = new Date('2026-11-22T16:00:00')
    expect(whenText(new Date('2026-11-22T16:05:00'), now)).toBe('in a few minutes')
    expect(whenText(new Date('2026-11-23T09:00:00'), now)).toBe('tomorrow')
    expect(whenText(new Date('2026-11-28T09:00:00'), now)).toBe('in 6 days')
  })
})

describe('FSRS wrapper', () => {
  it('schedules, measures strength and survives a JSON round trip', async () => {
    const s = await getScheduler(0.9)
    const t0 = new Date('2026-11-22T16:00:00Z')
    const c0 = newFsrsCard(s, 'w1:see', t0)
    expect(strengthDays(s, c0)).toBe(0)
    expect(recallChance(s, c0, t0)).toBe(0)
    const c1 = reviewCard(s, c0, 3, t0)
    expect(strengthDays(s, c1)).toBeGreaterThan(1)
    const later = new Date(t0.getTime() + 3 * 86_400_000)
    const r = recallChance(s, c1, later)
    expect(r).toBeGreaterThan(0.5)
    expect(r).toBeLessThan(1)
    const revived = reviveFsrsCard(JSON.parse(JSON.stringify(c1)))
    expect(() => reviewCard(s, revived, 3, later)).not.toThrow()
  })
})
