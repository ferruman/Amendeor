# Amendeor v0.1 implementation roadmap

**Status**: Planned · **Source of product requirements**: [PRD](prd.md)

Each milestone has a [specification](../specs/001-contracts-edited-copy/spec.md), an implementation plan, and numbered tasks in its own `specs/` directory. Task ids are local to a milestone: `M1/T001`, `M2/T001`, etc. The checkboxes are intentionally open until code and evidence exist.

| Order | Milestone | Deliverable | Exit evidence |
|---|---|---|---|
| 1 | [M1 — contracts and edited copy](../specs/001-contracts-edited-copy/plan.md) · [tasks](../specs/001-contracts-edited-copy/tasks.md) | Readers, proposal schema, accept/reject/build | Rebuild from source + accepted proposals, including stale/conflict cases; source hashes unchanged |
| 2 | [M2 — deterministic proofreading](../specs/002-deterministic-proofreading/plan.md) · [tasks](../specs/002-deterministic-proofreading/tasks.md) | English/Russian rules, metrics, inspect/edit/report/diff | No-key real-book runs, clean controls, cache and performance checks |
| 3 | [M3 — evaluation harness](../specs/003-eval-harness/plan.md) · [tasks](../specs/003-eval-harness/tasks.md) | Reproducible fixtures, mutations, traps, scorer | Frozen mechanical baseline before model work |
| 4 | [M4 — model copy edit](../specs/004-model-copy-edit/plan.md) · [tasks](../specs/004-model-copy-edit/tasks.md) | Gateway, bounded windows, resume, ledger | Three measured runs per language; proposals marked unverified |
| 5 | [M5 — guards](../specs/005-guards/plan.md) · [tasks](../specs/005-guards/tasks.md) | Semantic/voice checks and release gate | Worst-run thresholds in both languages, real-book review, v0.1 tag |
| 6 | [v0.2 — formulaic prose](../specs/006-formulaic-prose/plan.md) · [tasks](../specs/006-formulaic-prose/tasks.md) | Pattern and metric candidates → guarded local edits | Clean controls, human review, verified proposals only |

The critical path is **M1 → M2 → M3 → M4 → M5**. Within each milestone, `[P]` marks tasks that can be implemented independently after their shared prerequisite lands. `npm test` and `npm run typecheck` run at each checkpoint; M3 adds a reproducible evaluation command, and M5 adds the quality gate.

The read-only formulaic scanner is already in `inspect` as M2/T031. The v0.2 edit pass depends on M5's semantic and voice guards; phrase hits alone never produce accepted edits.

Start with **M1/T001–T004** (package and fixtures), then **M1/T005–T012** (source and hashing). The first useful vertical slice is **M1/T013–T025**: a fixture proposal accepted into a complete edited copy and rebuilt after the source changes.

## Scope decisions fixed for v0.1

- M2 `mechanical` is rules-only and works without a key. M4 adds optional model grammar/spelling in that mode when an edit profile exists.
- Reading `findings/` is deferred to v0.2, as in PRD §20. The v0.1 model windows use rules, metrics, and scene text.
- Proposal ids follow PRD §7 and identify category + chapter + scene + normalized target. At most one effective accepted replacement for that identity is active; conflicting acceptance records are an error.
