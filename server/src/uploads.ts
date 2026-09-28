/** What an upload gets when it starts; checked again when it commits. */
export interface UploadTicket {
  /** Reserved sequence number for the version id. */
  sequence: number;
  /** The account's deletion generation when the upload started. */
  generation: number;
}

interface AccountUploads {
  /** Bumped by every DELETE of the account. */
  generation: number;
  /** Next sequence number to hand out; null = seed from the newest stored version. */
  nextSequence: number | null;
  inFlight: number;
}

/**
 * In-memory, per-account bookkeeping for uploads in flight.
 *
 * - Sequence numbers are handed out when an upload starts, so versions sort by when their
 *   upload began, not by when a (possibly slow) body finished arriving: a slow upload of older
 *   data can never become "latest" over newer data.
 * - A deletion generation lets a commit notice that its account was deleted after the upload
 *   started, so a late upload can't bring a deleted account, or its old data, back.
 *
 * An entry exists only while uploads for the account are in flight. With none in flight, disk
 * is the source of truth: the next upload seeds the counter from the newest stored version
 * (numbers of failed uploads may be reused; nothing was stored under them). Memory therefore
 * stays proportional to uploads in flight.
 */
export class UploadTracker {
  readonly #accounts = new Map<string, AccountUploads>();

  /**
   * Registers an upload and reserves its sequence number. Must run under the account lock, so
   * seeding from disk can't race a commit or a delete. Pair with {@link end}.
   */
  async begin(accountId: string, highestStored: () => Promise<number>): Promise<UploadTicket> {
    let state = this.#accounts.get(accountId);
    if (state === undefined) {
      state = { generation: 0, nextSequence: null, inFlight: 0 };
      this.#accounts.set(accountId, state);
    }
    state.inFlight += 1;
    try {
      state.nextSequence ??= (await highestStored()) + 1;
    } catch (err) {
      this.end(accountId);
      throw err;
    }
    const sequence = state.nextSequence;
    state.nextSequence += 1;
    return { sequence, generation: state.generation };
  }

  /** False if the account was deleted after the upload with this ticket started. */
  isCurrent(accountId: string, ticket: UploadTicket): boolean {
    return this.#accounts.get(accountId)?.generation === ticket.generation;
  }

  /** Marks one upload for the account as finished (committed or not). */
  end(accountId: string): void {
    const state = this.#accounts.get(accountId);
    if (state === undefined) return;
    state.inFlight -= 1;
    if (state.inFlight <= 0) this.#accounts.delete(accountId);
  }

  /**
   * Called by DELETE under the account lock, whether or not the account exists (its very first
   * upload may still be arriving): invalidates every upload in flight for it.
   */
  accountDeleted(accountId: string): void {
    const state = this.#accounts.get(accountId);
    if (state === undefined) return;
    state.generation += 1;
    state.nextSequence = null;
  }

  /** Accounts with uploads in flight (for tests). */
  get trackedAccounts(): number {
    return this.#accounts.size;
  }
}

export interface SlotLimits {
  /** Uploads arriving at once, across all clients. */
  total: number;
  /** Of those, first uploads to accounts that don't exist yet. */
  newAccounts: number;
  /** Uploads arriving at once from one client address. */
  perClient: number;
}

export type SlotResult =
  { ok: true; release: () => void } | { ok: false; reason: 'server_busy' | 'client_busy' };

/**
 * Concurrency limits for uploads while their bodies arrive. First uploads to unknown account
 * ids (which anyone can send) may hold only `newAccounts` slots, so strangers stalling uploads
 * can never take the slots the family's existing accounts need; `perClient` stops one address
 * from holding many at once.
 */
export class UploadSlots {
  readonly #limits: SlotLimits;
  readonly #perClient = new Map<string, number>();
  #total = 0;
  #newAccounts = 0;

  constructor(limits: SlotLimits) {
    this.#limits = limits;
  }

  acquire(client: string, newAccount: boolean): SlotResult {
    const mine = this.#perClient.get(client) ?? 0;
    if (mine >= this.#limits.perClient) return { ok: false, reason: 'client_busy' };
    if (
      this.#total >= this.#limits.total ||
      (newAccount && this.#newAccounts >= this.#limits.newAccounts)
    ) {
      return { ok: false, reason: 'server_busy' };
    }
    this.#total += 1;
    if (newAccount) this.#newAccounts += 1;
    this.#perClient.set(client, mine + 1);

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.#total -= 1;
        if (newAccount) this.#newAccounts -= 1;
        const left = (this.#perClient.get(client) ?? 1) - 1;
        if (left > 0) this.#perClient.set(client, left);
        else this.#perClient.delete(client);
      },
    };
  }

  /** Slots in use (for tests). */
  get inUse(): number {
    return this.#total;
  }
}
