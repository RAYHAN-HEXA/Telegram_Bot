import type { RawJob } from '../../types.js';
import { fetchJson } from '../../utils/http.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';

const BASE = 'https://jobicy.com/api/v2/remote-jobs';
const TIMEOUT_MS = 30_000;

interface JobicyJob {
  id?: number | string;
  url?: string;
  jobSlug?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  salaryCurrency?: string;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

function formatSalary(job: JobicyJob): string | undefined {
  const min = Number(job.annualSalaryMin ?? 0);
  const max = Number(job.annualSalaryMax ?? 0);
  if (!min && !max) return undefined;
  const currency = job.salaryCurrency || 'USD';
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  if (min && max) return `${symbol}${min.toLocaleString()} - ${symbol}${max.toLocaleString()} / year`;
  if (min) return `From ${symbol}${min.toLocaleString()} / year`;
  return `Up to ${symbol}${max.toLocaleString()} / year`;
}

function mapJob(item: JobicyJob): RawJob | undefined {
  if (!item?.jobTitle || !item.url) return undefined;
  const description = stripHtml(item.jobDescription ?? item.jobExcerpt ?? '');
  const tags = [...(item.jobIndustry ?? []), ...(item.jobType ?? [])]
    .map((tag) => String(tag).trim())
    .filter(Boolean);

  return {
    source: 'jobicy',
    sourceId: String(item.id ?? item.jobSlug ?? item.url),
    title: item.jobTitle.trim(),
    company: (item.companyName ?? 'Unknown').trim(),
    url: item.url,
    location: (item.jobGeo ?? '').trim(),
    description,
    tags,
    jobType: inferJobType(`${(item.jobType ?? []).join(' ')} ${item.jobTitle} ${truncate(description, 300)}`),
    salary: formatSalary(item),
    postedAt: item.pubDate,
    level: item.jobLevel?.trim() || undefined,
    remoteBySource: true,
  };
}

/** Jobicy: free public API, up to 200 remote jobs per request. */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const data = await fetchJson<JobicyResponse>(`${BASE}?count=200`, { timeoutMs: timeoutMs || TIMEOUT_MS });
  const jobs: RawJob[] = [];
  for (const item of data.jobs ?? []) {
    const mapped = mapJob(item);
    if (mapped) jobs.push(mapped);
  }
  return jobs;
}
