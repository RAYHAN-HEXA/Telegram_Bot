import { REQUIREMENTS } from '../config.js';
import type { RawJob, ScoredJob } from '../types.js';
import { ageHours, parseDate } from '../utils/date.js';
import { findMatches } from '../utils/text.js';
import { containsPhrase, isWorldwide } from './eligibility.js';

type Requirements = typeof REQUIREMENTS;

/**
 * Point values. Positive weights are normalised to 0-100 (MAX_POINTS), so the
 * Telegram "Match Score" is always displayed out of 100.
 */
export const WEIGHTS = {
  junior: 10,
  remote: 10,
  worldwide: 10,
  remoteGeoUnspecified: 6,
  stack: 10,
  internship: 8,
  fullStack: 8,
  fresh24h: 5,
  fresh48h: 3,
  preferredTitle: 4,
  senior: -30,
  lead: -30,
  manager: -30,
  indiaOnly: -30,
  onsite: -20,
} as const;

export const MAX_POINTS =
  WEIGHTS.junior +
  WEIGHTS.remote +
  WEIGHTS.worldwide +
  WEIGHTS.stack +
  WEIGHTS.internship +
  WEIGHTS.fullStack +
  WEIGHTS.fresh24h +
  WEIGHTS.preferredTitle;

const JUNIOR_RE =
  /\b(junior|jun\.|entry[-\s]?level|beginner|intern(ship)?|internship|trainee|graduate|graduat\w*|new grad|associate|apprentice|fresher)\b|\b0\s*[-–]\s*(?:1|2)\s*years\b|\b0\s*(?:to|-)\s*(?:1|2)\s*years\b/i;
const FULL_STACK_RE = /\bfull[-\s]?stack\b|\bmean stack\b|\bmern stack\b/i;
const SENIOR_RE = /\b(senior|sr\.|sr|snr|principal|staff(?!\s+augmentation)|architect)\b/i;
const LEAD_RE = /\blead\b|\btech lead\b|\blead engineer\b/i;
const MANAGER_RE = /\b(manager|director|head of|chief|vice president|vp|cto|cio)\b/i;
const ONSITE_RE = /\b(on[-\s]?site|onsite|in[-\s]?office|hybrid)\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ScoreOptions {
  now?: Date;
  req?: Requirements;
}

/** Score one job and return a normalised 0-100 value plus its signals. */
export function scoreJob(job: RawJob, options: ScoreOptions = {}): ScoredJob {
  const req = options.req ?? REQUIREMENTS;
  const now = options.now ?? new Date();

  const postedDate = parseDate(job.postedAt);
  const hours = ageHours(postedDate, now);
  const titleAndLevel = `${job.title} ${job.level ?? ''}`;
  // A junior title overrides a (sometimes wrong) source level field.
  const seniorSource = JUNIOR_RE.test(job.title) ? job.title : titleAndLevel;
  const fullText = `${job.title} ${job.location} ${job.tags.join(' ')} ${job.description}`;
  const signals: string[] = [];
  let points = 0;

  // --- positives -------------------------------------------------------
  if (JUNIOR_RE.test(titleAndLevel) || JUNIOR_RE.test(job.description.slice(0, 1200))) {
    points += WEIGHTS.junior;
    signals.push(`+${WEIGHTS.junior} junior / entry level`);
  }

  points += WEIGHTS.remote;
  signals.push(`+${WEIGHTS.remote} remote`);

  if (isWorldwide(job, req)) {
    points += WEIGHTS.worldwide;
    signals.push(`+${WEIGHTS.worldwide} worldwide / Bangladesh eligible`);
  } else {
    points += WEIGHTS.remoteGeoUnspecified;
    signals.push(`+${WEIGHTS.remoteGeoUnspecified} remote (location not restricted)`);
  }

  const stackMatches = findMatches(fullText, req.stackKeywords);
  if (stackMatches.length > 0) {
    points += WEIGHTS.stack;
    signals.push(`+${WEIGHTS.stack} stack: ${[...new Set(stackMatches)].slice(0, 4).join(', ')}`);
  }

  if (job.jobType === 'internship') {
    points += WEIGHTS.internship;
    const paid = /paid/i.test(job.title) || Boolean(job.salary) || /paid internship/i.test(job.description.slice(0, 800));
    signals.push(`+${WEIGHTS.internship} ${paid ? 'paid internship' : 'internship'}`);
  }

  if (FULL_STACK_RE.test(fullText)) {
    points += WEIGHTS.fullStack;
    signals.push(`+${WEIGHTS.fullStack} full stack`);
  }

  if (hours !== undefined && hours >= 0 && hours <= 24) {
    points += WEIGHTS.fresh24h;
    signals.push(`+${WEIGHTS.fresh24h} posted within 24h`);
  } else if (hours !== undefined && hours >= 0 && hours <= req.freshWindowHours) {
    points += WEIGHTS.fresh48h;
    signals.push(`+${WEIGHTS.fresh48h} posted within 48h`);
  }

  const preferred = findMatches(job.title, req.preferredTitles);
  if (preferred.length > 0) {
    points += WEIGHTS.preferredTitle;
    signals.push(`+${WEIGHTS.preferredTitle} preferred title: ${preferred[0]}`);
  }

  // --- negatives -------------------------------------------------------
  if (SENIOR_RE.test(seniorSource)) {
    points += WEIGHTS.senior;
    signals.push(`${WEIGHTS.senior} senior role`);
  }
  if (LEAD_RE.test(seniorSource)) {
    points += WEIGHTS.lead;
    signals.push(`${WEIGHTS.lead} lead role`);
  }
  if (MANAGER_RE.test(seniorSource)) {
    points += WEIGHTS.manager;
    signals.push(`${WEIGHTS.manager} management role`);
  }
  if (containsPhrase(job.location, 'india')) {
    points += WEIGHTS.indiaOnly;
    signals.push(`${WEIGHTS.indiaOnly} India-only`);
  }
  if (ONSITE_RE.test(job.location) || ONSITE_RE.test(job.title)) {
    points += WEIGHTS.onsite;
    signals.push(`${WEIGHTS.onsite} onsite / hybrid`);
  }

  const score = clamp(Math.round((points / MAX_POINTS) * 100), 0, 100);

  const result: ScoredJob = {
    ...job,
    score,
    points,
    signals,
  };
  if (postedDate) result.postedDate = postedDate;
  if (hours !== undefined) result.ageHours = hours;
  return result;
}

export function scoreJobs(jobs: RawJob[], options: ScoreOptions = {}): ScoredJob[] {
  return jobs.map((job) => scoreJob(job, options));
}

/** score desc -> newest first -> title. */
export function byScore(a: ScoredJob, b: ScoredJob): number {
  if (b.points !== a.points) return b.points - a.points;
  const aAge = a.ageHours ?? Number.POSITIVE_INFINITY;
  const bAge = b.ageHours ?? Number.POSITIVE_INFINITY;
  if (aAge !== bAge) return aAge - bAge;
  return a.title.localeCompare(b.title);
}

/**
 * Fresh-first selection: never fill the daily quota with old jobs when enough
 * jobs from the last `freshWindowHours` exist.
 */
export function selectTopJobs(scored: ScoredJob[], maxJobs: number, freshWindowHours: number): ScoredJob[] {
  const sorted = [...scored].sort(byScore);
  const isFresh = (job: ScoredJob): boolean => job.ageHours === undefined || job.ageHours <= freshWindowHours;

  const fresh = sorted.filter(isFresh);
  const older = sorted.filter((job) => !isFresh(job));

  if (fresh.length >= maxJobs) return fresh.slice(0, maxJobs);
  return [...fresh, ...older].slice(0, maxJobs);
}
