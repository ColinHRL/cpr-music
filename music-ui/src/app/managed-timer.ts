export interface ManagedTimer {
  handle: ReturnType<typeof globalThis.setTimeout> | null;
  deadlineMs: number | null;
  callback: (() => void) | null;
  version: number;
}

/** Creates timer state that can be paused, resumed, and reconciled after tab suspension. */
export function createManagedTimer(): ManagedTimer {
  return {
    handle: null,
    deadlineMs: null,
    callback: null,
    version: 0,
  };
}

/** Replaces any existing timeout on a managed timer with a new scheduled callback. */
export function scheduleManagedTimer(
  timer: ManagedTimer,
  delayMs: number,
  callback: () => void,
): void {
  const safeDelayMs = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
  const version = timer.version + 1;

  clearManagedTimer(timer);
  timer.version = version;
  timer.deadlineMs = Date.now() + safeDelayMs;
  timer.callback = callback;
  timer.handle = globalThis.setTimeout(() => {
    if (timer.version !== version) {
      return;
    }

    runManagedTimer(timer);
  }, safeDelayMs);
}

/** Clears a managed timer and removes any pending callback metadata. */
export function clearManagedTimer(timer: ManagedTimer): void {
  if (timer.handle !== null) {
    clearTimeout(timer.handle);
  }

  timer.handle = null;
  timer.deadlineMs = null;
  timer.callback = null;
  timer.version++;
}

/** Executes a managed timer callback after first resetting its bookkeeping state. */
export function runManagedTimer(timer: ManagedTimer): void {
  const callback = takeManagedTimerCallback(timer);
  callback?.();
}

/** Clears a managed timer while returning its callback so callers can safely invoke it later. */
export function takeManagedTimerCallback(timer: ManagedTimer): (() => void) | null {
  const callback = timer.callback;
  clearManagedTimer(timer);
  return callback;
}

/** Restarts a timer using its stored deadline or fires it immediately if that deadline passed. */
export function reconcileManagedTimer(timer: ManagedTimer): void {
  if (!timer.callback || timer.deadlineMs === null) {
    return;
  }

  const callback = timer.callback;
  const remainingMs = timer.deadlineMs - Date.now();
  clearManagedTimer(timer);

  if (remainingMs <= 0) {
    callback();
    return;
  }

  scheduleManagedTimer(timer, remainingMs, callback);
}
