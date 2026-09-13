import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * A box's inner width, kept current by a `ResizeObserver` — for a zone that
 * FITS its content to the room it is given (the long trip's heatmap, the
 * loupe's ruler) rather than scaling it by a zoom. Zero until measured, and
 * a caller draws nothing meaningful at zero.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
