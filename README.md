# Rayhan Job Alert Bot

A free, self-hosted Telegram bot that collects remote job postings, filters them
for a **junior / entry-level MERN-style developer in Bangladesh**, scores them
against a tunable requirements list, and posts the **top 50** to a Telegram
channel every day at **08:30 Bangladesh time**.

Everything runs on free resources:

| Piece | Where it runs | Cost |
| --- | --- | --- |
| Job collection + filtering | GitHub Actions cron | free (public repo) |
| Telegram delivery | Telegram Bot API | free |
| Job data sources | Public keyless APIs/RSS | free |
| Database | `data/posted-jobs.json` (file kept via Actions cache) | free |

No paid services, no VPS, no external database.

---

## 1. How it works

```
sources ──▶ dedupe ──▶ eligibility ──▶ scoring ──▶ selection ──▶ Telegram
 (6 keyless   (URL +     (junior,       (0-100)     (fresh-first,  (HTML,
  sources)   title+co)   remote, geo,               ≤ maxJobs,      1.2 s
                        age, job type)              48 h first)     apart)
```

1. **Collect** – Remotive, RemoteOK, Jobicy, Arbeitenow, We Work Remotely and
   Working Nomads are fetched in parallel with retries/timeouts.
2. **De-duplicate** – identical URLs and identical title+company pairs collapse
   into one job; anything already posted (see `data/posted-jobs.json`) is dropped.
3. **Eligibility** – rejects jobs that are not junior, not remote, not open to
   Bangladesh, too old, the wrong job type, or not a development role.
4. **Scoring** – adds points for junior signals, remote/worldwide location, the
   target stack, internship/full-time, recency and preferred titles; subtracts
   points for senior/lead/manager language, India-only and on-site roles.
   Raw points (max 65) are normalised to `0-100` for display.
5. **Selection** – fresh jobs (≤48 h) first, then older ones by score, until
   `maxJobs` (50) is reached.
6. **Send** – rendered as one or more HTML messages (max 4096 characters each)
   with a 1.2 s pause between them, then the posted ids are written to the store.

---

## 2. One-time Telegram setup

### 2.1 Create the bot

1. Open Telegram and talk to **@BotFather**.
2. Send `/newbot`, pick a display name (e.g. `Rayhan Job Alert`) and a unique
   username ending in `bot` (e.g. `rayhan_job_alert_bot`).
3. BotFather replies with an HTTP API token that looks like
   `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
   This is `TELEGRAM_BOT_TOKEN` — treat it like a password, never commit it.

### 2.2 Create the channel

1. Create a Telegram channel (private or public) for the alerts.
2. Open **Channel → Administrators → Add Administrator** and add your bot by
   its username. Give it permission to **post messages**.
   (Without this the bot will fail with `not enough rights`.)

### 2.3 Find the chat id

* **Public channel** – use the channel handle directly: `@mychannel`.
* **Private channel** – the numeric id, `-100xxxxxxxxxx`. Two easy ways to get it:
  * Add the bot as admin, post any message in the channel, then open
    `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and read
    `channel_post.chat.id`.
  * Or forward a channel message to **@userinfobot** (does not work for
    channels) — so prefer the `getUpdates` route.

That value (with the leading `-100`) is `TELEGRAM_CHAT_ID`.

### 2.4 Send a test message (optional)

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d chat_id="$TELEGRAM_CHAT_ID" -d text="hello from the job bot" -d parse_mode=HTML
```

---

## 3. Run it locally

Requirements: Node.js 24+ (the repo uses ESM and `fetch`).

```bash
npm install
cp .env.example .env         # then fill in the two Telegram values
npm run dry-run              # fetch + filter + score + preview, never sends
```

Dry run output shows the per-source counts, every rejection reason, the
selected jobs with their scores, and the exact first Telegram message chunk.

Test everything:

```bash
npm run typecheck            # tsc --noEmit (strict mode)
npm run test:telegram        # real Telegram code against a local mock Bot API
npm test                     # typecheck + telegram tests + full dry run
```

Run for real locally (needs `.env`):

```bash
npm start                    # = node dist/index.js
```

---

## 4. Schedule with GitHub Actions (free)

1. Create a GitHub repository and push this project:

   ```bash
   git init
   git add .
   git commit -m "Rayhan job alert bot"
   git branch -M main
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```

2. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   and add both secrets:
   * `TELEGRAM_BOT_TOKEN`
   * `TELEGRAM_CHAT_ID`

3. **Actions → Daily Job Alert → Run workflow** with `dry_run = true` first to
   verify the pipeline, then again with `dry_run = false` to send a real message.

4. After the first successful run the cron takes over: `.github/workflows/job-alert.yml`
   runs at `30 2 * * *` = **02:30 UTC = 08:30 Asia/Dhaka**.

Notes:

* GitHub's scheduled runs are occasionally delayed by a few minutes — that is
  normal and not a bug in the workflow.
* If a run has no eligible jobs the bot posts a short "no suitable jobs today"
  message instead of staying silent.
* `concurrency` prevents two runs from racing over the posted-jobs store.
* The store is kept between runs with `actions/cache` (restore before the run,
  save after it), so a job is never posted twice.

### Cron math

```
local time = UTC + offset        →  08:30 (UTC+6) = 02:30 UTC
UTC   = local time - offset      →  08:30 - 6h    = 02:30 UTC
```

If Bangladesh ever changes its offset, update the `cron` line **and** keep
`TIMEZONE=Asia/Dhaka` (used only for the date shown in the message header).

---

## 5. How to change job requirements later

Everything job-related lives in one object: `REQUIREMENTS` in
`src/config.ts`. Edit it, then re-run `npm run dry-run` to see the effect
before deploying.

| Field | Meaning |
| --- | --- |
| `maxJobs` | Max jobs per morning (hard capped at 100) |
| `maxAgeDays` | Jobs older than this are rejected (default 14) |
| `freshWindowHours` | Fresh-first window (default 48 h) |
| `minScore` | Drop jobs below this score (0 = keep everything) |
| `allowContract` | Accept contract/freelance roles |
| `allowedJobTypes` | `full-time`, `part-time`, `internship` |
| `techKeywords` | Relevance gate (title is a dev role **or** ≥2 keywords match) |
| `stackKeywords` | +10 bonus when the stack matches |
| `preferredTitles` | +4 when the title matches |
| `seniorTitleKeywords` | Rejection words for seniority |
| `restrictedRegions` | Location words that make a job ineligible |
| `worldwideKeywords` | Location words that mean "anyone can apply" |

Common tweaks:

* **Allow contract work** → `allowContract: true`.
* **Only MERN, no Vue/Angular** → delete `vue`/`angular` from `techKeywords`.
* **Include nearby countries** → move them from `restrictedRegions` to
  `worldwideKeywords` (only if you can legally work there).
* **Send fewer jobs** → `MAX_JOBS=10` in `.env` / workflow env (overrides the
  built-in default).

Environment variables (`.env.example`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`DRY_RUN`, `MAX_JOBS`, `STORAGE_FILE`, `TIMEZONE`, `TELEGRAM_SEND_DELAY_MS`,
`SOURCE_TIMEOUT_MS`.

### Scoring reference

| Signal | Points |
| --- | --- |
| Junior/intern/entry level | +10 |
| Remote | +10 |
| Worldwide or Bangladesh (or Asia) | +10 (unspecified geo +6) |
| MERN/React/Next/TS/JS/Node/Express | +10 |
| Internship | +8 |
| Full stack | +8 |
| Posted < 24 h (−48 h: +3) | +5 / +3 |
| Preferred title | +4 |
| Senior/lead/manager language | −30 |
| India-only | −30 |
| On-site | −20 |

Raw total (max 65) → displayed as `raw / 65 * 100`.

---

## 6. Data sources and usage policy

| Source | Endpoint | Key needed | Notes |
| --- | --- | --- | --- |
| Remotive | `remotive.com/api/remote-jobs` | no | public JSON API |
| RemoteOK | `remoteok.com/api` | no | public JSON API |
| Jobicy | `jobicy.com/api/v2/remote-jobs` | no | capped at 200 jobs |
| Arbeitenow | `arbeitnow.com/api/job-board-api` | no | pages 1–5, `remote === true` only |
| We Work Remotely | `weworkremotely.com/.../*.rss` | no | 4 programming RSS feeds |
| Working Nomads | `workingnomads.com/api/exposed_jobs` | no | public JSON API |

Policies the code follows: a fixed personal `User-Agent`, HTTP timeouts,
exponential backoff on 429/5xx, sequential pages with short delays, no paid or
scraped private endpoints, and only as much data as one daily digest needs.
If a source changes its API, that source alone fails — the others still run.

---

## 7. Security and data

* The token is only ever read from GitHub Secrets / `.env`; it is never written
  to the repository or printed in full (the logger redacts
  `digits:token`-shaped strings).
* `permissions: contents: read` in the workflow — the bot cannot modify the repo.
* `data/posted-jobs.json` holds only job ids, urls, titles and dates. Prune it
  any time (it self-heals; only newer posts are treated as duplicates).

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Missing required environment variable(s)` | Secrets or `.env` not set, or you forgot `DRY_RUN=true` |
| `chat not found` | Wrong `TELEGRAM_CHAT_ID`, or the bot is not in the channel |
| `not enough rights to send text messages` | Bot is not an admin / cannot post |
| `429 Too Many Requests` | Message delay too low — raise `TELEGRAM_SEND_DELAY_MS` |
| Run finishes but no messages | Check the Actions log for `eligible 0` — see §5 to loosen requirements |
| Same job appears twice | The posted-jobs cache was cleared; delete the `posted-jobs-` cache entries (Actions → Caches) and start fresh |
| A source fails with `HTTP 403` | Their API changed/started rate limiting; other sources continue |

---

## 9. Project structure

```
rayhan-job-alert-bot/
├── .github/workflows/job-alert.yml   # cron 08:30 BD + manual dispatch
├── data/posted-jobs.json             # de-duplication store
├── scripts/telegram-selftest.mjs     # mock Bot API test (npm run test:telegram)
├── src/
│   ├── index.ts                      # pipeline + dry-run report
│   ├── config.ts                     # REQUIREMENTS + env config
│   ├── filters/eligibility.ts        # accept/reject rules
│   ├── filters/scoring.ts            # weights, score, fresh-first selection
│   ├── jobs/sources/                 # 6 keyless sources
│   ├── jobs/index.ts                 # collect + dedupe
│   ├── storage/postedJobs.ts         # atomic JSON store
│   ├── telegram/bot.ts               # Bot API client (retries, chunking)
│   ├── telegram/message.ts           # HTML rendering
│   └── utils/                        # http, rss, text, date, logger
├── .env.example
└── package.json
```
