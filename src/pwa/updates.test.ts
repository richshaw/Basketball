import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, TAKEOVER_TIMEOUT_MS, watchForTakeover } from './updates';

/** Just enough of a ServiceWorkerContainer: events, plus a registration that may have a waiting worker. */
function fakeContainer({ waiting }: { waiting: boolean }) {
  const container = Object.assign(new EventTarget(), {
    getRegistration: () => Promise.resolve({ waiting: waiting ? {} : null }),
  });
  return container as unknown as ServiceWorkerContainer;
}

function setup(container: ServiceWorkerContainer | undefined) {
  const reload = vi.fn();
  const activateWaitingWorker = vi.fn(() => Promise.resolve());
  const run = () => applyUpdate({ container, activateWaitingWorker, reload });
  return { reload, activateWaitingWorker, run };
}

describe('applyUpdate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('activates the waiting version and reloads once it controls the page', async () => {
    const container = fakeContainer({ waiting: true });
    const { reload, activateWaitingWorker, run } = setup(container);

    await run();
    expect(activateWaitingWorker).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway if the new version never takes control', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const container = fakeContainer({ waiting: true });
    const { reload, run } = setup(container);

    await run();
    vi.advanceTimersByTime(TAKEOVER_TIMEOUT_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('just reloads when the new version already took over elsewhere', async () => {
    const { reload, activateWaitingWorker, run } = setup(fakeContainer({ waiting: false }));

    await run();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(activateWaitingWorker).not.toHaveBeenCalled();
  });

  it('just reloads where service workers are not supported', async () => {
    const { reload, activateWaitingWorker, run } = setup(undefined);

    await run();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(activateWaitingWorker).not.toHaveBeenCalled();
  });
});

/** A container whose controller can be swapped, like when a new version takes over. */
function controlledContainer(initial: string | null) {
  const container = Object.assign(new EventTarget(), { controller: initial });
  const takeOver = (next: string) => {
    container.controller = next;
    container.dispatchEvent(new Event('controllerchange'));
  };
  return { container: container as unknown as ServiceWorkerContainer, takeOver };
}

describe('watchForTakeover', () => {
  it('reports a new version taking over from the one this window runs', () => {
    const { container, takeOver } = controlledContainer('v1');
    const onTakeover = vi.fn();
    watchForTakeover(container, onTakeover);

    takeOver('v2');

    expect(onTakeover).toHaveBeenCalledTimes(1);
  });

  it('ignores the first version claiming a fresh page', () => {
    const { container, takeOver } = controlledContainer(null);
    const onTakeover = vi.fn();
    watchForTakeover(container, onTakeover);

    takeOver('v1');
    expect(onTakeover).not.toHaveBeenCalled();

    takeOver('v2');
    expect(onTakeover).toHaveBeenCalledTimes(1);
  });

  it('stops watching when unsubscribed', () => {
    const { container, takeOver } = controlledContainer('v1');
    const onTakeover = vi.fn();
    const stop = watchForTakeover(container, onTakeover);

    stop();
    takeOver('v2');

    expect(onTakeover).not.toHaveBeenCalled();
  });

  it('does nothing where service workers are not supported', () => {
    expect(() => watchForTakeover(undefined, vi.fn())()).not.toThrow();
  });
});
