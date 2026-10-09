# English prose style for Amendeor

Guide: `check --guide en-prose-style`. Catalog version `0.3.0`.

Principles of diction, figures, sound, rhythm and register, written in our own words. They rest on a tension this guide keeps: every rule about style has writing that works precisely because it breaks it. Slang, dialect, Creole and code-switching belong in literary prose; long sentences can earn their length; fragments can punch; repetition can make rhythm. This guide therefore asks only whether a choice **damages** the passage, never whether it is standard.

It also asks whether a sentence keeps the reader inside the story: the reader should stop seeing words and see the scene, and a slip of technique, a filtered image, an abstract word where an image is needed or a recurring tic can break that. A careful writer may break any of these knowingly; metafiction breaks immersion on purpose and is outside the checks.

It reads the narrator's sentences only; character speech belongs to [en-fiction-editing](en-fiction-editing-principles.md).

Mode and severity as in [en-fiction-editing](en-fiction-editing-principles.md).

## Principles

| ID | Name | Question | Mode | Context | Valid finding | Keep when | False-positive risk | Severity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `prose.static-verb` | Static verb where action is | Does a linking or weak verb (*was*, *seemed*, *appeared*, *had*, *there was*, *occurred*) carry a sentence whose real content is an action, so that the moment goes flat? | C | The sentence and the scene's pace | "There was a crash and then there was a scream from the yard." in an action scene | Stillness is the content (a strategic *is*); description of a state; a deliberately flat, affectless voice | high | info |
| `prose.weak-verb-adverb` | Weak verb propped by an adverb | Does a generic verb lean on an adverb (*walked slowly*, *ran very quickly*, *set it down angrily*) where one precise verb would act? | C | The sentence | "Angrily she set the cup on the table." | No single verb carries the nuance; the adverb adds information the verb lacks; the plain verb is the narrator's voice | medium | low |
| `prose.empty-adjective` | Adjective that tells the reaction | Does an adjective announce the reaction the reader is meant to have (*mysterious*, *beautiful*, *terrifying*, *unique*, *fascinating*) instead of giving the detail that would produce it? | C | The description | "The house was mysterious and somehow terrifying." with nothing in it to fear | The adjective is the viewpoint character's judgment in free indirect style; the detail is already given and the word sums it in a way the rhythm needs | medium | low |
| `prose.adjective-pileup` | Adjective by habit | Do adjectives pile up on nouns by habit — attributes every reader assumes (*steep cliffs*, *green grass*), strings of epithets, purple stacks — so that the image blurs? | C | The sentence | "The tall, dark, looming, ancient, gnarled oak stood against the dark, stormy, brooding sky." | Lush description that fits the setting and voice; a catalogue on purpose; parody | medium | low |
| `prose.stock-diction` | Stock phrase | Does the narration use a dead metaphor, cliché or stock description where its own observation should be (*leave no stone unturned*, towns *nestled* in hills, ruins that *beckon*)? | D+C | The sentence | "The village was nestled in the hills, a sleepy hamlet where time stood still." | A voice that thinks in clichés by design; a cliché turned or subverted; dialogue | medium | low |
| `prose.mixed-metaphor` | Mixed metaphor | Do two figures collide in one image so that the picture contradicts itself? | C | The sentence and the next | "The plan was a house of cards that finally took root." | A character's muddled speech; comic intent | low | low |
| `prose.tin-ear-figure` | Figure that does not fit | Does a comparison fail on its own terms — an image that is factually wrong (*white as coal*), unpleasant against intent, or an adjective that contradicts the metaphor it modifies? | C | The figure and what it describes | "Her eyes were as blue as a bowl of skim milk." meant as praise | Deliberate grotesque or comic effect; the viewpoint character's skewed perception | medium | low |
| `prose.forced-sound` | Sound that fights sense | Does alliteration, rhyme or jingle call attention to itself against the meaning, or does an accidental rhyme or doggerel rhythm jar a serious sentence? | C | The sentence read aloud | "The bed blew clear of the shed; we fled ahead, half dead." in a tense scene | Sound play the passage is built on; a comic or childlike voice; a song, chant or spell inside the story | medium | info |
| `prose.elegant-variation` | Synonym cycling | Does the narration cycle synonyms for one thing (*the file*, *the dossier*, *the documents*, *the record*) to avoid repeating a word, so that the reader wonders whether these are different things? | C | The paragraph | "She opened the letter. The missive was short. The epistle ended with his name." | The variants carry different information or a change of viewpoint; one character's idiom; distinct objects | medium | low |
| `prose.monotonous-rhythm` | Monotonous rhythm | Do several sentences in a row share one length and one shape (subject–verb–object, subject–verb–object) so that the passage flattens, without the monotony serving the scene? | C | The paragraph | Six consecutive sentences of eight words each, each beginning with "She" plus a verb, in a calm reflective scene | Deliberate staccato for tension or exhaustion; incantatory repetition; a list-like passage by design | high | info |
| `prose.register-slip` | Register slip | Does a word or phrase from an unintended register — officialese, slang, a modern idiom in a period voice, a Latinate stiffness in a plain voice — break the narration's established tone? | C | The narration's tone in this scene | "The marshal surveyed the area and ascertained that the horses had been relocated." in a plain frontier voice | Deliberate high–low mixing that the voice uses throughout; a character's word quoted in free indirect style; irony | high | low |
| `prose.phoney-tone` | Borrowed manner | Does the narration put on a manner that is not its own — breathless clipped fragments imitating a famous terse style, forced folksiness, a pose of toughness — rather than the voice the rest of the book uses? | C | The passage against the book's voice | "Rain. The street. A car. I lit a cigarette. She came out. Trouble." in an otherwise discursive, leisurely novel | Pastiche or parody on purpose; a character-narrator whose voice this is throughout | high | info |
| `prose.fragment-gimmick` | Fragment as gimmick | Does a sentence fragment chop the line without adding punch, emphasis or rhythm, so that it reads as an affectation? | C | The paragraph | "He walked in. Tired. Of everything. Of her. Of the house." where nothing in the scene earns the chopping | Fragments that land a beat, mark a turn, or carry a voice; interior monologue | high | info |
| `prose.connotation` | Wrong shade of meaning | Is a word close in sense but wrong in connotation or register for this moment, so that it pulls against the scene (or is it misused, as *literally* for *figuratively*)? | C | The sentence and the scene's mood | "At the funeral the widow's grief was quite vibrant." | A deliberate ironic clash; a character's malapropism in free indirect style | medium | low |
| `prose.dream-break` | Break in the fictional dream | Does a clumsy construction, a self-regarding intrusion of the author, or narration that has to be reread just to be understood pull the reader out of the scene? | C | The sentence and its paragraph | "Having been, by the time she, who had not slept, reached the gate, rain." | An intrusive narrator who is a character in the book's design; an unreliable narrator; deliberate disorientation the scene is about; metafiction | medium | medium |
| `prose.filtering` | Filtered perception | Does a perceiving verb (*she noticed*, *he saw*, *she could hear*, *he felt*) stand between the reader and an image that could be given directly? | C | The sentence and the point of view | "Looking up, she noticed a hawk circling over the barn." | The act of noticing is itself the event (a realization, a delay in perception); the filter signals whose perception it is after a shift; distant narration | high | info |
| `prose.abstract-for-concrete` | Abstract word where an image is needed | Does an abstract, general or Latinate word (*the animals*, *hostile activity*, *the dwelling*) stand where the scene needs a concrete one the reader can see? | C | The sentence | "The animals engaged in hostile activity near their dwelling." for two dogs fighting by a kennel | Summary that deliberately keeps distance; a viewpoint character who thinks in abstractions; essayistic narration by design | medium | low |
| `prose.mannerism` | Mannerism | Does a stylistic tic recur in the passage in a way that draws attention to the writer rather than serving the material? | C | The passage | Three paragraphs in a row each ending on a one-word sentence fragment in italics | A difficult style that is clearly in the service of the material; sincere plainness or stiffness; a signature voice the book sustains | high | info |

## Signals

| Signal | Principle | Matches |
| --- | --- | --- |
| `prose.dead-metaphor` | `prose.stock-diction` | a short list of dead metaphors and stock phrases not already in Amendeor's formulaic catalog: *leave no stone unturned*, *raining cats and dogs*, *level playing field*, *on the fast track*, *the rat race*, *hue and cry*, *gild the lily*, *loud and clear*, *toe the line*, *nestled in/among the hills*, *where old meets new*, *time stood still* |

Text inside quotation marks is skipped. *at the end of the day* and similar frames are already `formulaic.filler-frame` and are not repeated here.

## Out of scope

| Matter | Reason |
| --- | --- |
| Grammar: agreement, case, *who*/*whom*, *lie*/*lay*, *less*/*fewer*, *that*/*which*, tense and mood | Correctness; `edit --mode proofread` owns it. |
| Myths: split infinitives, ending with a preposition, starting with a conjunction | Must not be flagged. |
| Fixed ratios (for example of active to linking verbs) | Not a measure of a manuscript; `prose.static-verb` asks the question instead. |
| Singular *they* and similar usage positions | A pronoun choice is not a craft defect. |
| Headlines, captions, marketing copy, academic prose | Nonfiction and commercial forms. |
| Jargon, euphemism, hedges and intensifiers | Kept in `clarity.jargon` and `clarity.qualifier`. |
| Point of view by pronoun choice | `fiction.pov-slip` and `fiction.psychic-distance-jump`. |
| Dangling and misplaced modifiers, run-on sentences | `clarity.dangling-modifier`, `clarity.misplaced-modifier`, `clarity.sprawl`. |
| Flattening rhythm, removing deliberate repetition | Not findings: rules for the verifier and for any proposed edit. |
