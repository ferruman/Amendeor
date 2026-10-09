# Real-provider evaluation — 2026-09-24

The editor was `openai/gpt-5.1` and the independent verifier was `anthropic/claude-sonnet-5`, both through the project-specific OpenRouter configuration. Each row is three uncached model runs on a seeded public-domain book fixture. Rates use the worst run; costs and model times are the observed per-run ranges.

| Work and mode | Mutation recall by run | Formulaic recall | Worst unnecessary edits / word | Control proposals | Deterministic trap recall | Trap regressions | Cost / run | Model time / run |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [Jekyll copy](results/2026-09-24-jekyll-en-copy.md) | 6/9, 5/9, 5/9 | — | 0.125% | 0 | 160/160 | 0 | $0.081–$0.110 | 103–146 s |
| [Kashtanka copy](results/2026-09-24-kashtanka-ru-copy.md) | 6/9, 6/9, 6/9 | — | 0.100% | 0 | 160/160 | 0 | $0.072–$0.098 | 89–124 s |
| [Jekyll formulaic](results/2026-09-24-jekyll-en-copy-formulaic.md) | 5/10, 5/10, 5/10 | 3/3 | 0.050% | 0 | 160/160 | 0 | $0.082–$0.125 | 106–167 s |
| [Kashtanka formulaic](results/2026-09-24-kashtanka-ru-copy-formulaic.md) | 7/10, 7/10, 6/10 | 3/3 | 0.067% | 0 | 160/160 | 0 | $0.051–$0.070 | 57–87 s |

The frozen [mechanical baseline](BASELINE.md) found 3/9 English and 4/9 Russian mutations. The copy pass improves recall while all measured worst-run unnecessary-edit rates stay below the 2% PRD gate. English copy and formulaic runs had no model-stage failures. Russian copy had one discarded no-op answer in each of two runs; Russian formulaic had one discarded answer in each of two runs. These are reported as partial model stages, not transport failures.

Standalone real-provider checks on the untouched public-domain control chapters returned raw `NO_CHANGE` for 1/2 English windows and 1/1 Russian window (2/3 combined). Both runs offered zero proposals after guards. The English raw model answers reached exactly half, rather than a strict majority, so the per-language `NO_CHANGE` checkpoint remains a measured limitation.

The trap metric tests the **deterministic first guard stage** on 160 prepared meaning changes per language. It does not measure the independent verifier's recall on untrapped meaning changes. Real-book human review is recorded separately. Human-labelled pattern precision remains `n/a`: the inserted formulaic examples demonstrate recall, but they are not an independent sample of naturally occurring proposals.

The canonical English and Russian copy results, and the English formulaic result, replay a monotone deterministic guard update on captured real-provider proposals. Their JSON files include `guard_recheck`, original run IDs, model versions, ledgers, and removed proposal IDs. The original raw runs (`*-control-fail.json`) remain alongside them. No model calls or charges were changed by the replay. The final Russian formulaic result ran the current guard directly.

The [real-book chapter review](REAL_BOOK_REVIEW.md) found zero offered proposals in the English chapter and zero formulaic hits in both books. The Russian `seymsk` chapter was scanned locally with zero rule or formulaic hits. External model review of that private chapter is pending explicit approval after automatic approval review rejected its upload to OpenRouter.

## Exploratory Russian proofreading pass — 2026-09-25

One uncached `proofread` run on the nine seeded Kashtanka mutations found the agreement, typo, and missing-comma examples (1/1 each). The clean control chapter received zero proposals. Two proposals outside the seeded errors remained, including a possible modernization of the historical form «румяны»; they still require author review. This is one run, not a repeatability or precision estimate. The [run record](results/2026-09-25-kashtanka-ru-proofread-first-pass.md) and [raw proposals and guard decisions](results/2026-09-25-kashtanka-ru-proofread-first-pass.json) preserve the result. The recorded cost was $0.0874.

## English editorial guides — 2026-10-09

Fixture: [`fixtures/en-guides`](fixtures/en-guides/) — 13 scenes with 26 labeled defects and 10 scenes of legitimate choices (fragments, dialect, free indirect discourse, passive for state, anaphora, omniscience, a periodic sentence, polysyndeton, an unreliable narrator, present tense), original text written for this purpose by the author of the catalogs. Runner: `node --env-file=.env eval/en-guides.ts [--model]`. A finding is **TP** when its principle matches the label and it overlaps the labeled fragment; **near** when it overlaps a labeled defect under another principle (usually another guide's); **unlabeled** when it lands elsewhere in a defect scene; anything in a keep scene is a false positive.

| Run | Guides | Findings | TP | Near | FP on keep scenes | Unlabeled | Recall | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Signals only](results/2026-10-09-en-guides-signals.md) | 3 | 10 | 10 | 0 | 0 | 0 | 38% | $0 |
| [Model](results/2026-10-09-en-guides-model.md) | 3 (after merge) | 41 | 17 | 19 | 0 | 5 | 65% | $0.60 |
| Model, before the merge | 4 | 52 | 19 | 23 | 1 | 9 | 73% | $0.70 |

Editor `openai/gpt-5.1`, verifier `anthropic/claude-sonnet-5` × 3 passes; about 300k tokens in per full pass of the three guides over 23 short scenes. The baseline without the new guides — the formulaic catalog — fired on none of the 26 defects and none of the keep scenes. Three earlier model runs with four guides gave 69–73% recall with 0–1 findings on keep scenes.

What the numbers say:

- **No findings on the ten keep scenes** after the merge. The one false positive of the last four-guide run (deliberate polysyndeton read as monotonous rhythm) did not recur; polysyndeton and anaphora are now named as intended effects in the rhythm rule.
- **The merge of the narrative-craft guide into `en-fiction-editing` and `en-prose-style`** cut findings by a fifth and cost by 15%, raised the lower bound of precision from 37% to 41%, and lost recall from 73% to 65%: the scene-level principles it brought (narrator explaining, unmotivated change, frigidity) were missed in this run.
- **Most non-TP findings are still real defects filed under another guide's principle** (a dangling modifier as a static verb, clutter as abstract wording). Precision against labels is 41–100% depending on how "near" and "unlabeled" are counted; running all three guides on one book can duplicate findings across them.
- **Stable misses**: clichéd beats (`fiction.beat-overuse`), threefold repetition of one feeling (`fiction.repeated-effect`), a pronoun with two antecedents (`clarity.ambiguous-reference`), a mixed metaphor, filtering, an unmotivated change of tone, a trivializing simile at a deathbed.

These figures show that the mechanism works and how conservative it is on a sample written to test it. They are not a measurement of editorial value on real manuscripts.
