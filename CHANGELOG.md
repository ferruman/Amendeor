# Changelog

## Unreleased

- Formulaic catalog 0.3.0 from the suite's `PROSE-TELLS.md`: participle glosses, copula dodges, narrow negative parallels, chat leaks, clustered model vocabulary, and book-level gestures (pause beats, “the way a…” similes) that fire only above a per-book rate. Signal reasons now reach the copy-edit prompt (1.6.0).
- Added Codicora workspace and standalone manuscript readers, proposal contracts, acceptance history, edited-copy builds, and CLI reports.
- Added English and Russian deterministic proofreading, book-relative metrics, language packs, configuration layers, cache, and rule-only editing.
- Added public-domain evaluation fixtures, seeded mutations, semantic traps, scorer, and a frozen mechanical baseline.
- Added Anthropic, OpenAI-compatible, and local model transports; bounded copy-edit windows, structured parsing, retries, resume, and a priced call ledger.
- Added deterministic semantic traps, repeated model verification, voice checks, and auditable guard rejections.
- Measured three real-provider copy-edit and formulaic runs per language, with deterministic guard replay records and worst-run release metrics in `eval/RESULTS.md`.
- Added project-specific OpenRouter editor and verifier profiles, request pacing, retry timing, and private `.env` setup.
- Fixed: `AMENDEOR_*` secrets no longer enter the recorded config; author rejections now hold for model proposals; `--resume` keeps its original baseline; repeated identical errors in one scene get distinct proposal ids (first-occurrence ids are unchanged); batch acceptance skips conflicting history with a warning; model case and punctuation edits are `prose`; duplicate standalone slugs and invalid `codicora.yaml` report clear errors.
- Added `check --guide infostyle`: a prose-safe selection of «Пиши, сокращай» principles with narrator-only signals and a contextual pass; guides now share one runner.
- The private `seymsk` model review and v0.1 tag remain pending.
