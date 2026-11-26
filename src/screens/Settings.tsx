import { useEffect, useRef, useState } from 'react'
import { eraseEverything, exportData, importData, saveSettings } from '../lib/db'
import { speak } from '../lib/audio'
import { DIRECTION_LABEL, DIRECTIONS, type Settings } from '../lib/types'
import { dayKey } from '../lib/util'
import { ConfirmButton, useToast } from '../ui'

export function SettingsScreen({ settings }: { settings: Settings }) {
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [learner, setLearner] = useState(settings.learner)
  const [addedBy, setAddedBy] = useState(settings.addedBy)

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  const save = (patch: Partial<Settings>) => void saveSettings(patch)

  const doExport = async () => {
    const blob = new Blob([await exportData()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `word-garden-backup-${dayKey(new Date())}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    toast('Backup saved to your downloads.')
  }

  const doImport = async (f: File) => {
    try {
      const r = await importData(await f.text())
      toast(`Restored ${r.words} words and ${r.reviews} answers.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  return (
    <section className="scr" aria-label="Settings">
      <h1 className="h2">Settings</h1>

      <div className="card settings">
        <div className="set-row">
          <label htmlFor="set-learner">Learner's name</label>
          <input id="set-learner" className="input" value={learner} onChange={e => setLearner(e.target.value)} onBlur={() => learner.trim() && save({ learner: learner.trim() })} />
        </div>
        <div className="set-row">
          <label htmlFor="set-by">"Added by" name on this device</label>
          <input id="set-by" className="input" value={addedBy} onChange={e => setAddedBy(e.target.value)} onBlur={() => addedBy.trim() && save({ addedBy: addedBy.trim() })} />
        </div>
      </div>

      <h2 className="h2">Practice</h2>
      <div className="card settings">
        <div className="set-row">
          <label htmlFor="set-new">New words per day</label>
          <input type="range" id="set-new" min={0} max={15} value={settings.newPerDay} onChange={e => save({ newPerDay: Number(e.target.value) })} />
          <output htmlFor="set-new">{settings.newPerDay}</output>
        </div>
        <div className="set-row">
          <span className="lbl" id="len-label">Session length</span>
          <div className="tabs" role="group" aria-labelledby="len-label">
            {[10, 15, 20].map(m => <button key={m} type="button" className={settings.sessionMinutes === m ? 'on' : ''} aria-pressed={settings.sessionMinutes === m} onClick={() => save({ sessionMinutes: m })}>{m} min</button>)}
          </div>
        </div>
        <div className="set-row">
          <span className="lbl" id="ret-label">Target recall</span>
          <div className="tabs" role="group" aria-labelledby="ret-label">
            {[0.85, 0.9, 0.95].map(r => <button key={r} type="button" className={settings.targetRecall === r ? 'on' : ''} aria-pressed={settings.targetRecall === r} onClick={() => save({ targetRecall: r })}>{Math.round(r * 100)}%</button>)}
          </div>
          <span className="help">Higher means more reviews.</span>
        </div>
        <div className="set-row">
          <span className="lbl">Directions</span>
          <div className="checks">
            {DIRECTIONS.map(d => (
              <label key={d} htmlFor={`dir-${d}`}>
                <input type="checkbox" id={`dir-${d}`} checked={settings.directions[d]}
                  onChange={e => {
                    const next = { ...settings.directions, [d]: e.target.checked }
                    if (!Object.values(next).some(Boolean)) return toast('Keep at least one direction on.')
                    save({ directions: next })
                  }} />
                {DIRECTION_LABEL[d]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <h2 className="h2">Voice and spelling</h2>
      <div className="card settings">
        <div className="set-row">
          <label htmlFor="set-voice">Voice</label>
          <select id="set-voice" className="input" value={settings.voice} onChange={e => { const v = e.target.value as Settings['voice']; save({ voice: v }); void speak(v === 'en-US' ? 'color' : 'colour') }}>
            <option value="en-US">American English</option>
            <option value="en-GB">British English</option>
          </select>
        </div>
        <div className="set-row">
          <label htmlFor="set-british">Accept British spellings too (colour for color)</label>
          <input type="checkbox" id="set-british" checked={settings.acceptBritish} onChange={e => save({ acceptBritish: e.target.checked })} />
        </div>
      </div>

      <h2 className="h2">Your data</h2>
      <div className="card">
        <p className="sub">In this version everything is stored on this device only. Notion sync arrives in phase 2, so save a backup now and then.</p>
        {persisted === false && <p className="help">This browser may clear the data if the app goes unused for a while. On iPad, add Word Garden to the Home Screen to keep it.</p>}
        <div className="row">
          <button type="button" className="btn" onClick={() => void doExport()}>Save a backup</button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>Restore from a backup</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
        </div>
        <p className="help">Restoring replaces every word and answer on this device with the ones in the file.</p>
        <div className="row"><ConfirmButton label="Erase everything" confirmLabel="Erase all words and history" onConfirm={() => void eraseEverything().then(() => toast('Everything was erased.'))} /></div>
      </div>
    </section>
  )
}
