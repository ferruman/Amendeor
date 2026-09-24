# Implementation Plan: M4 — Model copy edit

**Date**: 2026-09-24 · **Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

## Approach

Make the gateway the sole model-call path. Transports adapt response shapes into one result and one error type; the gateway owns retry, timeout policy, budget estimation, and ledger. Windows carry editable text plus read-only neighbouring context. The prompt requests `{ edits: [] }` for ordinary no-change windows. Validate responses, locate every target, and discard invalid candidates before proposal construction.

Cache completed windows and individual calls by complete inputs. `--resume` opens an existing run, skips completed units, and publishes the finished manifest and report atomically. Until M5, model proposals retain `unverified: true`; no guard result is implied. Model grammar/spelling in `mechanical` is enabled only when an edit profile exists.

## Sequence and gates

| Gate | Tasks | Evidence |
|---|---|---|
| Gateway | T001–T007 | Transport failures, budgets, and ledger tests |
| Editing pass | T008–T014 | Local transport CLI and resume tests |
| Measured run | T015–T016 | Three runs per language, cost and quality results |

Provider output shape, truncation, and non-reproducible responses are the main risks. Diagnostics, bounded windows, cache, and evaluation make these visible before M5.
