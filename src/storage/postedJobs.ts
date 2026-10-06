import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../utils/logger.js';

interface StoreFile {
  version: number;
  updatedAt: string;
  ids: string[];
}

/**
 * Persistent set of already-posted job ids (JSON file, no database).
 * Written atomically so an interrupted run cannot corrupt the store.
 */
export class PostedJobsStore {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private ids = new Set<string>();
  private order: string[] = [];

  constructor(filePath: string, maxEntries = 10_000) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.ids.size;
  }

  load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info(`posted-jobs store not found at ${this.filePath}, starting empty`);
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((id): id is string => typeof id === 'string') : [];
      this.ids = new Set(ids);
      this.order = ids;
      logger.info(`loaded ${this.ids.size} previously posted job id(s)`);
    } catch (err) {
      logger.warn(`could not read posted-jobs store (${(err as Error).message}); starting empty`);
      this.ids = new Set();
      this.order = [];
    }
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Adds ids, keeps insertion order and trims the oldest entries. */
  add(ids: Iterable<string>): number {
    let added = 0;
    for (const id of ids) {
      if (!id || this.ids.has(id)) continue;
      this.ids.add(id);
      this.order.push(id);
      added += 1;
    }

    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
      else break;
    }

    return added;
  }

  save(): void {
    const payload: StoreFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      ids: this.order,
    };

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

/** Stable id for a job regardless of which source returned it. */
export function jobId(url: string, source: string, sourceId: string): string {
  const clean = url.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').toLowerCase();
  return clean || `${source}:${sourceId}`;
}
