export interface ManagedTimer {
  handle: number | null;
  deadlineMs: number | null;
  callback: (() => void) | null;
}

/** Creates timer state that can be paused, resumed, and reconciled after tab suspension. */
export function createManagedTimer(): ManagedTimer {
  return {
    handle: null,
    deadlineMs: null,
    callback: null,
  };
}

/** Replaces any existing timeout on a managed timer with a new scheduled callback. */
export function scheduleManagedTimer(
  timer: ManagedTimer,
  delayMs: number,
  callback: () => void,
): void {
  const safeDelayMs = Math.max(0, delayMs);

  clearManagedTimer(timer);
  timer.deadlineMs = Date.now() + safeDelayMs;
  timer.callback = callback;
  timer.handle = window.setTimeout(() => {
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
