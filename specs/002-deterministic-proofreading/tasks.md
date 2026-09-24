# Tasks: M2 — Deterministic proofreading

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · `docs/prd.md` §9.1, §10, §11, §15–§17 · `../LESSONS.md` §2, §5
**Depends on**: M1
**Goal**: `amendeor edit --mode mechanical` is useful with no API key, in English and Russian.

## Phase 1: Config

- [X] T001 `src/config.ts`: layers CLI > `AMENDEOR_*` env (`__` for nesting) > `<workspace>/amendeor.yaml` > `$AMENDEOR_CONFIG` or `$XDG_CONFIG_HOME/codicora/amendeor.yaml` > defaults; zod schemas for user level (providers, profiles) and workspace level (`language`, `preserve`, `normalize`, `avoid`, `auto_accept`, `rules`); effective config + winning layer per key
- [X] T002 Refuse keys with characters a header cannot carry and literal placeholders (`…`, `<paste-key-here>`) with a message naming the field (LESSONS §5)
- [X] T003 `test/config.test.ts`: every test sets `XDG_CONFIG_HOME` to a nonexistent path — never reads the real user config (LESSONS "For agents")

## Phase 2: Language and text

- [X] T004 [P] `src/lang/en/pack.json`, `src/lang/ru/pack.json` + `src/lang/pack.ts` (zod): stopwords, negation words, modal/certainty words, quote pairs, sentence-end abbreviations, filter verbs, adverb suffixes (`ru`: empty on purpose), dash conventions; pack version
- [X] T005 Missing pack is loud: `inspect`/`edit` warn in console, `run.json` and report; derived stopwords (frequent + short tokens of the book) replace the list, never an empty filter (LESSONS §2)
- [X] T006 `src/text/segment.ts`: paragraphs, sentences (`Intl.Segmenter` + pack abbreviations), words with offsets; `10:14`, dates and decimals kept as one token
- [X] T007 [P] `src/text/names.ts`: proper nouns = capitalized away from a sentence start, book-wide; `sameStem(a, b)` per LESSONS §2 (same length and all but the last letter, or a shared 6-char prefix)
- [X] T008 [P] `src/text/dialogue.ts`: dialogue spans for `“”`, `""`, `«»` and Russian dash-led speech lines
- [X] T009 Tests for T004–T008 on `en` and `ru` samples, including a timestamp, an inflected name and a dash-led Russian dialogue

## Phase 3: Rules

- [X] T010 `src/rules/index.ts`: `Rule { id, version, langs, category, impact, detect(scene, ctx) → ProposalDraft[] }`; registry; per-rule on/off from config; rule-set version = hash of ids + versions
- [X] T011 [P] `rules/doubled-word.ts` (case-insensitive, across line breaks; skips intentional repetition inside dialogue when `preserve` says so)
- [X] T012 [P] `rules/whitespace.ts` (doubled spaces, space before punctuation, trailing spaces inside a line)
- [X] T013 [P] `rules/balance.ts` (unbalanced quotes and brackets per paragraph — reported, proposed only when the fix is unambiguous)
- [X] T014 [P] `rules/quotes.ts` (normalize to `normalize.quotes`; nested quotes per language)
- [X] T015 [P] `rules/dashes-ellipsis.ts` (hyphen vs dash, spacing around dashes per language, `...` → `…` if configured)
- [X] T016 [P] `rules/capitalization.ts` (lowercase after sentence end, respecting pack abbreviations)
- [X] T017 [P] `rules/markdown.ts` (stray `**`, `_`, heading markers mid-paragraph, escaped characters)
- [X] T018 [P] `rules/spelling-variant.ts` (book-level majority for `colour/color`-type pairs from the pack; `ё/е` per `normalize.yo`) — minority occurrences proposed
- [X] T019 [P] `rules/name-variant.ts` (two spellings of what `sameStem` + edit distance 1 says is one name) — `category: terminology`, `impact: prose`: never auto-accepted, two characters may really differ
- [X] T020 `test/rules/*.test.ts`: each rule fires on its positive sample in each language it claims and **does not fire on the control text** (`test/fixtures/control-en.md`, `control-ru.md` — clean, typographically correct prose)

## Phase 4: Metrics

- [X] T021 `src/metrics/index.ts`: per scene and book baseline — n-gram repeats (content-word filter from the pack or derived), word-frequency spikes (names excluded via T007), doubled phrases within a paragraph, dialogue-tag distribution, sentence-length distribution, scene opening/ending repetition, not-X-but-Y, tricolons, rhetorical questions, filter verbs, adverbs (absent where the pack has no suffixes), dash and semicolon density
- [X] T022 Every hotspot requires *above the book's own baseline* first and an absolute floor second (LESSONS §2); `test/metrics.test.ts` includes a Russian dash-heavy scene that must not be a hotspot against a Russian baseline

## Phase 5: Commands

- [X] T023 `src/cache.ts`: `.codicora/amendeor/cache/<stage>/<key>.json`, key = hash of everything the unit reads (scene text, config slice, rule-set version); failures never cached
- [X] T024 `inspect <target>`: structure, language, word counts, pack status, metric hotspots; `--json`; no run dir
- [X] T025 `edit <target> --mode mechanical`: rules-only in M2, over all scenes → proposals (dedupe by id, drop author-rejected) → run dir (`run.json` codicora.run-shaped: inputs, config, stages with `units { cached, computed, failed }`, counts) → `auto_accept` applied through M1 accept + build; M4 adds optional model grammar/spelling when an edit profile is configured
- [X] T026 `src/report.ts` + `report <target> [--run]`: PRD §17 layout, `degraded` section, `--json`
- [X] T027 `diff <target>`: previous run vs latest by id → `new | unchanged | updated | resolved`, plus `stale` for accepted proposals that no longer locate
- [X] T028 `test/cli.test.ts`: `edit --mode mechanical` with no config at all succeeds and says "rules only"; two runs over the same input produce identical proposals; second run is all cache hits
- [X] T029 Perf check: generated 120k-word book, cold `edit --mode mechanical` < 10 s, warm < 2 s
- [X] T030 Smoke (manual, not CI): run over `../books/jekyll-and-hyde` and `../books/seymsk`; read the top 30 proposals of each by eye; record false positives as control-text additions and rule fixes
- [X] T031 `src/patterns/formulaic.ts` + `inspect`: report narrow English/Russian phrase hits with id, scene address, exact quote and raw offsets; exclude dialogue; never infer AI authorship or generate an edit directly. `test/fixtures/formulaic-examples.json` has positive and keep cases per language; both clean controls produce zero hits.

**Checkpoint**: both real books get a mechanical run with no key; the control texts produce zero proposals.
