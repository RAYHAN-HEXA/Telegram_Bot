export interface RssItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
  /** Extra tags captured verbatim (We Work Remotely uses region and category). */
  extra: Record<string, string>;
}

const ITEM_RE = /<item[\s>][\s\S]*?<\/item>/gi;
const EXTRA_TAGS = ['region', 'category'];

function extractTag(block: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag.replace(':', '\\:')}[^>]*>([\\s\\S]*?)</${tag.replace(':', '\\:')}>`, 'i');
  const match = pattern.exec(block);
  if (!match || match[1] === undefined) return undefined;
  return cleanValue(match[1]);
}

function cleanValue(raw: string): string {
  let value = raw.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  if (cdata && cdata[1] !== undefined) value = cdata[1].trim();
  return value;
}

/**
 * Minimal RSS 2.0 reader. No external XML dependency: job feeds are flat,
 * and any HTML inside a value is decoded later by stripHtml().
 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  if (!xml) return items;

  const blocks = xml.match(ITEM_RE) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, 'title') ?? '';
    const link = extractTag(block, 'link') ?? '';
    const guid = extractTag(block, 'guid') ?? '';
    const description = extractTag(block, 'description') ?? extractTag(block, 'content:encoded') ?? '';
    const pubDate = extractTag(block, 'pubDate') ?? '';

    const extra: Record<string, string> = {};
    for (const tag of EXTRA_TAGS) {
      const value = extractTag(block, tag);
      if (value) extra[tag] = value;
    }

    if (!title && !link && !guid) continue;

    items.push({ title, link, guid, description, pubDate, extra });
  }
  return items;
}
