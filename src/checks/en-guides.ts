import type { Guide } from './guide.ts';

// Английские гайды для художественной прозы; каталоги принципов в docs/en-*-principles.md.
// Пересекающиеся принципы закреплены за одним гайдом (docs/en-guides.md), правила ниже не дают другим гайдам их повторять.
// Узкие сигналы — только то, что регулярное выражение видит надёжно; прямая речь пропускается в checkGuide.

const SPEECH = '(?:said|says|asked|asks|replied|answered|whispered|shouted|cried|muttered|snapped|murmured|added|continued|repeated)';
const TAG_SUBJECT = "(?:he|she|I|they|we|you|[A-Z][\\p{L}'’-]+(?: [A-Z][\\p{L}'’-]+)?)";
// Тег идёт сразу после закрывающей кавычки, перед которой запятая, вопрос или восклицание; точка — это отдельная фраза (beat).
const AFTER_SPEECH = `(?<=[,?!…][”"’']\\s{0,3})`;

export const enFictionEditing: Guide = {
  id: 'en-fiction-editing', language: 'en', name: 'English fiction editing', version: '0.3.0', contextVersion: '0.3.0',
  source: 'docs/en-fiction-editing-principles.md', prefix: 'fiction', minPrinciples: 30, narrationOnly: false,
  byline: 'principles of fiction editing: dialogue, attribution, exposition, point of view and distance, scene staging and logic, and the emotional honesty of the narration',
  signals: [
    {
      id: 'fiction.tag-emotion', principle: 'fiction.explained-emotion', sourcePages: '',
      expression: new RegExp(`\\b${SPEECH} (?:in|with) (?:astonishment|surprise|amazement|anger|annoyance|irritation|disgust|exasperation|frustration|relief|delight|amusement|horror|alarm|disbelief|contempt|resignation|despair|dismay|bitterness|sarcasm)\\b`, 'gu'),
      reason: 'The tag names the emotion; check whether the spoken line already shows it.'
    },
    {
      id: 'fiction.ly-tag', principle: 'fiction.ly-attribution', sourcePages: '',
      expression: new RegExp(`\\b${SPEECH} (?!(?:softly|gently|quietly|loudly|clearly|slowly|quickly|evenly|distinctly|hoarsely|breathlessly|huskily|faintly|early|only|finally|family|lovely|friendly|lonely|likely|daily)\\b)[a-z]{2,}ly\\b`, 'gu'),
      reason: 'An -ly adverb on the tag may carry what the line should carry; adverbs of the act of speaking are fine.'
    },
    {
      id: 'fiction.impossible-tag', principle: 'fiction.said-bookism', sourcePages: '',
      expression: new RegExp(`${AFTER_SPEECH}${TAG_SUBJECT} (?:smiled|grinned|chuckled|grimaced|smirked|shrugged|nodded|frowned|beamed|laughed)\\b`, 'gu'),
      reason: 'The tag attributes speech to an action that cannot produce it; consider said, or a separate beat.'
    },
    {
      id: 'fiction.quoted-thought', principle: 'fiction.quoted-thought', sourcePages: '',
      expression: new RegExp(`${AFTER_SPEECH}${TAG_SUBJECT} (?:thought|wondered)\\b(?! aloud| out loud)`, 'gu'),
      reason: 'Unspoken thought is punctuated as speech.'
    }
  ],
  scanRules: [
    'This guide covers dialogue, speech attribution, exposition, point of view and psychic distance, scene staging and logic, and emotional honesty. Leave line-level clarity (dangling modifiers, ambiguous pronouns, jargon), diction, figures of speech and sentence-level immersion to other guides; do not report them here.',
    'Judge only this passage. Do not judge plot, structure, theme, pacing across chapters or continuity of facts with other parts of the book; another tool reviews those.',
    'Principles about distance, staging, motivation, explanation, sentimentality and frigidity apply to the narration; characters may speak as clumsily or as emotionally as they like.',
    'Read dialogue as speech: fragments, comma splices, contractions, slang, dialect and broken grammar in dialogue are natural and are never findings by themselves.',
    'For fiction.explained-emotion, quote the explaining words (the tag, the adverb or the sentence of explanation) and say what in the passage already shows the feeling. If nothing shows it, it is not fiction.explained-emotion.',
    'For fiction.pov-slip, name the established viewpoint character and the words that leave their perception. Do not report it in omniscient narration or when the viewpoint character could infer the thing from what they see or hear.',
    'Report fiction.repeated-effect and fiction.word-echo only when both occurrences are inside TEXT; quote the later, weaker one.',
    'Feeling in the narration is not telling by itself. Do not push a manuscript toward an emotional minimalism that does not fit it.'
  ],
  verifyRules: [
    'Reject fiction.explained-emotion unless the passage already shows the named emotion or meaning through dialogue, action or a beat.',
    'Reject fiction.pov-slip in omniscient narration, after a scene break, or when the viewpoint character could perceive or infer the reported thing.',
    'Reject findings that object to natural features of speech in dialogue: fragments, contractions, slang, dialect, interruptions, broken grammar.',
    'Reject fiction.psychic-distance-jump when the move is gradual, marked by a break, or free indirect discourse.',
    'Reject fiction.sentimentality and fiction.frigidity unless the quoted words themselves, not the subject matter, carry the fault.'
  ]
};

export const enClarity: Guide = {
  id: 'en-clarity', language: 'en', name: 'English clarity', version: '0.3.0', contextVersion: '0.3.0',
  source: 'docs/en-clarity-principles.md', prefix: 'clarity', minPrinciples: 16, narrationOnly: true,
  byline: 'sentence-level clarity principles selected for fiction',
  signals: [
    {
      id: 'clarity.empty-verb-noun', principle: 'clarity.hidden-action', sourcePages: '',
      expression: /\b(?:(?:conduct(?:ed|s|ing)?) (?:an? |the )?(?:investigation|examination|search|inspection)|(?:came|come|comes|coming) to (?:an |the )?(?:agreement|conclusion)|(?:gave|give|gives|giving) (?:some |serious )?consideration to|(?:took|take|takes|taking) into consideration|(?:was|were|is|are) in possession of|(?:put|puts|putting) in an appearance|(?:was|were|is|are) of the opinion that|(?:made|make|makes|making) contact with)\b/giu,
      reason: 'The action sits in a noun after an empty verb; check whether one verb would say it.'
    },
    {
      id: 'clarity.inflated-phrase', principle: 'clarity.inflated-phrase', sourcePages: '',
      expression: /\b(?:due to the fact that|owing to the fact that|in light of the fact that|despite the fact that|in spite of the fact that|in the event that|at this point in time|at the present time|for the purpose of|in regard to|with regard to|with reference to|until such time as|prior to)\b/giu,
      reason: 'A stock phrase where one word may do; keep it if the voice is deliberately formal.'
    },
    {
      id: 'clarity.redundant-pair', principle: 'clarity.redundancy', sourcePages: '',
      expression: /\b(?:each and every|first and foremost|full and complete|any and all|various and sundry|true facts|final outcome|past history|future plans|terrible tragedy|free gift|basic fundamentals|consensus of opinion|blar(?:ed|es|ing) loudly|screech(?:ed|es|ing) loudly|stumbl(?:ed|es|ing) awkwardly|utterly reject(?:ed|s)?|smil(?:ed|es|ing) happily|grinn(?:ed|ing) widely|clench(?:ed|es|ing)? (?:his|her|their|my|your|its) teeth tightly)\b/giu,
      reason: 'One word repeats what the other already says.'
    }
  ],
  scanRules: [
    'These principles come from plain-style editing for nonfiction. Apply them only to the narrator\'s own sentences. Do not report dialogue, a character\'s thoughts in their own idiom, free indirect discourse, or letters and documents inside the story.',
    'Never report a sentence because it is long, has a passive verb, starts with And or But, splits an infinitive or ends with a preposition.',
    'Report only failures of reading: the reader cannot tell who acted, what a modifier or pronoun attaches to, when something happened, or must hold too much before the verb. Concision for its own sake is not a finding.',
    'Leave dialogue, point of view, diction, figures of speech and rhythm to the other guides.'
  ],
  verifyRules: [
    'Reject a finding if the quoted sentence is a character\'s idiom or free indirect thought.',
    'For clarity.ambiguous-reference and clarity.misplaced-modifier require two grammatically possible readings with different meanings, both stated in the reason.',
    'For clarity.agentless-passive require that the scene needs to show the doer; reject descriptions of a state.'
  ]
};

export const enProseStyle: Guide = {
  id: 'en-prose-style', language: 'en', name: 'English prose style', version: '0.3.0', contextVersion: '0.3.0',
  source: 'docs/en-prose-style-principles.md', prefix: 'prose', minPrinciples: 18, narrationOnly: true,
  byline: 'principles of prose style and immersion: diction, figures, sound, rhythm, register, and sentences that keep the reader inside the story',
  signals: [
    {
      id: 'prose.dead-metaphor', principle: 'prose.stock-diction', sourcePages: '',
      expression: /\b(?:(?:leave|leaves|left|leaving) no stone unturned|raining cats and dogs|(?:a )?level playing field|on the fast track|the rat race|hue and cry|gild(?:ed|s|ing)? the lily|loud and clear|to(?:e|es|ed|eing) the line|nestled (?:in|among|between) the (?:hills|foothills|mountains|trees)|where old meets new|time stood still)\b/giu,
      reason: 'A dead metaphor or stock phrase in the narration; keep it if it is a character\'s voice or turned on purpose.'
    }
  ],
  scanRules: [
    'Slang, dialect, Creole, fragments, long sentences, repetition and sound play are legitimate when they work. Ask only whether a choice damages this passage, never whether it is standard.',
    'Narration only. Leave dialogue and character voice to en-fiction-editing, and clarity failures (modifiers, pronouns, jargon, qualifiers) to en-clarity.',
    'Report prose.monotonous-rhythm and prose.fragment-gimmick only when the passage gives no sign that the effect is intended. Polysyndeton, anaphora and incantatory repetition are intended effects.',
    'Real fiction has no rules, only things to watch out for. Report a break in immersion or a mannerism only when the passage shows no sign that it is deliberate.'
  ],
  verifyRules: [
    'Reject a finding whose objection is only that a word or construction is nonstandard, informal, rare, elaborate or plain.',
    'Reject prose.stock-diction when the phrase is turned, ironic, or the voice of a character in free indirect style.'
  ]
};

export const englishGuides = [enFictionEditing, enClarity, enProseStyle];
