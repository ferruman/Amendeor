# Implementation Plan: M3 — Evaluation harness

**Date**: 2026-09-24 · **Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

## Approach

Package two small public-domain workspaces as immutable originals with provenance. Generate mutated copies from a seed and record each changed span. Keep a separate control chapter and hand-marked style spans. The evaluator runs the real CLI, applies candidate edits in memory for scoring, and writes machine-readable results plus a human report. It scores whether a proposal fixes the mutation without changing text outside its span; multiple valid wordings can pass.

Freeze the first mechanical baseline before model development. Guard scores remain `n/a` until M5. Results carry fixture version, rule-set version, prompt version when present, model id, seed, and the command. Model runs repeat at least three times; the mechanical run is deterministic.

## Sequence and gates

| Gate | Tasks | Evidence |
|---|---|---|
| Fixtures | T001–T003 | Provenance, controls, protected spans |
| Mutations and traps | T004–T006 | Seed reproduction and address validation |
| Scorer | T007–T009 | Per-type results; `n/a` for unimplemented guard metrics |
| Baseline | T010–T011 | Committed baseline and clean controls |

The main risk is benchmark leakage or a false positive control. Mutations skip protected text, and the control remains unmutated and separately scored.
