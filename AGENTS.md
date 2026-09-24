# Amendeor

Amendeor proposes conservative copy edits and builds an `edited/` copy from accepted proposals. It never writes to the source manuscript.

## Invariants

1. The source manuscript is read-only.
2. A proposal is applied only when its target is uniquely located or safely disambiguated; stale, ambiguous, and overlapping edits are reported.
3. `edited/` is reproducible from the source and its append-only accepted proposal history.

There is no build step: what runs is what you edited. See [`../LESSONS.md`](../LESSONS.md) before changing model or run behavior. Code comments are written in Russian.
