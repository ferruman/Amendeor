export type ProviderErrorKind = 'network' | 'timeout' | 'http' | 'truncated' | 'refused' | 'schema';
export class ProviderError extends Error {
  kind: ProviderErrorKind; retryable: boolean; diagnosis: string; retryAfterMs?: number;
  constructor(kind: ProviderErrorKind, retryable: boolean, diagnosis: string, retryAfterMs?: number) { super(diagnosis); this.name = 'ProviderError'; this.kind = kind; this.retryable = retryable; this.diagnosis = diagnosis; this.retryAfterMs = retryAfterMs; }
}
export interface CompletionRequest { system: string; prompt: string; model: string; maxTokens: number; temperature?: number; timeoutMs?: number; apiKey?: string; endpoint?: string; thinking?: boolean; reasoning?: boolean }
export interface Completion { text: string; finishReason: string; usage: { input_tokens: number; output_tokens: number }; ms: number; diagnostics?: string }
export interface Provider { complete(request: CompletionRequest): Promise<Completion> }
