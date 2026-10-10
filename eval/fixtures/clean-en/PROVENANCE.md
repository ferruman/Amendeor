# Clean English fixture (held out, 2026-10-10)

- Work: Robert Louis Stevenson, *The Strange Case of Dr Jekyll and Mr Hyde* (1886), chapters "Incident of Dr. Lanyon" and "Incident at the Window". These chapters are not part of the `jekyll-en` fixture (it uses the first four chapters).
- Digital source: Project Gutenberg eBook #43, `../pg43.txt`, SHA-256 `48e3f455c90f42e2aa4e9b0413672974a175121eef5262ebe9d8cdec5b74cf14`. Public domain.
- Transformations: the same as `jekyll-en` — Gutenberg header and licence removed, line-wrapped paragraphs joined, paragraph boundaries and Stevenson's British and period spellings preserved; scenes of about 700 words with deterministic UUID markers.
- No injected errors. The whole fixture is a control: any accepted edit changes the author's text.
- Held out: no prompt or rule was tuned on this text.

Regenerate with `node scripts/prepare-clean-fixtures.ts` from the Amendeor root. No model produced this fixture.
