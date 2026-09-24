# Implementation Plan: M1 — Contracts and edited copy

**Date**: 2026-09-24 · **Spec**: [spec.md](spec.md) · **Tasks**: [tasks.md](tasks.md)

## Approach

Use one Node ESM/TypeScript package, native type stripping, `yaml`, `zod`, and `node:test`. Build the reader first, then the proposal contract and locator, then durable decisions and CLI. Source and edited manuscript share one reader. The source manifest is copied byte for byte and chapter markers are preserved. All paths are resolved from the workspace manifest; standalone output lives beneath `--out` or `<input>.amendeor/`.

An accepted decision stores the full proposal so `build` has no dependency on a run. Build resolves edits against the original scene, sorts by source offset, rejects overlapping spans, then applies nonconflicting replacements. It writes files atomically and reports `applied`, `moved`, `stale`, and `conflict`. A missing or ambiguous target is never replaced by position alone. Run publication uses a temporary directory and atomic rename; `latest.json` changes only after a complete run exists.

## Sequence and gates

| Gate | Tasks | Evidence |
|---|---|---|
| Source contract | T001–T012 | Fixture workspace and standalone inputs; documented reader errors |
| Proposal contract | T013–T016 | Schema freshness, golden hashes, stable identity, unambiguous location |
| Durable state | T017–T019 | Interrupted writes leave no published run; second run refused |
| Edited copy | T020–T025 | End-to-end accept/build/rebuild, duplicate identity, and source hash tests |

`npm test` and `npm run typecheck` are required at the checkpoint. No real book or API key is required. The primary risks are duplicate target text, normalized-to-raw offset mapping, and partial writes; the named tests exercise each.
