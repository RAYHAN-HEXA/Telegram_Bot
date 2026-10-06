import { logger, redact } from '../utils/logger.js';
import { sleep } from '../utils/date.js';

export class TelegramError extends Error {
  readonly statusCode?: number;
  readonly retryAfter?: number;

  constructor(message: string, statusCode?: number, retryAfter?: number) {
    super(message);
    this.name = 'TelegramError';
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

interface ApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  parameters?: { retry_after?: number };
}

/**
 * Thin Bot API client: native fetch, HTML parse mode, bounded retries with
 * backoff and strict respect for Telegram's retry_after.
 * The token is never written to the logs.
 */
export class TelegramBot {
  private readonly token: string;
  private readonly chatId: string;
  private readonly delayMs: number;
  private readonly apiBase: string;

  constructor(
    token: string,
    chatId: string,
    delayMs = 1200,
    apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org',
  ) {
    this.token = token;
    this.chatId = chatId;
    this.delayMs = delayMs;
    this.apiBase = apiBase.replace(/\/+$/, '');
  }

  private endpoint(method: string): string {
    return `${this.apiBase}/bot${this.token}/${method}`;
  }

  async sendMessage(text: string): Promise<void> {
    const attempts = 4;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(this.endpoint('sendMessage'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            link_preview_options: { is_disabled: true },
          }),
        });
      } catch (err) {
        lastError = err;
        if (attempt < attempts - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        break;
      }

      let body: ApiResponse;
      try {
        body = (await response.json()) as ApiResponse;
      } catch {
        body = { ok: false, description: `invalid JSON response (HTTP ${response.status})` };
      }

      if (body.ok) return;

      const description = body.description ?? `HTTP ${response.status}`;
      const retryAfter = body.parameters?.retry_after;
      const retryable = response.status === 429 || response.status >= 500;

      if (!retryable || attempt === attempts - 1) {
        throw new TelegramError(description, response.status, retryAfter);
      }

      const waitSeconds = retryAfter !== undefined ? retryAfter + 1 : 2 ** attempt;
      logger.warn(`Telegram ${response.status}: ${description} - retrying in ${waitSeconds}s`);
      await sleep(waitSeconds * 1000);
    }

    throw lastError instanceof Error
      ? new TelegramError(redact(lastError.message))
      : new TelegramError('Telegram request failed');
  }

  /** Send every chunk with a politeness delay; returns how many succeeded. */
  async sendMessages(texts: string[]): Promise<number> {
    let sent = 0;
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      if (!text) continue;
      await this.sendMessage(text);
      sent += 1;
      logger.info(`telegram message ${i + 1}/${texts.length} sent (${text.length} chars)`);
      if (i < texts.length - 1) await sleep(this.delayMs);
    }
    return sent;
  }
}
