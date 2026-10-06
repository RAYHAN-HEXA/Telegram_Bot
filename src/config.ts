import dotenv from 'dotenv';
import type { JobType } from './types.js';

dotenv.config();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Everything about the job hunt lives here.
 * Edit these lists to change what the bot looks for - see README
 * section "How to change job requirements later".
 */
export const REQUIREMENTS = {
  /** Maximum jobs sent per morning. */
  maxJobs: 50,

  /** Jobs older than this are rejected outright (days). Fresh jobs are
   *  still preferred: selection is fresh-first, so older jobs are only ever
   *  used to fill the quota. */
  maxAgeDays: 14,

  /** "Fresh" window used by the fresh-first selection rule (hours). */
  freshWindowHours: 48,

  /** Discard jobs scoring below this (0-100). Keep 0 to disable. */
  minScore: 0,

  /** Accept contract / freelance / temporary roles as well? */
  allowContract: false,

  /** Job types accepted when the source reports one. */
  allowedJobTypes: ['full-time', 'part-time', 'internship'] as JobType[],

  /**
   * Relevance gate: a job is kept when the title looks like a dev role, or
   * when at least two of these keywords appear in title + location + tags +
   * description (a single stray "css" inside a marketing post is not enough).
   */
  techKeywords: [
    'mern',
    'react',
    'react.js',
    'reactjs',
    'next.js',
    'nextjs',
    'typescript',
    'javascript',
    'node.js',
    'nodejs',
    'express.js',
    'express',
    'full stack',
    'fullstack',
    'front end',
    'frontend',
    'front-end',
    'web developer',
    'web development',
    'software engineer',
    'software developer',
    'vue',
    'angular',
    'html',
    'css',
    'jquery',
    'svelte',
    'nest.js',
    'graphql',
    'mongo',
    'mongodb',
  ],

  /** Bonus stack: +10 when one of these matches (scoring). */
  stackKeywords: [
    'mern',
    'mern stack',
    'react',
    'react.js',
    'reactjs',
    'next.js',
    'nextjs',
    'typescript',
    'javascript',
    'node.js',
    'nodejs',
    'express.js',
    'express',
  ],

  /** +4 when the title matches one of these (scoring). */
  preferredTitles: [
    'junior mern',
    'mern stack developer',
    'junior full stack',
    'full stack developer',
    'junior frontend',
    'junior front end',
    'front end developer',
    'frontend developer',
    'react developer',
    'next.js developer',
    'nextjs developer',
    'typescript developer',
    'node.js developer',
    'nodejs developer',
    'software engineer',
    'frontend engineer',
    'web developer',
    'junior developer',
    'junior software',
    'intern',
  ],

  /**
   * Title / level words that mark a job as NOT junior.
   * Matched against title + source level field only.
   */
  seniorTitleKeywords: [
    'senior',
    'sr.',
    'sr ',
    'snr',
    'lead',
    'principal',
    'staff',
    'architect',
    'head of',
    'chief',
    'director',
    'manager',
    'vice president',
    'vp ',
    'evp',
    'cto',
    'internship coordinator',
  ],

  /**
   * Geo markers that restrict where applicants may be located.
   * Matched against the location field. Bangladesh is in Asia, so
   * "asia" / "apac" are treated as eligible, not restricted.
   */
  restrictedRegions: [
    'united states',
    'usa',
    'u.s.',
    'u.s.a.',
    'us only',
    'america',
    'north america',
    'south america',
    'canada',
    'united kingdom',
    'uk',
    'great britain',
    'britain',
    'europe',
    'european union',
    'eu',
    'germany',
    'france',
    'netherlands',
    'spain',
    'italy',
    'portugal',
    'poland',
    'ireland',
    'switzerland',
    'austria',
    'belgium',
    'sweden',
    'norway',
    'denmark',
    'finland',
    'greece',
    'czech republic',
    'romania',
    'japan',
    'singapore',
    'hong kong',
    'china',
    'south korea',
    'taiwan',
    'new zealand',
    'australia',
    'uae',
    'dubai',
    'saudi arabia',
    'israel',
    'south africa',
    'nigeria',
    'kenya',
    'brazil',
    'mexico',
    'argentina',
    'chile',
    'colombia',
    'peru',
    'turkey',
    'russia',
    'ukraine',
    'philippines',
    'indonesia',
    'vietnam',
    'malaysia',
    'thailand',
    'sri lanka',
    'nepal',
    'pakistan',
    'latin america',
    'latam',
    'emea',
    'mena',
    'oceania',
    'africa',
  ],

  /** Location words that mean "anyone can apply, including Bangladesh". */
  worldwideKeywords: [
    'worldwide',
    'world-wide',
    'world wide',
    'anywhere',
    'global',
    'globally',
    'all countries',
    'all locations',
    'across the globe',
    'across the world',
    'work from anywhere',
    'remote, worldwide',
    'international',
    'internationally',
    'multinational',
    'asia',
    'apac',
    'indo-pacific',
  ],
};

export interface AppConfig {
  telegramToken: string;
  telegramChatId: string;
  dryRun: boolean;
  maxJobs: number;
  storageFile: string;
  timezone: string;
  sendDelayMs: number;
  sourceTimeoutMs: number;
}

export class ConfigError extends Error {}

export function loadConfig(argv: string[] = process.argv): AppConfig {
  const dryRun =
    bool(process.env.DRY_RUN, false) ||
    argv.includes('--dry-run') ||
    argv.includes('--dryrun');

  const telegramToken = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const telegramChatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();

  if (!dryRun) {
    const missing: string[] = [];
    if (!telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
    if (!telegramChatId) missing.push('TELEGRAM_CHAT_ID');
    if (missing.length > 0) {
      throw new ConfigError(
        `Missing required environment variable(s): ${missing.join(', ')}. ` +
          'Fill in .env (copy .env.example) or run with --dry-run.',
      );
    }
  }

  const envLimit = int(process.env.MAX_JOBS, REQUIREMENTS.maxJobs);

  return {
    telegramToken,
    telegramChatId,
    dryRun,
    maxJobs: Math.max(1, Math.min(envLimit, 100)),
    storageFile: process.env.STORAGE_FILE?.trim() || './data/posted-jobs.json',
    timezone: process.env.TIMEZONE?.trim() || 'Asia/Dhaka',
    sendDelayMs: int(process.env.TELEGRAM_SEND_DELAY_MS, 1200),
    sourceTimeoutMs: int(process.env.SOURCE_TIMEOUT_MS, 20000),
  };
}
