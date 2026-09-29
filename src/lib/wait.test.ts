import { describe, expect, it } from 'vitest';
import { waitAtMost } from './wait';

describe('waitAtMost', () => {
  it('resolves once the task settles, either way', async () => {
    let settled = false;
    await waitAtMost(
      new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
        settled = true;
      }),
      5000,
    );
    expect(settled).toBe(true);
    await expect(waitAtMost(Promise.reject(new Error('Disk error')), 5000)).resolves.toBe(
      undefined,
    );
  });

  it("doesn't wait longer than asked for a task that never settles", async () => {
    const started = performance.now();
    await waitAtMost(new Promise(() => {}), 30);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
