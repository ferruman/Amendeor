# Implementation Plan: M2 — Deterministic proofreading

**Date**: 2026-09-24 · **Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

## Approach

Load configuration and a language pack before text processing. Tokenize once per scene with raw offsets, keeping timestamps and decimals intact; derive paragraph, sentence, word, name, and dialogue views from that representation. Rules consume those views and return proposal drafts, then M1 assigns identities and deduplicates. The rule registry carries versions used by cache keys and reports.

Compute book-level baselines before flagging scene hotspots. Apply language-specific measures only where defined; use a visible fallback for missing stopword packs. Keep inspect read-only and keep edit's state publication atomic through M1. Report stage counts and cache status from the run manifest, not by re-running analysis.

## Sequence and gates

| Gate | Tasks | Evidence |
|---|---|---|
| Config and text model | T001–T009 | Layer tests; English/Russian tokenizer, names, dialogue fixtures |
| Rules | T010–T020 | Positive and clean-control cases for every rule |
| Metrics | T021–T022 | Book-relative tests, including Russian dash baseline |
| Commands and cache | T023–T030 | No-key CLI, deterministic repeat, cache hits, perf and real-book smoke |

The risk is false positives from language conventions. The clean controls and real-book review are release evidence, and each discovered false positive becomes a regression fixture.
