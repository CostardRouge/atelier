import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * A box's inner width, kept current by a `ResizeObserver` — for a zone that
 * FITS its content to the room it is given (the long trip's heatmap, the
 * loupe's ruler) rather than scaling it by a zoom. Zero until measured, and
 * a caller draws nothing meaningful at zero.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const [ref, size] = useElementSize<T>();
  return [ref, size.width];
}

/** Both inner sides, the same way — for a box whose HEIGHT is shared out (the stage and the band under it). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((cur) => (cur.width === el.clientWidth && cur.height === el.clientHeight ? cur : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
