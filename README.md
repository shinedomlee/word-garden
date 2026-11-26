# Word Garden

A vocabulary trainer for Chris (age 9–12, bilingual, American English). Family members add the words
Chris meets; the app looks them up in open dictionaries and tests Chris in three directions on a
spaced-repetition schedule (FSRS).

This is **phase 1**: the full learning loop on one device. Data is stored in the browser (IndexedDB).
Notion sync is phase 2; Google Sheets is phase 3. The design is in the "Word Garden Blueprint" artifact.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, plus a Network URL for the iPad on the same Wi-Fi
npm test           # unit tests (grading, spelling, syllables, dictionary parsing, FSRS, planner)
npm run build      # type-check and build the installable app into dist/
```

### On the iPad

- **Quick try:** run `npm run dev` on the computer and open the printed *Network* address in Safari on
  the iPad (same Wi-Fi). Everything works except offline use and Home Screen install, which need HTTPS.
- **Real use:** host `dist/` on any static HTTPS host (Cloudflare Pages is the plan, because the phase 2
  Notion connector also runs on Cloudflare). Open the site in Safari, tap Share → Add to Home Screen.
- Each device keeps its own data until phase 2. Use **Settings → Save a backup / Restore** to move it.

## What phase 1 does

| Area | What works |
|---|---|
| Add words | Look up a word (Free Dictionary API = Wiktionary data, plus Simple English Wiktionary for plain wording), tick one or more meanings (the first is the one Chris met; each has its own wording and example sentence; practice takes turns between them, and a retry re-asks the meaning that was missed), edit them, add sentence, tags, Watch-out note, memory hook. Syllables and stress are prefilled and editable. British spellings (harbour) are detected and verified against the dictionary. Paste a list → Inbox → review and approve. |
| Practice | Daily plan: most-forgotten reviews first, then up to 8 new words (none if more than 60 reviews wait), one direction per word per day, time limit. Meet (guess first, say it aloud), Hear it (typed dictation), See it (meaning choice for young cards, flip + self-grade later, every fifth a fill-in-the-blank choice), Recall it (definition + blanked sentence, letter hints). Missed cards come back a few cards later (up to three practice tries that do not change the schedule). |
| Grading | Typed answers graded automatically: wrong → Again; hint, slow or one letter off (6+ letters) → Hard; right → Good; fast and stable → Easy. British spellings count as right with a note. Answer fields turn off autocorrect. |
| Garden | Tiles by stage (Seed → Mastered, weakest direction counts), due drops, filters, search, per-direction strength bars, edit, pause, remove. |
| Progress | Words, mastered, right-first-time vs target, practice days, 7-day forecast, accuracy by direction, tricky words, spelling slips by pattern. |
| Settings | Name, new words per day, session length, target recall, directions, voice (US/UK), accept British spellings, backup/restore, erase. |
| App | Installable PWA, offline after first load; recorded pronunciations are cached once played. |

## Code map

```
src/lib/fsrs.ts        FSRS-7 via ts-fsrs; strength = days until recall falls to 90%
src/lib/session.ts     daily planner (pure, tested)
src/lib/grading.ts     answer checking, grades, spelling-slip patterns, look-alikes
src/lib/dictionary.ts  Free Dictionary API + Simple English Wiktionary parsers
src/lib/spelling.ts    British spelling candidates
src/lib/syllables.ts   syllables (TeX hyphenation patterns) and stress from IPA
src/lib/db.ts          IndexedDB (Dexie): words, cards, reviews, settings, lookups, backup
src/lib/stats.ts       stages, streak, forecast, progress numbers
src/screens/*          Today, Session, Garden, AddWords, Progress, Settings
scripts/make-icons.py  draws the app icons (npm run icons)
```

## Credits

Definitions and examples: Wiktionary and Simple English Wiktionary (CC BY-SA), via the
[Free Dictionary API](https://dictionaryapi.dev/) and the MediaWiki API. Scheduling:
[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT). Syllables:
[hyphen](https://github.com/ytiurin/hyphen) (ISC). Font: Andika (SIL Open Font License).
