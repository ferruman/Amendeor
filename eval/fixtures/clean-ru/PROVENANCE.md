# Clean Russian fixture (held out, 2026-10-10)

- Works: Антон Павлович Чехов, «Смерть чиновника» (1883), «Злоумышленник» (1885), «Ванька» (1886). Original Russian prose, modern orthography as published by Wikisource.
- Digital sources: Russian Wikisource raw wikitext snapshots fetched 2026-10-10, stored in `eval/sources/`:
  - `smert-chinovnika.wiki.txt` — SHA-256 `969e6b51f32d2244d287ce870add4d778093575773a8a0ae764eb6072558eddb`
  - `zloumyshlennik.wiki.txt` — SHA-256 `7213b76ef39450d1f06ee586f0425f4c5309167cb503b58ae8fd412aed2fccc4`
  - `vanka-1886.wiki.txt` — SHA-256 `c985e7fd9803696ae0bad5fdbd7d242b06a852e81431c474f37ab51d7861fbd4`
  Wikisource cites the Nauka *Полное собрание сочинений* (vols. 2, 4, 5).
- Rights: Wikisource labels the texts `PD-old-70`; Chekhov died in 1904.
- Transformations: the same as `kashtanka-ru` — strip the `Отексте` header, notes and categories; remove `<ref>` footnotes, HTML tags, `&nbsp;` and templates; replace wiki links with their visible text; preserve prose, dialogue dashes, dialect, period forms and paragraph boundaries; group paragraphs into scenes of about 700 words with deterministic UUID markers.
- No injected errors. The whole fixture is a control: any accepted edit changes the author's text. It contains deliberate traps for over-editing: period forms (e.g. «шкапа»), a child's dialect letter in «Ванька», a peasant's speech in «Злоумышленник», unstressed «е» for «ё».
- Held out: no prompt or rule was tuned on this text.

Regenerate with `node scripts/prepare-clean-fixtures.ts` from the Amendeor root. No model produced this fixture.
