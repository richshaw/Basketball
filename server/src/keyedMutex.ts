/**
 * Serializes async work per key (here: per account) inside this process. Callers for the same
 * key run one at a time in arrival order; different keys never wait on each other.
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }

  /** Number of keys with queued or running work (for tests). */
  get activeKeys(): number {
    return this.#tails.size;
  }
}
