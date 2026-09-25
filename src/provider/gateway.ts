import { readFile } from 'node:fs/promises';
import type { Config } from '../config.ts';
import type { LanguagePack } from '../lang/pack.ts';
import { AnthropicProvider } from './anthropic.ts';
import { OpenAIProvider } from './openai.ts';
import { LocalProvider } from './local.ts';
import { ProviderError, type Provider, type Completion, type CompletionRequest } from './types.ts';

export interface LedgerEntry { stage: string; provider: string; model: string; tokens_in: number; tokens_out: number; cost: number | null; currency: string | null; ms: number; budget: number; error?: string }
export class Gateway {
  readonly ledger: LedgerEntry[] = [];
  private charsPerToken: number;
  private nextOpenRouterRequestAt = 0;
  private config: Config; private env: NodeJS.ProcessEnv; private transports: Partial<Record<'anthropic' | 'openai' | 'local', Provider>>;
  constructor(config: Config, pack: LanguagePack, env: NodeJS.ProcessEnv = process.env, transports: Partial<Record<'anthropic' | 'openai' | 'local', Provider>> = {}) {
    this.config = config; this.env = env; this.transports = transports; this.charsPerToken = pack.chars_per_token;
  }
  async complete(stage: string, profileName: string, system: string, prompt: string, expectedChars: number): Promise<Completion> {
    const profile = this.config.profiles[profileName]; if (!profile) throw new Error('profile ' + profileName + ' missing');
    const providerConfig = this.config.providers[profile.provider]; if (!providerConfig) throw new Error('provider ' + profile.provider + ' missing');
    const provider = this.transports[providerConfig.transport] ?? (providerConfig.transport === 'anthropic' ? new AnthropicProvider() : providerConfig.transport === 'openai' ? new OpenAIProvider() : new LocalProvider());
    const apiKey = providerConfig.api_key ?? (providerConfig.api_key_env ? this.env[providerConfig.api_key_env] : undefined) ?? (providerConfig.api_key_file ? (await readFile(providerConfig.api_key_file, 'utf8')).trim() : undefined);
    const budget = Math.max(profile.thinking ? 2048 : 256, Math.ceil(expectedChars / this.charsPerToken * 1.25));
    const request: CompletionRequest = { system, prompt, model: profile.model, maxTokens: budget, temperature: profile.temperature ?? 0, endpoint: providerConfig.endpoint, apiKey, thinking: profile.thinking, reasoning: profile.reasoning };
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (providerConfig.transport !== 'local' && providerConfig.endpoint && new URL(providerConfig.endpoint).hostname === 'openrouter.ai') {
        const slot = Math.max(Date.now(), this.nextOpenRouterRequestAt);
        this.nextOpenRouterRequestAt = slot + 3500;
        const waitMs = slot - Date.now();
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      const started = performance.now();
      try {
        const result = await provider.complete(request);
        const inputChars = system.length + prompt.length;
        if (result.usage.input_tokens > 0) this.charsPerToken = inputChars / result.usage.input_tokens;
        const price = providerConfig.price;
        this.ledger.push({ stage, provider: profile.provider, model: profile.model, tokens_in: result.usage.input_tokens, tokens_out: result.usage.output_tokens,
          cost: price ? (result.usage.input_tokens * price.input_per_m + result.usage.output_tokens * price.output_per_m) / 1_000_000 : null,
          currency: price?.currency ?? null, ms: result.ms, budget });
        return result;
      } catch (error) {
        last = error;
        this.ledger.push({ stage, provider: profile.provider, model: profile.model, tokens_in: 0, tokens_out: 0, cost: null, currency: providerConfig.price?.currency ?? null, ms: Math.round(performance.now() - started), budget: request.maxTokens, error: error instanceof ProviderError ? error.kind + ': ' + error.diagnosis : String(error) });
        if (!(error instanceof ProviderError) || !error.retryable || attempt === 2) break;
        if (error.kind === 'truncated') request.maxTokens *= 2;
        await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs ?? 100 * 2 ** attempt));
      }
    }
    throw last;
  }
}
