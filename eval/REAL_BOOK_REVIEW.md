# Real-book chapter review — 2026-09-24

The source manuscripts were read only. The review used isolated temporary copies of one chapter from each book, so Amendeor could not write an `edited/` directory into either book.

| Book | Chapter | SHA-256 of chapter file | Local formulaic hits | Offered model proposals | Prose proposals reviewed |
| --- | --- | --- | ---: | ---: | ---: |
| `../books/jekyll-and-hyde` | `ch-0789c104` | `66e4902e97163d9457c9c65cee4c752f6c029911aa4f86439227847b417c1b03` | 0 | 0 | 0 |
| `../books/seymsk` | `ch-e83c99ac` | `3816cf44f43e73411d6c66b051bf4fd3ed4d94ee823fd448a699e0ff4f04551b` | 0 | pending approval | pending approval |

The entire real Jekyll book and the entire real Seymsk book each produced **zero formulaic hits** from `inspect`. The formulaic pass requires an overlapping catalog signal before it can offer a `prose-pattern` proposal, so the v0.2 one-chapter pattern review found zero offered proposals and no false positive to convert into a keep fixture.

The English chapter's real-provider `copy` run completed without transport failure. Its model generated two candidates; both were rejected by the proper-name guard. No proposal reached the author, so the M5 prose review had no English proposal to assess.

The Seymsk chapter's no-key local mechanical pass reported zero rule proposals and zero formulaic hits. The real-provider copy run was rejected by automatic approval review because it would send likely private manuscript content to OpenRouter. Approval to use the API key did not include approval to upload that chapter. The M5 Russian prose review and v0.1 tag remain pending a separate authorization; no private chapter text was sent.
