import { useCallback, useState } from 'react';
import { browserGestureStore, hasLearned, markLearned } from './learned-gestures';

/**
 * A hint that retires itself once its gesture has been used.
 *
 * `learn()` is called from the handler the gesture ITSELF lands in — a leg
 * dragged, a trim set — never from a mount or a hover, or the hint would
 * disappear before it was read.
 */
export function useLearnedGesture(key: string): { learned: boolean; learn: () => void } {
  const [learned, setLearned] = useState(() => hasLearned(browserGestureStore(), key));

  // Written unconditionally: the updater must stay pure (StrictMode runs it
  // twice), and marking a gesture already learned costs one idempotent write.
  const learn = useCallback(() => {
    markLearned(browserGestureStore(), key);
    setLearned(true);
  }, [key]);

  return { learned, learn };
}
