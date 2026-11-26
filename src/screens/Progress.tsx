import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { doneTodaySet, dueForecast, firstTryRate, practiceDays, slipSummary, stageOf, streak, trickyWords } from '../lib/stats'
import { SLIP_LABEL } from '../lib/grading'
import { DIRECTION_LABEL, DIRECTIONS, type Direction, type Settings } from '../lib/types'
import { addDays } from '../lib/util'
import { Icon, useNow } from '../ui'

const DIR_ICON: Record<Direction, string> = { hear: 'ear', see: 'eye', recall: 'bulb' }
const DIR_SUB: Record<Direction, string> = { hear: 'sound → word', see: 'word → meaning', recall: 'meaning → word' }
const SUGGEST: Record<Direction, string> = {
  hear: 'Add a Watch out note for sound-alikes, and practice saying it slowly.',
  see: 'Add a picture or a contrast word to the meaning.',
  recall: 'Add a memory hook for the spelling, such as one Collar, two Sleeves.',
}
const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`)

export function Progress({ settings }: { settings: Settings }) {
  const now = useNow()
  const words = useLiveQuery(() => db.words.where('status').anyOf('active', 'paused').toArray(), [])
  const cards = useLiveQuery(() => db.cards.toArray(), [])
  const reviews = useLiveQuery(() => db.reviews.toArray(), [])
  if (!words || !cards || !reviews) return null

  const active = words.filter(w => w.status === 'active')
  const weekAgo = addDays(now, -7)
  const mastered = active.filter(w => stageOf(w, cards, settings) === 4).length
  const rate = firstTryRate(reviews, now)
  const target = Math.round(settings.targetRecall * 100)
  const forecast = dueForecast(words, cards, settings, now, doneTodaySet(reviews, now))
  const tricky = trickyWords(active, cards)
  const slips = slipSummary(reviews, words, now)

  return (
    <section className="scr wide" aria-label="Progress">
      <div className="row-between"><h1 className="h2">Progress</h1><span className="chip">Last 30 days</span></div>
      <div className="kpis">
        <div className="kpi"><span className="l">Words in the garden</span><span className="v">{active.length}</span><span className="d">+{words.filter(w => w.createdAt >= weekAgo).length} this week</span></div>
        <div className="kpi"><span className="l">Mastered</span><span className="v">{mastered}</span><span className="d">90+ days in every direction</span></div>
        <div className="kpi"><span className="l">Right first time</span><span className="v">{pct(rate)}</span><span className="d">Target {target}%</span></div>
        <div className="kpi"><span className="l">Practice days</span><span className="v">{practiceDays(reviews, now)} of 30</span><span className="d">{streak(reviews, now)}-day streak</span></div>
      </div>
      <div className="two">
        <div className="card">
          <p className="label">Cards due, next 7 days</p>
          <DueChart data={forecast.map((f, i) => ({ label: i === 0 ? 'Today' : f.day.toLocaleDateString('en-US', { weekday: 'short' }), count: f.count }))} />
        </div>
        <div className="card">
          <p className="label">Right first time, by direction</p>
          <div className="meters">
            {DIRECTIONS.filter(d => settings.directions[d]).map(d => {
              const r = firstTryRate(reviews, now, d)
              const low = r !== null && r < settings.targetRecall
              return (
                <div key={d} className="meter">
                  <span className="nm"><Icon name={DIR_ICON[d]} className="sm" />{DIRECTION_LABEL[d]} <span>{DIR_SUB[d]}</span></span>
                  <span className="vl">{pct(r)}{low && <small>below target</small>}</span>
                  <span className="tr" role="img" aria-label={`${DIRECTION_LABEL[d]}: ${pct(r)} right first time, target ${target}%`}>
                    <i className={low ? 'low' : ''} style={{ width: `${(r ?? 0) * 100}%` }} />
                    <b style={{ left: `${target}%` }} />
                  </span>
                </div>
              )
            })}
          </div>
          <p className="help">The black line marks the {target}% target.</p>
        </div>
      </div>
      <div className="two">
        <div className="card">
          <p className="label">Tricky words: 4 or more lapses</p>
          {tricky.length === 0 ? <p className="sub">No tricky words yet.</p> : (
            <ul className="rows">
              {tricky.slice(0, 8).map(t => (
                <li key={t.word.id}><span className="w">{t.word.word}</span><span className="m">{t.lapses} lapses, mostly {DIRECTION_LABEL[t.direction]}. {SUGGEST[t.direction]}</span><span className="c">{t.lapses}</span></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <p className="label">Spelling slips by pattern</p>
          {slips.length === 0 ? <p className="sub">No spelling slips in the last 30 days.</p> : (
            <ul className="rows">
              {slips.map(s => <li key={s.kind}><span className="w">{SLIP_LABEL[s.kind]}</span><span className="m">{s.examples.join(', ')}</span><span className="c">{s.count}</span></li>)}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

function DueChart({ data }: { data: { label: string; count: number }[] }) {
  const [tip, setTip] = useState<number | null>(null)
  const W = 420, H = 196, L = 30, R = 8, T = 18, B = 28
  const pw = W - L - R, ph = H - T - B, base = T + ph
  const peak = Math.max(...data.map(d => d.count))
  const step = peak <= 8 ? 2 : peak <= 20 ? 5 : peak <= 40 ? 10 : 20
  const max = Math.max(step * 2, Math.ceil(peak / step) * step)
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  const band = pw / data.length, bw = 22, r = 4
  const y = (v: number) => base - (v / max) * ph
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cards due: ${data.map(d => `${d.label} ${d.count}`).join(', ')}`}>
        {ticks.map(t => (
          <g key={t}><line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="tick" x={L - 7} y={y(t) + 4} textAnchor="end">{t}</text></g>
        ))}
        {data.map((d, i) => {
          const x = L + i * band + (band - bw) / 2
          const top = y(d.count)
          return (
            <g key={i}>
              {d.count > 0 && <path className={`col${i === 0 ? ' now' : ''}`} d={`M${x},${base} V${top + r} A${r},${r} 0 0 1 ${x + r},${top} H${x + bw - r} A${r},${r} 0 0 1 ${x + bw},${top + r} V${base} Z`} />}
              {d.count === peak && peak > 0 && <text className="val" x={x + bw / 2} y={top - 6} textAnchor="middle">{d.count}</text>}
              <text className="tick" x={x + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>
            </g>
          )
        })}
        <line className="base" x1={L} x2={W - R} y1={base} y2={base} />
        {data.map((d, i) => (
          <rect key={i} className="hit" x={L + i * band} y={T} width={band} height={ph} tabIndex={0} aria-label={`${d.label}: ${d.count} cards due`}
            onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)} />
        ))}
      </svg>
      {tip !== null && (
        <div className="tip" style={{ left: `${((L + tip * band + band / 2) / W) * 100}%`, top: `calc(${(y(data[tip].count) / H) * 100}% - 8px)` }}>
          {data[tip].label}: {data[tip].count} {data[tip].count === 1 ? 'card' : 'cards'}
        </div>
      )}
    </div>
  )
}
