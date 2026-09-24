# M3 mechanical baseline — 2026-09-24

Run from the Amendeor root after `node scripts/prepare-eval-fixtures.ts`:

```bash
node eval/run.ts --work jekyll-en --mode mechanical --runs 1
node eval/run.ts --work kashtanka-ru --mode mechanical --runs 1
```

The seed is `amendeor-v1`. Each work has nine injected defects, one of each M3 type, and one untouched control chapter. Both controls produced **zero proposals**. The unnecessary edit rate over all scanned words was **0** in each work.

| Mutation | English recall | Russian recall |
| --- | ---: | ---: |
| typo | 0/1 | 0/1 |
| doubled word | 1/1 | 1/1 |
| punctuation | 0/1 | 0/1 |
| agreement | 0/1 | 0/1 |
| redundancy insertion | 1/1 | 1/1 |
| unnecessary qualifier | 0/1 | 0/1 |
| dialogue format | 0/1 | 1/1 |
| terminology variant | 0/1 | 0/1 |
| repeated sentence frame | 1/1 | 1/1 |

The deterministic rule set catches a narrow subset. Missing categories are candidates for the M4 model pass; they are not implied to be safe for automatic acceptance. The M5 deterministic trap stage rejects 160/160 prepared meaning changes per language. Full model verification and human-labelled precision remain unmeasured without a configured provider and labels.

Raw metrics, rule-set version, pack version, and per-run records are in [English results](results/2026-09-24-jekyll-en-mechanical.json) and [Russian results](results/2026-09-24-kashtanka-ru-mechanical.json). Repeated mechanical runs should have identical proposals and rates; the timestamp and run id naturally differ.
