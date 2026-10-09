# English clarity for Amendeor

Guide: `check --guide en-clarity`. Catalog version `0.2.0`.

Sentence-level clarity principles, written in our own words, selected for fiction from the tradition of plain-style editing for nonfiction. Because that tradition serves expository prose, this guide applies them only to the **narrator's own sentences**, never to dialogue, a character's thoughts in their own idiom, free indirect discourse, letters or documents inside the story. Brevity is not a goal: terseness that strips a passage's charm is a loss, and a long sentence is fine when it is clear. The guide asks only about failures of reading.

Each row is a question; a finding is a reason to reread. The deterministic signals below are hints; nothing here edits text.

Mode and severity as in [en-fiction-editing](en-fiction-editing-principles.md): **D** text signal, **C** contextual and verified; **medium** — the reader can misread who did what or when; **low** — noticeable weakness; **info** — advisory.

## Principles

| ID | Name | Question | Mode | Context | Valid finding | Keep when | False-positive risk | Severity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clarity.hidden-action` | Action hidden in a noun | Is an action the narration describes buried in a noun after an empty verb (*came to an agreement*, *conducted an investigation*), so that the sentence has no working verb? | D+C | The sentence | "The detective conducted an examination of the lock." | The noun refers back to an earlier sentence or names a familiar concept; a character's or document's officialese; the phrase is idiomatic in the speaker's register | medium | low |
| `clarity.missing-agent` | Missing actor | Has the narration removed the person who acts — abstractions as subjects, *there was ...* — so that the reader cannot tell who did or felt something the scene needs them to know? | C | The sentence and the paragraph | "There was a decision that the dog would be put down." when the scene turns on who decided | The vagueness is the point: the viewpoint character does not know, or a bureaucracy is being satirized; the actor is obvious from the previous sentence | medium | medium |
| `clarity.agentless-passive` | Passive that hides the doer | Does a passive verb hide who acts when the scene needs the reader to see who did it? | C | The sentence and the paragraph's focus | "The window was smashed and the money was taken." in a scene where the reader should see the thief act | The doer is unknown, irrelevant or obvious; the passive keeps the paragraph's focus on one character or puts familiar information first; passivity is the subject; a state rather than an action ("the door was locked") | high | low |
| `clarity.dangling-modifier` | Dangling modifier | Does an opening phrase have an implied subject that differs from the subject of the main clause, so that the sentence says something absurd or wrong? | C | The sentence | "Soaked and shivering, the fire was a welcome sight." | Absolute phrases; fixed expressions ("Generally speaking, ..."); a joke on purpose | low | medium |
| `clarity.misplaced-modifier` | Modifier attached to the wrong word | Does a modifier sit where it can attach to two words, or to the wrong one, so that the sentence can be read two ways (including *only* in the wrong place)? | C | The sentence | "She sold the piano to a man with carved legs." | Only one reading is grammatically possible; the ambiguity is a deliberate pun | medium | medium |
| `clarity.ambiguous-reference` | Ambiguous reference | Can a pronoun or a descriptive phrase refer to more than one person or thing just mentioned, with different meanings? | C | The previous two sentences | "Pete told Sam that his brother had been arrested." — whose brother? | Context excludes the second reading; the ambiguity is deliberate and the scene plays on it | medium | medium |
| `clarity.inflated-phrase` | Inflated phrase | Does a stock multi-word phrase stand where one plain word would say the same (*due to the fact that*, *in the event that*, *at this point in time*)? | D+C | The sentence | "Due to the fact that it was raining, they stayed in." in plain narration | A character's voice, a document, a pompous narrator by design; irony | low | info |
| `clarity.redundancy` | Redundancy | Does a word repeat what another already says — a doubled pair (*each and every*), a modifier implied by its noun (*true facts*, *final outcome*), an adverb implied by its verb (*blared loudly*)? | D+C | The phrase | "The radio blared loudly in the empty kitchen." | Emphasis the rhythm needs; legal or liturgical doublets in character; an idiom | low | info |
| `clarity.long-subject` | Long wait for the verb | Does the reader have to hold a long, abstract subject or a long interruption before reaching the main verb, so that the sentence is hard to follow? | C | The sentence | "The memory of the summer of the drowning of her brother in the quarry behind the school returned." | A deliberately suspended (periodic) sentence building to a climax; the sentence is long but its subject is short | medium | info |
| `clarity.sprawl` | Sprawling ending | Does a sentence trail off through tacked-on *which* / *that* / *who* clauses, each hanging on the last, so that the reader loses the thread and the sentence ends weakly? | C | The sentence | "She found the key, which was in the drawer that her father had used for the papers which he kept from the bank that had failed." | A long sentence propelled by emotion, hesitation or deliberate accumulation; resumptive or free modifiers that keep the line | medium | low |
| `clarity.faulty-parallel` | Broken parallel | Does a list or coordination join elements that are not parallel in grammar or in thought, so that the series stumbles or the logic blurs? | C | The sentence | "The house was cold, unlit, and the dog had gone." | A deliberate break at the end of a series for emphasis; common accepted pairings | medium | low |
| `clarity.logical-link` | Missing or false connection | Does a sentence fail to follow from the one before — a contrast, cause, or jump in time or place left unsignalled, or a connective (*therefore*, *however*) that claims a logic that is not there? | C | The previous and next sentences | "She had never trusted him. Therefore the garden was full of roses." | Deliberate juxtaposition, montage or stream of consciousness; a cut the scene break or white space signals | high | low |
| `clarity.tense-shift` | Unmotivated tense shift | Does the narration switch tense in a way that loses the reader in time, with no flashback, frame or present-tense habit to explain it? | C | The paragraph and the scene's base tense | A past-tense scene in which one sentence slides into the present and back for no reason | Historic present used consistently; a frame narrator speaking now about then; general truths in the present; free indirect thought; a dated document | high | medium |
| `clarity.qualifier` | Hedges and intensifiers that dilute | Do stacked qualifiers or intensifiers (*a bit*, *sort of*, *rather*, *very*, *really*, *quite*) in the narrator's own voice blunt a statement the passage otherwise makes plainly? | C | The sentence and the narrator's voice | "She was a bit afraid and rather tired and quite sure she was sort of lost." in a terse third-person narration | A first-person or free indirect voice whose hedging is character (uncertainty is content); comic understatement; a period voice | high | info |
| `clarity.jargon` | Jargon in the narration | Does the narration (not a character) slip into bureaucratic, technical or marketing jargon that the scene does not call for? | C | The sentence and the narrator's register | "The children were facilitated into a learning-positive environment." in a novel's narration | A character's idiom or a document within the story; satire; a narrator whose job speaks through them | medium | low |
| `clarity.noun-string` | Stack of nouns | Do three or more nouns pile up as modifiers of one another, so that the reader has to unpack the phrase? | C | The phrase | "the mill closure community impact meeting" | An established compound or proper name; a headline, sign or form inside the story | medium | info |

## Signals

Signals run on narration only (text in quotation marks is skipped). Each is a hint without verification.

| Signal | Principle | Matches |
| --- | --- | --- |
| `clarity.empty-verb-noun` | `clarity.hidden-action` | *came to an agreement/conclusion*, *conducted an investigation/examination/search/inspection*, *gave consideration to*, *took into consideration*, *was in possession of*, *made contact with*, *put in an appearance*, *was of the opinion that* and their tense forms |
| `clarity.inflated-phrase` | `clarity.inflated-phrase` | *due to the fact that*, *in the event that*, *at this point in time*, *for the purpose of*, *in regard to*, *with regard to*, *in light of the fact that*, *despite the fact that*, *until such time as*, *prior to* |
| `clarity.redundant-pair` | `clarity.redundancy` | doubled pairs and implied modifiers: *each and every*, *first and foremost*, *full and complete*, *true facts*, *final outcome*, *past history*, *future plans*, *terrible tragedy*, *free gift*, *blared loudly*, *screeched loudly*, *stumbled awkwardly*, *clenched ... teeth tightly* |

## Out of scope

| Matter | Reason |
| --- | --- |
| Correctness folklore: never start with *and*/*but*/*because*, *that* versus *which*, split infinitives, ending with a preposition, *hopefully* | Invented rules; must not be flagged. |
| Commonly confused words, agreement, case, punctuation | Grammar and usage: `edit --mode proofread` owns them. |
| Introductions, paragraph points, global organization | Document structure for expository writing. |
| Topic strings and old-before-new as a rule for every sentence | Fiction controls information for suspense and voice; kept only where a concrete reading failure results (`clarity.long-subject`, `clarity.logical-link`). |
| Metadiscourse, hedging in arguments | Argumentative register; the fiction-relevant part is `clarity.qualifier`. |
| Stress at the end of the sentence, elegance devices | Matters of rhythm and taste; rhythm lives in `prose.monotonous-rhythm`, and an elegance device is never a defect. |
| Advice about the writer's persona, leads and endings, nonfiction forms | Not properties of a fiction passage. |
| Institutional prose that hides responsibility | Inside fiction, evasive officialese is characterization. |
