# Design System: Amendeor

Amendeor's main interface is the text an author reads: `amendeor report` (the run report), the one-line results of `edit`, `accept`, `reject`, `build`, `diff`, and the findings of `check`. There is also one local screen, `amendeor serve` (below). Machine-readable output (`--json`, `proposals.jsonl`, `run.json`, the `edited/` manifest) is a contract, not design.

**The report shape is the suite's** — canonical copy in [`../Esgardeor/DESIGN.md`](../Esgardeor/DESIGN.md): title, ` · ` summary line, severity vocabulary, finding blocks, terminal rules. This file records only what is Amendeor's own.

## Report

- Title `# Amendeor report — <run_id>`, then one line of book size: `N chapters · N scenes · N words · <language>`.
- Then one line per stage, `Label: facts · facts`: Rules, Model, the four guards (semantic, objective, punctuation, voice), Proposals (by impact, with accepted/stale), Findings read, Usage (tokens and cost, or `unpriced`), language Pack, Hotspots, Formulaic passages.
- Sections `## Formulaic evidence` and `## Degraded`, each a list or the word `none`. A formulaic hit shows `chapter/scene id [lang]`, the exact quote and its provenance — evidence, never a verdict on authorship.
- A guard rejection is listed with the proposal id, the guard and the reason: what was withheld is as visible as what was proposed.

## Terminal

- Results on stdout; warnings and errors on stderr as `amendeor: …` / `amendeor: warning: …`.
- Exit 2 when the command ran but left something for the author: stale or conflicting proposals on accept/build, a partial contextual check.
- Proposal ids and statuses are printed as `  <status> <id> — <detail>`, one per line, in the order they were decided.

## Language

Report chrome is English. Quotes and replacements are verbatim in the book's language; Russian-specific rule names (`nora-gal`, `infostyle`) stay as ids.

## Review screen

`amendeor serve` (`src/ui/`, no build step) follows the shared visual system of [`../Fabellatrix/DESIGN.md`](../Fabellatrix/DESIGN.md): both themes, *field* by default, tokens only. Rail with the texts (library under `~/Amendeor`, plus any workspace given on the command line); the text on paper with every proposal inline as a word-level diff (deleted spaces shown as `␣`); a side column with the current proposal (category, impact, reason, verifier verdict), Accept/Reject (`A`/`R`), Previous/Next (`K`/`J`), status filters and the guard-withheld list. Chrome is English, the book's words stay verbatim. The screen calls the same functions as the CLI — no decision exists only in the UI.
