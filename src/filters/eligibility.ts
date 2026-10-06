import { REQUIREMENTS } from '../config.js';
import type { EligibilityResult, RawJob } from '../types.js';
import { ageHours, parseDate } from '../utils/date.js';
import { findMatches } from '../utils/text.js';

type Requirements = typeof REQUIREMENTS;

const REMOTE_RE = /\b(remote|work(?:ing)? from home|wfh|distributed|telecommut\w*)\b/i;
const ONSITE_RE = /\b(on[-\s]?site|onsite|in[-\s]?office|hybrid|on[-\s]?premises|on[-\s]?client site)\b/i;
const SENIOR_TITLE_RE =
  /\b(senior|sr\.|sr|snr|lead|principal|staff(?!\s+augmentation)|architect|head of|chief|director|manager|vice president|vp|cto|cio|evp)\b/i;
/** Signals in the *title* that mean the source's level field can be ignored. */
const JUNIOR_TITLE_RE =
  /\b(junior|entry[-\s]?level|intern(ship)?|trainee|graduate|graduat\w*|new grad|associate|apprentice|fresher)\b/i;
/** A title that clearly is a software development role. */
const TECH_TITLE_RE =
  /\b(developer|engineer|engineering|programming|programmer|devops|full[\s-]?stack|front[\s-]?end|back[\s-]?end|web[\s-]?(?:app|development|developer)|software|react|next\.?js|node\.?js|typescript|javascript|vue|angular|svelte|mern|mean|coder)\b/i;

/** "N+ years" / "N years of experience" requirements that signal a non-junior role. */
const YEARS_PLUS_RE = /\b([4-9]|\d{2})\+\s*(?:years|yrs)\b/gi;
const YEARS_EXPERIENCE_RE =
  /\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*(?:years|yrs)\s*(?:of\s+)?(?:professional\s+|industry\s+|relevant\s+|hands[-\s]?on\s+|applicable\s+)*experience\b/gi;
const YEARS_CONTEXT_RE =
  /(?:require\w*|minimum|at\s+least|must\s+have|needs?\s+|looking\s+for|ideally|want\w*|expect\w*|seek\w*|prefer\w*|possess\w*)[^.]{0,60}?\b([4-9]|\d{2})\s*\+?\s*(?:years|yrs)/gi;

/** Geo restrictions that are only visible in the description text. */
const STRONG_GEO_PATTERNS: Array<[RegExp, string]> = [
  [/\bindia[-\s]only\b|only\s+(?:in|within)\s+india\b|based\s+in\s+india\b|india[-\s]based\b|location:\s*india\b/i, 'India'],
  [/\b(?:usa|us|uk|canada|europe|india|australia|germany)[-\s]only\b/i, ''],
  // German-language ads ("m/w/d", "Deutschland") are almost always DACH-only.
  [/\b(?:m\/w\/d|m\/f\/d|w\/m\/d|d\/w\/m)\b/i, 'Germany (DACH)'],
  [/\bDeutschland\b|\bGerman(?:y)?[-\s](?:based|only|office|team|market)\b/i, 'Germany'],
  [
    /\b(?:must|should|required|need|have|expected)\s+(?:to\s+be\s+)?(?:based|located|residing|living|situated)\s+(?:in|within)\s+([A-Za-z][A-Za-z .,'-]{1,40})/,
    '',
  ],
  [
    /\b(?:candidates|applicants|developers|engineers|talents?|professionals)\s+(?:from|in)\s+(?:the\s+)?([A-Z][A-Za-z .,'-]{1,40})/,
    '',
  ],
  [/\b(?:within|inside)\s+(?:the\s+)?(?:germany|europe|usa|united states|india|uk|canada)\b/i, ''],
  [/\b(?:remote|work(?:ing)?|role|position)\s+(?:within|in|from)\s+(?:the\s+)?(?:Germany|France|Spain|Italy|Poland|Portugal|Netherlands|Turkey|Brazil|Mexico|Canada)\b/i, ''],
];

function escapePhrase(phrase: string): string {
  return phrase
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

/** Word-boundary aware phrase match ("uk" must not match "ukulele"). */
export function containsPhrase(text: string, phrase: string, caseInsensitive = true): boolean {
  if (!text || !phrase) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapePhrase(phrase)}([^a-z0-9]|$)`, caseInsensitive ? 'i' : '');
  return pattern.test(text);
}

export function containsAnyPhrase(text: string, phrases: string[]): string | undefined {
  for (const phrase of phrases) {
    if (containsPhrase(text, phrase)) return phrase;
  }
  return undefined;
}

/**
 * True when the location says the job is open worldwide (or explicitly to
 * Bangladesh), which is what we need for a Bangladesh-based applicant.
 */
export function isWorldwide(job: RawJob, req: Requirements = REQUIREMENTS): boolean {
  const marker = containsAnyPhrase(job.location, [...req.worldwideKeywords, 'bangladesh']);
  return Boolean(marker);
}

/** Regions/countries the location field locks the job to (e.g. "India", "US only"). */
export function restrictedRegions(job: RawJob, req: Requirements = REQUIREMENTS): string[] {
  const location = job.location;
  if (!location) return [];

  const found: string[] = [];
  if (/\b(?:US|USA|U\.S\.A?\.?|United States)\b/.test(location)) found.push('USA');
  if (containsPhrase(location, 'america') || containsPhrase(location, 'americas')) found.push('Americas');

  for (const region of req.restrictedRegions) {
    if (region === 'usa' || region === 'america' || region === 'north america' || region === 'south america') continue;
    if (containsPhrase(location, region)) found.push(region);
  }

  return [...new Set(found)];
}

function strongGeoFromDescription(job: RawJob): { region: string } | undefined {
  const text = `${job.title} ${job.description}`.slice(0, 4000);
  for (const [pattern, fallback] of STRONG_GEO_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const region = (match[1] ?? fallback).trim();
    if (region) return { region };
  }
  return undefined;
}

function seniorYearsRequirement(job: RawJob): boolean {
  const text = `${job.title} ${job.description}`.slice(0, 8000);
  const check = (match: RegExpExecArray): boolean => {
    const values = match.slice(1).filter(Boolean).map(Number);
    return values.some((value) => Number.isFinite(value) && value >= 4);
  };

  YEARS_PLUS_RE.lastIndex = 0;
  YEARS_EXPERIENCE_RE.lastIndex = 0;
  YEARS_CONTEXT_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = YEARS_EXPERIENCE_RE.exec(text)) !== null) {
    if (check(match)) return true;
  }
  while ((match = YEARS_PLUS_RE.exec(text)) !== null) {
    if (check(match)) return true;
  }
  while ((match = YEARS_CONTEXT_RE.exec(text)) !== null) {
    if (check(match)) return true;
  }
  return false;
}

/**
 * The single place where a job is accepted or rejected.
 * Uses title + location + experience requirements + description, not just
 * the title.
 */
export function checkEligibility(job: RawJob, req: Requirements = REQUIREMENTS): EligibilityResult {
  const reject = (reason: string): EligibilityResult => ({ ok: false, reasons: [reason] });

  if (!job.title || !job.url) return reject('missing-fields');

  // --- remote / onsite -------------------------------------------------
  const geoText = `${job.location} ${job.title}`;
  if (!job.remoteBySource && !REMOTE_RE.test(geoText)) return reject('not-remote');
  if (ONSITE_RE.test(geoText)) return reject('onsite');

  // --- seniority (title + level + experience requirements) -------------
  // Sources sometimes mislabel a "Financial Operations Intern" as Senior, so
  // an explicit junior title always wins over the source's level field.
  const seniorText = JUNIOR_TITLE_RE.test(job.title) ? job.title : `${job.title} ${job.level ?? ''}`;
  const seniorKeyword = SENIOR_TITLE_RE.exec(seniorText);
  if (seniorKeyword) return reject(`senior-role:${(seniorKeyword[1] ?? 'senior').trim()}`);
  if (seniorYearsRequirement(job)) return reject('senior-experience');

  // --- geography -------------------------------------------------------
  const worldwide = isWorldwide(job, req);
  if (!worldwide) {
    if (containsPhrase(job.location, 'india')) return reject('geo-restricted:India');

    const regions = restrictedRegions(job, req);
    if (regions.length > 0) return reject(`geo-restricted:${regions[0]}`);

    const strong = strongGeoFromDescription(job);
    if (strong) return reject(`geo-restricted:${strong.region}`);
  }

  // --- job type --------------------------------------------------------
  if (job.jobType !== 'unknown') {
    if (!req.allowedJobTypes.includes(job.jobType)) {
      if (job.jobType === 'contract' || job.jobType === 'freelance' || job.jobType === 'temporary') {
        if (!req.allowContract) return reject(`job-type:${job.jobType}`);
      } else {
        return reject(`job-type:${job.jobType}`);
      }
    }
  }

  // --- recency ---------------------------------------------------------
  const posted = parseDate(job.postedAt);
  const hours = ageHours(posted);
  if (hours !== undefined && hours > req.maxAgeDays * 24) return reject('too-old');

  // --- relevance gate (title + location + tags + description) ----------
  const haystack = `${job.title} ${job.location} ${job.tags.join(' ')} ${job.description}`;
  const techMatches = findMatches(haystack, req.techKeywords);
  const devTitle = TECH_TITLE_RE.test(job.title);
  if (!devTitle && techMatches.length < 2) return reject('no-relevant-tech-keyword');

  return { ok: true, reasons: [] };
}

/** Count rejections by reason for the dry-run report. */
export function summarizeRejections(results: EligibilityResult[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.ok) continue;
    const reason = result.reasons[0] ?? 'unknown';
    const key = reason.startsWith('geo-restricted:')
      ? 'geo-restricted'
      : reason.startsWith('job-type:')
        ? 'job-type'
        : reason.startsWith('senior-role:')
          ? 'senior-role'
          : reason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
