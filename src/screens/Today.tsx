import { useLiveQuery } from 'dexie-react-hooks'
import { buildTodayPlan, db, saveSettings } from '../lib/db'
import { unlockAudio } from '../lib/audio'
import { isDueToday, stageOf, STAGES } from '../lib/stats'
import { DIRECTION_LABEL, type Settings } from '../lib/types'
import { Icon, useDoneToday, useNow } from '../ui'
import type { Route } from '../App'

function greeting(d: Date) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

const isIpadSafari = () =>
  (/iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) &&
  !(navigator as Navigator & { standalone?: boolean }).standalone

export function Today({ settings, streakDays, inboxCount, onStart, onGo }: { settings: Settings; streakDays: number; inboxCount: number; onStart: () => void; onGo: (r: Route) => void }) {
  const now = useNow()
  const doneToday = useDoneToday(now)
  const words = useLiveQuery(() => db.words.toArray(), [])
  const cards = useLiveQuery(() => db.cards.toArray(), [])
  const today = useLiveQuery(() => buildTodayPlan(), [words, cards, settings])

  if (!words || !cards) return null
  const plan = today?.plan
  const active = words.filter(w => w.status === 'active')
  const due = active.filter(w => isDueToday(w, cards, settings, now, doneToday))
  const counts = [0, 1, 2, 3, 4].map(s => active.filter(w => stageOf(w, cards, settings) === s).length)
  const recentWords = words.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 4)
  const nextDir = (wordId: string) => {
    const c = cards.filter(x => x.wordId === wordId && settings.directions[x.direction]).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0]
    return c ? DIRECTION_LABEL[c.direction] : ''
  }
  const steps = plan?.steps.length ?? 0

  return (
    <section className="scr" aria-label="Today">
      <div>
        <p className="label">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="h1">{greeting(now)}, {settings.learner}</h1>
      </div>

      {isIpadSafari() && !settings.installHintDismissed && (
        <div className="notice green">
          <span>Install Word Garden: tap the Share button, then <b>Add to Home Screen</b>. It opens full screen and keeps its data safer.</span>
          <button type="button" className="btn small" onClick={() => void saveSettings({ installHintDismissed: true })}>Got it</button>
        </div>
      )}

      {active.length === 0 ? (
        <div className="card empty">
          <Icon name="sprout" className="lg" />
          <p className="big">The garden is empty</p>
          <p className="sub">Add the first words Chris has met in books, lessons or conversation.</p>
          <button type="button" className="btn primary" onClick={() => onGo('add')}>Add words</button>
        </div>
      ) : (
        <div className="card hero-card">
          <div>
            <p className="label">Today's practice</p>
            {steps > 0 ? (
              <>
                <p className="big">
                  {plan!.newWords.length > 0 && `${plan!.newWords.length} new ${plan!.newWords.length === 1 ? 'word' : 'words'}`}
                  {plan!.newWords.length > 0 && plan!.reviewCount > 0 && ' · '}
                  {plan!.reviewCount > 0 && `${plan!.reviewCount} ${plan!.reviewCount === 1 ? 'review' : 'reviews'}`}
                </p>
                <p className="sub">About {plan!.minutes} {plan!.minutes === 1 ? 'minute' : 'minutes'}.{plan!.dueCount > plan!.reviewCount && ` ${plan!.dueCount - plan!.reviewCount} more wait for tomorrow.`}</p>
              </>
            ) : (
              <>
                <p className="big">All done for today</p>
                <p className="sub">{streakDays > 0 ? `${streakDays}-day streak. ` : ''}New reviews appear tomorrow.</p>
              </>
            )}
          </div>
          <button type="button" className="btn primary lg" disabled={steps === 0} onClick={() => { unlockAudio(); onStart() }}>
            Start practice<Icon name="arrow" />
          </button>
        </div>
      )}

      {inboxCount > 0 && (
        <div className="notice">
          <span><b>{inboxCount}</b> {inboxCount === 1 ? 'word is' : 'words are'} waiting in the Inbox for a meaning to be picked.</span>
          <button type="button" className="btn small" onClick={() => onGo('add')}>Open Inbox</button>
        </div>
      )}

      {active.length > 0 && (
        <div className="two">
          <div className="card">
            <p className="label"><Icon name="drop" className="sm sun-ic" />Needs water</p>
            {due.length === 0 ? (
              <p className="sub">Nothing is due. Every word is watered.</p>
            ) : (
              <ul className="list">
                {due.slice(0, 6).map(w => <li key={w.id}><b>{w.word}</b><span>{nextDir(w.id)}</span></li>)}
                {due.length > 6 && <li><span>and {due.length - 6} more</span></li>}
              </ul>
            )}
          </div>
          <div className="card">
            <p className="label">Recently added</p>
            <ul className="list">
              {recentWords.map(w => <li key={w.id}><b>{w.word}</b><span>{w.addedBy}{w.metIn ? ` · ${w.metIn}` : ''}</span></li>)}
            </ul>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="card">
          <div className="row-between"><p className="label">Garden</p><button type="button" className="btn quiet" onClick={() => onGo('garden')}>Open garden</button></div>
          <div className="seg" role="img" aria-label={`Garden by stage: ${counts.map((c, s) => `${STAGES[s]} ${c}`).join(', ')}`}>
            {counts.map((c, s) => (c ? <i key={s} className={`s${s}`} style={{ flex: c }} /> : null))}
          </div>
          <ul className="legend">
            {counts.map((c, s) => <li key={s}><i className={`sw s${s}`} style={s === 0 ? { background: 'var(--g0-line)', border: 0 } : undefined} />{STAGES[s]} <b>{c}</b></li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
