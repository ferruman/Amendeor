# Implementation Plan: M5 — Semantic and voice guards

**Date**: 2026-09-24 · **Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

## Approach

Run cheap deterministic traps before spending verifier calls. Normalize and compare protected tokens with the M2 tokenizer and language packs. Each surviving model proposal receives a narrow verifier question for the configured number of passes; any doubt rejects. Run voice checks last, using explicit preserve rules, dialogue spans, and book-relative measures. Record the first rejection reason and all call usage in the run.

Only fully guarded candidates become ordinary proposals. Keep rejected candidates in `rejected.jsonl` for audit, without offering them for acceptance. Feed the M3 trap suite through the same guard path and score the worst of three runs per language. Any real-book meaning failure becomes a new trap case, followed by a fix and repeat gate.

## Sequence and gates

| Gate | Tasks | Evidence |
|---|---|---|
| Traps | T001–T002 | Trap fixture recall, clean mechanical baseline |
| Verifier | T003–T005 | All-pass semantics, rejection reasons, priced calls |
| Voice | T006–T008 | Dialogue and style preservation fixtures |
| Release | T009–T012 | Per-language quality gate, real-book review, docs and tag |

The acceptance threshold is a measured release gate, not a claim that no unseen semantic error is possible. The run results and reviewed samples are the evidence for v0.1.
