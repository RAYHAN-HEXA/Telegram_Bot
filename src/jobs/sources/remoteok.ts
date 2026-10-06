import type { RawJob } from '../../types.js';
import { fetchJson } from '../../utils/http.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';

const ENDPOINT = 'https://remoteok.com/api';
const TIMEOUT_MS = 25_000;

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  position?: string;
  company?: string;
  tags?: string[];
  location?: string;
  date?: string;
  epoch?: number;
  url?: string;
  apply_url?: string;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  remote?: boolean;
  legal?: string;
}

function formatSalary(job: RemoteOkJob): string | undefined {
  const min = Number(job.salary_min ?? 0);
  const max = Number(job.salary_max ?? 0);
  if (!min && !max) return undefined;
  if (min && max) return `$${min.toLocaleString()} - $${max.toLocaleString()} / year`;
  if (min) return `From $${min.toLocaleString()} / year`;
  return `Up to $${max.toLocaleString()} / year`;
}

/** RemoteOK: public JSON feed of remote jobs (attribution required by their ToS). */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const data = await fetchJson<RemoteOkJob[]>(ENDPOINT, { timeoutMs: timeoutMs || TIMEOUT_MS });
  const jobs: RawJob[] = [];

  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item !== 'object') continue;
    // The first element is a legal notice object, not a job.
    if (item.legal || !item.position) continue;

    const description = stripHtml(item.description ?? '');
    const url = item.url || item.apply_url || '';
    if (!url) continue;

    jobs.push({
      source: 'remoteok',
      sourceId: String(item.id ?? item.slug ?? url),
      title: String(item.position).trim(),
      company: (item.company ?? 'Unknown').trim(),
      url,
      location: (item.location ?? '').trim(),
      description,
      tags: (item.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
      jobType: inferJobType(`${item.position ?? ''} ${(item.tags ?? []).join(' ')} ${truncate(description, 300)}`),
      salary: formatSalary(item),
      postedAt: item.date ?? (item.epoch ? String(item.epoch) : undefined),
      remoteBySource: true,
    });
  }

  return jobs;
}
