import { postJson } from './http.ts';
import { ProviderError, type Provider, type CompletionRequest, type Completion } from './types.ts';

export class OpenAIProvider implements Provider {
  async complete(request: CompletionRequest): Promise<Completion> {
    if (!request.apiKey) throw new ProviderError('http', false, 'OpenAI-compatible API key missing');
    const endpoint = request.endpoint ?? 'https://api.openai.com/v1/chat/completions';
    const native = new URL(endpoint).hostname === 'api.openai.com';
    const supportsNone = /^gpt-(?:5\.(?:[1-9]\d*)|6)(?:$|[-.])/u.test(request.model);
    const reasoningOptions = native ? (supportsNone ? { reasoning_effort: request.reasoning ? 'medium' : 'none' } : {}) : { reasoning: { enabled: request.reasoning ?? false } };
    const result = await postJson(endpoint, {
      model: request.model, temperature: request.temperature ?? 0, max_tokens: request.maxTokens,
      ...reasoningOptions,
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }]
    }, { authorization: 'Bearer ' + request.apiKey }, request.timeoutMs);
    const choice = result.body.choices?.[0]; const finish = String(choice?.finish_reason ?? 'unknown');
    const content = choice?.message?.content;
    if (finish === 'length' || content === null) throw new ProviderError('truncated', true, 'OpenAI-compatible output truncated at budget ' + request.maxTokens + '; finish_reason=' + finish + '; content=' + (content === null ? 'null' : typeof content));
    if (typeof content !== 'string' || !content.trim()) throw new ProviderError('refused', false, 'OpenAI-compatible output empty; finish_reason=' + finish);
    return { text: content, finishReason: finish, usage: { input_tokens: Number(result.body.usage?.prompt_tokens ?? 0), output_tokens: Number(result.body.usage?.completion_tokens ?? 0) }, ms: result.ms };
  }
}
