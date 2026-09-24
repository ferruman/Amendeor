# Feature Specification: M1 — Contracts and edited copy

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §§5–8, 16, 19 · **Depends on**: none

## User stories

1. An author points Amendeor at a Codicora workspace or a standalone Markdown/text file and receives explicit reader errors for invalid input. A workspace follows `codicora.yaml` and `MANUSCRIPT.md`; standalone input requires a known language.
2. An author reviews a proposal tied to an exact scene and target, accepts or rejects it, and can rebuild `edited/` without the run cache or a model. The source text is never written.
3. After the source changes, an accepted edit that still locates is reapplied; a missing or ambiguous target is reported instead of guessed.

## Requirements

- **FR-001**: Read workspace and standalone inputs in stable chapter/scene order, preserving the source manifest and scene markers. Emit the reader errors and warnings defined by `MANUSCRIPT.md` §5.
- **FR-002**: Validate `amendeor.proposal/0.1`, generate its JSON Schema from the same type, and derive stable ids and hashes using `FINDINGS.md` §3 normalization.
- **FR-003**: Locate targets inside their scene with normalized text and raw offsets. Use context and occurrence to disambiguate; never apply an ambiguous or stale target.
- **FR-004**: Persist complete accepted proposals in `edited/accepted.jsonl`; author rejections live in tool state. `build` depends only on source and accepted proposals.
- **FR-005**: Build a complete edited manuscript, including unchanged chapters, without writing the input. Detect overlapping accepted edits and report conflicts.
- **FR-006**: Publish a run atomically and enforce one active run per target.

## Acceptance

- A fixture proposal can be accepted and rebuilt; the resulting `edited/` is readable by the same manuscript reader.
- Deleting `.codicora/amendeor/` does not change a rebuild's output.
- A source edit outside the target retains the accepted edit; removing the target marks it stale; overlapping accepted edits report a conflict.
- A hash of every source file is unchanged by `accept`, `reject`, and `build`.

## Boundaries

No model, proofreading rules, or findings input. `edited/` is a derived copy, not a new authoring surface.
