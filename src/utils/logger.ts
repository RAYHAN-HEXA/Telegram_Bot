type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Strip anything that looks like a Telegram bot token out of log output. */
export function redact(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input);
  return text
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/g, '[REDACTED_TOKEN]')
    .replace(/bot\d{6,12}:[A-Za-z0-9_-]{25,}/gi, 'bot[REDACTED_TOKEN]');
}

function write(level: Level, args: unknown[]): void {
  const time = new Date().toISOString();
  const line = args
    .map((a) => redact(typeof a === 'string' ? a : a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a)))
    .join(' ');
  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  fn(`[${time}] ${level.padEnd(5)} ${line}`);
}

export const logger = {
  debug: (...args: unknown[]) => write('DEBUG', args),
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
  success: (...args: unknown[]) => write('INFO', ['✅', ...args]),
};
