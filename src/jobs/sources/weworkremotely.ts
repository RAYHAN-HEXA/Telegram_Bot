import type { RawJob } from '../../types.js';
import { fetchText } from '../../utils/http.js';
import { parseRssItems } from '../../utils/rss.js';
import { stripHtml, inferJobType, truncate } from '../../utils/text.js';
import { sleep } from '../../utils/date.js';

/** Programming-related categories of We Work Remotely (public RSS). */
const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
];
const TIMEOUT_MS = 25_000;

function companyFromTitle(title: string): string {
  const [before] = title.split(':');
  const candidate = (before ?? '').trim();
  if (candidate && candidate.length <= 60) return candidate;
  return 'Unknown';
}

/** We Work Remotely: public RSS feed, attribution link required by their terms. */
export async function fetchJobs(timeoutMs: number): Promise<RawJob[]> {
  const timeout = timeoutMs || TIMEOUT_MS;
  const jobs: RawJob[] = [];

  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed, { timeoutMs: timeout });
      for (const item of parseRssItems(xml)) {
        const link = item.link || item.guid;
        if (!link || !item.title) continue;
        const description = stripHtml(item.description);
        const location = item.extra.region ?? '';

        jobs.push({
          source: 'weworkremotely',
          sourceId: item.guid || link,
          title: item.title.trim(),
          company: companyFromTitle(item.title),
          url: link,
          location,
          description,
          tags: item.extra.category ? [item.extra.category] : [],
          jobType: inferJobType(`${item.title} ${truncate(description, 400)}`),
          postedAt: item.pubDate,
          remoteBySource: true,
        });
      }
    } catch (err) {
      // First feed failing is reported, later feeds still get a chance.
      if (feed === FEEDS[0]) throw err;
    }
    await sleep(400);
  }

  return jobs;
}
