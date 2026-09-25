import { z } from 'zod';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { verifyPrompt, verifyPromptVersion } from '../prompts/verify.ts';

const answerSchema = z.object({ preserved: z.boolean(), reason: z.string() });
const objectiveAnswerSchema = z.object({ necessary: z.boolean(), reason: z.string() });
export interface VerifyResult { passed: boolean; passes: number; agreed: number; reason: string; sameFamily: boolean }
export async function verifyObjectiveCorrection(before: string, after: string, context: string, category: string, config: Config, cache: Cache, gateway: Gateway): Promise<{ passed: boolean; reason: string }> {
  const profile = config.profiles.verify;
  if (!profile) return { passed: false, reason: 'verify profile missing' };
  const key = { before, after, context, category, profile, provider: config.providers[profile.provider], promptVersion: 'objective-1' };
  let answer = await cache.read<z.infer<typeof objectiveAnswerSchema>>('verify-objective', key);
  if (!answer) {
    const system = 'You are an independent literary proofreader. Is BEFORE objectively incorrect in context, and is AFTER needed to correct it? Preserve historical spelling, partitive forms, dialect, character voice and authorial punctuation. An uncommon but valid form is not an error. For commas, require a specific syntactic rule. Optional modernization, preference and uncertainty mean necessary false. Return JSON only: {"necessary":boolean,"reason":"brief rule or reason to preserve"}.';
    const prompt = ['CATEGORY:', category, 'BEFORE:', before, 'AFTER:', after, 'SURROUNDING PARAGRAPH:', context].join('\n\n');
    try {
      const output = await gateway.complete('verify-objective', 'verify', system, prompt, 240);
      answer = objectiveAnswerSchema.parse(JSON.parse(output.text));
      await cache.write('verify-objective', key, answer);
    } catch (error) { return { passed: false, reason: 'objective verify failed: ' + (error instanceof Error ? error.message : String(error)) }; }
  }
  return { passed: answer.necessary, reason: answer.reason || (answer.necessary ? 'necessary' : 'not necessary') };
}
export async function verifyMeaning(before: string, after: string, context: string, impact: 'mechanical' | 'prose', config: Config, pack: LanguagePack, cache: Cache, gateway: Gateway): Promise<VerifyResult> {
  const profile = config.profiles.verify;
  if (!profile) return { passed: false, passes: 0, agreed: 0, reason: 'verify profile missing', sameFamily: false };
  const editFamily = config.profiles.edit?.family ?? config.providers[config.profiles.edit?.provider ?? '']?.family;
  const verifyFamily = profile.family ?? config.providers[profile.provider]?.family;
  const sameFamily = Boolean(editFamily && verifyFamily && editFamily === verifyFamily);
  const passes = profile.passes ?? (impact === 'prose' ? 3 : 1);
  let agreed = 0;
  for (let index = 0; index < passes; index++) {
    const key = { before, after, context, profile, provider: config.providers[profile.provider], promptVersion: verifyPromptVersion, index };
    let answer = await cache.read<z.infer<typeof answerSchema>>('verify', key);
    if (!answer) {
      const prompt = verifyPrompt(before, after, context);
      try {
        const output = await gateway.complete('verify', 'verify', prompt.system, prompt.prompt, 240);
        answer = answerSchema.parse(JSON.parse(output.text));
        await cache.write('verify', key, answer);
      } catch (error) { return { passed: false, passes: index + 1, agreed, reason: 'verify failed: ' + (error instanceof Error ? error.message : String(error)), sameFamily }; }
    }
    if (!answer.preserved) return { passed: false, passes: index + 1, agreed, reason: answer.reason || 'meaning not preserved', sameFamily };
    agreed++;
  }
  return { passed: true, passes, agreed, reason: 'preserved', sameFamily };
}
