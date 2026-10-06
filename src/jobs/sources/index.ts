import type { RawJob } from '../../types.js';

import * as arbeitnow from './arbeitnow.js';
import * as jobicy from './jobicy.js';
import * as remotive from './remotive.js';
import * as remoteok from './remoteok.js';
import * as weworkremotely from './weworkremotely.js';
import * as workingnomads from './workingnomads.js';

export interface JobSource {
  name: string;
  /** True when the source only publishes remote jobs. */
  remoteOnly: boolean;
  fetch: (timeoutMs: number) => Promise<RawJob[]>;
}

/**
 * Registered sources. Adding a source = write one module that returns
 * RawJob[] and add it here.
 */
export const SOURCES: JobSource[] = [
  { name: 'remotive', remoteOnly: true, fetch: remotive.fetchJobs },
  { name: 'remoteok', remoteOnly: true, fetch: remoteok.fetchJobs },
  { name: 'jobicy', remoteOnly: true, fetch: jobicy.fetchJobs },
  { name: 'arbeitnow', remoteOnly: true, fetch: arbeitnow.fetchJobs },
  { name: 'weworkremotely', remoteOnly: true, fetch: weworkremotely.fetchJobs },
  { name: 'workingnomads', remoteOnly: true, fetch: workingnomads.fetchJobs },
];
