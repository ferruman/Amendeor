# Kashtanka evaluation fixture

- Author and work: Антон Павлович Чехов, *Каштанка* (1887), original Russian prose.
- Digital source: [Russian Wikisource, Каштанка](https://ru.wikisource.org/wiki/Каштанка_(Чехов)), raw wikitext snapshot stored at `eval/sources/kashtanka.wiki.txt`, SHA-256 `eaa29285ffab4a7a20c0cf93e682947411a7edb2db22d9321047247e948be3e2`. Wikisource cites the 1976 Nauka collected works transcript.
- Rights: Wikisource labels the original work `PD-old-70`; Chekhov died in 1904. Editorial footnotes are excluded.
- Transformations: strip Wikisource metadata and notes; split all seven story chapters at wikitext headings; remove `<ref>` editorial footnotes, HTML tags and `&nbsp;` markup; preserve prose, dialogue dashes, Russian inflection and paragraph boundaries; group paragraphs into scenes of about 700 words; add deterministic UUID scene markers and a manuscript manifest.
- Control: `03-kashtanka`, marked `eval_control: true` in `manuscript.yaml`. Mutation generation leaves it unchanged.

Regenerate with `node scripts/prepare-eval-fixtures.ts` from the Amendeor root. No model produced this fixture.
