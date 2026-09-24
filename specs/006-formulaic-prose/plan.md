# Implementation Plan: v0.2 — Formulaic prose edits

**Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md) · **Depends on**: M2–M5

The implemented `inspect` scanner supplies exact, read-only phrase evidence. After M5, combine those hits with M2 book-relative metrics to select bounded windows for the M4 model pass. Ask for the smallest edit or `NO_CHANGE`; reject any answer outside the target window or one paragraph. Pass every candidate through the M5 semantic and voice guards and publish only verified prose proposals for explicit author acceptance.

Extend M3 fixtures with positive formulaic insertions and negative style cases. Measure both recall and unnecessary edits; inspect every offered proposal in a sample from the English and Russian books. Treat the scanner's current zero-hit result on both books as a conservative smoke result, not a quality score.

| Gate | Tasks | Evidence |
|---|---|---|
| Candidate routing | T001–T002 | Exact quote and book-relative hotspot reach the right window |
| Guarded edit | T003–T005 | `NO_CHANGE`, minimal verified prose proposal, no automatic acceptance |
| Evaluation | T006–T008 | Per-language controls, three-run spread, human review |
