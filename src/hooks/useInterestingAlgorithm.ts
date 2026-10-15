import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_INTERESTING_ALGORITHM, isInterestingAlgorithm, type InterestingAlgorithm } from '../lib/intelligenceRanking';

/** Same key as before, so existing choices survive. Per device; not part of the server-synced prefs. */
export const INTERESTING_ALGORITHM_STORAGE_KEY = 'frirss_interesting_algorithm';

/** The stored choice, or the default for a missing, unknown or unreadable value. */
export function readSavedInterestingAlgorithm(): InterestingAlgorithm {
  try {
    const saved = localStorage.getItem(INTERESTING_ALGORITHM_STORAGE_KEY);
    return isInterestingAlgorithm(saved) ? saved : DEFAULT_INTERESTING_ALGORITHM;
  } catch {
    return DEFAULT_INTERESTING_ALGORITHM;
  }
}

/** The Interesting ranking algorithm, persisted across reloads. Unknown values are ignored. */
export function useInterestingAlgorithm(): [InterestingAlgorithm, (value: string) => void] {
  const [algorithm, setAlgorithm] = useState<InterestingAlgorithm>(readSavedInterestingAlgorithm);
  useEffect(() => {
    try {
      localStorage.setItem(INTERESTING_ALGORITHM_STORAGE_KEY, algorithm);
    } catch { /* storage unavailable: the choice lasts for this session only */ }
  }, [algorithm]);
  const choose = useCallback((value: string) => {
    if (isInterestingAlgorithm(value)) setAlgorithm(value);
  }, []);
  return [algorithm, choose];
}
