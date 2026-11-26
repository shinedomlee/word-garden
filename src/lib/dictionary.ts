import type { Sense } from './types'

export interface LookupResult {
  word: string
  ipa: string
  audioUrl: string
  senses: Sense[]
  sourceUrl: string
  license: string
}

/* ---------- Free Dictionary API (Wiktionary data) ---------- */

interface FdPhonetic { text?: string; audio?: string }
interface FdEntry {
  word: string
  phonetic?: string
  phonetics?: FdPhonetic[]
  meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
  license?: { name?: string }
  sourceUrls?: string[]
}

export function parseFreeDictionary(json: unknown): LookupResult | null {
  if (!Array.isArray(json) || json.length === 0) return null
  const entries = json as FdEntry[]
  const phonetics = entries.flatMap(e => e.phonetics ?? [])
  const us = phonetics.find(p => p.audio && /-us\.mp3$/i.test(p.audio))
  const anyAudio = phonetics.find(p => p.audio)
  const audio = us ?? anyAudio
  const ipa = audio?.text || entries.find(e => e.phonetic)?.phonetic || phonetics.find(p => p.text)?.text || ''
  const senses: Sense[] = []
  for (const e of entries) {
    for (const m of e.meanings ?? []) {
      for (const d of m.definitions) {
        senses.push({ pos: m.partOfSpeech, definition: d.definition.trim(), example: d.example?.trim() || undefined, source: 'wiktionary' })
      }
    }
  }
  return {
    word: entries[0].word,
    ipa,
    audioUrl: audio?.audio ?? '',
    senses: senses.slice(0, 12),
    sourceUrl: entries[0].sourceUrls?.[0] ?? '',
    license: entries[0].license?.name ?? 'CC BY-SA',
  }
}

export async function fetchFreeDictionary(word: string, signal?: AbortSignal): Promise<LookupResult | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.trim().toLowerCase())}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`)
  return parseFreeDictionary(await res.json())
}

/* ---------- Simple English Wiktionary (plain wording for young readers) ---------- */

function cleanWikitext(s: string): string {
  let out = s
  for (let i = 0; i < 4; i++) out = out.replace(/\{\{w\|([^}|]+)(\|[^}]*)?\}\}/g, '$1')
  out = out.replace(/\{\{[^{}]*\}\}/g, '')
  out = out.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
  out = out.replace(/'''?/g, '').replace(/<[^>]+>/g, '')
  out = out.replace(/^\s*\((?:countable|uncountable|transitive|intransitive|informal|formal|plural)[^)]*\)\s*/i, '')
  return out.replace(/\s+/g, ' ').trim()
}

export function parseSimpleWikitext(text: string): Sense[] {
  const senses: Sense[] = []
  let pos = ''
  let last: Sense | null = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const heading = line.match(/^==+\s*([^=]+?)\s*==+$/)
    if (heading) {
      const h = heading[1].toLowerCase()
      pos = /noun|verb|adjective|adverb|preposition|pronoun|interjection|conjunction/.test(h) ? h : pos
      continue
    }
    if (/^#\s*[^:*#]/.test(line) && pos) {
      const def = cleanWikitext(line.replace(/^#\s*/, ''))
      if (def) {
        last = { pos, definition: def, source: 'simple' }
        senses.push(last)
      }
    } else if (/^#:/.test(line) && last && !last.example) {
      const ex = cleanWikitext(line.replace(/^#:\s*/, ''))
      if (ex) last.example = ex
    }
  }
  return senses.slice(0, 6)
}

export async function fetchSimpleWiktionary(word: string, signal?: AbortSignal): Promise<Sense[]> {
  const url = `https://simple.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word.trim().toLowerCase())}&prop=wikitext&format=json&formatversion=2&origin=*`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const data = (await res.json()) as { parse?: { wikitext?: string } }
  return data.parse?.wikitext ? parseSimpleWikitext(data.parse.wikitext) : []
}
