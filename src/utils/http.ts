import { logger } from './logger.js';

export const USER_AGENT = 'RayhanJobAlertBot/1.0 (personal job alert; contact: github issues)';

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt(url: string, options: HttpOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...options.headers },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** GET a URL as text with timeout + retry on network errors / 429 / 5xx. */
export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let i = 0; i <= retries; i += 1) {
    try {
      const res = await attempt(url, options);

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** i;
        lastError = new Error(`HTTP ${res.status} from ${hostOf(url)}`);
        if (i < retries) {
          logger.warn(`Rate limited/unavailable (${res.status}) on ${hostOf(url)}, retrying in ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${hostOf(url)}`);
      }

      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        const waitMs = 800 * 2 ** i;
        logger.warn(`Request to ${hostOf(url)} failed (${(err as Error).message}), retrying in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${hostOf(url)}`);
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}
