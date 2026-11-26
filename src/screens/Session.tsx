import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildTodayPlan, db, introduceWord, recordAnswer, updateWord } from '../lib/db'
import { firstCheckDirection, insertRetry, type Step } from '../lib/session'
import { checkTyped, classifySlip, lookAlikes, rateChoice, rateTyped, type TypedCheck } from '../lib/grading'
import { playWord, speak } from '../lib/audio'
import { streak } from '../lib/stats'
import { clozeOf, endOfDay, shuffle, whenText } from '../lib/util'
import { DIRECTION_LABEL, type AnswerFormat, type CardRec, type Direction, type Grade, type Settings, type SlipKind, type Word } from '../lib/types'
import { GRADE_LABEL, Icon, MeaningList, Syllables } from '../ui'
import { allSentences, meaningIndexFor, meaningsOf, sentencesFor } from '../lib/meanings'

interface Answer { grade: Grade; correct: boolean; answer: string; ms: number; hints: number; format: AnswerFormat; slip?: SlipKind; meaning?: number }
interface Outcome { updated: CardRec; retryQueued: boolean; graded: boolean; correct: boolean }
type OnAnswer = (a: Answer) => Promise<Outcome>
interface LogItem { wordId: string; kind: 'meet' | Direction; grade?: Grade; correct?: boolean; dueAt?: Date }

/* ---------- helpers ---------- */

const withStop = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)

/** A word is asked once a day, so anything due again today really comes back tomorrow. */
const backText = (due: Date, now: Date) => (due <= endOfDay(now) ? 'tomorrow' : whenText(due, now))

/** Other words to use as wrong options, preferring the same part of speech. Never another meaning of the same word. */
function distractors(word: Word, all: Word[], key: 'definition' | 'word', pos = word.pos): Word[] {
  const own = new Set(meaningsOf(word).map(m => m.definition))
  const pool = all.filter(w => w.id !== word.id && w.definition && w.word.toLowerCase() !== word.word.toLowerCase() && !own.has(w.definition))
  const samePos = shuffle(pool.filter(w => w.pos === pos))
  const rest = shuffle(pool.filter(w => w.pos !== pos))
  const seen = new Set<string>()
  return [...samePos, ...rest].filter(w => (seen.has(w[key]) ? false : (seen.add(w[key]), true))).slice(0, 3)
}

type Format = 'typed' | 'meaning-choice' | 'cloze-choice' | 'spelling-choice' | 'flip'

function formatFor(step: Extract<Step, { kind: 'review' | 'retry' }>, card: CardRec, word: Word, all: Word[]): Format {
  const young = card.strengthDays < 7
  if (step.direction === 'see') {
    const enough = distractors(word, all, 'definition').length >= 3
    if (step.kind === 'retry' || (step.kind === 'review' && step.check) || young) return enough ? 'meaning-choice' : 'flip'
    if (card.reps % 5 === 4 && enough && allSentences(word).length) return 'cloze-choice'
    return 'flip'
  }
  if (step.direction === 'hear' && card.lapses >= 4) return 'spelling-choice'
  return 'typed'
}

/* ---------- session ---------- */

export function Session({ settings, onExit, onGarden }: { settings: Settings; onExit: () => void; onGarden: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [words, setWords] = useState<Map<string, Word>>(new Map())
  const [cards, setCards] = useState<Map<string, CardRec>>(new Map())
  const [index, setIndex] = useState(0)
  const [log, setLog] = useState<LogItem[]>([])
  const [leftover, setLeftover] = useState(0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    let live = true
    void (async () => {
      const { plan } = await buildTodayPlan()
      const [ws, cs] = await Promise.all([db.words.toArray(), db.cards.toArray()])
      if (!live) return
      setWords(new Map(ws.map(w => [w.id, w])))
      setCards(new Map(cs.map(c => [c.id, c])))
      setSteps(plan.steps)
    })()
    return () => { live = false }
  }, [])

  const allWords = useMemo(() => Array.from(words.values()).filter(w => w.status !== 'inbox'), [words])

  if (!steps) return <div className="session"><div /><div className="sess-body"><p className="sub center">Getting today's cards ready…</p></div></div>

  const done = index >= steps.length
  const step = steps[index]

  const next = () => {
    const ni = index + 1
    const overTime = Date.now() - startedAt.current > settings.sessionMinutes * 60_000
    if (overTime && ni < steps.length) {
      // Time is up: finish checks and retries for words already started; the rest waits for tomorrow.
      const met = new Set(steps.slice(0, ni).map(s => s.wordId))
      const rest = steps.slice(ni)
      const keep = rest.filter(s => s.kind === 'retry' || (s.kind === 'review' && s.check && met.has(s.wordId)))
      setLeftover(rest.length - keep.length)
      setSteps([...steps.slice(0, ni), ...keep])
    }
    setIndex(ni)
  }

  const answer = (s: Extract<Step, { kind: 'review' | 'retry' }>): OnAnswer => async a => {
    const graded = s.kind === 'review'
    const { meaning, ...rec } = a
    const updated = await recordAnswer({ cardId: s.cardId, graded, ...rec })
    setCards(m => new Map(m).set(updated.id, updated))
    let retryQueued = false
    if (!a.correct) {
      const attempt = s.kind === 'retry' ? s.attempt + 1 : 1
      if (attempt <= 3) {
        setSteps(cur => insertRetry(cur!, index, { kind: 'retry', wordId: s.wordId, cardId: s.cardId, direction: s.direction, attempt, meaning }))
        retryQueued = true
      }
    }
    if (graded) setLog(l => [...l, { wordId: s.wordId, kind: s.direction, grade: a.grade, correct: a.correct, dueAt: updated.dueAt }])
    return { updated, retryQueued, graded, correct: a.correct }
  }

  const meetDone = async (word: Word, own: string) => {
    if (own.trim() !== word.mySentence) await updateWord(word.id, { mySentence: own.trim() })
    const now = new Date()
    await introduceWord(word.id, firstCheckDirection(settings), now)
    setWords(m => new Map(m).set(word.id, { ...word, mySentence: own.trim(), introducedAt: now }))
    const cs = await db.cards.where('wordId').equals(word.id).toArray()
    setCards(m => { const x = new Map(m); cs.forEach(c => x.set(c.id, c)); return x })
    setLog(l => [...l, { wordId: word.id, kind: 'meet' }])
    next()
  }

  let body: ReactNode = null
  if (steps.length === 0) {
    body = (
      <div className="scr card empty">
        <p className="big">Nothing to practice right now</p>
        <p className="sub">Every word is watered. Add new words, or come back tomorrow.</p>
        <button type="button" className="btn primary" onClick={onExit}>Back to Today</button>
      </div>
    )
  } else if (done) {
    body = <Summary log={log} words={words} leftover={leftover} onExit={onExit} onGarden={onGarden} />
  } else {
    const word = words.get(step.wordId)
    if (!word) {
      body = <button type="button" className="btn" onClick={next}>Skip a removed word</button>
    } else if (step.kind === 'meet') {
      body = <MeetStep key={index} word={word} onNext={own => void meetDone(word, own)} />
    } else {
      const card = cards.get(step.cardId)!
      const format = formatFor(step, card, word, allWords)
      const k = `${index}-${step.cardId}`
      const common = { word, card, onAnswer: answer(step), onNext: next, meaning: step.kind === 'retry' ? step.meaning : undefined }
      const label = (
        <p className="label">
          <Icon name={step.direction === 'hear' ? 'ear' : step.direction === 'see' ? 'eye' : 'bulb'} className="sm" />
          {DIRECTION_LABEL[step.direction]} · {step.kind === 'retry' ? 'one more try' : step.kind === 'review' && step.check ? 'first check of a new word' : card.reps === 0 ? 'first time' : 'review'}
        </p>
      )
      if (format === 'typed') body = <TypedStep key={k} {...common} label={label} direction={step.direction} settings={settings} />
      else if (format === 'flip') body = <FlipStep key={k} {...common} label={label} />
      else body = <ChoiceStep key={k} {...common} label={label} format={format} all={allWords} />
    }
  }

  return (
    <div className="session">
      <div className="sess-head">
        <button type="button" className="icon-btn plain" onClick={onExit} aria-label="Leave practice"><Icon name="x" /></button>
        <div className="bar" aria-hidden="true"><i style={{ width: `${steps.length ? Math.min(100, (index / steps.length) * 100) : 100}%` }} /></div>
        <span className="sub">{done || steps.length === 0 ? 'Done' : `${index + 1} of ${steps.length}`}</span>
      </div>
      <div className="sess-body">{body}</div>
    </div>
  )
}

/* ---------- Meet ---------- */

function MeetStep({ word, onNext }: { word: Word; onNext: (own: string) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [own, setOwn] = useState(word.mySentence)
  useEffect(() => { void playWord(word) }, [word])
  const meanings = meaningsOf(word)
  const posList = Array.from(new Set(meanings.map(m => m.pos).filter(Boolean))).join(', ')
  const rewritten = meanings.filter(m => m.originalDefinition && m.originalDefinition !== m.definition)
  const credit = rewritten.length === 1 && meanings.length === 1
    ? `Rewritten from: “${rewritten[0].originalDefinition}” (Wiktionary, CC BY-SA)`
    : meanings.some(m => m.originalDefinition) ? `${meanings.length > 1 ? 'Meanings' : 'Meaning'} from Wiktionary (CC BY-SA)` : ''
  return (
    <section className="scr" aria-label={`Meet ${word.word}`}>
      <p className="label"><span className="chip green">New word</span>Added by {word.addedBy}</p>
      <div className="word-line">
        <span className="word-xl">{word.word}</span>
        <button type="button" className="icon-btn big" onClick={() => void playWord(word)} aria-label={`Play ${word.word}`}><Icon name="speaker" /></button>
      </div>
      <p className="ipa"><Syllables word={word} />{word.ipa && <span>{word.ipa}</span>}{posList && <span className="pos">{posList}</span>}</p>
      {word.metIn && <p className="sub">Met in: {word.metIn}</p>}
      {word.watchOut && <p className="watch"><b>Watch out:</b> {word.watchOut}</p>}
      {!revealed ? (
        <div className="card guess">
          <p><b>What might it mean?</b> {meanings.length > 1 ? `It has ${meanings.length} meanings. Guess one first, even a wild guess.` : 'Have a guess first, even a wild one.'}</p>
          <button type="button" className="btn" onClick={() => setRevealed(true)}>{meanings.length > 1 ? 'Show the meanings' : 'Show the meaning'}</button>
        </div>
      ) : (
        <>
          <div className="card">
            <MeaningList word={word} big speakExample={s => void speak(s)} />
            {credit && <p className="credit">{credit}</p>}
            {word.examples.length > 0 && (
              <ul className="examples">
                {word.examples.slice(0, 3).map((ex, i) => (
                  <li key={i}><button type="button" className="icon-btn" onClick={() => void speak(ex)} aria-label="Play this sentence"><Icon name="speaker" className="sm" /></button><span>{ex}</span></li>
                ))}
              </ul>
            )}
            {word.hook && <p className="sub"><b>Memory hook:</b> {word.hook}</p>}
          </div>
          <div className="card say">
            <p><b>Say it out loud twice.</b> Saying a new word helps it stick.</p>
            <div className="row"><button type="button" className="btn" onClick={() => void playWord(word)}>Hear it again</button><button type="button" className="btn" onClick={() => void playWord(word, true)}>Slowly</button></div>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="meet-own">Your own sentence (optional)</label>
        <input id="meet-own" className="input" value={own} onChange={e => setOwn(e.target.value)} placeholder={`Use “${word.word}” in a sentence about you`} />
      </div>
      <div className="row-end">
        <button type="button" className="btn primary lg" disabled={!revealed} onClick={() => onNext(own)}>Next<Icon name="arrow" /></button>
      </div>
    </section>
  )
}

/* ---------- feedback ---------- */

function Feedback({ grade, title, outcome, onNext, children }: { grade: Grade; title: string; outcome: Outcome | null; onNext: () => void; children?: ReactNode }) {
  const tone = grade >= 3 ? 'good' : grade === 2 ? 'hard' : 'again'
  const now = new Date()
  let when = ''
  if (outcome) {
    if (outcome.graded) when = outcome.retryQueued ? `It comes back in a few minutes for another try, then ${backText(outcome.updated.dueAt, now)}.` : `Next review ${backText(outcome.updated.dueAt, now)}.`
    else when = outcome.retryQueued ? 'One more try in a few minutes.' : outcome.correct ? 'Practice try done. The schedule stays as it was.' : 'Enough tries for today. It comes back tomorrow.'
  }
  return (
    <div className={`fb fb-${tone}`} aria-live="polite">
      <p className="t">{title}</p>
      {children}
      {when && <p>{when}</p>}
      {outcome?.graded && <p className="small muted">Grade: {GRADE_LABEL[grade]}</p>}
      <div className="row-end"><button type="button" className="btn primary" autoFocus disabled={!outcome} onClick={onNext}>Next<Icon name="arrow" /></button></div>
    </div>
  )
}

function Letters({ target, check }: { target: string; check: TypedCheck }) {
  return (
    <p className="ans">
      {Array.from(target).map((ch, i) => (check.ok[i] ? <span key={i}>{ch}</span> : <mark key={i} className="miss">{ch}</mark>))}
    </p>
  )
}

/* ---------- typed (Hear it, Recall it) ---------- */

interface StepProps { word: Word; card: CardRec; onAnswer: OnAnswer; onNext: () => void; label: ReactNode; meaning?: number }

function TypedStep({ word, card: live, onAnswer, onNext, label, direction, settings, meaning: retryMeaning }: StepProps & { direction: Direction; settings: Settings }) {
  const [card] = useState(live)
  const target = word.word
  const young = card.strengthDays < 7
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(direction === 'recall' && young ? 1 : 0)
  const [hints, setHints] = useState(0)
  const [check, setCheck] = useState<TypedCheck | null>(null)
  const [grade, setGrade] = useState<Grade>(1)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const t0 = useRef(performance.now())
  const input = useRef<HTMLInputElement>(null)
  const [mi] = useState(() => retryMeaning ?? meaningIndexFor(word, card.reps))
  const meaning = meaningsOf(word)[mi]
  const sentence = useMemo(() => {
    const all = sentencesFor(word, mi)
    return all.length ? all[card.reps % all.length] : ''
  }, [word, mi, card.reps])

  useEffect(() => {
    if (direction === 'hear') void playWord(word)
    input.current?.focus()
  }, [direction, word])

  const submit = async (raw: string) => {
    if (check) return
    const c = checkTyped(target, raw, settings.acceptBritish ? word.altSpellings : [])
    const ms = performance.now() - t0.current
    const g = rateTyped(c, { hints, ms, target, strengthDays: card.strengthDays })
    const slip = !c.correct && !c.empty ? classifySlip(target, raw) ?? undefined : undefined
    setCheck(c)
    setGrade(g)
    setOutcome(await onAnswer({ grade: g, correct: c.correct, answer: raw.trim(), ms, hints, format: 'typed', slip, meaning: mi }))
    void playWord(word)
  }

  const hint = () => {
    setShown(s => Math.min(target.length - 1, Math.max(s, 0) + 1))
    setHints(h => h + 1)
    input.current?.focus()
  }

  const showSlots = young || shown > 0
  const title = !check ? '' : check.correct ? (hints ? 'Correct, with a hint' : 'Correct') : check.nearMiss ? 'Almost' : check.empty ? 'Here is the word' : 'Not this time'

  return (
    <section className="scr" aria-label={DIRECTION_LABEL[direction]}>
      {label}
      {direction === 'hear' ? (
        <div className="hear-box">
          <button type="button" className="play" onClick={() => void playWord(word)} aria-label="Play the word"><Icon name="play" className="lg" /></button>
          <div className="row">
            <button type="button" className="btn" onClick={() => void playWord(word, true)}>Slowly</button>
            {word.examples[0] && <button type="button" className="btn" onClick={() => void speak(word.examples[0])}>Play a sentence</button>}
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="sub">Which word means</p>
          <p className="def">{meaning.definition}</p>
          {sentence && <p className="cloze">{clozeOf(sentence, word.word)}</p>}
          <p className="pos">{meaning.pos}{young ? ` · ${target.length} letters` : ''}</p>
        </div>
      )}
      {showSlots && (
        <div className="slots" aria-label={`${target.length} letters`}>
          {Array.from(target).map((ch, i) => <span key={i} className={`slot${i < shown || check ? ' shown' : ''}`}>{i < shown || check ? ch : ''}</span>)}
        </div>
      )}
      <form className="answer-form" onSubmit={e => { e.preventDefault(); void submit(value) }}>
        <label htmlFor="answer" className={direction === 'hear' ? 'h2' : 'sr'}>{direction === 'hear' ? 'Type the word you hear' : 'Your answer'}</label>
        <div className="answer-row">
          <input
            id="answer" ref={input} className="answer" value={value} onChange={e => setValue(e.target.value)} readOnly={!!check}
            autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" inputMode="text" placeholder="type here"
          />
          <button type="submit" className="btn primary lg" disabled={!!check || !value.trim()}>Check</button>
        </div>
        {!check && (
          <div className="row">
            <button type="button" className="btn quiet" onClick={hint} disabled={shown >= target.length - 1}>{direction === 'hear' && shown === 0 ? 'Show first letter' : 'Next letter (hint)'}</button>
            <button type="button" className="btn quiet" onClick={() => void submit('')}>I don't know</button>
          </div>
        )}
      </form>
      {check && (
        <Feedback grade={grade} title={title} outcome={outcome} onNext={onNext}>
          <Letters target={target} check={check} />
          {!check.correct && value.trim() && <p className="small">You typed <span className="typed">{value.trim()}</span></p>}
          {check.variant && <p>British spelling <b>{check.variant}</b> accepted. In American English it is spelled <b>{target}</b>.</p>}
          {(direction === 'hear' || meaningsOf(word).length > 1) && <MeaningList word={word} />}
          <p className="small"><Syllables word={word} /> · say it out loud once.</p>
        </Feedback>
      )}
    </section>
  )
}

/* ---------- choices (See it, cloze, look-alike spellings) ---------- */

function ChoiceStep({ word, card: live, onAnswer, onNext, label, format, all: allLive, meaning: retryMeaning }: StepProps & { format: 'meaning-choice' | 'cloze-choice' | 'spelling-choice'; all: Word[] }) {
  const [card] = useState(live)
  const [all] = useState(allLive)
  const [mi] = useState(() => retryMeaning ?? meaningIndexFor(word, live.reps))
  const [picked, setPicked] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [grade, setGrade] = useState<Grade>(1)
  const t0 = useRef(performance.now())

  const { prompt, options } = useMemo(() => {
    if (format === 'spelling-choice') {
      const opts = shuffle([{ label: word.word, correct: true }, ...lookAlikes(word.word, all.map(w => w.word)).map(l => ({ label: l, correct: false }))])
      return { prompt: <p className="h2">Which spelling is the word you hear?</p>, options: opts }
    }
    if (format === 'cloze-choice') {
      const s = allSentences(word)
      const opts = shuffle([{ label: word.word, correct: true }, ...distractors(word, all, 'word').map(w => ({ label: w.word, correct: false }))])
      return { prompt: <><p className="h2">Which word fits?</p><p className="cloze">{clozeOf(s[card.reps % s.length], word.word)}</p></>, options: opts }
    }
    const m = meaningsOf(word)[mi]
    const opts = shuffle([{ label: m.definition, correct: true }, ...distractors(word, all, 'definition', m.pos).map(w => ({ label: w.definition, correct: false }))])
    return { prompt: <><p className="word-xl center">{word.word}</p><p className="h2">What does it mean?</p></>, options: opts }
  }, [word, all, format, card.reps, mi])

  useEffect(() => {
    if (format === 'spelling-choice') void playWord(word)
  }, [format, word])

  const pick = async (i: number) => {
    if (picked !== null) return
    const ms = performance.now() - t0.current
    const correct = options[i].correct
    const g = rateChoice(correct, ms)
    setPicked(i)
    setGrade(g)
    setOutcome(await onAnswer({ grade: g, correct, answer: options[i].label, ms, hints: 0, format: format === 'cloze-choice' ? 'cloze' : 'choice', meaning: mi }))
    void playWord(word)
  }

  useEffect(() => {
    if (picked !== null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= options.length) void pick(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <section className="scr" aria-label={DIRECTION_LABEL[card.direction]}>
      {label}
      {format === 'spelling-choice' && (
        <div className="hear-box"><button type="button" className="play" onClick={() => void playWord(word)} aria-label="Play the word"><Icon name="play" className="lg" /></button></div>
      )}
      {prompt}
      <div className="opts">
        {options.map((o, i) => (
          <button key={i} type="button" className={`opt${picked !== null && o.correct ? ' ok' : ''}${picked === i && !o.correct ? ' no' : ''}`} disabled={picked !== null} onClick={() => void pick(i)}>
            <span className="n">{i + 1}</span>{o.label}
          </button>
        ))}
      </div>
      {picked !== null && (
        <Feedback grade={grade} title={options[picked].correct ? 'Correct' : 'Not this time'} outcome={outcome} onNext={onNext}>
          {format !== 'meaning-choice' && <MeaningList word={word} />}
          {format === 'meaning-choice' && !options[picked].correct && <p><b>{word.word}</b>: {withStop(options.find(o => o.correct)!.label)}</p>}
          {format === 'meaning-choice' && meaningsOf(word).length > 1 && <><p className="small">All its meanings:</p><MeaningList word={word} /></>}
          <p className="small"><Syllables word={word} /> · say it out loud once.</p>
        </Feedback>
      )}
    </section>
  )
}

/* ---------- flip (stable See it cards) ---------- */

function FlipStep({ word, card: live, onAnswer, onNext, label }: StepProps) {
  const [card] = useState(live)
  const [shown, setShown] = useState(false)
  const [grade, setGrade] = useState<Grade | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const t0 = useRef(performance.now())
  const pool = [...meaningsOf(word).map(m => m.example ?? ''), ...word.examples].filter(Boolean)
  const example = pool.length ? pool[card.reps % pool.length] : ''

  const rate = async (g: Grade) => {
    if (grade) return
    setGrade(g)
    setOutcome(await onAnswer({ grade: g, correct: g > 1, answer: '', ms: performance.now() - t0.current, hints: 0, format: 'flip' }))
  }

  return (
    <section className="scr" aria-label="See it">
      {label}
      <p className="word-xl center">{word.word}</p>
      {!shown ? (
        <div className="card guess">
          <p><b>What does it mean?</b> Say the meaning to yourself, then check.</p>
          <button type="button" className="btn primary" autoFocus onClick={() => { setShown(true); void playWord(word) }}>Show the meaning</button>
        </div>
      ) : (
        <>
          <div className="card">
            <MeaningList word={word} big />
            {example && <p className="sub">{example}</p>}
          </div>
          {!grade ? (
            <div className="grid" style={{ display: 'grid', gap: 8 }}>
              <p className="sub">How well did you know it?</p>
              <div className="grades">
                <button type="button" className="btn" onClick={() => void rate(1)}>Forgot</button>
                <button type="button" className="btn" onClick={() => void rate(2)}>Hard</button>
                <button type="button" className="btn primary" onClick={() => void rate(3)}>Got it</button>
                <button type="button" className="btn" onClick={() => void rate(4)}>Easy</button>
              </div>
            </div>
          ) : (
            <Feedback grade={grade} title={grade > 1 ? 'Nice' : 'It will come back soon'} outcome={outcome} onNext={onNext} />
          )}
        </>
      )}
    </section>
  )
}

/* ---------- summary ---------- */

function Summary({ log, words, leftover, onExit, onGarden }: { log: LogItem[]; words: Map<string, Word>; leftover: number; onExit: () => void; onGarden: () => void }) {
  const reviews = useLiveQuery(() => db.reviews.toArray(), [])
  const graded = log.filter(l => l.kind !== 'meet')
  const right = graded.filter(l => l.correct).length
  const met = log.filter(l => l.kind === 'meet')
  const now = new Date()
  const days = reviews ? streak(reviews, now) : 0
  return (
    <section className="scr" aria-label="Practice summary">
      <p className="label">Practice done</p>
      <h1 className="h1">{right === graded.length && graded.length > 0 ? 'Every answer right!' : 'Nice work'}</h1>
      <div className="stats3">
        <div className="stat"><b>{graded.length}</b><span>cards answered</span></div>
        <div className="stat"><b>{right} of {graded.length}</b><span>right first time</span></div>
        <div className="stat"><b>{days}</b><span>{days === 1 ? 'day' : 'days'} in a row</span></div>
      </div>
      {leftover > 0 && <p className="notice">Time's up for today. {leftover} {leftover === 1 ? 'card waits' : 'cards wait'} for tomorrow.</p>}
      <div className="card">
        <p className="label">When each word comes back</p>
        <ul className="done-list">
          {met.map((l, i) => (
            <li key={`m${i}`}><span className="w">{words.get(l.wordId)?.word}</span><span className="m">Met today · other directions start tomorrow</span><span className="rating r4">New</span></li>
          ))}
          {graded.map((l, i) => (
            <li key={i}>
              <span className="w">{words.get(l.wordId)?.word}</span>
              <span className="m">{DIRECTION_LABEL[l.kind as Direction]} · back {l.dueAt ? backText(l.dueAt, now) : 'later'}</span>
              <span className={`rating r${l.grade}`}>{GRADE_LABEL[l.grade!]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="row-end">
        <button type="button" className="btn" onClick={onGarden}>See the garden</button>
        <button type="button" className="btn primary" onClick={onExit}>Back to Today</button>
      </div>
    </section>
  )
}
