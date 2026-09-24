# Tasks: M4 — Model copy edit

**Input**: [spec.md](spec.md) · [plan.md](plan.md) · `docs/prd.md` §9.2, §12, §16 · `../LESSONS.md` §1, §3
**Depends on**: M2, M3
**Goal**: model-assisted copy editing that returns `NO_CHANGE` freely, costs what the ledger says, and resumes. Its proposals are `unverified` until M5.

## Phase 1: Gateway

- [X] T001 `src/provider/types.ts`: `Provider { complete(req) → { text, finishReason, usage, ms } }`, one `ProviderError { kind: network|timeout|http|truncated|refused|schema, retryable, diagnosis }`
- [X] T002 [P] `src/provider/anthropic.ts`: `thinking: { type: "disabled" }` always unless the profile asks; carry `stop_reason` and content block types into the diagnosis
- [X] T003 [P] `src/provider/openai.ts` (OpenAI-compatible incl. OpenRouter): `reasoning: { enabled: false }` always unless the profile asks; carry `finish_reason`; `content: null` → `truncated` with the budget in the message
- [X] T004 [P] `src/provider/local.ts`: deterministic scripted transport for tests and the no-key demo
- [X] T005 `src/provider/http.ts`: request **and body read** inside one timeout and one try; every failure converted to `ProviderError` at this boundary (LESSONS §1)
- [X] T006 `src/provider/gateway.ts`: the only caller of transports — retry retryable errors with backoff, output budget = expected chars ÷ chars-per-token **measured from the run's own calls** (seed from the pack, update from `usage.input_tokens` vs characters sent), ledger entry per call (stage, provider, model, tokens, cost from configured `price`, ms)
- [X] T007 `test/provider.test.ts`: a stalled body becomes a retryable `ProviderError`, not a crash; truncation message names the budget; the Russian budget grows after the first call reports its density; no request reads real config or keys

## Phase 2: Copy-edit pass

- [X] T008 `src/prompts/copy-edit.ts` (versioned): one rule per line (LESSONS §3); language-specific instructions from the pack; the category list; `NO_CHANGE` = empty `edits` stated as the expected common answer; no scene markers or labels inside the text sent (strip on the way in)
- [X] T009 `src/edit/windows.ts`: candidate windows from rule hits, metric hotspots, and (modes `copy`/`full`) whole scenes in paragraph-aligned windows sized to `context_budget`; neighbouring paragraphs as read-only context. Findings input is deferred to v0.2 (PRD §20).
- [X] T010 `src/edit/parse.ts`: zod-validate `{ edits: [...] }`; one retry with the parse error in the prompt, then discard with a counted reason; every `target` must locate verbatim in the window; a replacement longer than one paragraph is discarded
- [X] T011 `src/edit/classify.ts`: `impact` — `mechanical` iff the token diff is punctuation, whitespace, case or a spelling-variant only; otherwise `prose`
- [X] T012 `src/edit/pass.ts`: windows → gateway → parse → proposals with `source: model`, `unverified: true`; units cached by everything they read (window, context, config slice, profile, prompt version); failures not cached; degraded units named in `run.json.stages[].failures`
- [X] T013 Wire `edit --mode copy|full` into the CLI; with a configured edit profile, `--mode mechanical` additionally sends grammar/spelling windows through the model path (without a profile it remains rules-only); `--resume <run-id>` reuses the run dir and cache; report shows windows sent, `NO_CHANGE` count, discarded answers with reasons, ledger per stage
- [X] T014 `test/edit.test.ts` with the local transport: empty edits → no proposals and counted `NO_CHANGE`; a target not in the window is discarded; a two-paragraph replacement is discarded; rerun is all cache hits; configured mechanical mode invokes model grammar/spelling while no-profile mode stays rules-only; `accept` refuses the resulting proposals without `--unverified`

## Phase 3: Measure

- [X] T015 Run `eval/run.ts --mode copy --runs 3` on both works with a real provider; record recall, unnecessary-edit rate, cost and time in `eval/results/`; compare with the mechanical baseline
- [X] T016 Adjust the prompt only on order-of-magnitude differences (LESSONS §4); bump the prompt version with each change

**Checkpoint**: real-provider copy edit runs on both fixtures and on `../books/seymsk` without a transport failure; `NO_CHANGE` is the majority answer on the control.
