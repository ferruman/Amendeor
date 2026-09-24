# Tasks: v0.2 — Formulaic prose edits

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · [pattern catalog](../../docs/prose-patterns.md)
**Depends on**: M2–M5

- [X] T001 Extend `src/edit/windows.ts`: route M2 formulaic hits and book-relative metric hotspots into bounded paragraph windows with the exact triggering quote and read-only context; skip marked dialogue and preserve spans.
- [X] T002 Version the pattern catalog and cache key; expose ids, language, quote, and provenance in the run report without an authorship score.
- [X] T003 Add a copy-edit prompt branch for formulaic prose: minimal local change or `NO_CHANGE`; forbid invented facts, erased uncertainty and generic voice normalization.
- [X] T004 Parse one-paragraph replacements through M4, classify them as `impact: prose`, then require all M5 guard passes before offering them. Never auto-accept this category.
- [X] T005 Test a real candidate, `NO_CHANGE`, hallucinated specificity, changed negation/certainty, dialogue and intentionally repeated phrase with the local transport and guard fixtures.
- [X] T006 Extend M3 mutations with formulaic insertions and keep examples for `en` and `ru`; score recall, unnecessary-edit rate and human-labelled proposal precision per pattern.
- [X] T007 Run at least three model evaluations per language; enforce M5's worst-run unnecessary-edit and semantic-regression gates, and record cost and latency.
- [X] T008 Review every offered proposal in one chapter of each real book; convert false positives into keep fixtures and retune or remove the responsible pattern. Both chapters have zero formulaic hits and therefore zero offered pattern proposals; see `eval/REAL_BOOK_REVIEW.md`.

**Checkpoint**: formulaic passages can yield guarded, reviewable proposals; clean controls and intentional style remain untouched.
