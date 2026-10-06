import type { CollectionResult, RawJob, SourceOutcome } from '../types.js';
import { SOURCES } from './sources/index.js';
import { logger, redact } from '../utils/logger.js';
import { collapseWhitespace, normalizeUrl, stripHtml, truncate } from '../utils/text.js';

/** Merge description variants and clean what the sources returned. */
function normalise(job: RawJob): RawJob {
  return {
    ...job,
    title: collapseWhitespace(job.title),
    company: collapseWhitespace(job.company) || 'Unknown',
    location: collapseWhitespace(job.location),
    description: truncate(stripHtml(job.description), 6000),
    tags: job.tags.map((tag) => collapseWhitespace(tag)).filter(Boolean),
    url: normalizeUrl(job.url),
  };
}

/** Drop jobs that appear more than once (same URL, or same title+company). */
export function dedupe(jobs: RawJob[]): RawJob[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: RawJob[] = [];

  for (const job of jobs) {
    const urlKey = normalizeUrl(job.url ?? '');
    const titleKey = `${(job.title ?? '').toLowerCase()}::${(job.company ?? '').toLowerCase()}`;
    if (urlKey && seenUrls.has(urlKey)) continue;
    if (seenTitles.has(titleKey)) continue;
    if (urlKey) seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    result.push(job);
  }
  return result;
}

/**
 * Run every source in parallel. One failing source never aborts the run -
 * its error is recorded and the remaining sources still contribute.
 */
export async function collectJobs(timeoutMs: number): Promise<CollectionResult> {
  const outcomes: SourceOutcome[] = [];
  const collected: RawJob[][] = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const jobs = await source.fetch(timeoutMs);
        outcomes.push({ name: source.name, ok: true, count: jobs.length });
        logger.info(`source ${source.name}: ${jobs.length} job(s)`);
        return jobs;
      } catch (err) {
        const message = redact(err instanceof Error ? err.message : String(err));
        outcomes.push({ name: source.name, ok: false, count: 0, error: message });
        logger.warn(`source ${source.name} failed: ${message} (continuing with other sources)`);
        return [] as RawJob[];
      }
    }),
  );

  const merged = collected.flat().map(normalise);
  const jobs = dedupe(merged);

  if (jobs.length !== merged.length) {
    logger.info(`de-duplicated ${merged.length - jobs.length} duplicate job(s)`);
  }

  // Keep outcomes ordered like SOURCES regardless of completion order.
  const order = new Map(SOURCES.map((source, index) => [source.name, index]));
  outcomes.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));

  return { jobs, outcomes };
}
