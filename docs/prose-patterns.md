# Formulaic prose in Amendeor

Catalog version: `0.2.0`. The initial pattern catalog adapts the editing ideas in [No AI Slop](https://github.com/petergyang/no-ai-slop/blob/main/skills/no-ai-slop/SKILL.md) (MIT [license](https://github.com/petergyang/no-ai-slop/blob/main/LICENSE)). Amendeor's implementation and Russian examples are local. A match is evidence of a phrase worth reading. It says nothing about who wrote the text.

`amendeor inspect <target> --json` includes `formulaic` hits with a stable pattern id, language, provenance, chapter, scene, raw offsets, exact quote, and reason. Plain output lists the hits. A phrase match alone never becomes a proposal.

| Pattern | English seed | Russian seed | Keep when |
|---|---|---|---|
| `formulaic.throat-clearing` | “Here's the thing” | deferred; common Russian openers need more context | It belongs to a character's speech or carries a real conversational turn |
| `formulaic.faux-insight` | “What nobody tells you” | «Мало кто говорит о том, что» | A character says it, or the claim has a specific dramatic purpose |
| `formulaic.importance-puffery` | “marks a pivotal moment” | «знаменует собой поворотный момент» | The line is quoted, ironic, or grounded in a concrete fact |
| `formulaic.filler-frame` | “At the end of the day” | «В современном мире» | Time or setting is genuinely being contrasted |

The positive and negative examples are executable fixtures in [`test/fixtures/formulaic-examples.json`](../test/fixtures/formulaic-examples.json). The scanner excludes marked dialogue. Clean English and Russian controls produce zero hits. A read-only smoke scan on the current `jekyll-and-hyde` and `seymsk` manuscripts produced zero hits in each; that result tests conservatism on these books, not recall.

The v0.2 edit pass is specified in [`specs/006-formulaic-prose/`](../specs/006-formulaic-prose/spec.md). The implemented pass sends exact hits and book-relative metrics in bounded windows. A model may answer `NO_CHANGE`; any `prose-pattern` edit must overlap a cited hit, is classified as prose, and must pass semantic and voice verification before explicit author acceptance. Literary repetition, fragments, dialect, quoted speech, and Russian dash usage remain valid unless the book-specific evidence and author review support a change. Real-provider evaluation and manual review remain pending.
