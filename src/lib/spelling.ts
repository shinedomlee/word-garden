/**
 * Candidate British spellings of an American word. They are only suggestions:
 * the Add screen keeps a candidate only if the dictionary has an entry for it.
 */
const LIST: Record<string, string> = {
  gray: 'grey',
  plow: 'plough',
  mold: 'mould',
  jewelry: 'jewellery',
  program: 'programme',
  aluminum: 'aluminium',
  pajamas: 'pyjamas',
  mustache: 'moustache',
  skeptic: 'sceptic',
  skeptical: 'sceptical',
  cozy: 'cosy',
  ax: 'axe',
  aging: 'ageing',
  judgment: 'judgement',
  maneuver: 'manoeuvre',
  fulfill: 'fulfil',
  enroll: 'enrol',
  willful: 'wilful',
  tire: 'tyre',
  curb: 'kerb',
  check: 'cheque',
}

export function britishCandidates(american: string): string[] {
  const w = american.trim().toLowerCase()
  const out = new Set<string>()
  if (LIST[w]) out.add(LIST[w])
  const rules: Array<[RegExp, string]> = [
    [/([a-z])or(s|ed|ing|ite|ites|ful|able|ably|less|ism|er|ers)?$/, '$1our$2'], // color, harbor, favorite
    [/([a-z])er(s)?$/, '$1re$2'], // center, theater
    [/iz(e|es|ed|ing|ation|ations)$/, 'is$1'], // organize
    [/yz(e|es|ed|ing)$/, 'ys$1'], // analyze
    [/og(s)?$/, 'ogue$1'], // catalog
    [/ense(s)?$/, 'ence$1'], // defense
    [/([aeiou])l(ed|ing|er|ers)$/, '$1ll$2'], // traveled
  ]
  for (const [re, rep] of rules) {
    if (re.test(w)) {
      const c = w.replace(re, rep)
      if (c !== w) out.add(c)
    }
  }
  return Array.from(out)
}
