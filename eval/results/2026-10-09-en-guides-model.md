# English guides evaluation 2026-10-09 (model)

Fixture: 26 labeled defects in 13 scenes, 10 scenes of legitimate stylistic choices.

Baseline without the new guides (formulaic catalog): 0 hits, 0 labeled defects touched, 0 on keep scenes.

| Guide | Layer | Findings | TP | Near | FP on keep | Unlabeled | Precision (lower–upper) | Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-fiction-editing | signals | 3 | 3 | 0 | 0 | 0 | 100%–100% | 27% |
| en-fiction-editing | contextual | 11 | 5 | 5 | 0 | 1 | 45%–100% | 45% |
| en-fiction-editing | combined | 12 | 6 | 5 | 0 | 1 | 50%–100% | 55% |
| en-clarity | signals | 5 | 5 | 0 | 0 | 0 | 100%–100% | 63% |
| en-clarity | contextual | 12 | 7 | 4 | 0 | 1 | 58%–100% | 88% |
| en-clarity | combined | 12 | 7 | 4 | 0 | 1 | 58%–100% | 88% |
| en-prose-style | signals | 2 | 2 | 0 | 0 | 0 | 100%–100% | 29% |
| en-prose-style | contextual | 16 | 3 | 10 | 0 | 3 | 19%–100% | 57% |
| en-prose-style | combined | 17 | 4 | 10 | 0 | 3 | 24%–100% | 57% |

Cost: $0.5977 (303353 tokens in, 10427 out); editor openai/gpt-5.1, verifier anthropic/claude-sonnet-5 × 3.

Findings by verdict are in the JSON next to this file.
