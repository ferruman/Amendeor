# Changelog

## Unreleased

- `check --guide habits`: book-pass habits → every use collected → one keep/replace request → `style.book.thin` findings that keep the book run's findings; deterministic checks against new habits, reused wording, wrong language and over-thinning (≤ ⅔); `edit` verifies meaning and offers them as author-only proposals. Book-pass habits now carry `patterns`.
- `check --guide book`: a whole-book pass for slips that need the passage's sense and for book-wide verbal habits; quoted marks only, slips carry a `suggestion`, passes are unioned (`--passes`, default 2), `profiles.book`. Evaluation in `eval/book-pass/`. A slip whose fix stays inside the quoted sentence carries `metadata.replacement`; `edit` reads Amendeor's own `style.book.slip` findings and makes each an author-only proposal (`unverified`, `review.evidence`), suppressed by a closing status.
- Guard recovery (audit 2026-10-11 F2/F3).
  - A typo-shaped model correction that would otherwise be dropped becomes a **review-only** proposal (`unverified`, impact `prose`, `review.evidence`). It is never bulk-, auto- or delegation-accepted. The rejections that qualify:
    - by `dialogue-content-change`, `negation-change` or `proper-name-change`;
    - by the necessity verifier, unless the verifier answered `necessary: false, preserved: false`;
    - left unchecked by a verifier failure.
  - Recovery is narrow:
    - a negation may only be fused or split;
    - a "name" may differ only in letter case;
    - all other traps and the non-dialogue voice checks still apply.
  - A malformed verifier answer is retried once. A second one is a `verifier` failure, not a rejection; unreachable calls are `provider` failures.
  - The guard stage is `partial` only on failures.
  - `edit` prints and returns the counts: offered, review-only, rejected, unchecked.
- Fail fast on refused spend (audit F5).
  - The budget is reserved before the OpenRouter pacing wait.
  - The first `SpendRefused` stops the edit and check window loops. The run records the rules output and a `refused` model stage, exits 2 and releases the lock.
  - A 9-window refused run went from 28 s to 0.3 s.
- Added English editorial guides `en-fiction-editing`, `en-clarity` and `en-prose-style`: principle catalogs in our own words (64 principles with keep-when exceptions and severity); eight narrow narration signals; English scan and verify prompts with the preservation rules; findings carry the principle's severity. Guides now declare their language and refuse a book in another one (the Russian guides used to return nothing on an English book). Overlapping findings for the same principle are deduplicated. Evaluation fixture and runner in `eval/en-guides.ts`.
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
