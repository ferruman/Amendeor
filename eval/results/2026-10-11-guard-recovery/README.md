# Guard recovery and fail-fast on refused spend (AUDIT 2026-10-11 F2, F3, F5)

Offline, $0. No paid call; `fetch` is stubbed in every run.

## Book 2 replay (`eval/replay-book2-guard.ts`)

This replays run `2026-10-11T16-48-37Z-cc25` of `books/larfenon-2` from its own cache, on a temporary copy of the book.

- **Model windows.** 108 of 111 windows hit the cache.
  - The other 3 changed after the run: two epigraphs were italicised (one with «врук» replaced), and ch. 2 was patched.
  - The epigraph text is restored in the copy. The window keys still differ, so these windows get their historical editor answer from the same cache.
  - One window has no unread non-empty entry. It answers `{"edits":[]}`.
- **Verifier.**
  - Cache hits answer for themselves.
  - Otherwise the stub returns the per-pass fields recorded in `run.json`.
  - The 2 historical schema failures get a reply without `preserved`, every time.
- **Fidelity.** The model offered set is identical to cc25: the same 13 proposal ids.

| | before (HEAD 1ef7b46) | after |
|---|---|---|
| F2 errors visible to the author | **0 / 16** (15 rejected, 1 verify failed) | **16 / 16 review-only** |
| …acceptable without explicit per-id consent | — | **0** (`unverified`, impact `prose`) |
| model proposals offered | 13 | 13 (same ids) |
| review-only | 0 | 18: the 16, plus «разошлся → разошёлся» and «на стенах → на стены» |
| editorial rejections | 39 | 20 (a subset of before) |
| unchecked: verifier / provider | 0 (2 counted as rejections) | 2 / 0 (one of them review-only) |
| guard stage | partial | partial: verifier failures only; rejections alone give `ok` |

Rejected before and after: every candidate the verifier answered `necessary: false, preserved: false`.
- «руок → рун», «бот → борт», «счла → сочла», «галофанийские → галафанийские», «в морге → в моргании».
- Every edit that is not typo-shaped: «где → куда», «как стоял → как и», «сухое → сухую землю», ….
- Every other trap: «ё», commas, punctuation style.

Files: `before.json` and `after.json`.

## Refused spend, 9 windows (`test/guard-recovery.test.ts` GR-6)

Setup: an agent at the CLI runs `edit --mode copy` without `--delegation`, with an OpenRouter endpoint.

| | before | after |
|---|---|---|
| wall time | 28.33 s | 0.29 s |
| exit code | 2 | 2 |
| refusal printed | once, at the end | once |
| lock | released | released |
| run record | model stage `ok`, 9 window failures | model stage `refused`, 0 done, 9 not sent; rules proposals recorded |
