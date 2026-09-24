# Tasks: M5 — Semantic and voice guards (v0.1 release)

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · `docs/prd.md` §9.3, §9.4, §18 · `../LESSONS.md` §2, §3
**Depends on**: M4
**Goal**: no model proposal reaches the author unless meaning and voice were checked; the §18 gates hold in both languages.

## Phase 1: Deterministic traps

- [X] T001 `src/guard/traps.ts`: compare target vs replacement — numbers/dates/times (tokenizer from M2 keeps `10:14` whole); negation words from the pack added/removed; proper nouns added/removed/changed, compared with `sameStem` so declension is not a change; modal/certainty words added/removed; dialogue text changed beyond punctuation when the category is not `dialogue-mechanics`
- [X] T002 `test/guard-traps.test.ts`: every `traps.json` type fires on its samples; zero fires on the mechanical proposals of the M3 baseline; `управление`→`управления` is not a name change

## Phase 2: Verifier

- [X] T003 `src/prompts/verify.ts` (versioned): one question — did the edit change information, action, implication, certainty, character state or meaning; answer `{ preserved: bool, reason }`; given before, after and the surrounding paragraph only
- [X] T004 `src/guard/verify.ts`: `verify.passes` (default 3 for `prose`, 1 for `mechanical`); survive only if every pass says preserved; warn in the report when the verify profile's `family` equals the edit profile's; each pass cached by (before, after, context, profile, prompt version, pass index)
- [X] T005 Pipeline order: traps first (no model call on a hit) → verifier → voice guard; rejections to `rejected.jsonl` with `{ guard, reason }`; survivors lose `unverified`, gain `verification { passes, agreed, semantic_risk: none, voice: ok }`

## Phase 3: Voice guard

- [X] T006 `src/guard/voice.ts`: `preserve` rules (`sentence-fragments`: reject edits that join a fragment; `dialect`/`informal-dialogue`: reject grammar/word-choice edits inside dialogue); edits inside dialogue need `dialogue-mechanics` or an explicit `normalize` rule
- [X] T007 Book-relative distance: reject an edit that moves a sentence's length, register markers (contractions, pack-listed formal/informal words) or punctuation profile beyond the book's own interquartile range
- [X] T008 `test/guard-voice.test.ts`: `"Yeah. Ain't happening."` survives; a joined fragment is rejected when `preserve` lists fragments and accepted when it does not

## Phase 4: Gate and release

- [X] T009 Feed `traps.json` through the guards (as if proposed by the model); report guard recall per type and language
- [X] T010 `eval/run.ts --mode copy --runs 3` on both works; gate per PRD §18: guard recall ≥ 95%, unnecessary-edit rate ≤ 2%, semantic regression 0 — per language, worst run counts. The same guards apply to model suggestions in `--mode mechanical`.
- [ ] T011 Real-book check: `../books/seymsk` and `../books/jekyll-and-hyde`, read every `prose` proposal of one chapter each by hand; any meaning change found becomes a new trap sample and a fix before release
- [ ] T012 Docs: `README.md` (install, no-key quick start, config, workflow `edit → report → accept → build`, what it will never do), `CHANGELOG.md`, update `../README.md` status row; tag `v0.1.0`

**Checkpoint = v0.1.0**: gates met in `en` and `ru`, measured, with the results committed under `eval/results/`.
