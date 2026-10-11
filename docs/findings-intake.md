# Phase 2 findings intake

`edit --mode copy` reads existing Codicora `findings/*/latest.json` runs and `findings/_status.jsonl`. No new command, application, or orchestrator is introduced. Intake never writes to findings, status overlays, manuscript, or authority. Proposals and run reports use the existing Amendeor storage; acceptance/build continue to target `edited/` and obey content locks.

Only `repetition.ngram` is actionable in Phase 2. Any scope is supported. Each validated quote becomes a `FormulaicHit` with the finding ID, then enters `EditWindow.signals`. A model proposal must overlap a trigger and stay in one paragraph. Style edits overlapping external evidence retain `source_findings`, become `prose-pattern` with `impact: prose`, and pass the existing semantic, voice, name, and protected-text guards.

The existing meaning-preservation verifier requires at least three unanimous passes for these proposals, even if the configured necessity verifier uses one pass. Necessity remains unchanged for proposals without external finding evidence, including the local formulaic catalogue. Repetition count does not prove editorial necessity. External-signal prompts explicitly preserve intended motifs and require a clear literary gain or NO_CHANGE.

Meaning-preserved repetition proposals retain `unverified: true` and `review.evidence` as the existing consent flag: verification records are successful, but editorial benefit awaits the author's decision. Accept each proposal by its ID through the existing author consent path (`accept <workspace> <id> --unverified`, or the UI's explicit consent). Mechanical bulk acceptance and auto-accept cannot select these prose proposals. `--delegation --unverified` remains forbidden. Nothing is accepted during analysis or proposal generation.

The last status record wins. `wontfix`, `false-positive`, and `fixed` create zero signals and protect their live quote spans from overlapping model edits. An evidence-bound decision is ignored when its evidence fingerprint differs. This is an editorial reader, not a release gate: delegated status authority is not certified here. Publication gates remain responsible for those checks under FINDINGS.md §6.

A missing quote or scene is reported as `already-resolved` per evidence record, including partially stale findings. Duplicate scene IDs are `ambiguous`. Quote lookup is deliberately verbatim: whitespace, case, or punctuation changes can count as stale. Finding IDs, run IDs, quote hashes, and evidence fingerprints are verified; duplicate IDs or malformed tool runs create no signals from that tool. An unreadable status overlay disables intake and produces a warning rather than pretending that all findings are open. Other categories are reported as not-applicable.

## Offline evaluation

`node eval/phase2-offline.ts --out eval/results/phase2-offline.json` compares pinned pre-Phase-2 Esgardeor with the current code on Book 2 and Book 1, checks recall above the floor, stable IDs, motif suppression, correct window routing, and manuscript/edited/manifest hashes. The script requires the sibling Esgardeor and suite books. Network calls are forbidden.

`node eval/phase2-replay.ts --out eval/results/phase2-replay.json` replays the frozen rule-safety recordings against Phase 1 and current Amendeor. It skips only offline pacing, preserves HTTP bodies, and supplies 503 for an unrecorded request. Proposal byte comparison normalizes only the new run ID. `eval/replay-book2-guard.ts` separately replays all 16 audit corrections.

Current offline results: Book 2 493 → 77 clusters, 364 potential targets in 101 windows; Book 1 437 → 85 clusters, 392 targets in 108 windows. The audit's historical Book 2 run had 492 n-grams; the current source has one additional pre-change finding. No clusters above the three-occurrence floor were lost. These targets are locations to review, not generated prose proposals or proven improvements. Paid evaluation has not run.
