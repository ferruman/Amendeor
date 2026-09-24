# Jekyll and Hyde evaluation fixture

- Author and work: Robert Louis Stevenson, *The Strange Case of Dr. Jekyll and Mr. Hyde* (1886).
- Digital source: [Project Gutenberg ebook 43](https://www.gutenberg.org/ebooks/43), plain text prepared by David Widger. The local input was `../pg43.txt` relative to the Amendeor root, SHA-256 `b43448a88391591f9cf82b25553df00faf47a2752a873185fcdd1156eebdb990`.
- Rights: Gutenberg marks ebook 43 as public domain in the United States; Stevenson died in 1894. The fixture contains the original English prose, with no later translation.
- Transformations: strip Gutenberg header, licence, contents and footer at the `START`/`END` markers; take the first four chapter bodies; convert CRLF to LF; join source line wraps within paragraphs; retain paragraph breaks and punctuation; split paragraphs into groups of about 700 words; add deterministic UUID scene markers and a manuscript manifest.
- Control: `03-jekyll`, marked `eval_control: true` in `manuscript.yaml`. Mutation generation leaves it unchanged.

Regenerate with `node scripts/prepare-eval-fixtures.ts` from the Amendeor root. No model produced this fixture.
