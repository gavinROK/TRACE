import { runWithConcurrency } from "./concurrency";

describe("runWithConcurrency", () => {
  it("preserves input order in the results regardless of completion order", async () => {
    const delays = [30, 10, 20];
    const results = await runWithConcurrency(delays, 3, (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));

    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` workers concurrently", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return item;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("handles an empty item list", async () => {
    const results = await runWithConcurrency([], 4, async (x) => x);
    expect(results).toEqual([]);
  });
});
