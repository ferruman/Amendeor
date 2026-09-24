# Tasks: M3 — Evaluation harness

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · `docs/prd.md` §18 · `../LESSONS.md` §4
**Depends on**: M2 (rules to measure)
**Goal**: quality is a number before the first model call, so M4 and M5 are measured from their first run.

## Phase 1: Fixtures

- [X] T001 `eval/fixtures/jekyll-en/original/`: 3–4 chapters from Project Gutenberg #43 (`../pg43.txt`), header/licence stripped, split into a workspace (codicora.yaml, manuscript.yaml, UUID markers); one chapter marked **control**; `PROVENANCE.md` (edition, URL, transformations)
- [X] T002 [P] `eval/fixtures/<work>-ru/original/`: a public-domain Russian prose text of comparable size (e.g. Чехов, short stories) — must contain dash-led dialogue and inflected names; control chapter; `PROVENANCE.md`. Not `books/seymsk`: the fixture is published with the repo
- [X] T003 [P] `preserve.json` per work: hand-marked spans of intentional style (fragments, dialect, repetition for effect, dialogue register) with a note each

## Phase 2: Mutations and traps

- [X] T004 `eval/mutate.ts`: seeded, deterministic; writes `mutated/` + `mutations.json` `{ id, type, chapter, scene, span, original, mutated }`. Types: typo, doubled word, punctuation, agreement (`en` subject–verb; `ru` gender/case ending), redundancy insertion, unnecessary qualifier, dialogue-format error, terminology variant, repeated sentence frame. Never inside `preserve` spans or the control chapter
- [X] T005 `eval/traps.ts`: `traps.json` — sentence pairs `{ before, after, type }` where `after` reads fluently and changes meaning: negation, number, name, location, certainty, ownership, intention, chronology; ≥ 20 per type per language, half generated from the fixture's own sentences, half hand-written for the hard cases (`didn't recognize` → `barely recognized`)
- [X] T006 `test/eval-fixtures.test.ts`: mutations are reproducible from the seed; every mutation span locates; no mutation in control or preserve

## Phase 3: Scoring

- [X] T007 `eval/score.ts`: proposal ↔ mutation by span overlap; a mutation is **recalled** when applying the proposal leaves the mutated span equal to the original or otherwise different from the mutation and nothing outside the span is changed (properties, not exact strings)
- [X] T008 Metrics per PRD §18: mutation recall per type; unnecessary-edit rate (proposals on control + preserve spans + unmutated text, over scanned words); guard recall and semantic regression (read from M5 output; `n/a` until then); proposal precision from `eval/labels/*.jsonl` when a labelled sample exists
- [X] T009 `eval/run.ts --work <id> --mode <mode> --runs N`: runs `amendeor edit` over `mutated/`, scores each run, writes `eval/results/<date>-<mode>.json` + `.md` with mean and spread (min–max) per metric; also records rule-set/prompt versions and model ids

## Phase 4: Baseline

- [X] T010 Run `--mode mechanical --runs 1` (deterministic) on both works; freeze as `eval/BASELINE.md` with the command that reproduces it (LESSONS §4 "Freeze a baseline")
- [X] T011 Fix or retune any rule with an unnecessary-edit rate above 2% on the control; the control stays clean

**Checkpoint**: `eval/BASELINE.md` shows per-type recall for the rules and 0 proposals on both controls.
