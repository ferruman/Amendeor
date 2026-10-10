# Furnace Road supervised trial

All offered edits remain pending. No acceptance API was called. The build used an empty acceptance list.

```json
{
  "run_id": "2026-10-10T17-45-26Z-6e2e",
  "input": "/Users/victor/Developer/git/codicora/books/bradshaw-01/manuscript/chapters/ch-f182cce3.md",
  "source_sha256": "65d3b473c511187576aac1315275b59e928158afe8d7090077bb8e2e4c271ed5",
  "original_unchanged": true,
  "scenes": 5,
  "words": 4072,
  "model_proposals": 0,
  "rule_proposals": 0,
  "pending": 0,
  "accepted": 0,
  "rejected": 0,
  "build_conflicts": 0,
  "verifier_calls": 0,
  "api_calls": 5,
  "actual_api_cost": 0.000849875,
  "conservative_spend_bound": 0.0008498750000000002,
  "budget_usd": 0.5,
  "cost_per_1000_words": 0.0002087119351669941,
  "execution_ms": 15979,
  "blocked": false
}
```

No proposed edits require inspection in this trial. All five editor responses were `{"edits":[]}`. The verifier was therefore not called. Word counts use the production summary/tokenizer.
