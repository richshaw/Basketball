import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../src/keyedMutex.js';

describe('KeyedMutex', () => {
  it('runs tasks for the same key one at a time, in order', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([
      mutex.run('k', task('a', 20)),
      mutex.run('k', task('b', 1)),
      mutex.run('k', task('c', 1)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(mutex.activeKeys).toBe(0);
  });

  it('does not block other keys and releases the lock when a task throws', async () => {
    const mutex = new KeyedMutex();
    let release!: () => void;
    const blocker = mutex.run('slow', () => new Promise<void>((resolve) => (release = resolve)));
    await expect(mutex.run('other', () => Promise.resolve('done'))).resolves.toBe('done');
    release();
    await blocker;

    await expect(mutex.run('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(mutex.run('k', () => Promise.resolve('after'))).resolves.toBe('after');
    expect(mutex.activeKeys).toBe(0);
  });
});
