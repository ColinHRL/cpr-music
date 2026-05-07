import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearManagedTimer,
  createManagedTimer,
  reconcileManagedTimer,
  scheduleManagedTimer,
} from './managed-timer';

describe('managed timer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ignores stale timeout callbacks after a reschedule', () => {
    const timer = createManagedTimer();
    const scheduledCallbacks: Array<() => void> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const staleCallback = vi.fn();
    const freshCallback = vi.fn();

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((callback: TimerHandler) => {
        scheduledCallbacks.push(callback as () => void);
        return scheduledCallbacks.length;
      }) as typeof originalSetTimeout,
    );
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(
      ((_: ReturnType<typeof globalThis.setTimeout>) => undefined) as typeof originalClearTimeout,
    );

    scheduleManagedTimer(timer, 1000, staleCallback);
    scheduleManagedTimer(timer, 1000, freshCallback);

    scheduledCallbacks[0]();
    expect(staleCallback).not.toHaveBeenCalled();
    expect(freshCallback).not.toHaveBeenCalled();

    scheduledCallbacks[1]();
    expect(staleCallback).not.toHaveBeenCalled();
    expect(freshCallback).toHaveBeenCalledTimes(1);
  });

  it('fires expired reconciled timers immediately', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const timer = createManagedTimer();
    const callback = vi.fn();

    scheduleManagedTimer(timer, 1000, callback);
    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    reconcileManagedTimer(timer);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(timer.callback).toBeNull();
    expect(timer.deadlineMs).toBeNull();
    expect(timer.handle).toBeNull();
  });

  it('normalizes invalid delays to immediate timers', () => {
    vi.useFakeTimers();

    const timer = createManagedTimer();
    const callback = vi.fn();

    scheduleManagedTimer(timer, Number.NaN, callback);

    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('clears pending timer metadata', () => {
    const timer = createManagedTimer();

    scheduleManagedTimer(timer, 1000, vi.fn());
    clearManagedTimer(timer);

    expect(timer.callback).toBeNull();
    expect(timer.deadlineMs).toBeNull();
    expect(timer.handle).toBeNull();
  });
});
