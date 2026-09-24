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
