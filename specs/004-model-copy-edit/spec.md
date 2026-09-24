# Feature Specification: M4 — Model copy edit

**Status**: Draft · **Source**: [PRD](../../docs/prd.md) §§9.2, 12, 15–16 · **Depends on**: M2 and M3

## User stories

1. An author runs `copy` or `full` mode and sees small, structured suggestions, with `NO_CHANGE` counted as a normal result.
2. An author optionally runs `mechanical` with a configured model for grammar and spelling; without a profile, the M2 rules-only path still works.
3. A run can resume after a provider failure without paying again for completed windows, and the report states cost, latency, failures, and degraded units.

## Requirements

- **FR-001**: Use one gateway for Anthropic, OpenAI-compatible, and local transports. Request and body read share timeout/error handling; provider diagnostics reach the retry loop.
- **FR-002**: Explicitly disable reasoning by transport unless requested. Size output budgets from measured token density and language-pack seed values.
- **FR-003**: Send bounded paragraph windows with read-only context. Parse and validate structured edits; discard missing targets and multi-paragraph rewrites.
- **FR-004**: Treat an empty `edits` array as `NO_CHANGE`. Mark all model proposals `unverified` until M5, so normal acceptance refuses them.
- **FR-005**: Cache successful window answers by text, context, configuration, model/profile, prompt, and rule versions; record every call in a priced ledger using configured prices only.
- **FR-006**: Evaluate both languages with repeat runs before advancing to guards.

## Acceptance

- Local transport tests cover `NO_CHANGE`, invalid output, missing target, oversized replacement, retry, resume, and ledger.
- Real-provider evaluation produces recall, unnecessary-edit rate, cost, and time for both languages; failures appear in the run report.
- No model proposal is accepted by default before M5.

## Boundary

Findings input is v0.2 per PRD §20. M4 windows come from rules, metrics, and scene windows.
