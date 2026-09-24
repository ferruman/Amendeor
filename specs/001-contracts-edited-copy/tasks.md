# Tasks: M1 — Contracts and the edited copy

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · `docs/prd.md` §5–§8, §16, §19 · `../WORKSPACE.md` v0.4 · `../MANUSCRIPT.md` · `../Esgardeor/docs/FINDINGS.md` §3
**Goal**: Amendeor can describe a change to someone else's text and apply it to its own copy — safely, with no model.
**Tests**: included; every non-trivial function leaves one runnable check.

## Phase 1: Setup

- [X] T001 Create `package.json` (`name: amendeor`, `type: module`, `bin: { amendeor: src/cli.ts }`, `engines.node >=23.6`, scripts `test: node --test`, `typecheck: tsc --noEmit`), deps `yaml`, `zod`; dev `typescript`, `@types/node`
- [X] T002 [P] `tsconfig.json` with `erasableSyntaxOnly`, `noEmit`, `strict`, `module/moduleResolution: nodenext`, `allowImportingTsExtensions` — no build step (PRD §19)
- [X] T003 [P] `AGENTS.md` (+ `CLAUDE.md` → `@AGENTS.md`): what the tool is, the three invariants, "no build step — what runs is what you edited", pointer to `../LESSONS.md`; `.gitignore`; `README.md` stub
- [X] T004 [P] Fixtures under `test/fixtures/`: `workspace-min/` (codicora.yaml, manuscript.yaml, two chapters with UUID markers, one implicit `s0`, one repeated sentence in a scene for ambiguity); `workspace-errors/<code>/` one per MANUSCRIPT.md §5 error; `standalone/one.md`, `standalone/dir/{01.md,02.txt}`

## Phase 2: Foundational

- [X] T005 `src/hash.ts`: `sha256`, `canonicalJson`, `normalizeText`, `normalizeQuote` exactly per FINDINGS.md §3
- [X] T006 `test/hash.test.ts`: quote hashes from FINDINGS.md §8 examples reproduce (`counted the lanterns…` → `sha256:28d5…`, `Ilya, nineteen that spring` → `sha256:cdaa…`); `normalizeText` cases (BOM, CRLF, trailing spaces, 3+ newlines)
- [X] T007 `src/book.ts`: types `Book { lang, chapters[] }`, `Chapter { slug, title, file, scenes[] }`, `Scene { id, text, implicit, contentHash }`; `splitScenes(text)` on `<!-- scene: <id> -->` lines
- [X] T008 `src/source/workspace.ts`: find and parse `codicora.yaml`, resolve `manuscript.path`, `edited.path`, `findings.path` relative to the manifest with WORKSPACE.md defaults
- [X] T009 `src/source/manuscript.ts`: read `manuscript.yaml` + chapters in manifest order; `ReaderError { code, detail }` for `manifest-missing | manifest-invalid | chapter-file-missing | duplicate-scene-id`; warnings `text-before-first-marker`, `chapter-not-in-manifest`; accept unknown keys and both `canon_event` forms
- [X] T010 [P] `src/source/standalone.ts`: file → one chapter (slug from file name), dir → chapters in name order; markers honoured else implicit `s0`; missing language → error naming `--lang` (never a silent `en`)
- [X] T011 `src/source/index.ts`: `openSource(target, opts)` → `{ book, kind: workspace|standalone, editedDir, stateDir }` (standalone: `--out`, default `<input>.amendeor/`)
- [X] T012 `test/source.test.ts`: workspace-min reads; every error fixture yields its code; standalone file/dir; `edited/` as input reads identically (same slugs and scene ids)

## Phase 3: Proposal contract

- [X] T013 `src/proposal/schema.ts`: zod `amendeor.proposal/0.1` per PRD §7 (categories, impact, `source`, `verification`, optional `unverified: true`); `scripts/schema.ts` writes `docs/schema/proposal.json` via zod's JSON Schema export; test fails on drift
- [X] T014 `src/proposal/identity.ts`: `makeProposal({ category, chapter, scene, target, replacement, … })` → fills `target.hash`, `fingerprint.primary.key` (target hash), `fingerprint.evidence` (replacement hash), `id = amendeor:<16 hex of canonicalJson(primary)>`, context `before`/`after` (≤ 60 chars), `occurrence`
- [X] T015 `src/proposal/locate.ts`: `locate(sceneText, target)` → `{ ok, start, end, moved } | { stale } | { ambiguous }` — normalized matching mapped back to raw offsets; several matches → context, then `occurrence`; replacement spanning more than one paragraph refused
- [X] T016 `test/proposal.test.ts`: id stable when unrelated scene text changes; id stable and evidence changes for a different replacement; locate: unique, whitespace-different, duplicate resolved by context, duplicate resolved by occurrence, gone → stale, context changed → `moved`

## Phase 4: Runs and state

- [X] T017 `src/run/store.ts`: `newRunId()` (`YYYY-MM-DDTHH-MM-SSZ-xxxx`), write run dir via `runs/.tmp-<id>` + rename, atomic `latest.json`, `readRun(id|latest)`; `proposals.jsonl` reader validates each line
- [X] T018 [P] `src/run/lock.ts`: `.codicora/amendeor/lock` with pid + start time; refuse a second run; a stale lock is reported with the path and how to remove it (LESSONS §5)
- [X] T019 `test/run.test.ts`: no partial run dir after a thrown write; lock refusal message

## Phase 5: Accept, reject, build

- [X] T020 `src/edited/decisions.ts`: append/read `edited/accepted.jsonl` (full proposal + `accepted_by`, `at`) and `.codicora/amendeor/rejected-by-author.jsonl`; refuse `unverified` proposals unless `allowUnverified`
- [X] T021 `src/edited/build.ts`: for each source chapter, apply accepted proposals per scene in document order via `locate`; overlap → `conflict`; results `applied | moved | stale | conflict`; write `edited/manuscript.yaml` (source manifest verbatim) and `chapters/*.md` only when changed (atomic); remove chapter files the source no longer lists; never touch the source
- [X] T022 `src/cli.ts`: `accept <target> <id…> | --impact mechanical [--unverified]`, `reject <target> <id…>`, `build <target>`; human summary + `--json`; exit 0 ok / 1 reader or usage error / 2 build finished with stale or conflict
- [X] T023 `test/build.test.ts`: no accepted → `edited/` byte-identical to source; accept one → only that span changes; edit the source elsewhere → rebuild re-applies; delete the target in the source → `stale`, not applied; two overlapping → one `conflict`; source files unchanged (hash before/after); rebuild after deleting `.codicora/` gives the same `edited/`
- [X] T024 `test/build.test.ts`: two identical target strings in one scene resolve by context or occurrence; if context does not distinguish them and the recorded occurrence is no longer valid, `build` reports `ambiguous` and applies neither. Assert replacements are applied against original source offsets in document order, so an earlier edit cannot shift a later target.
- [X] T025 `src/edited/decisions.ts` + `test/build.test.ts`: validate duplicate proposal ids in a run, repeated acceptance, and a second replacement for the same identity. Define one effective accepted revision per id, reject conflicting acceptance records with a named error, and preserve append-only decision history.

**Checkpoint**: a hand-written `proposals.jsonl` in a fixture run → `accept` → `edited/` → edit `manuscript/` → `build` re-applies or marks stale. `edited/` reads back through T009 unchanged in structure.
