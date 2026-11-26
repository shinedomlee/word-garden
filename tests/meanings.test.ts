import { describe, expect, it } from 'vitest'
import { allSentences, meaningIndexFor, meaningsOf, sentencesFor, withPrimary } from '../src/lib/meanings'

const base = {
  word: 'current', pos: 'noun', definition: 'water or air that keeps moving in one direction', originalDefinition: '',
  examples: ['The current pulled the raft downstream.'], metIn: 'river book', mySentence: '',
}
const current = {
  ...base,
  meanings: [
    { pos: 'noun', definition: 'water or air that keeps moving in one direction', originalDefinition: 'x' },
    { pos: 'noun', definition: 'the flow of electricity through a wire', originalDefinition: 'y', example: 'The current in the wire made the bulb glow.' },
    { pos: 'adjective', definition: 'happening now', originalDefinition: 'z' },
  ],
}

describe('meanings', () => {
  it('falls back to the single definition on older words', () => {
    expect(meaningsOf(base)).toEqual([{ pos: 'noun', definition: base.definition, originalDefinition: '' }])
  })
  it('takes turns between meanings across reviews', () => {
    expect([0, 1, 2, 3, 4].map(r => meaningIndexFor(current, r))).toEqual([0, 1, 2, 0, 1])
    expect(meaningIndexFor(base, 7)).toBe(0)
  })
  it('only blanks sentences that fit the meaning shown', () => {
    expect(sentencesFor(current, 0)).toEqual(['The current pulled the raft downstream.'])
    expect(sentencesFor(current, 1)).toEqual(['The current in the wire made the bulb glow.'])
    expect(sentencesFor(current, 2)).toEqual([])
    expect(allSentences(current)).toHaveLength(2)
  })
  it('mirrors the first meaning into the old fields', () => {
    const w = withPrimary({ meanings: current.meanings })
    expect(w.definition).toBe('water or air that keeps moving in one direction')
    expect(w.originalDefinition).toBe('x')
  })
})
