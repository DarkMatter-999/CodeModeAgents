import { isAbortError } from '@ai-sdk/provider-utils';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export function parseRetryAfter(value: string): number | undefined {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const ms = new Date(trimmed).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export function computeRetryDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  config: RetryConfig
): number {
  if (
    retryAfterMs !== undefined &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    return Math.min(retryAfterMs, config.maxDelayMs);
  }
  let delay = Math.min(config.baseDelayMs * 2 ** attempt, config.maxDelayMs);
  if (config.jitter) {
    delay *= 0.75 + Math.random() * 0.5;
  }
  return delay;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function withRetry(
  fetchImpl: typeof fetch,
  config: RetryConfig
): typeof fetch {
  return async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await fetchImpl(input, init);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (attempt >= config.maxRetries) throw error;
        attempt++;
        await sleep(computeRetryDelayMs(attempt - 1, undefined, config));
        continue;
      }
      const shouldRetry =
        response.status === 429 ||
        (response.status >= 500 && response.status < 600);
      if (!shouldRetry || attempt >= config.maxRetries) {
        return response;
      }
      const retryAfterMs = parseRetryAfter(
        response.headers.get('retry-after') ?? ''
      );
      attempt++;
      await sleep(computeRetryDelayMs(attempt - 1, retryAfterMs, config));
    }
  };
}

export function getRetryConfig(): RetryConfig {
  return {
    maxRetries: Number(process.env.RETRY_MAX_RETRIES ?? 5),
    baseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS ?? 500),
    maxDelayMs: Number(process.env.RETRY_MAX_DELAY_MS ?? 30_000),
    jitter: true,
  };
}
