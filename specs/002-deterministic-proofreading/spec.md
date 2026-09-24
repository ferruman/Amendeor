# Feature Specification: M2 — Deterministic proofreading

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §§9.1, 10–11, 15–17 · **Depends on**: M1

## User stories

1. An author with no API key runs `amendeor edit <target> --mode mechanical` and receives useful English or Russian proposals from deterministic rules.
2. An author inspects the book's structure and hotspots, reads a report, and compares two runs without modifying source text.
3. A repeat run over unchanged input reuses cache and yields the same proposal identities and replacements.

## Requirements

- **FR-001**: Merge configuration in the documented precedence order, report effective values, and refuse placeholder or invalid keys.
- **FR-002**: Provide explicit `en` and `ru` language packs, text segmentation, dialogue spans, and book-wide name detection; a missing pack is visible, never silently treated as English.
- **FR-003**: Each rule has a stable id/version and language scope. Every enabled rule must have a positive sample and a clean control sample; rules emit proposals through M1's contract.
- **FR-004**: Metrics select hotspots relative to the book's baseline, with language-specific features. Metrics never alter text or directly become edit proposals.
- **FR-005**: `inspect`, `edit --mode mechanical`, `report`, and `diff` work without a provider. Cache keys include every input a stage reads; failed units are not cached.
- **FR-006**: Optional automatic acceptance applies only to configured mechanical proposals through the normal accept/build path.
- **FR-007**: `inspect` reports exact, language-specific formulaic phrase evidence outside dialogue, without proposing edits or inferring AI authorship.

## Acceptance

- Both language control texts produce zero rule proposals; no-key runs on the two real books complete and their top proposals are reviewed.
- Two identical runs produce identical proposals, and the second is fully cached.
- A Russian dash-heavy scene is not a hotspot when typical for its book; missing language/pack is explicitly reported.
- A generated 120k-word book meets the cold and warm performance targets in `tasks.md`.
- Formulaic phrase examples flag their intended spans; dialogue and both clean controls have zero hits.

## Boundary

This milestone's mechanical mode runs rules only. M4 adds optional model grammar/spelling to the same mode when a profile is configured.
