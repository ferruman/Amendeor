# M2 smoke review — 2026-09-24

Commands used with an empty user config:

```sh
env -i HOME=/private/tmp XDG_CONFIG_HOME=/private/tmp/amendeor-no-config node src/cli.ts edit ../books/jekyll-and-hyde --mode mechanical --json
env -i HOME=/private/tmp XDG_CONFIG_HOME=/private/tmp/amendeor-no-config node src/cli.ts edit ../books/seymsk --mode mechanical --json
node scripts/perf.ts
```

The first runs produced 11 proposals on *Jekyll and Hyde* and 159 on *Seymsk*. I read all 11 English proposals and the first 30 Russian proposals with their surrounding text. The English set included legitimate “that that”, possessive apostrophe variants treated as name errors, initials such as “Dr. J.” treated as sentence endings, and rhetorical lower case after a question mark. The Russian set was dominated by normal case inflection of names and capitalized short function words such as «Не» and «На». These were false positives.

The rules now exclude those cases. Regression examples were added to both clean control texts. Follow-up runs produced zero proposals on each book; both runs finished with no failed units. The books' source files were read only and no proposals were auto-accepted.

The generated 120,120-word performance book took 1.002 seconds cold and 0.996 seconds warm on the local Node 26.4.0 run. The M2 limits are 10 seconds cold and 2 seconds warm. The performance script writes its fixture under the system temporary directory.
