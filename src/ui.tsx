import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, mergeSettings } from './lib/db'
import { meaningsOf } from './lib/meanings'
import { doneTodaySet, STAGES, type Stage } from './lib/stats'
import { startOfDay } from './lib/util'
import type { Grade, Settings, Word } from './lib/types'

/* ---------- icons ---------- */

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  sprout: (<><path d="M12 21v-9" /><path d="M12 12c0-4 3-7 8-7 0 5-3 7-8 7z" /><path d="M12 14c0-3-2.5-5-7-5 0 3.5 2.5 5 7 5z" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  chart: <path d="M5 20v-6M11 20V8M17 20V11M3 20h18" />,
  sliders: (<><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>),
  ear: (<><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4" height="7" rx="1.5" /><rect x="17" y="14" width="4" height="7" rx="1.5" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  bulb: (<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" /></>),
  speaker: (<><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>),
  flame: <path d="M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.7-4-7.7-.4 2-1.4 3.3-2.8 3.8.4-3.3-1-6.4-3.7-8.3.2 3.3-1.8 5.6-3.3 7.6C4.3 12 5 13.6 5 15.2 5 19.3 8 22 12 22z" />,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  leaf: (<><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" /><path d="M5 19c3-4 6-6.5 10-8.5" /></>),
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  inbox: (<><path d="M4 13l2.5-8h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 13h5l1 2h4l1-2h5" /></>),
}

export function Icon({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

/* ---------- toast ---------- */

const ToastCtx = createContext<(msg: string) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback((m: string) => {
    setMsg(m)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 3600)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" role="status" hidden={!msg}>{msg}</div>
    </ToastCtx.Provider>
  )
}

/* ---------- data hooks ---------- */

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => mergeSettings((await db.kv.get('settings'))?.value), [])
}

/** Current time, refreshed every minute so "due today" views stay honest. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

/** Words already practiced today; they wait until tomorrow even if a card is due. */
export function useDoneToday(now: Date): Set<string> {
  const day = startOfDay(now).getTime()
  const today = useLiveQuery(() => db.reviews.where('at').aboveOrEqual(new Date(day)).toArray(), [day])
  return today ? doneTodaySet(today, now) : new Set()
}

/* ---------- small pieces ---------- */

/** A word's meanings: one plain line, or a numbered list when it has several. */
export function MeaningList({ word, big = false, speakExample }: { word: Pick<Word, 'pos' | 'definition' | 'originalDefinition' | 'meanings'>; big?: boolean; speakExample?: (s: string) => void }) {
  const ms = meaningsOf(word)
  if (ms.length === 1) {
    return (
      <>
        <p className={big ? 'def' : undefined}>{ms[0].definition}</p>
        {speakExample && ms[0].example && <ExampleLine text={ms[0].example} onPlay={speakExample} />}
      </>
    )
  }
  return (
    <ol className="meanings">
      {ms.map((m, i) => (
        <li key={i}>
          <span className="n">Meaning {i + 1}{m.pos ? ` · ${m.pos}` : ''}</span>
          <span className={big ? 'def' : undefined}>{m.definition}</span>
          {speakExample && m.example && <ExampleLine text={m.example} onPlay={speakExample} />}
        </li>
      ))}
    </ol>
  )
}

function ExampleLine({ text, onPlay }: { text: string; onPlay: (s: string) => void }) {
  return (
    <span className="ex">
      <button type="button" className="icon-btn" onClick={() => onPlay(text)} aria-label="Play this sentence"><Icon name="speaker" className="sm" /></button>
      {text}
    </span>
  )
}

export function Syllables({ word }: { word: Pick<Word, 'syllables' | 'stress' | 'word'> }) {
  const parts = word.syllables.length ? word.syllables : [word.word]
  if (parts.length < 2) return <span className="syl">{parts[0]}</span>
  return (
    <span className="syl" aria-label={`Syllables: ${parts.join(' ')}, stress on ${parts[word.stress] ?? parts[0]}`}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && '·'}
          {i === word.stress ? <b>{p}</b> : p}
        </span>
      ))}
    </span>
  )
}

export function StageChip({ stage }: { stage: Stage }) {
  return <span className={`chip s${stage}`}>{STAGES[stage]}</span>
}

export const GRADE_LABEL: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

/** A button that asks for a second tap before doing something that cannot be undone. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger' }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button type="button" className={className} onClick={() => setAsking(true)}>{label}</button>
  return (
    <span className="row">
      <button type="button" className="btn danger" onClick={() => { setAsking(false); onConfirm() }}>{confirmLabel}</button>
      <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  )
}
