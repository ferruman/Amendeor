import { z } from 'zod';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { Cache } from '../cache.ts';
import { Gateway } from '../provider/gateway.ts';
import { verifyPrompt, verifyPromptVersion } from '../prompts/verify.ts';

const answerSchema = z.object({ preserved: z.boolean(), reason: z.string() });
export interface VerifyResult { passed: boolean; passes: number; agreed: number; reason: string; sameFamily: boolean }
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
