import { useState } from 'react';

const sameDeps = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * Returns `value`, but only adopts a new one when one of `refreshDeps`
 * changes or when `adoptEarly(adopted, latest)` says the change must not wait
 * (e.g. a signal that was missing has arrived). In between, the value adopted
 * last is returned.
 *
 * Meant for inputs that should not reshuffle a list the reader is looking at
 * just because they changed in the background — a poll re-fetching
 * favourites, a refresh rebuilding the subscriptions. Their latest state is
 * picked up at the next update that happens anyway.
 *
 * `value` is compared by reference, so it must stay the same object while it
 * has not changed (memoise it); `adoptEarly` is only asked when it differs.
 */
export function useLatchedValue<T>(
  value: T,
  refreshDeps: readonly unknown[],
  adoptEarly: (adopted: T, latest: T) => boolean,
): T {
  const [latched, setLatched] = useState(() => ({ value, refreshDeps }));
  const refresh = !sameDeps(latched.refreshDeps, refreshDeps)
    || (!Object.is(latched.value, value) && adoptEarly(latched.value, value));
  if (refresh) {
    // Adjusting state while rendering (React re-runs this component before
    // committing), so the new value is used in this very render.
    setLatched({ value, refreshDeps });
    return value;
  }
  return latched.value;
}
