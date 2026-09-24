import { ProviderError } from './types.ts';

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs = 60000, fetcher: typeof fetch = fetch): Promise<{ status: number; body: any; ms: number }> {
  const controller = new AbortController(); const started = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ProviderError('schema', false, 'invalid JSON response, status ' + response.status); }
    if (!response.ok) {
      const detail = parsed as { error?: { type?: string; message?: string }; metadata?: { headers?: Record<string, string> } };
      const reset = Number(response.headers?.get('x-ratelimit-reset') ?? detail.metadata?.headers?.['X-RateLimit-Reset']);
      const retryAfter = Number(response.headers?.get('retry-after'));
      const retryAfterMs = response.status === 429
        ? Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() + 500
          : Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000
        : undefined;
      const diagnosis = `HTTP ${response.status}: ${detail.error?.type ?? 'error'}: ${detail.error?.message ?? 'provider request failed'}`;
      throw new ProviderError('http', response.status === 429 || response.status >= 500, diagnosis, retryAfterMs);
    }
    return { status: response.status, body: parsed, ms: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError('timeout', true, 'request or response body exceeded ' + timeoutMs + 'ms');
    throw new ProviderError('network', true, error instanceof Error ? error.message : String(error));
  } finally { clearTimeout(timer); }
}
