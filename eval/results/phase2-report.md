# Phase 2 — Esgardeor repetition findings → Amendeor editorial proposals

2026-10-11. Implemented in the existing repositories. No new application or orchestrator. Paid calls: **0**; implementation, corpus measurements, and replays cost **$0**. Phase 3 and paid evaluation have not run.

Sources: [completed workflow audit](../../../codicora-docs/audits/2026-10-11-literary-editing/AUDIT.md), Amendeor Phase 1 `0e38c0d2b2004cd480f20d25930775c4a54ad67d`, and Esgardeor baseline `b9fdee20280d6c1fa6e214c153060dfe5e367730`. Both repositories were clean before implementation.

## Result and safety

Esgardeor clusters literally overlapping longer variants around a meaningful common core, preserving every token-verbatim evidence location. Default repetitions require three occurrences; duplicate complete paragraphs within one scene retain the two-occurrence exception. Stable keys retain stable IDs. Function-word overlap and transitive similarity do not join unrelated phrases. Findings remain concerns for analysis; their wording explicitly distinguishes motifs from unwanted habits.

Amendeor implements the narrow PRD §13 intake for `repetition.ngram` at any scope. It validates the Findings v0.1 contract and hashes, reads status overlays, and sends each live quote to the existing `FormulaicHit` → `EditWindow.signals` → trigger-overlap → `prose-pattern`/`source_findings` proposal path. Other families are not-applicable. Missing quotes are reported per occurrence as already-resolved; mixed stale/live findings retain their live targets.

`wontfix`, `false-positive`, and `fixed` findings generate no signals. Their quoted spans also block overlapping model changes, so a locally generated proposal cannot undo a motif decision. Overlay decisions bound to different evidence do not suppress a new occurrence. Nothing writes the source manuscript or a status overlay.

External-evidence prose proposals use at least three unanimous existing meaning-preservation checks, retain all semantic, voice, name, and protected-text guards, and remain review-only through the existing author-consent path. `impact: prose` prevents mechanical auto/bulk acceptance; the consent flag requires an explicit decision for each ID. Delegated unverified acceptance remains forbidden. No proposed change was accepted in either real book. The count is evidence to inspect, not proof of necessity or literary improvement.

## Corpus comparison

Measurements use **manuscript/** as the source. The audit's saved Book 2 run has 492 n-grams; the old detector recomputed on the current manuscript yields 493. This one-finding difference is reported separately rather than mixing historical and current input.

| Measure | Book 2, primary | Book 1, out of sample |
| --- | ---: | ---: |
| Before: old detector on current source | 493 | 437 |
| Before: findings with exactly two occurrences | 406 | 335 |
| After: coherent clusters | 77 | 85 |
| After: book-scope clusters | 68 | 80 |
| Mechanically actionable clusters | 77 | 85 |
| Potential editorial targets (live quotes) | 364 | 392 |
| Windows with findings evidence | 101 / 111 | 108 / 118 |
| Lost old clusters above the three-occurrence floor | 0 | 0 |
| Unchanged phrase IDs preserved | 70 | 82 |
| Stale quotes in regenerated findings | 0 | 0 |
| Paid-generated literary proposals | 0 | 0 |

“Actionable” means validated and locatable, **not** judged harmful to the prose. The target count is the number of potential local editorial targets; model-written proposals await an authorized paid experiment.

| Book 2 habit | Before: separate variants | After: one core / occurrences |
| --- | ---: | ---: |
| ладонь под повязкой | 9 | 1 / 25 |
| хрон в голове | 7 | 1 / 20 |
| всему своё время | 8 | 1 / 37 |
| как у человека, который | 1 | 1 / 9 |

The simile example already has a stable core in the current pre-change detector and retains it. The new detector aggregates the other three and exposes occurrences that greedy extension previously missed. The core key omits punctuation, while each quote preserves the manuscript's actual wording and punctuation.

Scratch-overlay motif trials: Book 2 «всему своё время» changes from **37 → 0** targets after `wontfix`; Book 1 «пять тысяч лет» changes from **49 → 0**. No author decision was written into the actual books. The offline evaluator hashes every file in both manuscript and edited folders and each workspace manifest before/after: all unchanged.

## Validation

- Esgardeor: all package tests pass, **329 passed / 1 existing skipped**; all TypeScript builds and schema regeneration pass. The planted control remains clean. Goldens deliberately change for aggregation, complete evidence, and the occurrence threshold. The 120k-word synthetic performance fixture retains its cold/warm budgets (about 2.7 s total in the isolated run).
- Amendeor: **203/203** deterministic tests pass; `tsc --noEmit` passes. New tests cover book and scene intake, multiple chapters, duplicate quote occurrences, latest/bound statuses, motifs, stale and partially stale evidence, malformed hashes/IDs/paths/overlays, minimum three meaning passes, trigger and paragraph boundaries, source evidence on real proposals, explicit consent, and zero automatic acceptance.
- Frozen no-findings replay: **60 jobs**, five corpus groups, **784 HTTP requests** per version. Phase 1 and Phase 2 produce byte-identical proposal files after normalizing only the new run ID, byte-identical rejected files, and identical HTTP bodies. Three unrecorded requests are one inherited verifier failure in both versions; all are answered locally with 503. No network fallback is available.
- Historical Book 2 replay: **all 16 audit errors remain review-only**, zero lost, zero acceptable without consent. Two recorded malformed-verifier cases remain failures; they do not become semantic rejections. The fail-fast refused-spend and guard-recovery tests still pass.
- Tests block external networking. Replay responses come from existing recordings or deterministic fixtures. Production models, provider pricing, verifier defaults, manuscript ownership, and `amendeor.yaml` are unchanged.

Raw artifacts: [corpus comparison](phase2-offline.json), [frozen replay parity](phase2-replay.json), [Book 2 guard recovery replay](phase2-book2-guard-replay.json). Reproduction scripts: `Amendeor/eval/phase2-offline.ts`, `Amendeor/eval/phase2-replay.ts`, and the existing `eval/replay-book2-guard.ts`. Details: [Amendeor intake](../../docs/findings-intake.md), [Esgardeor aggregation](../../../Esgardeor/docs/REPETITION-CLUSTERS.md).

## False-positive risks and limitations

Literal counts still include useful motifs, titles, names, ordinary clauses, and dialogue formulae. Examples needing author judgment include Book 2 «сто десять лет» (24), the title refrain (37), and Book 1 «пять тысяч лет» (49). No literary precision percentage is claimed: the top clusters have not been independently labelled tic/motif/noise. Scene function, rhythm, and subtle voice cannot be certified by a lower count or by a deterministic replay.

There is no lemmatizer or semantic phrase clustering. Inflections, near-paraphrases, and overlaps shorter than a meaningful literal core can remain separate. Short cores require repeated longer variants; isolated short three-word phrases are deliberately not a new detector family. A newly shortened key creates a new finding ID; old decisions on removed variant IDs require re-triage rather than silent inheritance. Complete evidence can enlarge reports in highly templated corpora.

Quote lookup is conservatively exact; whitespace or punctuation changes can be reported as stale. Ambiguous scene IDs never select another scene. Intake is an editorial reader, not a publication gate, and does not certify delegated status authority. An existing malformed Collationator run is warned about and omitted; valid Esgardeor repetitions remain readable. A malformed status overlay disables intake with a warning. Sentence frames, tics, ending detection, and other findings families remain outside Phase 2.

The replay gap affects one historical job equally in Phase 1/2. It supports parity of unchanged behavior, not a claim that every historical verifier request was successfully replayed. No model-quality result for the new evidence-backed literary proposals exists yet.

## Expected paid cost and next experiment

The completed audit budgets **≤ $0.35** for three Book 2 runs and **≤ $0.15** for one Book 1 run; allow **≤ $0.20** for new regression requests and **$0.30** for retries: **$1.00 maximum**. These are historical forecasts, not current provider quotes or spending authorization. Added evidence invalidates affected window caches, and the actual proposal/verification count is unknown.

Recommended next experiment: first label the top 30 Book 2 clusters as tic, motif, or noise with author spot-checking. Mark motifs `wontfix` in a scratch copy. If the set is useful, explicitly authorize a capped Book 2 copy-edit evaluation on three labelled habits, review every proposed change for literary gain and preservation, then repeat on Book 1. Stop on any harmful offered edit. Keep all real manuscripts locked and require per-change approval. Paid evaluation is **not authorized or run** by this implementation.

## Commits

Implementation and report hashes are listed in the delivery message. Phase 2 is complete; no later phase is implemented.
