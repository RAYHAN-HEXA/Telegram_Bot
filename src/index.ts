import { ConfigError, loadConfig, REQUIREMENTS } from './config.js';
import { checkEligibility, summarizeRejections } from './filters/eligibility.js';
import { scoreJobs, selectTopJobs, MAX_POINTS } from './filters/scoring.js';
import { collectJobs } from './jobs/index.js';
import { jobId, PostedJobsStore } from './storage/postedJobs.js';
import { TelegramBot } from './telegram/bot.js';
import { buildMessages } from './telegram/message.js';
import { dateLabel, relativeTime, sleep } from './utils/date.js';
import { logger } from './utils/logger.js';
import { truncate } from './utils/text.js';
import type { ScoredJob } from './types.js';

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function printSourceOutcomes(outcomes: { name: string; ok: boolean; count: number; error?: string }[]): void {
  out('  Sources');
  for (const outcome of outcomes) {
    if (outcome.ok) {
      out(`    ✅ ${outcome.name.padEnd(16)} ${outcome.count} job(s)`);
    } else {
      out(`    ❌ ${outcome.name.padEnd(16)} failed: ${outcome.error ?? 'unknown error'}`);
    }
  }
}

function printRejections(counts: Map<string, number>): void {
  if (counts.size === 0) return;
  out('  Rejections');
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sorted) {
    out(`    - ${reason.padEnd(28)} ${count}`);
  }
}

function printSelected(selected: ScoredJob[]): void {
  out('');
  out(`  Selected jobs (${selected.length})`);
  out('  ' + '-'.repeat(74));
  selected.forEach((job, index) => {
    const age = job.postedDate ? relativeTime(job.postedDate) : 'date unknown';
    out(`  ${String(index + 1).padStart(2)}. [${String(job.score).padStart(3)}/100] ${truncate(job.title, 52)}`);
    out(`      🏢 ${truncate(job.company, 34)} · 💼 ${job.jobType} · 🕒 ${age}`);
    out(`      🌍 ${truncate(job.location || 'Remote', 50)}`);
    out(`      🔗 ${job.url}`);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const now = new Date();

  logger.info(
    `Rayhan Job Alert Bot starting • mode=${config.dryRun ? 'DRY RUN (no Telegram messages)' : 'LIVE'} • maxJobs=${config.maxJobs} • ${dateLabel(now, config.timezone)}`,
  );

  const store = new PostedJobsStore(config.storageFile);
  store.load();

  // 1. Collect from every source (a failing source never aborts the run).
  const { jobs: collected, outcomes } = await collectJobs(config.sourceTimeoutMs);

  // 2. Drop jobs that were already sent on a previous day.
  const pool = [];
  let alreadyPosted = 0;
  for (const job of collected) {
    if (store.has(jobId(job.url, job.source, job.sourceId))) {
      alreadyPosted += 1;
      continue;
    }
    pool.push(job);
  }

  // 3. Eligibility (title + location + experience + description).
  const checks = pool.map((job) => ({ job, result: checkEligibility(job, REQUIREMENTS) }));
  const eligible = checks.filter((item) => item.result.ok).map((item) => item.job);
  const rejectionCounts = summarizeRejections(checks.map((item) => item.result));

  // 4. Score + fresh-first selection.
  const scored = scoreJobs(eligible, { now, req: REQUIREMENTS }).filter(
    (job) => job.score >= REQUIREMENTS.minScore,
  );
  const selected = selectTopJobs(scored, config.maxJobs, REQUIREMENTS.freshWindowHours);

  if (config.dryRun) {
    out('');
    out('='.repeat(76));
    out('  RAYHAN JOB ALERT BOT - DRY RUN (nothing was sent to Telegram)');
    out('='.repeat(76));
    printSourceOutcomes(outcomes);
    out('  Pipeline');
    out(`    unique jobs collected        ${collected.length}`);
    out(`    skipped (already posted)     ${alreadyPosted}`);
    out(`    rejected by filters          ${checks.length - eligible.length}`);
    printRejections(rejectionCounts);
    out(`    eligible                      ${eligible.length}`);
    out(`    selected (max ${String(config.maxJobs).padStart(2)})             ${selected.length}`);
    out(`  Scoring: max raw points ${MAX_POINTS}, shown as 0-100`);
    printSelected(selected);

    const preview = buildMessages(selected, {
      now,
      timezone: config.timezone,
      collected: collected.length,
      eligible: eligible.length,
    });
    out('');
    out(`  Telegram preview (${preview.length} message chunk(s) would be sent, chunk 1 shown)`);
    out('-'.repeat(76));
    out(preview[0]?.text ?? '(empty)');
    out('-'.repeat(76));
    out('');
    out('  Re-run with TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (no --dry-run) to send.');
    out('');
    return;
  }

  // 5. Build the Telegram digest.
  const chunks = buildMessages(selected, { now, timezone: config.timezone, collected: collected.length, eligible: eligible.length });
  const bot = new TelegramBot(config.telegramToken, config.telegramChatId, config.sendDelayMs);

  logger.info(`sending ${chunks.length} Telegram message chunk(s) with ${selected.length} job(s)`);

  let sentChunks = 0;
  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (!chunk) continue;
      await bot.sendMessage(chunk.text);
      sentChunks += 1;
      logger.info(`message ${i + 1}/${chunks.length} delivered`);
      if (i < chunks.length - 1) await sleep(config.sendDelayMs);
    }
  } catch (err) {
    // Persist the jobs that did go out so they are not sent twice.
    const deliveredIds = chunks
      .slice(0, sentChunks)
      .flatMap((chunk) => chunk.jobIndices)
      .map((index) => selected[index])
      .filter((job): job is ScoredJob => Boolean(job))
      .map((job) => jobId(job.url, job.source, job.sourceId));

    const added = store.add(deliveredIds);
    store.save();

    logger.error(
      `Telegram delivery failed after ${sentChunks}/${chunks.length} message(s): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    logger.error(`${added} partially delivered job(s) were marked as posted.`);
    process.exitCode = 1;
    return;
  }

  const ids = selected.map((job) => jobId(job.url, job.source, job.sourceId));
  const added = store.add(ids);
  store.save();

  logger.success(
    `Posted ${selected.length} job(s) in ${chunks.length} message(s); ` +
      `${added} new id(s) recorded (store now holds ${store.size}).`,
  );
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    logger.error(err.message);
  } else {
    logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
  process.exit(1);
});
