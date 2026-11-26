import type { Word } from './types'

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

let shared: HTMLAudioElement | null = null
let lang: 'en-US' | 'en-GB' = 'en-US'

function audioEl(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio()
    shared.preload = 'auto'
  }
  return shared
}

export function setVoiceLang(l: 'en-US' | 'en-GB') {
  lang = l
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined
  const all = window.speechSynthesis.getVoices()
  const match = all.filter(v => v.lang.replace('_', '-') === lang)
  const pool = match.length ? match : all.filter(v => v.lang.startsWith('en'))
  return pool.find(v => /enhanced|premium|natural/i.test(v.name)) ?? pool.find(v => v.localService) ?? pool[0]
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Speak with the device voice. Resolves when finished (or at once if speech is unavailable). */
export function speak(text: string, rate = 0.92): Promise<void> {
  return new Promise(resolve => {
    if (!canSpeak()) return resolve()
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = rate
      const v = pickVoice()
      if (v) u.voice = v
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    } catch {
      resolve()
    }
  })
}

/** Play the word: the recorded pronunciation when there is one (American voice only), else the device voice. */
export async function playWord(word: Pick<Word, 'word' | 'audioUrl'>, slow = false): Promise<void> {
  const useRecording = word.audioUrl && (lang === 'en-US' ? !/-uk\.mp3$/i.test(word.audioUrl) : true)
  if (useRecording) {
    try {
      const a = audioEl()
      a.src = word.audioUrl
      a.playbackRate = slow ? 0.7 : 1
      ;(a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true
      await a.play()
      return
    } catch {
      // fall through to the device voice
    }
  }
  await speak(word.word, slow ? 0.55 : 0.9)
}

/** Call from a tap (Start practice): iPad Safari only allows sound after a user gesture. */
export function unlockAudio(): void {
  try {
    const a = audioEl()
    a.src = SILENT_WAV
    void a.play().catch(() => undefined)
  } catch {
    // ignore
  }
  if (canSpeak()) {
    try {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
    } catch {
      // ignore
    }
  }
}
