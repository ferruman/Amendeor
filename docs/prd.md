# Amendeor

**Product Requirements Document**
**Status:** Draft v0.4 · 2026-09-24
**Role:** copy editor / proofreader
**Repository:** `Amendeor`

---

## 1. Summary

Amendeor is a local-first copy editor and proofreader. It takes finished text — a Codicora manuscript or any standalone Markdown/plain-text file — and produces evidence-backed, reviewable **edit proposals**, then builds an **edited copy** from the ones that are accepted.

It works on grammar, spelling, punctuation, typography, clarity, redundancy, local repetition, dialogue mechanics, terminology and spelling consistency, and formulaic prose patterns.

It does not do substantive revision: plot, character arcs, pacing, canon, missing events and story logic belong upstream.

Three invariants:

> **1. Amendeor may change how something is said, never what happens or what the text means.**
>
> **2. Amendeor never writes the text it reads.** It reads `manuscript/` (or an input file) and writes its own copy.
>
> **3. Amendeor is standalone.** A Codicora workspace is one supported input, not a requirement. It depends on documented formats, never on another tool's code.

In one line: **Amendeor improves the words, not the story.**

---

## 2. Place in Codicora

| Tool | Does | Owns |
|---|---|---|
| Chartularius | story bible | `canon/` |
| Fabellatrix | writes and substantively revises | `manuscript/` |
| Collationator | manuscript vs canon | `findings/collationator/` |
| Esgardeor | literary review | `findings/esgardeor/` |
| **Amendeor** | **copy editing, proofreading** | **`edited/`**, `.codicora/amendeor/` |
| Trucheman | translation | `localization/` |

```text
Chartularius ─ canon/exports/ ─▶ Fabellatrix ─▶ manuscript/ ─┬─▶ Collationator ─┐
                                      ▲                      └─▶ Esgardeor ─────┤
                                      └──────── substantive revision ◀──────────┘
                                                             │
                                             (story is done) ▼
                                                         Amendeor
                                                             │ proposals → accept
                                                             ▼
                                                          edited/
                                                        ┌────┴────┐
                                                        ▼         ▼
                                                   Trucheman   Publisher
```

Amendeor runs after the story has stabilized. Downstream tools read `edited/` when it exists and `manuscript/` otherwise.

Routing by responsibility, not by invocation — no tool calls another:

```text
Fabellatrix changes WHAT is written.
Amendeor improves HOW it is written.
Trucheman changes the LANGUAGE it is written in.
```

`"He slowly began to slowly walk toward the door."` → Amendeor: `"He walked toward the door."`
`"He forgives his father though nothing establishes why."` → not Amendeor's (§14).

---

## 3. Goals — v0.1

1. Read a Codicora workspace (`WORKSPACE.md`, `MANUSCRIPT.md`) and standalone `.md`/`.txt`.
2. Deterministic proofreading that is useful with no API key.
3. Conservative model-assisted copy editing with a semantic guard.
4. Structured, stable, stale-aware edit proposals.
5. Explicit acceptance, and a rebuildable edited copy.
6. English and Russian from day one — the two languages of the books this ecosystem actually runs on (`books/jekyll-and-hyde`, `books/seymsk`).
7. Caching, resume, and a usage/cost/latency ledger.
8. Measured quality: a mutation-based evaluation, including semantic traps, before generative edits are called trustworthy.

## 4. Non-goals

Writing, generating, inserting or rewriting scenes; plot, character, structure, chronology or canon repair; literary, theological or canon review; translation; publishing and layout typography; AI-authorship detection or detector evasion; writing into `manuscript/`.

---

## 5. Input

```bash
amendeor <command> <workspace | file | directory>
```

**Codicora workspace.** Resolves folders through `codicora.yaml` (never by convention alone) and reads `manuscript/` per `MANUSCRIPT.md`: chapter order and language from `manuscript.yaml`, scenes from `<!-- scene: <id> -->` markers, reader errors and warnings exactly as `MANUSCRIPT.md` §5 defines them. It does not read the writer's summaries or state (`MANUSCRIPT.md` §6). Optionally reads `findings/` (§13).

**Standalone text.** A `.md`/`.txt` file is one chapter; a directory is chapters in name order. Scene markers are honoured if present; otherwise each file is one implicit scene `s0`. Language comes from `--lang` or the config; there is no guessing that silently falls back to English.

Unsupported in v0.1: DOCX, EPUB (the author exports Markdown).

---

## 6. Output and ownership

```text
edited/                      owner: Amendeor — format: MANUSCRIPT.md, unchanged
  manuscript.yaml            same schema_version, language, slugs and order as the source
  chapters/<slug>.md         same scene markers, edited text
  accepted.jsonl             the accepted proposals this copy was built from (self-contained)

.codicora/amendeor/          tool-private state (the convention Collationator and Esgardeor already use)
  latest.json                { "run_id": "…" }
  runs/<run_id>/
    run.json                 run manifest, shaped like codicora.run/0.1
    proposals.jsonl
    rejected.jsonl           guard rejections, with reasons
    report.md
  cache/
  lock
```

Standalone input writes the same two trees under `--out <dir>` (default `<input>.amendeor/`).

Rules:

- **`edited/` = source + accepted proposals.** It is a derived artifact, rebuilt by `amendeor build`, and never edited by hand: a hand edit is a second source of truth. Text changes go into the source (through its owner) or into a proposal.
- **Same format as `manuscript/`.** Any reader of `manuscript/` reads `edited/` with a different path and no new code.
- **Why not write into `manuscript/`:** ownership (`WORKSPACE.md` rule 1), and also mechanics — Fabellatrix treats `manuscript/` as an export of its own store and rewrites every chapter that differs from it after each change (`Fabellatrix/server/manuscript.js`), so edits placed there would be silently lost.
- `edited/` is pinned in `WORKSPACE.md` v0.4 (layout row, `edited.path` manifest key, ownership row, readers prefer it for the finished text).

---

## 7. Edit proposal — `amendeor.proposal/0.1`

Internal schema, designed so it can later be promoted to a `codicora.*` contract (§21). Hashing and normalization reuse `FINDINGS.md` §3 verbatim — `canonicalJson`, `normalizeText`, `normalizeQuote`, SHA-256 rendered as `sha256:<hex>` — so there is one definition of "the same text" in the ecosystem.

```json
{
  "schema": "amendeor.proposal/0.1",
  "id": "amendeor:5b0e1f7a93c24d6e",
  "fingerprint": {
    "primary": { "category": "redundancy", "chapter": "ch-4f2e9b1c", "scene": "0d3a4e7b-9a5c-4e7b-9a5c-1f2e3d4c5b6a", "key": "sha256:…target…" },
    "evidence": "sha256:…replacement…"
  },
  "run_id": "2026-09-24T10-00-00Z-a91f",
  "tool": { "name": "amendeor", "version": "0.1.0" },
  "location": {
    "chapter": "ch-4f2e9b1c",
    "scene": "0d3a4e7b-9a5c-4e7b-9a5c-1f2e3d4c5b6a",
    "content_hash": "sha256:…scene at review time…"
  },
  "target": {
    "text": "He slowly began to slowly walk toward the door.",
    "hash": "sha256:…normalizeQuote(text)…",
    "before": "…up to 60 chars preceding…",
    "after": "…up to 60 chars following…",
    "occurrence": 0
  },
  "replacement": "He walked toward the door.",
  "category": "redundancy",
  "impact": "prose",
  "source": "model",
  "confidence": 0.9,
  "reason": "Removes the doubled adverb and the empty 'began to' without changing the action.",
  "source_findings": ["esgardeor:0d722fe8f9182703"],
  "verification": { "passes": 3, "agreed": 3, "semantic_risk": "none", "voice": "ok" }
}
```

- **Identity** = `{category, chapter, scene, key}` with `key` = hash of the normalized target. Edits elsewhere in the scene do not change it; a different replacement for the same target changes `fingerprint.evidence`, not `id` (same logic as a finding's `updated` state).
- **Locating the target:** exact normalized match inside the scene. One match → it. Several → disambiguate by `before`/`after`, then `occurrence`. None → `stale`.
- **Stale** is decided by the target and its context, not by the whole-scene hash: an unrelated edit elsewhere in the scene must not invalidate every proposal in it. `content_hash` records what was read.
- **A proposal is never replacement text for more than one paragraph.** A model reply that rewrites more is discarded, not truncated.
- `source`: `rule:<rule-id>` or `model`.

### Categories

```text
spelling  grammar  punctuation  typography  capitalization
word-choice  clarity  sentence-structure  redundancy  repetition
dialogue-mechanics  terminology  consistency  prose-pattern
```

No category may represent substantive writing (`plot-*`, `scene-rewrite`, `new-content` do not exist).

### Impact

| impact | meaning | acceptance |
|---|---|---|
| `mechanical` | no intended semantic change (typo, doubled word, whitespace, deterministic punctuation) | may be auto-accepted by config |
| `prose` | wording changes, same information, action and implication | explicit acceptance |
| `semantic-risk` | the guard could not confirm meaning is preserved | never produced as a proposal; goes to `rejected.jsonl` |

---

## 8. Acceptance and the edited copy

```text
source (read-only) + accepted.jsonl ──amendeor build──▶ edited/
```

- `amendeor accept <target> <id…>` or `--impact mechanical` appends to `edited/accepted.jsonl` and rebuilds. Each line carries the full proposal (target, context, replacement), so `build` needs nothing from `.codicora/` — the cache can be deleted and `edited/` still rebuilds.
- `amendeor reject <target> <id…>` records a rejection in `.codicora/amendeor/rejected-by-author.jsonl` so the same proposal is not offered again while its target is unchanged. Losing that file only means proposals are offered again.
- Build applies accepted edits per scene in document order. Two accepted edits whose targets overlap → the later one is a **conflict**, reported, not applied.
- The first `build` of a chapter with no accepted edits copies it verbatim, so `edited/` is always complete.

### Returning to the story after copy editing

The author may go back to Fabellatrix after Amendeor has run. This is a main scenario, not an edge case. On the next `build` or run:

| accepted proposal | result |
|---|---|
| target + context still found | re-applied automatically |
| target found, context changed | re-applied, reported as `moved` |
| target gone | `stale`, listed for review, not applied |

New and changed scenes are edited as usual; unchanged scenes come from cache (§16).

---

## 9. Pipeline

```text
ingest → validate → deterministic rules → candidates → model edit → semantic guard → voice guard → dedupe → proposals → report
```

No stage writes the source. `edited/` is written only by `accept`/`build`.

### 9.1 Deterministic rules (no key)

Duplicate words, doubled whitespace, malformed or unbalanced punctuation and quotes, configured quote style, spacing around dashes and ellipses, capitalization after sentence ends, Markdown artifacts, spelling-variant consistency (`colour`/`color`, `ё`/`е` when the book uses one), terminology consistency for names the book itself spells two ways.

Each rule: an id, a language scope, individually switchable, tested against a clean control text that it must not fire on (§18).

### 9.2 Model copy edit

Per scene, only on candidate regions: a rule hit, a metric hotspot (§10), a supplied finding (§13), or — in `copy`/`full` mode — the scene itself in windows. The model returns structured candidates:

```json
{ "edits": [ { "target": "…", "replacement": "…", "category": "redundancy", "reason": "…" } ] }
```

- `NO_CHANGE` (an empty `edits`) is a first-class answer, and the report counts it. Conservatism is the desired property.
- Every `target` must be found verbatim (normalized) in the scene; one that is not is discarded and counted.
- Invalid JSON → one retry with the parse error in the diagnosis, then discard. Model output never becomes text directly.

Context sent: the target window, surrounding paragraphs, editing constraints, relevant findings, and a short voice summary. Never the whole book to edit one sentence.

### 9.3 Semantic guard

Mandatory for every model proposal before it becomes a proposal. Two layers:

**Deterministic traps** — cheap, run first, reject on any hit:

- numbers, dates, times (`10:14` is one token — `LESSONS.md` §2 "Numbers are invisible");
- negation (`not`, `n't`, `never`, `no`; `не`, `ни`, `нет`, `без`) added or removed;
- proper nouns added, removed or changed — found by capitalization away from a sentence start, compared by shared stem so an inflected name (`управление`/`управления`) is not a change (`LESSONS.md` §2);
- modal/certainty words (`maybe`, `must`, `может`, `должно`) added or removed;
- quoted dialogue text changed beyond punctuation when the category is not `dialogue-mechanics`.

**Model verifier** — narrow question: *did this edit change information, action, implication, certainty, character state or meaning?* Rules:

- A different model family from the editor where configured.
- **One pass is an opinion** (`LESSONS.md` §3): `verify.passes` (default 3 for `prose`, 1 for `mechanical` that reached the model); a proposal survives only if all passes say "preserved". Doubt rejects — rejection is cheap because `NO_CHANGE` is always acceptable.
- Rejected edits go to `rejected.jsonl` with the trap or the verifier's reason.

Example: `She didn't recognize him.` → `She barely recognized him.` — negation trap fires; rejected without a model call.

### 9.4 Voice guard

An edit can be factually equivalent and still wrong. The guard rejects edits that normalize away what the author does on purpose:

- explicit `preserve` rules in config (fragments, dialect, informal dialogue);
- dialogue: `"Yeah. Ain't happening."` must not become `"No. That is not going to happen."` — v0.1 rule: grammar/word-choice edits inside quoted dialogue need `dialogue-mechanics` category or an explicit `normalize` rule;
- book-relative measures (§10): an edit that moves a sentence far from the book's own distribution of length, register or punctuation is rejected.

A fuller voice profile (per-character speech evidence) is v0.2.

---

## 10. Metrics and formulaic prose

Metrics say **where to look**, never what to do. `"actually" × 143` means inspect candidate regions, not delete it 143 times.

v0.1 metrics: n-gram repetition, word-frequency spikes, doubled phrases within a paragraph, dialogue-tag distribution, sentence-length distribution, scene-opening/ending repetition, "not X but Y", tricolons, rhetorical questions, filter verbs, adverbs, dash and semicolon density.

**Calibrate against the book, not against an absolute** (`LESSONS.md` §2). Every threshold is relative to the book's own baseline, with an absolute floor only as a secondary condition:

- a correctly punctuated Russian novel runs ~36 em dashes per 1000 words, because the dash is a copula and a speech marker — an English ceiling flags every scene;
- Russian has no adverb suffix; the metric does not exist there and is not reported;
- stopwords come from a language pack or are derived from the book (frequent and short), and a missing pack is **loud**, never a silently inert filter;
- a character's name is not a lexical tic (proper-noun detection as in §9.3).

Standalone use means Amendeor keeps its own metrics. In a workspace where Esgardeor findings exist, they are additional candidate sources (§13), not a replacement. Esgardeor's calibrations are the reference for Amendeor's; the code is not shared.

**Formulaic prose evidence.** `inspect` may name a narrow, language-specific stock phrase with its exact quote and scene address. It does not score the text as "AI-written" or infer authorship. Phrase matches are candidate locations, not edit instructions; quoted dialogue and marked intentional style are protected. The v0.2 pass combines these signals with book-relative repetition/rhythm metrics, asks for a minimal local edit or `NO_CHANGE`, and sends every proposed edit through the semantic and voice guards before the author can accept it. English and Russian patterns are curated separately; there is no universal banned-word list or fixed dash ceiling. The initial catalog and its positive/negative fixtures are documented in [prose-patterns.md](prose-patterns.md), adapted from [No AI Slop](https://github.com/petergyang/no-ai-slop).

---

## 11. Configuration

Following the existing Codicora convention (Esgardeor `CONFIG.md`, `LESSONS.md` §5):

Layers, highest first: CLI flags > environment `AMENDEOR_*` > workspace `<workspace>/amendeor.yaml` > user `~/.config/codicora/amendeor.yaml` (or `$AMENDEOR_CONFIG`) > defaults. `run.json.config` records the effective values.

**User level** — providers, keys, profiles, prices:

```yaml
providers:
  main:  { transport: anthropic, endpoint: https://api.anthropic.com, family: anthropic, api_key_env: ANTHROPIC_API_KEY,
           price: { input_per_m: 3, output_per_m: 15, currency: USD } }
  other: { transport: openai, endpoint: https://openrouter.ai/api/v1, family: openai, api_key_file: ~/.secrets/openrouter }
profiles:
  edit:   { provider: main,  model: <model-id>, temperature: 0.2 }
  verify: { provider: other, model: <model-id>, passes: 3 }
```

**Workspace level** — the book's editing constraints:

```yaml
language: ru                  # standalone input; a workspace takes it from manuscript.yaml
preserve: [sentence-fragments, dialect, informal-dialogue]
normalize: { spelling: british, quotes: «», yo: keep }
avoid: [redundant-emotional-explanation]
auto_accept: [mechanical]     # default: nothing
rules: { typography.ellipsis: off }
```

No model id is hard-coded. Keys live in the config file or a key file, never on the command line; placeholders like `<paste-key-here>` are refused (`LESSONS.md` §5).

---

## 12. Provider gateway

All model calls pass through one function. Required from the first commit, because each has already cost another Codicora tool a run (`LESSONS.md` §1):

- **Reasoning off unless asked for, per transport, by its own name** — `thinking: { type: "disabled" }` on Anthropic, `reasoning: { enabled: false }` on OpenRouter/OpenAI-compatible.
- **Output budget scaled by language** — derived from the material (characters per input token reported by the provider), not a default of 4 that silently means English.
- **Body read inside the same guard and timeout as the request**; every network failure converted to the one error type the retry loop knows.
- **Diagnosis in the error** — `finish_reason`/`stop_reason`, content block types, the budget hit — carried to where the decision is made.
- Structured-output validation, retry, timeout.
- Ledger per call: stage, provider, resolved model, input/output tokens, cost from configured price (never guessed from a model name), latency. Rolled up into `run.json.ledger` per stage (`edit`, `verify`), the same shape as Esgardeor's.

A `local` deterministic transport exists for tests and the no-key demo.

---

## 13. Findings as input (optional)

In a workspace, Amendeor may read `findings/*/latest.json` runs (`FINDINGS.md`, `codicora.finding/0.1`). A finding is **evidence of where to look, never an instruction**, and Amendeor behaves the same whichever tool emitted it — no `if tool == "esgardeor"`.

Routing uses the real fields, not an invented taxonomy:

- **`kind`**: `FINDINGS.md` allows auto-application only for `defect`. Amendeor never auto-accepts a proposal derived from a `concern` or `suggestion`; it may still propose.
- **`scope`**: only `scene` findings with a `quote` are candidates in v0.1.
- **`category`** — against the actual Esgardeor registry (`Esgardeor/docs/CATEGORIES.md`) and Collationator's:

| family | Amendeor |
|---|---|
| `repetition.ngram`, `repetition.tic`, `repetition.phrase`, `repetition.sentence-frame` | candidate |
| `prose.adverb-density`, `prose.filter-words`, `prose.em-dash-density`, `prose.tricolon`, `prose.rhetorical-qa`, `prose.cliche`, `slop.*` | candidate (metric-level: inspect quoted regions only) |
| `exposition.redundant`, `exposition.obvious`, `clarity.confusing` | candidate only if a sentence-level edit resolves it; otherwise not-applicable |
| `prose.sentence-monotony`, `prose.paragraph-uniformity`, `prose.rhythm`, `prose.generic`, `voice.*`, `dialogue.flat`, `dialogue.on-the-nose`, `exposition.dump` | not-applicable — resolving them is rewriting |
| `plot.*`, `character.*`, `emotion.*`, `pacing.*`, `scene.*`, `chapter.*`, `pov.*`, `summary.*`, `canon.*`, `continuity.*`, `source.*` | not-applicable |
| unknown category | not-applicable, counted in the report |

Classification per finding: `applicable`, `not-applicable`, `ambiguous`, `already-resolved` (its quote no longer found). The report lists them; nothing is written to `findings/`.

Amendeor does **not** write `findings/_status.jsonl` in v0.1: its edits live in `edited/`, while a finding describes `manuscript/`, which is unchanged. Whether "fixed in `edited/`" deserves a status is an ecosystem question (§21).

---

## 14. Hard stop

When an issue cannot be fixed without changing an event, character behaviour, motivation or knowledge, chronology, location, causality, a story fact, scene purpose, dialogue meaning, canon or structure, the answer is `NOT_APPLICABLE` — reported, never a clever rewrite.

---

## 15. CLI

```bash
amendeor inspect  <target>                   # structure, language, counts, metrics; no model
amendeor edit     <target> [--mode mechanical|copy|full]
amendeor accept   <target> <id…> | --impact mechanical
amendeor reject   <target> <id…>
amendeor build    <target>                   # rebuild edited/ from source + accepted.jsonl; no model
amendeor report   <target> [--run <id>]      # render a run; no model
amendeor diff     <target>                   # proposals vs previous run: new / unchanged / updated / stale / resolved
```

Options: `--findings <path>`, `--lang`, `--out`, `--resume <run-id>`, `--no-cache`, `--json`.

`--mode mechanical` is the final proofreading pass (rules plus model grammar/spelling only); there is no separate `proofread` command. `mechanical` with no key configured runs the rules alone — a supported mode, not a failure; the report says which parts ran.

---

## 16. Caching, resume, determinism

- The unit is the scene window. **The cache key is everything the unit reads** (`LESSONS.md` §1): normalized window text, context text, editing config, findings used, profile (provider, model, parameters), prompt version, rule-set version. Keying on identifiers instead of content is a known bug.
- Model answers are cached, not re-derived: `temperature: 0` does not make routed inference reproducible (`LESSONS.md` §4), and `diff` between runs is meaningful only because unchanged units return the same cached proposals.
- Failures are never cached. Resume = rerun; completed units come from cache.
- A degraded unit (fallback, truncated window, skipped verify) says so in `run.json.stages[].failures` and in the report; `ok` means ok (`LESSONS.md` §1, "A fallback nobody can see").
- One run at a time per target, guarded by `.codicora/amendeor/lock`; a stale lock is reported with how to remove it.

---

## 17. Report

```text
Amendeor — ch 12, 41 scenes, 26,418 words, ru
Rules            143 hits → 61 proposals (mechanical)
Model            81 windows · 42 NO_CHANGE · 39 candidates
Semantic guard   5 rejected (3 trap, 2 verifier) · Voice guard 3 rejected
Proposals        mechanical 61 · prose 31   (accepted 0, stale 0)
Findings         21 read · 8 applicable · 11 not-applicable · 2 ambiguous
Usage            edit 412k/38k tok · verify 96k/4k tok · $1.84 · 6m12s
Degraded         none
```

`--json` gives the same data.

---

## 18. Evaluation

Generative edits are not trusted until measured. Fixtures: public-domain prose (Jekyll and Hyde, English) and a Russian text, each with a **clean control** section that must produce no proposals — a check that fires on the control is miscalibrated, not vindicated (`LESSONS.md` §4).

```text
eval/fixtures/<work>/
  original/          clean text
  mutations.json     injected defects: typo, doubled word, punctuation, agreement, redundancy,
                     unnecessary qualifier, dialogue format, terminology variant, repeated frame
  traps.json         edits a model might make that change meaning: negation, number, name,
                     location, certainty, ownership, intention, chronology
  preserve.json      intentional style that must survive (fragments, dialect, dialogue register)
```

Test properties, not exact strings — several replacements can be right.

| metric | definition | v0.1 gate |
|---|---|---|
| mutation recall | injected defects with a correct proposal | reported per category |
| proposal precision | useful proposals / all proposals (human-labelled sample) | reported |
| unnecessary-edit rate | proposals on the control and on `preserve` spans | ≤ 2% |
| guard recall | injected traps rejected | ≥ 95% |
| semantic regression | meaning-changing proposals that pass the guards | 0 on the fixture |

Run-to-run variance is large (`LESSONS.md` §4): report the spread over ≥ 3 runs; only order-of-magnitude differences rank prompt variants. Freeze a baseline before changing a prompt.

---

## 19. Technology

Node ≥ 23.6, ESM, TypeScript run by Node's native type stripping (erasable syntax only, `tsc --noEmit` for checking), `node:test`. **No build step**: what runs is what was edited — Esgardeor lost three runs to a CLI loading a stale `dist/` (`LESSONS.md` §5). Dependencies: `yaml`, `zod`. **One package** in v0.1 (`src/` + `test/` + `eval/`); split into packages when a second consumer of the core exists (MCP in v0.2). Collationator shows the single-package shape is enough.

Language-specific rules live in `src/lang/<bcp47>/` (rules, stopwords, negation and modal words). Only languages covered by the evaluation are advertised: `en`, `ru`.

Local-first: no telemetry; the only text that leaves the machine is what is sent to a configured provider.

---

## 20. Milestones

**M1 — Contracts and the edited copy (no model).** Workspace and standalone readers with `MANUSCRIPT.md` errors; proposal schema and JSON Schema; hashing per `FINDINGS.md` §3; target location, stale, conflict; `accept`/`reject`/`build`; `edited/` pinned in `WORKSPACE.md`. *Answers: can Amendeor describe and apply a change safely to its own copy?*

**M2 — Deterministic proofreading.** `inspect`, config, rule framework, `en` + `ru` rules, book-relative metrics, `edit --mode mechanical` with no key, report, `diff`, cache, lock. *Useful with no API key.*

**M3 — Evaluation harness.** Fixtures, mutation generator, traps, control, metrics of §18 over the rules alone. Built before the model pass so M4 is measured from its first run.

**M4 — Model copy edit.** Gateway (§12), structured output, candidate windows, `NO_CHANGE`, ledger, resume. Until M5, model proposals are marked `unverified` and `accept` refuses them without `--unverified`.

**M5 — Guards.** Deterministic traps, N-pass verifier, voice guard v0.1, rejection reporting. Gate: §18 targets met on both languages.

**v0.1 release = M1–M5.**

**v0.2:** findings input (§13); fuller voice profile with per-character dialogue evidence; [formulaic-prose pass](../specs/006-formulaic-prose/spec.md) driven by quoted pattern evidence and book-relative metrics; MCP (stdio: `status`, `inspect`, `edit`, `report`, `diff`, `list_proposals`, `get_proposal`, `accept`) as a thin layer over the same core; container image (non-root, no ports); DOCX input.

**M-eco (whenever it is useful):** downstream readers (Trucheman, publisher) prefer `edited/`; decide on promoting the proposal schema.

---

## 21. Open questions

1. ~~Folder name~~ — `edited/`, pinned in `WORKSPACE.md` v0.4.
2. **Promoting the proposal schema** to `codicora.proposal/0.1`. Wait until a second producer or consumer exists (a review UI, another editor).
3. **Finding status for edits in `edited/`.** A finding is about `manuscript/`; Amendeor's fix does not change it. Options: a new status value, a note on `fixed`, or Esgardeor reviewing `edited/` instead. Not blocking.
4. **Typography boundary.** Linguistic typography (quotes, dashes, spacing that the language requires) → Amendeor; layout typography (hyphenation, widows, ligatures) → publisher.
5. **Fabellatrix round-trip.** If an author wants copy edits back in Fabellatrix's store (to keep writing on the edited text), Fabellatrix would import `edited/` — its decision, through its own feature. Amendeor needs nothing for it.

---

## 22. The ecosystem in six sentences

```text
Chartularius records what is true.
Fabellatrix writes and revises what happens.
Collationator checks whether it matches the canon.
Esgardeor checks whether the manuscript works.
Amendeor produces the edited copy: the same story, better words.
Trucheman creates another-language edition.
```

No application needs another application's source code.
