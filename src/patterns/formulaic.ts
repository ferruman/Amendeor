import type { Book } from '../book.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { dialogueSpans } from '../text/dialogue.ts';

export const formulaicCatalogVersion = '0.3.0';
export const formulaicCatalogProvenance = 'docs/prose-patterns.md (local adaptation; see source and MIT license links); ../PROSE-TELLS.md (Wikipedia: Signs of AI writing, CC BY-SA 4.0)';
export interface FormulaicHit {
  id: string;
  language: string;
  provenance: string;
  chapter: string;
  scene: string;
  start: number;
  end: number;
  quote: string;
  reason: string;
}

// scope: каждое совпадение — сигнал; 'scene' — только если в сцене ≥ 3 разных слова из списка (одно слово
// случайно, кластер — признак); 'book' — только если книга повторяет жест чаще порога на 10 тыс. слов.
interface PatternDefinition { id: string; language: 'en' | 'ru'; expression: RegExp; reason: string; scope?: 'scene' | 'book' }

// Это узкие сигналы для проверки человеком, а не доказательство происхождения текста.
const patterns: PatternDefinition[] = [
  { id: 'formulaic.throat-clearing', language: 'en', expression: /\b(?:here['’]s the thing|let me be clear)(?=\b|[,:.!?])/giu, reason: 'Generic opening delays the point.' },
  { id: 'formulaic.faux-insight', language: 'en', expression: /\b(?:what nobody tells you|the part everyone misses)(?=\b|[,:.!?])/giu, reason: 'The setup claims special insight without adding it.' },
  { id: 'formulaic.importance-puffery', language: 'en', expression: /\b(?:(?:marks?|marking|marked) (?:a|the) (?:pivotal|turning|key|defining) (?:moment|point|shift)|(?:stands?|stood|serves?|served) as (?:a )?(?:testament|reminder) to|a testament to|(?:an )?indelible mark|play(?:s|ed|ing)? (?:a )?(?:pivotal|crucial|vital) role|setting the stage for)\b/giu, reason: 'The phrase labels importance instead of showing the event.' },
  { id: 'formulaic.participle-gloss', language: 'en', expression: /(?<=,\s)(?:highlighting|underscoring|emphasi[sz]ing|symboli[sz]ing|showcasing|fostering|cultivating)\b/giu, reason: 'A trailing -ing clause comments on the sentence instead of adding to it.' },
  { id: 'formulaic.copula-dodge', language: 'en', expression: /\b(?:serves|served|serving|functions|functioned) as (?:a|an|the)\b/giu, reason: 'A plain is/was would say the same.' },
  { id: 'formulaic.negative-parallel', language: 'en', expression: /\b(?:not (?:just|merely|simply) [^.!?;]{1,60}?,\s*but\b|n(?:o|['’])t (?:just |only |merely )?about [^.!?]{1,60}?[.;,—–]\s*(?:it|this|that)(?:['’]s| is| was) about\b)/giu, reason: 'The sentence corrects a misconception nobody voiced; the positive claim is enough.' },
  { id: 'formulaic.ai-vocabulary', language: 'en', scope: 'scene', expression: /\b(?:tapestr(?:y|ies)|testament|delv(?:e|es|ed|ing)|intricate(?:ly)?|intricacies|interplay|meticulous(?:ly)?|pivotal|underscor(?:e|es|ed|ing)|vibrant|bolster(?:s|ed|ing)?|garner(?:s|ed|ing)?|multifaceted)\b/giu, reason: 'Several words that models overuse cluster in one scene.' },
  { id: 'formulaic.filler-frame', language: 'en', expression: /\b(?:at the end of the day|in today['’]s world|it['’]s worth noting that|it is worth noting that|it(?:['’]s| is) important to (?:note|remember)|in summary|in conclusion)\b/giu, reason: 'A stock frame may add no information.' },
  { id: 'formulaic.chat-leak', language: 'en', expression: /\b(?:I hope this helps|here is the (?:scene|chapter|passage|revised|rewritten)|let me know if|would you like me to|as an AI(?: language model)?)\b|\[(?:insert|character name|placeholder)\b[^\]\n]{0,40}\]/giu, reason: 'Text addressed to a chatbot user, not prose.' },
  { id: 'formulaic.pause-beat', language: 'en', scope: 'book', expression: /\b(?:let (?:it|that|this|the (?:quiet|silence|words?|question|line)) (?:sit|hang|settle|land)|did(?:n['’]t| not) fill the (?:quiet|silence|pause)|(?:after |for )?a beat|for a (?:long )?(?:moment|second))\b/giu, reason: 'One dramatic move under different words: a line, then a held pause.' },
  { id: 'formulaic.the-way-simile', language: 'en', scope: 'book', expression: /\bthe way (?:a|an|people|someone|somebody|you|men|women|kids|anyone|everyone) [\p{L}'’]+/giu, reason: 'One move under different words: an observation explained by a small generic comparison.' },
  { id: 'formulaic.faux-insight', language: 'ru', expression: /(?:вот о чём никто не говорит|мало кто говорит о том, что)/giu, reason: 'Зачин обещает особое знание, не добавляя факта.' },
  { id: 'formulaic.importance-puffery', language: 'ru', expression: /(?:знаменует собой поворотный момент|служит ярким свидетельством|(?:стал|стало|стала|является) (?:ярким )?свидетельством|неизгладимый след|сыграл[аио]? (?:ключевую|важнейшую) роль)/giu, reason: 'Фраза объявляет событие важным вместо конкретного объяснения.' },
  { id: 'formulaic.participle-gloss', language: 'ru', expression: /(?<=,\s)(?:подчёркивая|подчеркивая|символизируя|демонстрируя)(?![\p{L}])/giu, reason: 'Деепричастный хвост комментирует фразу, ничего не добавляя.' },
  { id: 'formulaic.negative-parallel', language: 'ru', expression: /(?<![\p{L}])(?:не просто [^.!?;]{1,60}?, а|дело не в [^.!?;]{1,60}?, а в)(?![\p{L}])/giu, reason: 'Фраза опровергает мнение, которого никто не высказывал; хватит утверждения.' },
  { id: 'formulaic.ai-vocabulary', language: 'ru', scope: 'scene', expression: /(?<![\p{L}])(?:многогранн\p{L}*|неотъемлем\p{L}*|гобелен\p{L}*|погрузи(?:ться|лся|лась)|пронизан\p{L}*|уникальн\p{L}*|подчёркивает|подчеркивает)(?![\p{L}])/giu, reason: 'В одной сцене скопились слова, которые модели употребляют сверх меры.' },
  { id: 'formulaic.filler-frame', language: 'ru', expression: /(?:в современном мире|необходимо отметить, что|важно отметить, что|стоит отметить, что|подводя итог|в заключение)/giu, reason: 'Шаблонная рамка может не добавлять информации.' },
  { id: 'formulaic.chat-leak', language: 'ru', expression: /(?:надеюсь, это поможет|вот (?:сцена|глава|исправленный|переписанный)|дайте знать, если|как языковая модель|\[(?:вставить|имя персонажа)[^\]\n]{0,40}\])/giu, reason: 'Обращение к пользователю чат-бота, а не проза.' },
  { id: 'formulaic.pause-beat', language: 'ru', scope: 'book', expression: /(?<![\p{L}])(?:помолчал[аи]?|выдержал[аи]? паузу|повисл[аио] (?:тишина|пауза)|дал[аи]? (?:этому|словам|паузе|тишине) (?:повиснуть|повисеть|осесть|улечься))(?![\p{L}])/giu, reason: 'Один и тот же драматургический жест разными словами: реплика, затем пауза.' }
];

// ponytail: порог для жестов книги — по сравнению с Стивенсоном (pg43: «the way a…» 0,3 на 10 тыс. слов против
// 15,6 в Furnace Road); откалибровать по большему корпусу, если появится.
const bookGestureRate = 3, bookGestureMin = 5, sceneClusterDistinct = 3;
const words = (text: string) => text.match(/\p{L}+/gu)?.length ?? 0;

export function scanFormulaicProse(book: Book, pack: LanguagePack): FormulaicHit[] {
  const relevant = patterns.filter((pattern) => pattern.language === pack.language);
  const hits: FormulaicHit[] = [];
  for (const chapter of book.chapters) for (const scene of chapter.scenes) {
    const dialogue = dialogueSpans(scene.text, pack);
    const sceneHits: FormulaicHit[] = [];
    for (const pattern of relevant) {
      const found: FormulaicHit[] = [];
      for (const match of scene.text.matchAll(pattern.expression)) {
        const start = match.index!;
        const end = start + match[0].length;
        if (dialogue.some((span) => start < span.end && end > span.start)) continue;
        found.push({ id: pattern.id, language: pattern.language, provenance: formulaicCatalogProvenance, chapter: chapter.slug, scene: scene.id, start, end, quote: match[0], reason: pattern.reason });
      }
      if (pattern.scope === 'scene' && new Set(found.map((hit) => hit.quote.toLowerCase().slice(0, 5))).size < sceneClusterDistinct) continue;
      sceneHits.push(...found);
    }
    hits.push(...sceneHits.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)));
  }
  // Жест книги — не ошибка фразы: сигналом он становится, только когда книга повторяет его чаще порога.
  const total = book.chapters.reduce((sum, chapter) => sum + words(chapter.text), 0) || 1;
  const bookScoped = new Set(relevant.filter((pattern) => pattern.scope === 'book').map((pattern) => pattern.id));
  const counts = new Map<string, number>();
  for (const hit of hits) if (bookScoped.has(hit.id)) counts.set(hit.id, (counts.get(hit.id) ?? 0) + 1);
  return hits.flatMap((hit) => {
    if (!bookScoped.has(hit.id)) return [hit];
    const count = counts.get(hit.id)!, rate = count * 10000 / total;
    if (count < bookGestureMin || rate < bookGestureRate) return [];
    const note = pack.language === 'ru' ? `В книге ${count} раз (${rate.toFixed(1)} на 10 тыс. слов); оставьте те, что несут сцену.` : `${count} times in this book (${rate.toFixed(1)} per 10k words); keep the ones that carry the scene.`;
    return [{ ...hit, reason: `${hit.reason} ${note}` }];
  });
}
