/**
 * Isolated HTTP tests for /api/internal/scrape auth + rate limit.
 * Does not call runAllScrapers.
 */
process.env.CRON_SECRET = 'unit-test-cron-secret';

import express from 'express';
import { internalScrapeLimiter } from '../src/middleware/rateLimiter.js';
import { requireCronBearer } from '../src/middleware/cronSecret.js';

const app = express();
app.set('trust proxy', 1);
app.post('/api/internal/scrape', requireCronBearer, internalScrapeLimiter, (_req, res) => {
  res.json({ ok: true, triggeredBy: 'cron-http' });
});

const server = app.listen(0, async () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/api/internal/scrape`;
  const results = [];

  const post = async (headers) => {
    const res = await fetch(url, { method: 'POST', headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  };

  results.push({ name: 'wrong-secret', ...(await post({ Authorization: 'Bearer wrong' })) });
  results.push({
    name: 'legacy-header',
    ...(await post({ 'x-cron-secret': process.env.CRON_SECRET }))
  });
  results.push({
    name: 'query-token',
    ...(await (async () => {
      const res = await fetch(`${url}?token=${process.env.CRON_SECRET}`, { method: 'POST' });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    })())
  });
  for (let i = 0; i < 5; i += 1) {
    results.push({ name: `brute-${i + 1}`, ...(await post({ Authorization: 'Bearer brute' })) });
  }
  results.push({
    name: 'correct-secret',
    ...(await post({ Authorization: `Bearer ${process.env.CRON_SECRET}` }))
  });
  results.push({
    name: 'second-correct',
    ...(await post({ Authorization: `Bearer ${process.env.CRON_SECRET}` }))
  });

  console.log(JSON.stringify(results, null, 2));
  server.close();
});
