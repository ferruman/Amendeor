import { readFile } from 'node:fs/promises';
import { ProviderError, type Provider, type CompletionRequest, type Completion } from './types.ts';

export class LocalProvider implements Provider {
  private script?: (request: CompletionRequest) => Promise<string> | string;
  constructor(script?: (request: CompletionRequest) => Promise<string> | string) { this.script = script; }
  async complete(request: CompletionRequest): Promise<Completion> {
    let output: string;
    if (this.script) output = await this.script(request);
    else if (request.endpoint) {
      const fixture = JSON.parse(await readFile(request.endpoint, 'utf8')) as { default?: string; responses?: Record<string, string> };
      output = fixture.responses?.[request.model] ?? fixture.default ?? '{"edits":[]}';
    } else output = '{"edits":[]}';
    if (!output) throw new ProviderError('refused', false, 'local script returned empty output');
    return { text: output, finishReason: 'stop', usage: { input_tokens: Math.ceil((request.system.length + request.prompt.length) / 4), output_tokens: Math.ceil(output.length / 4) }, ms: 0 };
  }
}
