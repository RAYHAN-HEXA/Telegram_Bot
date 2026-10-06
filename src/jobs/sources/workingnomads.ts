import type { RawJob } from '../../types.js';
import { fetchJson } from '../../utils/http.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';

const ENDPOINT = 'https://www.workingnomads.com/api/exposed_jobs';
const TIMEOUT_MS = 25_000;

interface WorkingNomadsJob {
  url?: string;
  title?: string;
  description?: string;
  company_name?: string;
  category_name?: string;
  tags?: string;
  location?: string;
  pub_date?: string;
}

/** Working Nomads: public JSON feed of remote jobs (no key required). */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const data = await fetchJson<WorkingNomadsJob[]>(ENDPOINT, { timeoutMs: timeoutMs || TIMEOUT_MS });
  const jobs: RawJob[] = [];

  for (const item of Array.isArray(data) ? data : []) {
    if (!item?.title || !item.url) continue;
    const description = stripHtml(item.description ?? '');
    const tags = (item.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    jobs.push({
      source: 'workingnomads',
      sourceId: item.url,
      title: item.title.trim(),
      company: (item.company_name ?? 'Unknown').trim(),
      url: item.url,
      location: (item.location ?? '').trim(),
      description,
      tags: [...tags, item.category_name ?? ''].filter(Boolean),
      jobType: inferJobType(`${item.title} ${tags.join(' ')} ${truncate(description, 400)}`),
      postedAt: item.pub_date,
      remoteBySource: true,
    });
  }

  return jobs;
}
