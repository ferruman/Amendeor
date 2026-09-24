# Feature Specification: v0.2 — Formulaic prose edits

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §10 and [pattern catalog](../../docs/prose-patterns.md) · **Depends on**: M2 metrics, M3 evaluation, M4 model pass, M5 guards

## User stories

1. An author inspects a named pattern with an exact quote, scene address and reason, without an AI-authorship claim.
2. In `copy` or `full` mode, an author receives a small optional edit for a formulaic passage, or `NO_CHANGE` when the phrase fits the book's voice.
3. An author accepts a verified prose proposal explicitly; the edited copy is rebuilt through the existing M1 path.

## Requirements

- **FR-001**: Candidate windows use M2's quoted pattern hits and book-relative repetition/rhythm hotspots. A metric alone never dictates a replacement.
- **FR-002**: English and Russian patterns are reviewed independently. Dialogue and configured preserve spans are excluded from phrase-only targeting.
- **FR-003**: The model proposes one local replacement or `NO_CHANGE`. It must preserve specific facts, uncertainty, character voice, plot, chronology and meaning; it must not invent a more vivid detail.
- **FR-004**: Every candidate follows M4 structured output and M5 semantic/voice guards. Survivors are `impact: prose`, require explicit acceptance, and carry evidence of the triggering signal.
- **FR-005**: The report separates detected passages, `NO_CHANGE`, discarded candidates, guard rejections and offered proposals. It does not call the text "AI-written".
- **FR-006**: Evaluation covers both languages with positive and intentional-style negative examples, clean controls, human-labelled precision, and at least three model runs. No fixed banned-word list or dash threshold is used.

## Acceptance

- Both clean controls and protected dialogue receive zero offered proposals from this pass.
- A quoted fixture with an actual formulaic frame can produce a verified, minimal proposal; a stylistically intentional fixture yields `NO_CHANGE` or a guard rejection.
- The worst of three runs per language meets the M5 unnecessary-edit and semantic-regression gates. Real-book proposals are reviewed by a human before release.
