/** Runs `worker` over `items` with at most `limit` in flight at once,
 * matching PRODUCT_SPEC.md section 9's "concurrent multi-host execution
 * with bounded concurrency." `worker` must not reject — callers
 * (CommandExecutionService) catch their own per-device failures and
 * resolve with a FAILED run record instead, so one device's problem
 * never aborts the rest of the batch. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    await runNext();
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}
