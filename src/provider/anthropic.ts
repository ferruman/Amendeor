import { postJson } from './http.ts';
import { ProviderError, type Provider, type CompletionRequest, type Completion } from './types.ts';

export class AnthropicProvider implements Provider {
  async complete(request: CompletionRequest): Promise<Completion> {
    if (!request.apiKey) throw new ProviderError('http', false, 'Anthropic API key missing');
    const endpoint = request.endpoint ?? 'https://api.anthropic.com/v1/messages';
    const openRouter = new URL(endpoint).hostname === 'openrouter.ai';
    const headers: Record<string, string> = openRouter ? { authorization: 'Bearer ' + request.apiKey } : { 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' };
    const result = await postJson(endpoint, {
      model: request.model, max_tokens: request.maxTokens, temperature: request.temperature ?? 0,
      system: request.system, messages: [{ role: 'user', content: request.prompt }],
      thinking: request.thinking ? { type: 'enabled', budget_tokens: 1024 } : { type: 'disabled' }
    }, headers, request.timeoutMs);
    const body = result.body;
    const kinds = Array.isArray(body.content) ? body.content.map((item: any) => item.type) : [];
    const output = Array.isArray(body.content) ? body.content.filter((item: any) => item.type === 'text').map((item: any) => item.text ?? '').join('') : '';
    const stop = String(body.stop_reason ?? 'unknown');
    if (stop === 'max_tokens') throw new ProviderError('truncated', true, 'Anthropic output truncated at budget ' + request.maxTokens + '; stop_reason=' + stop + '; blocks=' + kinds.join(','));
    if (!output) throw new ProviderError('refused', false, 'Anthropic returned no text; stop_reason=' + stop + '; blocks=' + kinds.join(','));
    return { text: output, finishReason: stop, usage: { input_tokens: Number(body.usage?.input_tokens ?? 0), output_tokens: Number(body.usage?.output_tokens ?? 0) }, ms: result.ms, diagnostics: 'blocks=' + kinds.join(',') };
  }
}
