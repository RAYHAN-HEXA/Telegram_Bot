import type { RawJob } from '../../types.js';
import { fetchJson } from '../../utils/http.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';

const ENDPOINT = 'https://remotive.com/api/remote-jobs';
const TIMEOUT_MS = 25_000;

interface RemotiveJob {
  id: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

/** Remotive: free public remote-job API (software development category). */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const data = await fetchJson<RemotiveResponse>(ENDPOINT, { timeoutMs: timeoutMs || TIMEOUT_MS });
  const jobs: RawJob[] = [];

  for (const item of data.jobs ?? []) {
    if (!item?.title || !item.url) continue;
    const description = stripHtml(item.description ?? '');
    const location = item.candidate_required_location ?? '';
    const typeText = `${item.job_type ?? ''} ${truncate(description, 400)}`;

    jobs.push({
      source: 'remotive',
      sourceId: String(item.id ?? item.url),
      title: item.title.trim(),
      company: (item.company_name ?? 'Unknown').trim(),
      url: item.url,
      location: location.trim(),
      description,
      tags: (item.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      jobType: inferJobType(typeText),
      salary: item.salary?.trim() || undefined,
      postedAt: item.publication_date,
      remoteBySource: true,
    });
  }

  return jobs;
}
