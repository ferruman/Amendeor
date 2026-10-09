# English editorial guides

Three guides extend `amendeor check` to English literary fiction. They are built like the Russian guides ([Nora Gal](nora-gal-check.md), [Infostyle](infostyle-principles.md)): a principle catalog, a few narrow text signals, a contextual pass by the editor model, an independent verifier, exact-quote validation, and findings that are diagnostics only. The principles are written in our own words, with our own examples. Nothing here edits a manuscript.

| Guide | Focus | Catalog | Principles | Signals | Reads |
| --- | --- | --- | --- | --- | --- |
| `en-fiction-editing` | dialogue, attribution, exposition, point of view and distance, scene staging and logic, explanation, sentimentality | [catalog](en-fiction-editing-principles.md) | 30 | 4 | narration and dialogue |
| `en-clarity` | sentence clarity in the narrator's voice | [catalog](en-clarity-principles.md) | 16 | 3 | narration only |
| `en-prose-style` | diction, figures, sound, rhythm, register, immersion at the level of the sentence | [catalog](en-prose-style-principles.md) | 18 | 1 | narration only |

## Usage

```sh
node src/cli.ts check path/to/book --guide en-fiction-editing            # signals + contextual review
node src/cli.ts check path/to/book --guide en-clarity --json
node src/cli.ts check path/to/book --guide en-prose-style --rules-only   # signals only, no model, no key
node src/cli.ts check path/to/workspace --guide en-prose-style --findings   # also write findings/amendeor/
```

The book must be English (`--lang en`, or `language: en` in `manuscript.yaml`). A guide run on a manuscript in another language stops with `en-clarity checks en manuscripts; this book is ru` — and the Russian guides now do the same on an English book instead of silently returning nothing.

The contextual pass needs `profiles.edit` and `profiles.verify` with different models and their keys, exactly as for the Russian guides; with `profiles.verify.passes: 3` a finding needs two of three verifier passes. Successful windows are cached in `.codicora/amendeor/cache/` (`--no-cache` disables it); an agent run needs `--delegation` and spends against the shared budget like every other model call. A window that fails makes the run `contextual.status: partial` and exits with code 2.

Each finding carries the principle id, the exact quote with raw offsets, the reason, the catalog path and, for contextual findings, the verifier agreement and a severity from the catalog (`medium`, `low` or `info`). With `--findings` they become `codicora.finding/0.1` concerns in the category `style.<principle>` with that severity (signals are `low`). They never become proposals and never enter `accept`.

Run the guides one at a time, primary first: `en-fiction-editing`, then `en-clarity`, then `en-prose-style`. Each guide is one review of every window, so cost grows linearly with the number of guides.

## Why three guides

A fourth guide on narrative craft (immersion, psychic distance, sentimentality) was merged on 2026-10-09: in evaluation the models did not keep its principles apart from the others — most of its findings were real defects filed under other guides' principles — and the merge removes one pass of cost. Its scene-level principles moved to `en-fiction-editing`, its sentence-level ones to `en-prose-style`. Each remaining pass holds 16–30 related questions. Duplicates between the three are limited by ownership: every principle that could belong to two guides has **one owner** (table below), and the other guides' prompts tell the model not to report it.

## How a finding is made

1. **Applicability.** The guide's language must match the book's.
2. **Signals** (`D` rows). A narrow regular expression marks a phrase in the narration; text inside quotation marks is skipped. A signal is reported as a hint without model verification, so the lists are short and were checked against flag and keep examples (`test/fixtures/en-guide-signals.json`) and against the clean English control, where none fires.
3. **Contextual pass.** For each window of a scene the editor model receives the guide's questions with each principle's *keep when* cases, the window and the neighbouring paragraphs, and a standing instruction: a pattern is not a defect; never report by itself a fragment, intentional repetition, a long sentence, passive voice, unusual syntax, deliberate ambiguity, sparse or elaborate prose, dialect, colloquial dialogue, character vocabulary, an unreliable narrator, interior monologue, free indirect discourse, deliberate distance, a genre convention or a deliberate departure from standard usage; do not push toward generic polished prose; use a principle only when it names the actual problem; say nothing about authorship.
4. **Parsing.** The answer must match the schema; the principle must belong to this guide; the quote must occur exactly once in the window and not cross a paragraph; a hedged reason ("some readers", "slightly", "may seem", "arguably", ...) is discarded as speculation. Narration-only guides drop quotes inside dialogue before any verifier call.
5. **Verification.** A different model sees the window and each candidate with its principle's question and *keep when*, and accepts only findings the quote proves and the principle fits; it rejects taste, interpretation, length or unusualness alone, any *keep when* case, and anything that needs the whole book.
6. **Deduplication.** Within a run, a signal and a contextual finding for the same principle on overlapping text become one (the signal is kept). Different principles on the same words stay separate.

## Boundaries

| Concern | Owner | Why not here |
| --- | --- | --- |
| Plot, threads, setup and payoff, scene necessity, scene-ending monotony, pacing across chapters, character arcs | Esgardeor (literary review) | Needs the whole book; Amendeor's guides see one window and its neighbours. |
| Continuity of facts (names, times, places across chapters) | Collationator, Esgardeor | Same. |
| Spelling, grammar, agreement, punctuation, confused words | `amendeor edit --mode proofread` | Correctness, not craft; the guides must not re-flag it. |
| Model-writing tells (importance puffery, participle glosses, filler frames, pause beats, "the way a…" similes) | Amendeor formulaic catalog, [`PROSE-TELLS.md`](../../PROSE-TELLS.md) | Already detected; the guides do not repeat those phrases. |
| Proposing replacement text | `amendeor edit` (copy-edit with semantic and voice guards, explicit acceptance) | Guides are diagnostics. |

## Owners of shared principles

| Shared concern | Owner |
| --- | --- |
| Explaining what the scene already shows | `fiction.explained-emotion` (emotion and dialogue); `fiction.narrator-explains` (meaning, motive, moral); `prose.empty-adjective` (adjectives that announce the reader's reaction) |
| Point of view and distance | `fiction.pov-slip`, `fiction.viewpoint-diction`, `fiction.thought-mechanics` (whose head, whose words); `fiction.psychic-distance-jump` (how far) |
| *As* / *-ing* openers, false simultaneity | `fiction.subordinated-action` |
| Dangling and misplaced modifiers | `clarity.dangling-modifier`, `clarity.misplaced-modifier` |
| Passive voice | `clarity.agentless-passive` (only when the scene needs the doer) |
| Nominalizations and weak verb phrases | `clarity.hidden-action` |
| Clutter, inflated phrases, redundancy | `clarity.inflated-phrase`, `clarity.redundancy` |
| Hedges and intensifiers | `clarity.qualifier` |
| Jargon, officialese | `clarity.jargon` (narration); `prose.register-slip` (tone break) |
| Clichés and stock phrases | `prose.stock-diction`; clichéd gestures in `fiction.beat-overuse` |
| Adverbs | `fiction.ly-attribution` (on tags); `prose.weak-verb-adverb` (in narration); redundant adverbs in `clarity.redundancy` |
| Sentence variety and rhythm | `prose.monotonous-rhythm` |
| Diction shifts, register | `prose.register-slip` |
| Accidental rhyme, forced sound | `prose.forced-sound` |
| Elegant variation | `fiction.name-consistency` (characters); `prose.elegant-variation` (everything else) |
| Emphasis versus function, proportion | `fiction.proportion` |
| Long sprawling sentences, run-ons | `clarity.sprawl` |
| Mannered style | `prose.mannerism`; `prose.phoney-tone` for borrowed manners |

### Overlap with existing Amendeor functionality

- **Formulaic catalog** (`inspect`, `edit`): the guides contain no pattern that duplicates it. `fiction.beat-overuse` and `fiction.repeated-effect` cover the same ground as the book-level `formulaic.pause-beat` and `the-way-simile`, but per window and by judgment rather than by rate; on the fixture the formulaic catalog fired on none of the labeled defects.
- **Copy-edit** (`edit --mode copy|full`): proposes replacements for objective and prose problems with semantic and voice guards. The guides find problems it is not asked about (point of view, exposition, attribution, distance) and propose nothing.
- **Proofreading and metrics**: grammar, punctuation, repetition hotspots; the guides exclude correctness and treat repetition as a question of effect, not of count.
- **Russian guides**: unchanged in behaviour and prompts; their catalogs parse identically (tested). They share the runner, the cache layout and the findings writer.

## AI-generated prose

How the patterns of model-written prose map onto the principles. Nothing in the guides attributes text to a model; a pattern is reported only when it damages the passage.

| Pattern | Principles |
| --- | --- |
| Repetitive sentence structures | `prose.monotonous-rhythm` |
| Formulaic emotional descriptions | `fiction.explained-emotion`, `fiction.beat-overuse` (stock gestures), `prose.empty-adjective`, `fiction.sentimentality` |
| Redundant explanations of motivation | `fiction.narrator-explains`, `fiction.explained-emotion` |
| Repeated emotional beats | `fiction.repeated-effect`, `fiction.beat-overuse` |
| Overexplained subtext | `fiction.explained-emotion`, `fiction.narrator-explains` |
| Artificial dialogue | `fiction.stilted-dialogue`, `fiction.expository-dialogue`, `fiction.voice-sameness` |
| Generic metaphors | `prose.stock-diction`, `prose.tin-ear-figure` |
| Unnecessary abstract summaries | `fiction.narrator-explains`, `prose.abstract-for-concrete`, `fiction.repeated-effect` |
| Unmotivated shifts in narrative distance | `fiction.psychic-distance-jump` |
| Formulaic scene endings | **none here** — a final short line is often exactly right, and the pattern shows only across many scenes; Esgardeor's `scene.ending-monotony` and Fabellatrix's instruction cover closing aphorisms (PROSE-TELLS.md). |

**Experimental heuristics.** None were added. Candidates such as scene-ending codas, the "Y rather than X" construction, the rule of three, vague attribution and dash density are already recorded in the suite's [`PROSE-TELLS.md`](../../PROSE-TELLS.md) with their own provenance and are measured by Esgardeor and the formulaic catalog. If one is ever wanted here, it belongs in a separate `x.` catalog with its provenance and a clean-control evaluation.

## Diagnostics and edits

Guide checks report; they do not rewrite. A guide finding is never a proposal, never enters `accepted.jsonl` and is never auto-accepted. If a later version feeds guide findings to `edit` (as the formulaic signals already are), any replacement must go through the existing guards — semantic traps, repeated model verification, voice checks — and the author's explicit acceptance; and every proposed edit must neither flatten rhythm nor remove deliberate repetition.

## Evaluation

Method and numbers: [`eval/RESULTS.md`](../eval/RESULTS.md#english-editorial-guides--2026-10-09).

## Limitations and risks

- **Over-editing.** The largest risk. Several principles are advice with well-known exceptions (show versus tell, adverbs, passive, fragments, said). The catalogs carry the exceptions as *keep when*, both models see them, and principles close to taste are severity `info`; still, an author who acts on every finding will drift toward one house style. The findings are questions.
- **Uncertain principles.** `fiction.viewpoint-diction`, `fiction.voice-sameness`, `fiction.figure-at-turning-point`, `fiction.dialect-spelling`, `clarity.qualifier`, `clarity.logical-link`, `clarity.tense-shift`, `prose.static-verb`, `prose.monotonous-rhythm`, `prose.register-slip`, `prose.phoney-tone`, `prose.fragment-gimmick`, `prose.filtering`, `fiction.psychic-distance-jump`, `fiction.sentimentality`, `fiction.frigidity` and `prose.mannerism` are marked high false-positive risk: each depends on the book's established voice, which a window shows only partly.
- **Cross-filing.** Models often report a real defect under another guide's principle, so running all three guides on one book can duplicate findings.
- **Window scope.** A principle that needs the scene's opening (whose point of view this is, how staging was set) can be judged wrongly in a later window of a long scene. Book-level matters are out of scope by design.
- **Signals are unverified.** They are short lists; a signal can still fire in a deliberate voice (an officious narrator's *due to the fact that*). Their reason says so.
- **Dialogue detection** depends on paired quotation marks; single quotes used as apostrophes can mis-mark spans.
- **Model variance.** One pass is an opinion; the verifier's majority vote reduces it but does not remove it, and a cached window repeats its first answer.

## Recommendations

1. Read a real English manuscript with the guides and record, per principle, how many findings an editor would act on — as was done for the Russian guide (28 findings: 8 clear, 8 disputed, 12 better kept). Retire or narrow principles below one in three.
2. If cross-filing remains on real books, deduplicate by place across guides regardless of principle.
3. Add public-domain passages (for example from `pg43.txt`) as keep controls: real published prose should produce few findings.
4. Let the scene's opening paragraph travel with every window of that scene, so point-of-view and staging questions are judged from the start of the scene.
5. Only after (1): consider passing confirmed guide findings to `edit --mode copy` as signals, under the existing guards and explicit acceptance.
