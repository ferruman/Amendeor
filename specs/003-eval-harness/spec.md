# Feature Specification: M3 — Evaluation harness

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §18 · **Depends on**: M2

## User stories

1. A maintainer runs a seeded mutation suite against English and Russian public-domain prose and sees which defect types the rules catch.
2. A maintainer checks clean controls and marked intentional style so tuning cannot be rewarded for unnecessary edits.
3. A later model or guard change is compared with a frozen, reproducible baseline, including run-to-run spread.

## Requirements

- **FR-001**: Store publishable English and Russian fixtures with source provenance, clean control chapters, and `preserve` spans.
- **FR-002**: Generate reproducible defects outside controls and preserve spans, with exact source addresses and a fixed seed.
- **FR-003**: Maintain semantic traps by type and language, with generated and hand-written examples; they are inputs for M5.
- **FR-004**: Score mutation recall by text effect and span, unnecessary-edit rate, optional human-labelled precision, guard recall, and semantic regression. Unavailable measures are `n/a`, not zero.
- **FR-005**: Record mode, versions, model ids, commands, mean and spread for repeated runs. Freeze the mechanical baseline before M4 work.

## Acceptance

- Regenerating mutations with the same seed is byte-identical; every recorded mutation locates and none lies in a protected span.
- Mechanical evaluation runs offline for both languages, reports per-type recall, and records zero proposals on clean controls after tuning.
- `eval/BASELINE.md` names exact reproduction commands and versions.
