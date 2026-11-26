import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addWord, cachedLookup, db, deleteWord, findWordByText, updateWord, type WordDraft } from '../lib/db'
import { fetchFreeDictionary, type LookupResult } from '../lib/dictionary'
import { meaningsOf, withPrimary } from '../lib/meanings'
import { britishCandidates } from '../lib/spelling'
import { stressIndex, syllabify } from '../lib/syllables'
import { playWord } from '../lib/audio'
import type { Meaning, Sense, Settings, Word } from '../lib/types'
import { ConfirmButton, Icon, useToast } from '../ui'

/* ---------- drafts ---------- */

/** The editable part of a stored word (without ids, dates or status). */
export function toDraft(w: Word): WordDraft {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, createdAt: _c, updatedAt: _u, introducedAt: _i, status: _s, ...draft } = w
  return draft
}

const blankMeaning = (): Meaning => ({ pos: '', definition: '', originalDefinition: '' })
const meaningFromSense = (s: Sense): Meaning => ({ pos: s.pos, definition: s.definition, originalDefinition: s.definition, example: s.example })

export function blankDraft(word: string, settings: Settings): WordDraft {
  const w = word.trim()
  return {
    word: w, pos: '', definition: '', originalDefinition: '', meanings: [blankMeaning()], examples: [], metIn: '', ipa: '', audioUrl: '',
    syllables: syllabify(w), stress: 0, altSpellings: [], watchOut: '', tags: [], addedBy: settings.addedBy, mySentence: '', hook: '', sourceUrl: '',
  }
}

/** A draft with the first (simplest) meaning ticked; the person adding the word can tick more. */
export function draftFromLookup(word: string, data: LookupResult | null, simple: Sense[], settings: Settings, metIn = ''): { draft: WordDraft; senses: Sense[] } {
  const senses = [...simple, ...(data?.senses ?? [])]
  const base = blankDraft(word, settings)
  const ipa = data?.ipa ?? ''
  const first = senses[0]
  const meanings = first
    ? [{ ...meaningFromSense(first), example: first.example ?? data?.senses.find(s => s.example && s.pos === first.pos)?.example }]
    : [blankMeaning()]
  return {
    senses,
    draft: withPrimary({
      ...base,
      meanings,
      metIn,
      ipa,
      audioUrl: data?.audioUrl ?? '',
      stress: stressIndex(ipa, base.syllables.length),
      sourceUrl: data?.sourceUrl ?? '',
    }),
  }
}

/** Keep only British candidates that the dictionary knows, so a made-up spelling is never accepted. */
async function realBritishSpellings(word: string): Promise<string[]> {
  const found: string[] = []
  for (const c of britishCandidates(word)) {
    try {
      if (await fetchFreeDictionary(c)) found.push(c)
    } catch {
      // offline: skip
    }
  }
  return found
}

const splitList = (s: string) => s.split(/[,;]/).map(x => x.trim()).filter(Boolean)

/* ---------- editor ---------- */

export interface EditorSeed { draft: WordDraft; senses: Sense[]; wordId?: string; notFound?: boolean }

export function WordEditor({ seed, mode, onDone, onCancel }: { seed: EditorSeed; mode: 'new' | 'inbox' | 'edit'; onDone: (msg: string) => void; onCancel?: () => void }) {
  const [d, setD] = useState<WordDraft>(seed.draft)
  const [meanings, setMeanings] = useState<Meaning[]>(() => meaningsOf(seed.draft).map(m => ({ ...m })))
  const [senses, setSenses] = useState<Sense[]>(seed.senses)
  const [sylText, setSylText] = useState(seed.draft.syllables.join('·'))
  const [altText, setAltText] = useState(seed.draft.altSpellings.join(', '))
  const [examples, setExamples] = useState(seed.draft.examples.join('\n'))
  const [tags, setTags] = useState(seed.draft.tags.join(', '))
  const [checkingAlt, setCheckingAlt] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const dup = useLiveQuery(() => findWordByText(d.word), [d.word])
  const duplicate = dup && dup.id !== seed.wordId ? dup : undefined
  const syllables = useMemo(() => sylText.split(/[·.\-\s]+/).filter(Boolean), [sylText])
  const set = (patch: Partial<WordDraft>) => setD(cur => ({ ...cur, ...patch }))
  const filled = meanings.filter(m => m.definition.trim())

  // New words: look for real British spellings Chris might type.
  useEffect(() => {
    if (mode === 'edit' || seed.draft.altSpellings.length > 0 || !seed.draft.word) return
    let live = true
    setCheckingAlt(true)
    void realBritishSpellings(seed.draft.word).then(found => {
      if (live && found.length) setAltText(found.join(', '))
    }).finally(() => live && setCheckingAlt(false))
    return () => { live = false }
  }, [seed.draft.word, mode, seed.draft.altSpellings.length])

  // Editing a word from the garden: offer the dictionary meanings again so more can be ticked.
  useEffect(() => {
    if (seed.senses.length > 0 || mode !== 'edit' || !seed.draft.word) return
    let live = true
    void cachedLookup(seed.draft.word)
      .then(r => { if (live) setSenses([...r.simple, ...(r.data?.senses ?? [])]) })
      .catch(() => undefined)
    return () => { live = false }
  }, [seed.senses.length, mode, seed.draft.word])

  const tickedAt = (s: Sense) => meanings.findIndex(m => m.originalDefinition === s.definition)

  const toggle = (s: Sense) => {
    const i = tickedAt(s)
    if (i >= 0) {
      if (meanings.length === 1) return toast('Keep at least one meaning. Tick another one first.')
      setMeanings(ms => ms.filter((_, j) => j !== i))
    } else {
      setMeanings(ms => (ms.length === 1 && !ms[0].definition.trim() ? [meaningFromSense(s)] : [...ms, meaningFromSense(s)]))
    }
  }

  const editMeaning = (i: number, patch: Partial<Meaning>) => setMeanings(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)))

  const save = async () => {
    if (!d.word.trim() || filled.length === 0) return
    setSaving(true)
    const cleaned: Meaning[] = filled.map(m => ({
      pos: m.pos.trim(),
      definition: m.definition.trim(),
      originalDefinition: m.originalDefinition,
      ...(m.example?.trim() ? { example: m.example.trim() } : {}),
    }))
    const draft: WordDraft = withPrimary({
      ...d,
      meanings: cleaned,
      word: d.word.trim(),
      syllables: syllables.length ? syllables : [d.word.trim()],
      stress: Math.min(d.stress, Math.max(0, syllables.length - 1)),
      altSpellings: splitList(altText).map(s => s.toLowerCase()),
      examples: examples.split('\n').map(s => s.trim()).filter(Boolean),
      tags: splitList(tags),
      senses: undefined,
    })
    const count = cleaned.length > 1 ? ` with ${cleaned.length} meanings` : ''
    try {
      if (mode === 'new') {
        await addWord(draft, 'active')
        onDone(`Added “${draft.word}”${count}. Chris meets it in the next practice with room for new words.`)
      } else if (mode === 'inbox' && seed.wordId) {
        await updateWord(seed.wordId, { ...draft, status: 'active' })
        onDone(`Approved “${draft.word}”${count}.`)
      } else if (seed.wordId) {
        await updateWord(seed.wordId, draft)
        onDone(`Saved “${draft.word}”${count}.`)
      }
    } catch {
      toast('Saving failed. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="row-between">
        <div className="row">
          <input className="input big" style={{ width: 'auto', maxWidth: '100%' }} value={d.word} onChange={e => set({ word: e.target.value })} aria-label="Word" autoCapitalize="none" spellCheck={false} />
          <button type="button" className="icon-btn" onClick={() => void playWord(d)} aria-label="Play the word"><Icon name="speaker" /></button>
        </div>
        <div className="row">
          {d.ipa && <span className="chip">{d.ipa}</span>}
          {d.audioUrl ? <span className="chip green">Recording</span> : <span className="chip">Device voice</span>}
        </div>
      </div>
      {duplicate && <p className="err">“{duplicate.word}” is already in the garden.</p>}
      {seed.notFound && <p className="sub">The dictionary has no entry for this word. Write a meaning Chris will understand.</p>}

      <div className="field">
        <span className="lbl">Syllables (tap the stressed one)</span>
        <div className="row">
          <input className="input" style={{ maxWidth: 240 }} value={sylText} onChange={e => setSylText(e.target.value)} aria-label="Syllables, separated by dots" spellCheck={false} />
          <div className="row" role="group" aria-label="Stressed syllable">
            {syllables.map((s, i) => (
              <button key={i} type="button" className={`btn small${i === d.stress ? ' primary' : ''}`} aria-pressed={i === d.stress} onClick={() => set({ stress: i })}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {senses.length > 0 && (
        <fieldset className="senses">
          <legend>Which meanings should Chris learn? Tick one or more.</legend>
          {senses.map((s, i) => (
            <label key={i} className="sense">
              <input type="checkbox" checked={tickedAt(s) >= 0} onChange={() => toggle(s)} />
              <span>
                <i className="pos">{s.pos}</i> {s.definition}
                {s.example && <span className="src">“{s.example}”</span>}
                <span className="src">{s.source === 'simple' ? 'Simple English Wiktionary' : 'Wiktionary'}, CC BY-SA</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="field">
        <span className="lbl">{meanings.length > 1 ? `The ${meanings.length} meanings Chris will see (practice takes turns)` : 'The meaning Chris will see'}</span>
        {meanings.map((m, i) => (
          <div key={i} className="meaning-edit">
            <div className="row-between">
              <span className="label">{meanings.length > 1 ? `Meaning ${i + 1}${i === 0 ? ' · the one Chris met' : ''}` : 'Meaning'}</span>
              {meanings.length > 1 && <button type="button" className="btn quiet small" onClick={() => setMeanings(ms => ms.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            <textarea className="input" rows={2} value={m.definition} onChange={e => editMeaning(i, { definition: e.target.value })} aria-label={`Meaning ${i + 1}`} placeholder="In words Chris already knows" />
            <div className="two">
              <input className="input" value={m.pos} onChange={e => editMeaning(i, { pos: e.target.value })} aria-label={`Part of speech for meaning ${i + 1}`} placeholder="Part of speech, e.g. noun" />
              <input className="input" value={m.example ?? ''} onChange={e => editMeaning(i, { example: e.target.value })} aria-label={`Example sentence for meaning ${i + 1}`} placeholder="Example sentence for this meaning (optional)" />
            </div>
          </div>
        ))}
        <div className="row-between">
          <p className="help">Rewrite each meaning in words Chris knows; the dictionary wording stays linked for credit. One or two meanings work best.</p>
          <button type="button" className="btn quiet" onClick={() => setMeanings(ms => [...ms, blankMeaning()])}>+ Add a meaning in my own words</button>
        </div>
      </div>

      <div className="two">
        <div className="field">
          <label htmlFor="ed-alt">British spellings Chris may type {checkingAlt && <span className="help">(checking…)</span>}</label>
          <input id="ed-alt" className="input" value={altText} onChange={e => setAltText(e.target.value)} placeholder="e.g. harbour" autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="ed-tags">Tags</label>
          <input id="ed-tags" className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="Science, Rivers" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ed-ex">More example sentences, one per line (for the first meaning)</label>
        <textarea id="ed-ex" className="input" rows={2} value={examples} onChange={e => setExamples(e.target.value)} />
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor="ed-met">Where did Chris meet it?</label>
          <input id="ed-met" className="input" value={d.metIn} onChange={e => set({ metIn: e.target.value })} placeholder="A sentence or a place, e.g. library book, ch. 3" />
        </div>
        <div className="field">
          <label htmlFor="ed-watch">Watch out (optional)</label>
          <input id="ed-watch" className="input" value={d.watchOut} onChange={e => set({ watchOut: e.target.value })} placeholder="e.g. sounds the same as currant, a dried fruit" />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor="ed-hook">Memory hook (optional)</label>
          <input id="ed-hook" className="input" value={d.hook} onChange={e => set({ hook: e.target.value })} placeholder="e.g. one Collar, two Sleeves" />
        </div>
        <div className="field">
          <label htmlFor="ed-by">Added by</label>
          <input id="ed-by" className="input" value={d.addedBy} onChange={e => set({ addedBy: e.target.value })} />
        </div>
      </div>
      <div className="row-end">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn primary" disabled={saving || !d.word.trim() || filled.length === 0 || !!duplicate}>
          {mode === 'new' ? 'Add to garden' : mode === 'inbox' ? 'Approve' : 'Save'}
        </button>
      </div>
    </form>
  )
}

/* ---------- screen ---------- */

function parseLine(line: string): { word: string; context: string } | null {
  const t = line.trim()
  if (!t) return null
  const m = t.match(/^(.+?)\s+[-–—|]\s+(.+)$/) ?? t.match(/^([^:]+?):\s*(.+)$/)
  return m ? { word: m[1].trim(), context: m[2].trim() } : { word: t, context: '' }
}

export function AddWords({ settings }: { settings: Settings }) {
  const [tab, setTab] = useState<'one' | 'list' | 'inbox'>('one')
  const inbox = useLiveQuery(() => db.words.where('status').equals('inbox').toArray(), []) ?? []
  const toast = useToast()

  // one word
  const [text, setText] = useState('')
  const [metIn, setMetIn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [seed, setSeed] = useState<EditorSeed | null>(null)

  // list
  const [raw, setRaw] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // inbox review
  const [reviewing, setReviewing] = useState<Word | null>(null)

  const lookup = async () => {
    const w = text.trim()
    if (!w) return
    setBusy(true)
    setError('')
    setSeed(null)
    try {
      const { data, simple } = await cachedLookup(w)
      const s = draftFromLookup(w, data, simple, settings, metIn.trim())
      setSeed({ ...s, notFound: !data && simple.length === 0 })
    } catch {
      setError('The dictionary could not be reached. Check the connection, or write the meaning yourself below.')
      setSeed({ draft: { ...blankDraft(w, settings), metIn: metIn.trim() }, senses: [], notFound: true })
    } finally {
      setBusy(false)
    }
  }

  const addList = async () => {
    const lines = raw.split('\n').map(parseLine).filter((x): x is { word: string; context: string } => !!x)
    if (!lines.length) return
    setProgress({ done: 0, total: lines.length })
    let added = 0
    let skipped = 0
    for (let i = 0; i < lines.length; i++) {
      const { word, context } = lines[i]
      if (await findWordByText(word)) {
        skipped++
      } else {
        let senses: Sense[] = []
        let draft = { ...blankDraft(word, settings), metIn: context }
        try {
          const r = await cachedLookup(word)
          const s = draftFromLookup(word, r.data, r.simple, settings, context)
          draft = s.draft
          senses = s.senses
        } catch {
          // offline: keep the blank draft so a parent can fill it in
        }
        await addWord({ ...draft, senses }, 'inbox')
        added++
      }
      setProgress({ done: i + 1, total: lines.length })
    }
    setProgress(null)
    setRaw('')
    toast(`${added} added to the Inbox${skipped ? `, ${skipped} already in the garden` : ''}.`)
    setTab('inbox')
  }

  return (
    <section className="scr" aria-label="Add words">
      <div className="row-between">
        <h1 className="h2">Add words</h1>
        <div className="tabs" role="tablist" aria-label="How to add">
          <button type="button" role="tab" aria-selected={tab === 'one'} className={tab === 'one' ? 'on' : ''} onClick={() => setTab('one')}>One word</button>
          <button type="button" role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Paste a list</button>
          <button type="button" role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>Inbox{inbox.length ? ` (${inbox.length})` : ''}</button>
        </div>
      </div>

      {tab === 'one' && (
        <>
          <form className="card" onSubmit={e => { e.preventDefault(); void lookup() }}>
            <div className="answer-row">
              <input className="input big" value={text} onChange={e => setText(e.target.value)} placeholder="Type a word" aria-label="Word to add" autoCapitalize="none" spellCheck={false} autoComplete="off" />
              <button type="submit" className="btn primary" disabled={busy || !text.trim()}>{busy ? 'Looking up…' : 'Look up'}</button>
            </div>
            <div className="field">
              <label htmlFor="add-met">Where did Chris meet it? (optional)</label>
              <input id="add-met" className="input" value={metIn} onChange={e => setMetIn(e.target.value)} placeholder="The sentence, or the book and page" />
            </div>
            {error && <p className="err">{error}</p>}
          </form>
          {seed && (
            <WordEditor
              key={seed.draft.word + seed.senses.length}
              seed={seed}
              mode="new"
              onDone={msg => { toast(msg); setSeed(null); setText(''); setMetIn('') }}
              onCancel={() => setSeed(null)}
            />
          )}
        </>
      )}

      {tab === 'list' && (
        <div className="card">
          <div className="field">
            <label htmlFor="add-list">One word per line. Add the sentence after a dash if you have it.</label>
            <textarea id="add-list" className="input" rows={8} value={raw} onChange={e => setRaw(e.target.value)} placeholder={'harbor - The boats waited in the harbor.\nreluctant\nmeander: The river meanders through the valley.'} />
          </div>
          <div className="row-between">
            <p className="help">Each word is looked up and placed in the Inbox, where you pick the meanings before Chris sees it.</p>
            <button type="button" className="btn primary" disabled={!!progress || !raw.trim()} onClick={() => void addList()}>
              {progress ? `Looking up ${progress.done} of ${progress.total}…` : 'Add to Inbox'}
            </button>
          </div>
        </div>
      )}

      {tab === 'inbox' && (
        <div className="card">
          {inbox.length === 0 ? (
            <p className="sub">The Inbox is empty. Words from a pasted list wait here until someone picks the meanings.</p>
          ) : (
            inbox.map(w => (
              <div key={w.id} className="inbox-item">
                <div>
                  <b>{w.word}</b>{' '}
                  <span className="muted small">
                    {w.definition ? `· ${w.definition}` : '· no meaning yet'}
                    {meaningsOf(w).length > 1 ? ` (+${meaningsOf(w).length - 1} more)` : ''}
                  </span>
                  <p className="help">{w.addedBy}{w.metIn ? ` · ${w.metIn}` : ''}</p>
                </div>
                <div className="row">
                  <button type="button" className="btn small primary" onClick={() => setReviewing(w)}>Review</button>
                  <ConfirmButton className="btn small" label="Remove" confirmLabel="Remove word" onConfirm={() => void deleteWord(w.id)} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {reviewing && (
        <div className="sheet-bg" role="dialog" aria-modal="true" aria-label={`Review ${reviewing.word}`}>
          <div className="sheet">
            <WordEditor
              seed={{ draft: toDraft(reviewing), senses: reviewing.senses ?? [], wordId: reviewing.id, notFound: !reviewing.senses?.length && !reviewing.definition }}
              mode="inbox"
              onDone={msg => { toast(msg); setReviewing(null) }}
              onCancel={() => setReviewing(null)}
            />
          </div>
        </div>
      )}
    </section>
  )
}
