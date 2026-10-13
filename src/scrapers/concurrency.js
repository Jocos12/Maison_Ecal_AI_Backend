/**
 * Run async work on `items` with at most `limit` tasks in flight.
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return results;
}
