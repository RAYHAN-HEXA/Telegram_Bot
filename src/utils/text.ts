import type { JobType } from '../types.js';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  deg: '°',
  pound: '£',
  euro: '€',
  sect: '§',
  raquo: '»',
  laquo: '«',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
  ordm: 'º',
  acute: '´',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Convert any HTML (possibly double-escaped, as found in RSS feeds) to
 * clean plain text.
 */
export function stripHtml(input: string | undefined): string {
  let text = input ?? '';
  for (let i = 0; i < 4; i += 1) {
    const hadTags = /<[a-z/!][^>]*>/i.test(text);
    const hadEntities = /&[#a-z0-9]+;/i.test(text);
    if (!hadTags && !hadEntities) break;

    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|ul|ol|tr|h[1-6]|blockquote|section|article|table)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text);
    text = text.replace(/\s+/g, ' ');
  }
  return text.trim();
}

export function collapseWhitespace(input: string): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, max: number): string {
  const text = collapseWhitespace(input);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function escapeHtml(input: string): string {
  return (input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TRACKING_PARAMS = /^(utm_|ref$|refid$|trackingid$|source$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$)/i;

/** Canonical form of a URL used for cross-source de-duplication. */
export function normalizeUrl(raw: string): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    const drop: string[] = [];
    url.searchParams.forEach((_v, key) => {
      if (TRACKING_PARAMS.test(key)) drop.push(key);
    });
    drop.forEach((key) => url.searchParams.delete(key));
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    const query = url.searchParams.toString();
    return `${url.protocol}//${url.hostname}${path}${query ? `?${query}` : ''}`;
  } catch {
    return value;
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Keyword matches that respect word boundaries ("react" matches "React.js"). */
export function findMatches(text: string, keywords: string[]): string[] {
  const haystack = (text ?? '').toLowerCase();
  const found: string[] = [];
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    if (!needle) continue;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const before = index === 0 ? '' : haystack[index - 1] ?? '';
      const after = haystack[index + needle.length] ?? '';
      const startOk = /^[a-z0-9]/.test(needle) ? !/[a-z0-9]/.test(before) : true;
      const endOk = /[a-z0-9]$/.test(needle) ? !/[a-z0-9]/.test(after) : true;
      if (startOk && endOk) {
        found.push(keyword);
        break;
      }
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  return found;
}

export function hasKeyword(text: string, keywords: string[]): boolean {
  return findMatches(text, keywords).length > 0;
}

export function inferJobType(text: string): JobType {
  const value = (text ?? '').toLowerCase();
  if (/\binternship\b|\binterns?\b|\btrainee\b|\btraineeship\b/.test(value)) return 'internship';
  if (/\bpart[-\s]?time\b|\bparttime\b/.test(value)) return 'part-time';
  if (/\bfull[-\s]?time\b|\bfulltime\b/.test(value)) return 'full-time';
  if (/\bfreelance\b|\bfreelancer\b/.test(value)) return 'freelance';
  if (/\bcontract\b|\bcontractor\b|\bcontract[-\s]?to[-\s]hire\b/.test(value)) return 'contract';
  if (/\btemporary\b|\btemp(?:orary)?[-\s]role\b/.test(value)) return 'temporary';
  return 'unknown';
}

/** Stable short id used for de-duplication across runs. */
export function hashId(input: string): string {
  let hash = 0x811c9dc5;
  const value = input || '';
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function uniquePush(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}
