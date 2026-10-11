import { z } from 'zod';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { parseModelJson } from '../provider/json.ts';
import { SpendRefused } from '../provider/meter.ts';
import { necessityContextPrompt, necessityContextPromptVersion, necessityPrompt, necessityPromptVersion, verifyPrompt, verifyPromptVersion } from '../prompts/verify.ts';

const answerSchema = z.object({ preserved: z.boolean(), reason: z.string() });
// Оба поля обязательны: ответ без одного из них — сбой проверки, а не молчаливое согласие.
const necessitySchema = z.object({ necessary: z.boolean(), preserved: z.boolean(), reason: z.string() });
const objectiveAnswerSchema = z.object({ necessary: z.boolean(), reason: z.string() });
// failure: проверка не состоялась — verifier ответил не по схеме и после повтора, или вызов не дошёл (provider). Это не
// редакторское решение: такая правка не «отклонена», а не проверена.
export type VerifyFailure = 'verifier' | 'provider';
export interface VerifyResult { passed: boolean; passes: number; agreed: number; reason: string; sameFamily: boolean; answers?: Array<{ necessary?: boolean; preserved: boolean }>; failure?: VerifyFailure }

// Один вызов verifier с одним повтором на ответ не по схеме (как у редактора в edit/pass.ts). Отказ в тратах не ловится:
// он останавливает весь прогон. Сбой провайдера уже повторён в Gateway.
async function ask<T>(gateway: Gateway, stage: string, system: string, prompt: string, schema: z.ZodType<T>): Promise<T> {
  try { return schema.parse(parseModelJson((await gateway.complete(stage, 'verify', system, prompt, 240)).text)); }
  catch (error) {
    if (!(error instanceof z.ZodError || error instanceof SyntaxError)) throw error;
    const retry = `${prompt}\n\nYOUR PREVIOUS ANSWER WAS INVALID (${error.message.replace(/\s+/gu, ' ').slice(0, 300)}). Return JSON only, with every field.`;
    return schema.parse(parseModelJson((await gateway.complete(stage + '-retry', 'verify', system, retry, 240)).text));
  }
}
function failureOf(error: unknown): { failure: VerifyFailure; message: string } {
  if (error instanceof SpendRefused) throw error;
  return { failure: error instanceof z.ZodError || error instanceof SyntaxError ? 'verifier' : 'provider', message: error instanceof Error ? error.message : String(error) };
}
export async function verifyObjectiveCorrection(before: string, after: string, context: string, category: string, config: Config, cache: Cache, gateway: Gateway): Promise<{ passed: boolean; reason: string; failure?: VerifyFailure }> {
  const profile = config.profiles.verify;
  if (!profile) return { passed: false, reason: 'verify profile missing' };
  const key = { before, after, context, category, profile, provider: config.providers[profile.provider], promptVersion: 'objective-1' };
  let answer = await cache.read<z.infer<typeof objectiveAnswerSchema>>('verify-objective', key);
  if (!answer) {
    const system = 'You are an independent literary proofreader. Is BEFORE objectively incorrect in context, and is AFTER needed to correct it? Preserve historical spelling, partitive forms, dialect, character voice and authorial punctuation. An uncommon but valid form is not an error. For commas, require a specific syntactic rule. Optional modernization, preference and uncertainty mean necessary false. Return JSON only: {"necessary":boolean,"reason":"brief rule or reason to preserve"}.';
    const prompt = ['CATEGORY:', category, 'BEFORE:', before, 'AFTER:', after, 'SURROUNDING PARAGRAPH:', context].join('\n\n');
    try {
      answer = await ask(gateway, 'verify-objective', system, prompt, objectiveAnswerSchema);
      await cache.write('verify-objective', key, answer);
    } catch (error) { const { failure, message } = failureOf(error); return { passed: false, reason: 'objective verify failed: ' + message, failure }; }
  }
  return { passed: answer.necessary, reason: answer.reason || (answer.necessary ? 'necessary' : 'not necessary') };
}
export async function verifyMeaning(before: string, after: string, context: string, impact: 'mechanical' | 'prose', config: Config, pack: LanguagePack, cache: Cache, gateway: Gateway, options: { necessity?: boolean; context?: unknown; minPasses?: number } = {}): Promise<VerifyResult> {
  const profile = config.profiles.verify;
  if (!profile) return { passed: false, passes: 0, agreed: 0, reason: 'verify profile missing', sameFamily: false };
  const editFamily = config.profiles.edit?.family ?? config.providers[config.profiles.edit?.provider ?? '']?.family;
  const verifyFamily = profile.family ?? config.providers[profile.provider]?.family;
  const sameFamily = Boolean(editFamily && verifyFamily && editFamily === verifyFamily);
  const passes = Math.max(options.minPasses ?? 0, profile.passes ?? (impact === 'prose' ? 3 : 1));
  const necessity = Boolean(options.necessity);
  const schema = necessity ? necessitySchema : answerSchema;
  let agreed = 0; const answers: Array<{ necessary?: boolean; preserved: boolean }> = [];
  for (let index = 0; index < passes; index++) {
    // Контекст входит в ключ кэша: тот же текст с другим профилем сохранения — другой вопрос.
    const withContext = necessity && options.context !== undefined;
    const key = { before, after, context, profile, provider: config.providers[profile.provider], promptVersion: withContext ? necessityContextPromptVersion : necessity ? necessityPromptVersion : verifyPromptVersion, index, ...(withContext ? { editorial: options.context } : {}) };
    let answer = await cache.read<{ necessary?: boolean; preserved: boolean; reason: string }>(necessity ? 'verify-necessity' : 'verify', key);
    if (!answer) {
      const prompt = withContext ? necessityContextPrompt(before, after, context, options.context) : (necessity ? necessityPrompt : verifyPrompt)(before, after, context);
      try {
        answer = await ask<{ necessary?: boolean; preserved: boolean; reason: string }>(gateway, 'verify', prompt.system, prompt.prompt, schema);
        await cache.write(necessity ? 'verify-necessity' : 'verify', key, answer);
      } catch (error) { const { failure, message } = failureOf(error); return { passed: false, passes: index + 1, agreed, reason: 'verify failed: ' + message, sameFamily, answers, failure }; }
    }
    answers.push(necessity ? { necessary: answer.necessary, preserved: answer.preserved } : { preserved: answer.preserved });
    // Решение выводится из полей, а не из текста причины: принять можно только необходимую и сохраняющую правку.
    if (!answer.preserved) return { passed: false, passes: index + 1, agreed, reason: 'not preserved: ' + (answer.reason || 'meaning not preserved'), sameFamily, answers };
    if (necessity && !answer.necessary) return { passed: false, passes: index + 1, agreed, reason: 'unnecessary: ' + (answer.reason || 'no objective error'), sameFamily, answers };
    agreed++;
  }
  return { passed: true, passes, agreed, reason: necessity ? 'necessary and preserved' : 'preserved', sameFamily, answers };
}
