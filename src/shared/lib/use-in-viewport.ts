import { useEffect, useRef, useState, type RefObject } from 'react';

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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView]);

  return [ref, inView];
}
