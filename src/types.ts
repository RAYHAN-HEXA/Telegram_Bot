export type JobType =
  | 'full-time'
  | 'part-time'
  | 'internship'
  | 'contract'
  | 'freelance'
  | 'temporary'
  | 'unknown';

export interface RawJob {
  /** Source identifier, e.g. "remotive", "remoteok". */
  source: string;
  /** Job id inside the source (usually the source's own id/slug). */
  sourceId: string;
  title: string;
  company: string;
  url: string;
  /** Location / geo field. May contain "Remote", "Worldwide", "India", ... */
  location: string;
  /** Plain text description (HTML already stripped by the collector). */
  description: string;
  tags: string[];
  jobType: JobType;
  salary?: string;
  /** ISO-8601 publication date when the source provides one. */
  postedAt?: string;
  /** Seniority level reported by the source ("Junior", "Senior", ...). */
  level?: string;
  /** True when the source only lists remote jobs. */
  remoteBySource: boolean;
}

export interface ScoredJob extends RawJob {
  /** Normalised match score, 0-100 (this is what the message shows). */
  score: number;
  /** Raw weighted points before normalisation (can be negative). */
  points: number;
  /** Human readable scoring signals, used by the dry-run report. */
  signals: string[];
  /** Parsed publication date, when available. */
  postedDate?: Date;
  /** Age in hours, when available. */
  ageHours?: number;
}

export interface SourceOutcome {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface CollectionResult {
  jobs: RawJob[];
  outcomes: SourceOutcome[];
}

export interface EligibilityResult {
  ok: boolean;
  /** Rejection reason(s); empty when ok === true. */
  reasons: string[];
}

export interface MessageChunk {
  text: string;
  /** `scored` indices contained in this chunk (used for de-dup bookkeeping). */
  jobIndices: number[];
}
