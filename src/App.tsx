import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './lib/db'
import { setVoiceLang } from './lib/audio'
import { streak } from './lib/stats'
import { addDays } from './lib/util'
import { Icon, useNow, useSettings } from './ui'
import { Today } from './screens/Today'
import { Session } from './screens/Session'
import { Garden } from './screens/Garden'
import { AddWords } from './screens/AddWords'
import { Progress } from './screens/Progress'
import { SettingsScreen } from './screens/Settings'

export type Route = 'today' | 'practice' | 'garden' | 'add' | 'progress' | 'settings'
const ROUTES: Route[] = ['today', 'practice', 'garden', 'add', 'progress', 'settings']

function routeFromHash(): Route {
  const h = window.location.hash.replace('#', '') as Route
  return ROUTES.includes(h) && h !== 'practice' ? h : 'today'
}

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'today', label: 'Today', icon: 'home' },
  { route: 'garden', label: 'Garden', icon: 'sprout' },
  { route: 'add', label: 'Add', icon: 'plus' },
  { route: 'progress', label: 'Progress', icon: 'chart' },
  { route: 'settings', label: 'Settings', icon: 'sliders' },
]

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const settings = useSettings()
  const now = useNow()
  const recent = useLiveQuery(() => db.reviews.where('at').aboveOrEqual(addDays(new Date(), -400)).toArray(), [])
  const inboxCount = useLiveQuery(() => db.words.where('status').equals('inbox').count(), []) ?? 0

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (settings) setVoiceLang(settings.voice)
  }, [settings?.voice])

  // Ask the browser to keep this site's data; Safari otherwise may clear it after 7 days unused.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  const go = (r: Route) => {
    setRoute(r)
    if (r !== 'practice') history.replaceState(null, '', `#${r}`)
  }

  const days = recent ? streak(recent, now) : 0

  return (
    <div className={`shell${route === 'practice' ? ' focus' : ''}`}>
      <header className="topbar">
        <span className="logo"><Icon name="leaf" />Word Garden</span>
        <span className="spacer" />
        {days > 0 && <span className="chip sun"><Icon name="flame" className="sm" />{days}-day streak</span>}
        <span className="avatar" role="img" aria-label={settings?.learner ?? 'Learner'}>{(settings?.learner ?? 'C').slice(0, 1).toUpperCase()}</span>
      </header>
      <nav className="rail" aria-label="Sections">
        {NAV.map(n => (
          <button key={n.route} type="button" className={route === n.route ? 'on' : ''} aria-current={route === n.route ? 'page' : undefined} onClick={() => go(n.route)}>
            <Icon name={n.icon} />
            {n.label}
            {n.route === 'add' && inboxCount > 0 && <span className="badge" aria-label={`${inboxCount} in Inbox`}>{inboxCount}</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {!settings ? null : route === 'practice' ? (
          <Session settings={settings} onExit={() => go('today')} onGarden={() => go('garden')} />
        ) : route === 'garden' ? (
          <Garden settings={settings} />
        ) : route === 'add' ? (
          <AddWords settings={settings} />
        ) : route === 'progress' ? (
          <Progress settings={settings} />
        ) : route === 'settings' ? (
          <SettingsScreen settings={settings} />
        ) : (
          <Today settings={settings} streakDays={days} inboxCount={inboxCount} onStart={() => go('practice')} onGo={go} />
        )}
      </main>
    </div>
  )
}
