import type { MessageChunk, ScoredJob } from '../types.js';
import { dateLabel, relativeTime } from '../utils/date.js';
import { escapeHtml, truncate } from '../utils/text.js';

const SEPARATOR = '━━━━━━━━━━━━━━━━';
const KEYCAP = '\uFE0F\u20E3';
const MAX_CHUNK = 3900; // Telegram limit is 4096 chars, leave headroom.
const FOCUS = 'Remote + Junior + MERN/React/Next.js/TypeScript';

export function numberEmoji(value: number): string {
  if (value === 10) return '\u{1F51F}';
  return String(value)
    .split('')
    .map((digit) => `${digit}${KEYCAP}`)
    .join('');
}

function typeLabel(job: ScoredJob): string {
  switch (job.jobType) {
    case 'full-time':
      return 'Full-time';
    case 'part-time':
      return 'Part-time';
    case 'internship':
      return /paid/i.test(job.title) || Boolean(job.salary) ? 'Paid internship' : 'Internship';
    case 'contract':
      return 'Contract';
    case 'freelance':
      return 'Freelance';
    case 'temporary':
      return 'Temporary';
    default:
      return 'Not specified';
  }
}

function jobBlock(job: ScoredJob, position: number, now: Date): string {
  const title = escapeHtml(truncate(job.title, 80));
  const company = escapeHtml(truncate(job.company, 70));
  const location = escapeHtml(job.location || 'Remote');
  const salary = escapeHtml(job.salary ?? 'Not listed');
  const posted = relativeTime(job.postedDate, now);
  const href = /^https?:\/\//i.test(job.url) ? escapeHtml(job.url) : '';

  const lines = [
    `${numberEmoji(position)} <b>${title}</b>`,
    '',
    `🏢 Company: ${company}`,
    `🌍 Location: ${location}`,
    `💼 Type: ${typeLabel(job)}`,
    `💰 Salary: ${salary}`,
    `🕒 Posted: ${posted}`,
    '',
    `⭐ Match Score: <b>${job.score}/100</b>`,
    '',
  ];

  lines.push(href ? `🔗 <a href="${href}">Apply</a>` : '🔗 Apply: (link unavailable)');
  return lines.join('\n');
}

export interface MessageMeta {
  now: Date;
  timezone: string;
  /** Total unique jobs collected from all sources. */
  collected: number;
  /** Jobs that passed the eligibility filter. */
  eligible: number;
}

function header(meta: MessageMeta): string {
  return [`🔥 DAILY REMOTE JOBS`, `📅 ${dateLabel(meta.now, meta.timezone)}`, ''].join('\n');
}

function footer(count: number): string {
  return ['', SEPARATOR, '', `📊 Total jobs: ${count}`, `🎯 Focus: ${FOCUS}`].join('\n');
}

/**
 * Split the digest into chunks that fit inside Telegram's 4096 char limit.
 * Every chunk carries the job indices it contains so the caller can mark
 * exactly those jobs as posted.
 */
export function buildMessages(jobs: ScoredJob[], meta: MessageMeta): MessageChunk[] {
  const now = meta.now;

  if (jobs.length === 0) {
    const text = `${header(meta)}${SEPARATOR}\n\n😕 No new jobs matched your filters today.\n\n📊 Total jobs: 0\n🎯 Focus: ${FOCUS}`;
    return [{ text, jobIndices: [] }];
  }

  const chunks: MessageChunk[] = [];
  let current = header(meta);
  let currentIndices: number[] = [];

  const flush = (nextText = ''): void => {
    chunks.push({ text: current, jobIndices: currentIndices });
    current = nextText;
    currentIndices = [];
  };

  jobs.forEach((job, index) => {
    const block = `\n${SEPARATOR}\n\n${jobBlock(job, index + 1, now)}\n`;
    if (current.length + block.length > MAX_CHUNK) {
      flush('🔥 DAILY REMOTE JOBS (continued)\n');
    }
    current += block;
    currentIndices.push(index);
  });

  const end = footer(jobs.length);
  if (current.length + end.length > MAX_CHUNK) {
    flush();
    current = end;
  } else {
    current += end;
  }
  flush();

  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}
