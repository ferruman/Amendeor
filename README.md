# Amendeor

Conservative copy editing for Codicora manuscripts. It reads a Codicora workspace or standalone Markdown/text, records reviewable proposals, and builds a derived `edited/` copy. The manuscript input is never rewritten.

Requires Node.js 23.6 or newer. TypeScript runs directly through Node; there is no build step.

```sh
npm install
npm test
npm run typecheck
```

## Review in the browser

```sh
npm run ui                     # http://127.0.0.1:4178
npm run ui -- ../books/seymsk  # also show a Codicora workspace
```

Add a text (paste it or pick `.md`/`.txt` files, one chapter each), run a check, then accept or reject each proposal on the page; **Download edited** returns the edited copy. Pasted texts live in `~/Amendeor` (`--library DIR` to change); the original is never rewritten. Model modes appear when `.env` and `amendeor.yaml` configure them (see below).

## No-key quick start

```sh
node src/cli.ts inspect path/to/book --json
node src/cli.ts check path/to/book --guide nora-gal
node src/cli.ts edit path/to/book --mode mechanical
node src/cli.ts report path/to/book
```

Standalone text requires `--lang en` or `--lang ru` if the language cannot be read from a workspace manifest. A standalone output path can be set with `--out path/to/edited`. The no-key mechanical pass applies deterministic rules only.

`node src/cli.ts reject path/to/book <proposal-id>` also withdraws an already accepted proposal and rebuilds `edited/` without it. The original acceptance remains in the append-only journal; a `withdraw` event records who reversed it. The UI's Reject button supports accepted proposals too. Agents use `--delegation <id>` with `amendeor.accept`.

## Model editing

The repository includes `amendeor.yaml` with separate editor and verifier profiles on OpenRouter. Copy `.env.example` to `.env`, put a key in `AMENDEOR_OPENROUTER_API_KEY`, and run commands from this directory with `node --env-file=.env`. The private `.env` is ignored by Git. A workspace can override settings with its own `amendeor.yaml`.

The provider configuration uses environment variable names rather than embedding secrets. A key written inline (`api_key:`) is accepted only in the user config (`~/.config/codicora/amendeor.yaml`); in a workspace's `amendeor.yaml` it is refused — the book folder is portable and goes to git, the credential belongs to the machine:

```yaml
providers:
  editor:
    transport: openai
    endpoint: https://api.openai.com/v1/chat/completions
    api_key_env: AMENDEOR_EDITOR_API_KEY
    family: editor-family
  verifier:
    transport: anthropic
    api_key_env: AMENDEOR_VERIFIER_API_KEY
    family: verifier-family
profiles:
  edit:
    provider: editor
    model: your-editor-model
    context_budget: 4096
  verify:
    provider: verifier
    model: your-verifier-model
    passes: 3
preserve:
  - sentence-fragments
  - dialect
  - informal-dialogue
```

Set `price.input_per_m`, `price.output_per_m`, and `price.currency` for a meaningful cost ledger; calls without configured prices are marked unpriced. The transports also support `local` for scripted tests and an OpenAI-compatible endpoint such as OpenRouter. Without `profiles.verify`, model candidates are withheld from ordinary proposals.

```sh
node --env-file=.env src/cli.ts edit path/to/book --mode proofread
node --env-file=.env src/cli.ts edit path/to/book --mode copy
node --env-file=.env src/cli.ts report path/to/book
node --env-file=.env src/cli.ts accept path/to/book amendeor:PROPOSAL_ID
node --env-file=.env src/cli.ts build path/to/book
```

`--mode proofread` reads every chapter title and scene window for objective spelling, grammar, and punctuation errors. Model suggestions require an independent check that the original is actually wrong, then the semantic and voice guards. Comma-only suggestions require explicit acceptance. `--mode copy` and `--mode full` also scan all scene windows for broader copy edits. `--resume RUN_ID` reuses successful window answers from the cache and replaces that run's report. `diff` compares proposal status across runs. `accept --impact mechanical` accepts only mechanical proposals; model suggestions pass semantic and voice guards before ordinary acceptance.

Amendeor never edits `manuscript/`, silently accepts prose changes, or treats formulaic wording as proof of authorship. Model suggestions that fail meaning or voice checks are withheld and recorded as guard rejections. Formulaic `inspect` findings include a pattern id and the exact quote for review; see [the pattern catalog](docs/prose-patterns.md).

The separate `check --guide nora-gal` command combines narrow Russian office-language signals with a contextual review of the source-grounded principles. It requires configured edit and verify profiles, makes no proposals or edits, and caches successful review windows. Use `--rules-only` for the no-key pattern check; see [the implemented check](docs/nora-gal-check.md) and [the principle catalog](docs/nora-gal-principles.md).

With `--findings` (in a Codicora workspace), `check` also writes its results to `findings/amendeor/` in the suite's findings format ([`../FINDINGS.md`](../FINDINGS.md)): category `style.<principle>`, kind `concern`, severity `low`, each with its quote — so Fabellatrix shows them beside the chapter and an Imprimeor edition can gate on them. They are diagnostics, not edits: a finding names a place and a reason, while `edit` proposals carry a replacement the author accepts into `edited/`. Without the flag, `check` stays a read-only report on stdout.

**Under a delegation** ([`../DELEGATION.md`](../DELEGATION.md)). `edit --delegation <id>` and `check --delegation <id>` let an agent run the paid model passes for the author when `authority/delegations.json` allows `amendeor.edit`. Before every model call the worst case — the input at two characters a token plus the whole output budget, at the provider's `price` in `amendeor.yaml` — must fit what is left of the delegation's limit, shared with every other tool. A provider without a price, a limit in another currency, or a call that would not fit stops the paid passes before spending; the command exits 2 and says what is missing. The actual cost (tokens × price) and the delegation's `delegation_hash` go into `authority/amendeor.jsonl`. `accept --delegation` needs `amendeor.accept`. Without `--delegation` a person at a terminal works as before; an agent's shell (`CODICORA_AGENT`, `CLAUDECODE` or Codex's `CODEX_SANDBOX` in the environment) is not a person: `accept` is refused, and `edit`/`check` run their rules but make no model call (exit 2).

`check --guide infostyle` works the same way with a narrow, prose-safe selection from Ilyakhov and Sarycheva's «Пиши, сокращай»: office phrases, hidden actions, time parasites, inflated words and euphemisms in the narrator's own voice. The book is written for business text, so evaluations, intensifiers, vagueness and fragments are deliberately left out, and findings inside dialogue are dropped; see [the catalog](docs/infostyle-principles.md).

For English fiction, three guides work the same way: `en-fiction-editing` (dialogue, attribution, exposition, point of view and distance, scene logic, sentimentality), `en-clarity` (the narrator's sentences only) and `en-prose-style` (diction, figures, rhythm, register, immersion). Every principle carries its legitimate exceptions, and the prompts forbid treating fragments, repetition, passive voice, dialect, free indirect discourse and other deliberate choices as defects. A guide on a book in another language stops with an error. See [the overview](docs/en-guides.md).

## Evaluation

The public-domain English and Russian fixtures and reproducible mutation seeds live under `eval/fixtures/`. Reproduce the mechanical baseline and the deterministic semantic traps with:

```sh
node eval/run.ts --work jekyll-en --mode mechanical --runs 1
node eval/run.ts --work kashtanka-ru --mode mechanical --runs 1
node eval/guard-traps.ts
```

The [baseline](eval/BASELINE.md), [trap report](eval/results/2026-09-24-guard-traps.md), and [real-provider results](eval/RESULTS.md) record measured results. Reproduce a copy-edit run with `node --env-file=.env eval/run.ts --work jekyll-en --mode copy --runs 3` or the same command for `kashtanka-ru`; add `--formulaic` for the v0.2 mutation set. The private `seymsk` real-book model review and v0.1 tag remain pending. The full product contract is in [the PRD](docs/prd.md).
