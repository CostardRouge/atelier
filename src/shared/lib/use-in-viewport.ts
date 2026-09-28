import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * One observer for EVERY element that asks — not one per row. A library of
 * two thousand files mounted two thousand `IntersectionObserver`s (the audit
 * of 2026-09-22); the browser answers one observer watching many targets in a
 * single pass, so the rows share it, each with its own callback.
 */
let shared: IntersectionObserver | null = null;
const callbacks = new Map<Element, () => void>();

function observe(el: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    // No observer (an old engine, a test): everything counts as in view.
    onVisible();
    return () => {};
  }
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cb = callbacks.get(entry.target);
        if (!cb) continue;
        callbacks.delete(entry.target);
        shared?.unobserve(entry.target);
        cb();
      }
    },
    { rootMargin: '200px' },
  );
  callbacks.set(el, onVisible);
  shared.observe(el);
  return () => {
    if (callbacks.delete(el)) shared?.unobserve(el);
  };
}

/**
 * One-shot viewport visibility: `inView` flips to true the first time the
 * element scrolls near the viewport (200px margin), then stays true — the
 * lazy-mount trigger galleries and library rows use so a pool of thousands of
 * files doesn't decode everything up front.
 */
export function useInViewport<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null) as RefObject<T>;
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    return observe(el, () => setInView(true));
  }, [inView]);

  return [ref, inView];
}
