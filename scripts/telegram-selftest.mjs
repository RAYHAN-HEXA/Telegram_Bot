// Self-test for the Telegram layer: runs the real bot code against a local
// mock of the Bot API, so sending can be verified without real credentials.
//
//   npm run test:telegram
import http from 'node:http';
import assert from 'node:assert/strict';

const TOKEN = '123456:TESTTOKENABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHAT_ID = '-1001234567890';

const capturedLogs = [];
const original = { log: console.log, warn: console.warn, error: console.error };
const capture = (...args) => capturedLogs.push(args.map(String).join(' '));
console.log = capture;
console.warn = capture;
console.error = capture;

const { TelegramBot, TelegramError } = await import('../dist/telegram/bot.js');
const { buildMessages } = await import('../dist/telegram/message.js');
const { redact } = await import('../dist/utils/logger.js');

const state = { requests: [], mode: 'ok', failures: 0 };

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    state.requests.push({ url: req.url, body });

    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (state.mode === 'bad') {
      reply(400, { ok: false, description: 'Bad Request: message is too long' });
      return;
    }
    if (state.mode === 'flaky' && state.failures === 0) {
      state.failures += 1;
      reply(500, { ok: false, description: 'Internal Server Error' });
      return;
    }
    if (state.mode === 'rate' && state.failures === 0) {
      state.failures += 1;
      reply(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 0 } });
      return;
    }
    reply(200, { ok: true, result: { message_id: state.requests.length } });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

function fakeJobs(count) {
  return Array.from({ length: count }, (_, i) => ({
    source: 'test',
    sourceId: `id-${i}`,
    title: `Junior React Developer <i> & Friends #${i}`,
    company: `Company ${i}`,
    url: `https://example.com/jobs/${i}?utm_source=x`,
    location: 'Worldwide',
    description: 'Build things with React & TypeScript.',
    tags: ['react'],
    jobType: i % 3 === 0 ? 'internship' : 'full-time',
    salary: i % 2 === 0 ? '$50,000 - $70,000' : undefined,
    postedAt: new Date(Date.now() - i * 3600_000).toISOString(),
    remoteBySource: true,
    score: 90 - i,
    points: 58,
    signals: ['+10 remote'],
  }));
}

const now = new Date();
const meta = { now, timezone: 'Asia/Dhaka', collected: 100, eligible: 80 };

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`  ✅ ${name}`);
  } catch (err) {
    results.push(`  ❌ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
};

// --- 1. message building -------------------------------------------------
const many = buildMessages(fakeJobs(60), meta);
check('60 jobs are split into several chunks', () => {
  assert.ok(many.length > 1, `expected >1 chunk, got ${many.length}`);
});
check('every chunk respects the 4096 Telegram limit', () => {
  for (const chunk of many) assert.ok(chunk.text.length <= 4096, `chunk too long: ${chunk.text.length}`);
});
check('chunk job indices cover every job exactly once', () => {
  const indices = many.flatMap((chunk) => chunk.jobIndices).sort((a, b) => a - b);
  assert.deepEqual(indices, Array.from({ length: 60 }, (_, i) => i));
});
check('HTML in job titles is escaped', () => {
  const text = many.map((chunk) => chunk.text).join('\n');
  assert.ok(!text.includes('<i> &'), 'raw <i> should be escaped');
  assert.ok(text.includes('&lt;i&gt; &amp;'), 'escaped entities missing');
  assert.ok(text.includes('⭐ Match Score'), 'score line missing');
});check('header and footer are present', () => {
  const first = many[0].text;
  const last = many[many.length - 1].text;
  assert.ok(first.startsWith('🔥 DAILY REMOTE JOBS'));
  assert.ok(first.includes('📅 '));
  assert.ok(last.includes('📊 Total jobs: 60'));
  assert.ok(last.includes('🎯 Focus:'));
});
check('empty selection still produces a message', () => {
  const empty = buildMessages([], meta);
  assert.equal(empty.length, 1);
  assert.ok(empty[0].text.includes('Total jobs: 0'));
});

// --- 2. successful sending ----------------------------------------------
state.mode = 'ok';
state.requests = [];
state.failures = 0;
const bot = new TelegramBot(TOKEN, CHAT_ID, 5, base);
const sent = await bot.sendMessages(many.map((chunk) => chunk.text));
check('all chunks are delivered', () => {
  assert.equal(sent, many.length);
  assert.equal(state.requests.length, many.length);
});
check('requests use the configured chat id and HTML parse mode', () => {
  for (const request of state.requests) {
    assert.ok(request.url.endsWith('/sendMessage'), request.url);
    assert.equal(request.body.chat_id, CHAT_ID);
    assert.equal(request.body.parse_mode, 'HTML');
    assert.equal(typeof request.body.text, 'string');
  }
});

// --- 3. retry on transient failure --------------------------------------
state.mode = 'flaky';
state.requests = [];
state.failures = 0;
const retried = await new TelegramBot(TOKEN, CHAT_ID, 5, base).sendMessages(['hello']);
check('a 500 response is retried and then delivered', () => {
  assert.equal(retried, 1);
  assert.equal(state.requests.length, 2);
});

// --- 4. non-retryable Telegram error ------------------------------------
state.mode = 'bad';
state.requests = [];
state.failures = 0;
let thrown;
try {
  await new TelegramBot(TOKEN, CHAT_ID, 5, base).sendMessage('too long');
} catch (err) {
  thrown = err;
}
check('a 400 response raises TelegramError without retrying', () => {
  assert.ok(thrown instanceof TelegramError, `expected TelegramError, got ${thrown}`);
  assert.match(thrown.message, /message is too long/);
  assert.equal(state.requests.length, 1, '400 must not be retried');
});

// --- 5. the token never reaches the logs --------------------------------
check('logged output never contains the bot token', () => {
  const joined = capturedLogs.join('\n');
  assert.ok(!joined.includes(TOKEN), 'token leaked into logs');
});
check('redact() masks Telegram-style tokens', () => {
  assert.ok(!redact(`failed to call bot${TOKEN}/sendMessage`).includes(TOKEN));
  assert.ok(redact(`failed to call bot${TOKEN}/sendMessage`).includes('[REDACTED_TOKEN]'));
});

await new Promise((resolve) => server.close(resolve));
console.log = original.log;
console.warn = original.warn;
console.error = original.error;

console.log('\nTelegram layer self-test');
console.log('-'.repeat(60));
for (const line of results) console.log(line);
console.log('-'.repeat(60));
console.log(process.exitCode ? 'FAILED' : 'All Telegram tests passed.');
