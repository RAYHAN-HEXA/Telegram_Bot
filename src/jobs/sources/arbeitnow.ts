import type { RawJob } from '../../types.js';
import { fetchJson } from '../../utils/http.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';
import { sleep } from '../../utils/date.js';

const BASE = 'https://www.arbeitnow.com/api/job-board-api';
const PAGES = [1, 2, 3, 4, 5];
const TIMEOUT_MS = 30_000;

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  remote?: boolean;
  url?: string;
  created_at?: number | string;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

/**
 * Arbeitnow: free public job board API. Only jobs flagged `remote` are kept
 * (the board is mostly on-site), pages are fetched with a small delay.
 */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const timeout = timeoutMs || TIMEOUT_MS;
  const jobs: RawJob[] = [];

  for (const page of PAGES) {
    try {
      const data = await fetchJson<ArbeitnowResponse>(`${BASE}?page=${page}`, { timeoutMs: timeout });
      const batch = data.data ?? [];
      for (const item of batch) {
        if (!item?.remote || !item.title || !item.url) continue;
        const description = stripHtml(item.description ?? '');

        jobs.push({
          source: 'arbeitnow',
          sourceId: String(item.slug ?? item.url),
          title: item.title.trim(),
          company: (item.company_name ?? 'Unknown').trim(),
          url: item.url,
          location: (item.location ?? '').trim(),
          description,
          tags: (item.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
          jobType: inferJobType(
            `${(item.job_types ?? []).join(' ')} ${item.title} ${truncate(description, 1200)}`,
          ),
          postedAt: item.created_at !== undefined ? String(item.created_at) : undefined,
          remoteBySource: true,
        });
      }
      if (batch.length === 0) break;
    } catch (err) {
      if (page === PAGES[0]) throw err;
    }
    await sleep(400);
  }

  return jobs;
}
