# Feature Specification: M5 — Semantic and voice guards

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §§9.3–9.4, 18, 20 · **Depends on**: M4

## User stories

1. An author sees only model proposals that passed semantic traps, repeated verification, and voice checks; rejected edits remain auditable with reasons.
2. A maintainer runs semantic traps in English and Russian and sees recall by type and language, including the worst of repeated model runs.
3. A release is cut only after both languages meet the PRD quality gates and real-book review finds no unaddressed meaning change.

## Requirements

- **FR-001**: Reject model edits that alter numbers, dates, times, negation, names, certainty, or dialogue content under the defined trap rules.
- **FR-002**: Verify remaining proposals with configured passes; every pass must affirm preserved meaning. Report when editor and verifier use the same model family.
- **FR-003**: Enforce configured style preservation and dialogue restrictions, and compare sentence-level changes with book-relative voice measures.
- **FR-004**: Persist guard rejections with stage and reason; only survivors lose `unverified` and gain verification evidence.
- **FR-005**: Measure guard recall, unnecessary edits, and semantic regression on both language fixtures; gate on the PRD §18 thresholds.

## Acceptance

- Trap fixtures achieve ≥95% guard recall per language; unnecessary-edit rate is ≤2%; semantic regression on fixtures is zero in the worst of at least three runs.
- Every model proposal offered for ordinary acceptance contains successful verification data; rejected edits appear in `rejected.jsonl` and the report.
- Manual review of one chapter in each real book yields no unaddressed meaning-changing proposal.

## Boundary

The guards apply to model proposals. Deterministic mechanical proposals still use the rule contract and configured acceptance policy.
