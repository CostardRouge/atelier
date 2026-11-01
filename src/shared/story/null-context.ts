/**
 * A 2D context that draws nothing — what the Studio runs a post on to learn
 * WHICH objects it draws and WHEN (`studio.ts`, `objectTracks`), hundreds of
 * frames at a time, without a pixel: every method is a no-op returning the
 * context itself (a gradient, a pattern, a path are the same sink), a
 * property set is kept and read back, and text is measured roughly, which is
 * all a layout pass needs. Works where there is no DOM, so the sampling is
 * tested in Node. (pure)
 */
export function nullContext(width = 1080, height = 1920): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {
    globalAlpha: 1,
    font: '10px sans-serif',
    canvas: { width, height },
  };
  const sink: object = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop in store) return store[prop];
      if (prop === 'measureText')
        return (s: string) => {
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(store.font))?.[1] ?? 10);
          const width = String(s).length * px * 0.55;
          return { width, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
        };
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === Symbol.toPrimitive) return () => '';
      return () => sink;
    },
    set(_t, prop, value) {
      store[prop] = value;
      return true;
    },
    apply() {
      return sink;
    },
  });
  return sink as CanvasRenderingContext2D;
}
