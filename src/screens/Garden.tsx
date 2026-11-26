import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteWord, updateWord } from '../lib/db'
import { isDueToday, stageOf, STAGE_HINT, STAGES, type Stage } from '../lib/stats'
import { DIRECTION_LABEL, DIRECTIONS, type CardRec, type Settings, type Word } from '../lib/types'
import { daysText, endOfDay, whenText } from '../lib/util'
import { ConfirmButton, Icon, MeaningList, StageChip, Syllables, useDoneToday, useNow, useToast } from '../ui'
import { toDraft, WordEditor } from './AddWords'

type Filter = 'all' | 'due' | 'weak' | 'mastered' | 'paused'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Needs water' },
  { id: 'weak', label: 'Seeds & sprouts' },
  { id: 'mastered', label: 'Mastered' },
  { id: 'paused', label: 'Paused' },
]
const barPct = (d: number) => Math.min(100, (Math.log(1 + Math.max(0, d)) / Math.log(1 + 365)) * 100)

export function Garden({ settings }: { settings: Settings }) {
  const now = useNow()
  const doneToday = useDoneToday(now)
  const words = useLiveQuery(() => db.words.where('status').anyOf('active', 'paused').toArray(), [])
  const cards = useLiveQuery(() => db.cards.toArray(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Word | null>(null)
  const toast = useToast()

  if (!words || !cards) return null
  const info = words
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(w => ({ w, stage: stageOf(w, cards, settings), due: isDueToday(w, cards, settings, now, doneToday) }))
  const matches = (x: { w: Word; stage: Stage; due: boolean }) => {
    if (query && !x.w.word.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (filter === 'due') return x.due
    if (filter === 'weak') return x.stage <= 1 && x.w.status === 'active'
    if (filter === 'mastered') return x.stage === 4
    if (filter === 'paused') return x.w.status === 'paused'
    return true
  }
  const shown = info.filter(matches)
  const selected = info.find(x => x.w.id === selectedId) ?? shown[0]

  if (words.length === 0) {
    return (
      <section className="scr card empty" aria-label="Garden">
        <Icon name="sprout" className="lg" />
        <p className="big">Nothing planted yet</p>
        <p className="sub">Words appear here as soon as they are added.</p>
      </section>
    )
  }

  return (
    <section className="scr wide" aria-label="Garden">
      <div className="row-between">
        <h1 className="h2">Garden <span className="sub">· {shown.length === words.length ? `${words.length} words` : `${shown.length} of ${words.length}`}</span></h1>
        <input className="input" style={{ maxWidth: 220 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a word" aria-label="Find a word" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="filters" role="group" aria-label="Show">
        {FILTERS.map(f => (
          <button key={f.id} type="button" className={`fchip${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="g-layout">
        <div className="garden-grid">
          {shown.map(({ w, stage, due }) => (
            <button
              key={w.id} type="button"
              className={`tile s${stage}${w.status === 'paused' ? ' paused' : ''}${selected?.w.id === w.id ? ' sel' : ''}`}
              aria-pressed={selected?.w.id === w.id}
              aria-label={`${w.word}, ${STAGES[stage]}${due ? ', due today' : ''}${w.status === 'paused' ? ', paused' : ''}`}
              onClick={() => setSelectedId(w.id)}
            >
              {due && <span className="drop" aria-hidden="true"><Icon name="drop" /></span>}
              {w.word}
            </button>
          ))}
          {shown.length === 0 && <p className="sub">No words match.</p>}
        </div>
        {selected && (
          <Detail
            word={selected.w} stage={selected.stage} due={selected.due} doneToday={doneToday.has(selected.w.id)} cards={cards.filter(c => c.wordId === selected.w.id)} settings={settings} now={now}
            onEdit={() => setEditing(selected.w)}
            onPause={async () => {
              const paused = selected.w.status === 'paused'
              await updateWord(selected.w.id, { status: paused ? 'active' : 'paused' })
              toast(paused ? `“${selected.w.word}” is back in practice.` : `“${selected.w.word}” is paused and will not come up.`)
            }}
            onDelete={async () => {
              await deleteWord(selected.w.id)
              setSelectedId(null)
              toast(`Removed “${selected.w.word}” and its history.`)
            }}
          />
        )}
      </div>
      <ul className="legend">
        {STAGES.map((s, i) => <li key={s}><i className={`sw s${i}`} />{s}: {STAGE_HINT[i]}</li>)}
        <li><Icon name="drop" className="sm sun-ic" />Due today</li>
      </ul>
      <p className="help">A word's stage is its weakest direction. Days are how long until the chance of recalling it falls to 90%.</p>

      {editing && (
        <div className="sheet-bg" role="dialog" aria-modal="true" aria-label={`Edit ${editing.word}`}>
          <div className="sheet">
            <WordEditor seed={{ draft: toDraft(editing), senses: [], wordId: editing.id }} mode="edit" onDone={msg => { toast(msg); setEditing(null) }} onCancel={() => setEditing(null)} />
          </div>
        </div>
      )}
    </section>
  )
}

function Detail({ word, stage, due, doneToday, cards, settings, now, onEdit, onPause, onDelete }: {
  word: Word; stage: Stage; due: boolean; doneToday: boolean; cards: CardRec[]; settings: Settings; now: Date
  onEdit: () => void; onPause: () => void; onDelete: () => void
}) {
  const reps = cards.reduce((n, c) => n + c.reps, 0)
  const lapses = cards.reduce((n, c) => n + c.lapses, 0)
  const until = endOfDay(now)
  return (
    <aside className="card" aria-live="polite">
      <p className="word-md">{word.word}</p>
      <p className="row"><StageChip stage={stage} />{due && <span className="chip sun"><Icon name="drop" className="sm" />Due today</span>}{word.status === 'paused' && <span className="chip">Paused</span>}</p>
      <p className="ipa" style={{ fontSize: 15 }}><Syllables word={word} />{word.ipa && <span>{word.ipa}</span>}</p>
      <MeaningList word={word} />
      {!word.introducedAt ? (
        <p className="sub">Not met yet. Chris meets it in the next practice with room for new words.</p>
      ) : (
        <div className="dir-bars">
          {DIRECTIONS.map(d => {
            const c = cards.find(x => x.direction === d)
            if (!c) return null
            if (!settings.directions[d]) return <div key={d} className="dir-bar"><span>{DIRECTION_LABEL[d]}</span><span className="meta">Turned off in Settings</span></div>
            const isDue = c.dueAt <= until
            const when = isDue && doneToday ? 'practiced today, next tomorrow' : c.reps === 0 ? `starts ${whenText(c.dueAt, now)}` : isDue ? 'due today' : `next review ${whenText(c.dueAt, now)}`
            return (
              <div key={d} className="dir-bar">
                <span>{DIRECTION_LABEL[d]}</span>
                <span className="track"><i className={isDue && !doneToday ? 'due' : ''} style={{ width: `${barPct(c.strengthDays)}%` }} /></span>
                <span className="meta">{daysText(c.strengthDays)} · {when}</span>
              </div>
            )
          })}
        </div>
      )}
      <p className="help">{reps} {reps === 1 ? 'review' : 'reviews'} · {lapses} {lapses === 1 ? 'lapse' : 'lapses'} · added by {word.addedBy} on {word.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{word.metIn ? ` · met in: ${word.metIn}` : ''}</p>
      <div className="row">
        <button type="button" className="btn small" onClick={onEdit}>Edit</button>
        <button type="button" className="btn small" onClick={onPause}>{word.status === 'paused' ? 'Resume' : 'Pause'}</button>
        <ConfirmButton className="btn small" label="Remove" confirmLabel="Remove word and history" onConfirm={onDelete} />
      </div>
    </aside>
  )
}
