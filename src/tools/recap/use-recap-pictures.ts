import { useEffect, useMemo, useRef, useState } from 'react';
import { makeFrameGrader } from '../../shared/lut/frame-grader';
import type { LutStack } from '../../shared/lut/use-lut-stack';
import { gradeKey } from '../../shared/lut/saved-grade';
import type { RecapDoc, RecapPicture } from '../../shared/recap/recap-doc';
import type { Drawable } from '../../shared/recap/recap-paint';
import { printOf, type PrintContext } from './recap-media';
import { pictureMaterial, printKey } from '../../shared/recap/recap-raw';

export interface PicturesState {
  /** The still a picture draws now — developed and wearing the look — or null while it is not in hand. */
  still: (key: string) => Drawable | null;
  /** Prints being fetched or made. */
  loading: number;
  /** Pictures nothing can give in this visit (a local file not handed over again, another instance). */
  missing: string[];
  /** Moves whenever a picture lands — what a stage repaints on. */
  version: number;
}

/** A graded copy: the grader's canvas is its own and reused, so the picture is copied out of it. */
export function gradedCopy(stack: LutStack, pic: RecapPicture, bmp: ImageBitmap): Drawable | null {
  const lut = stack.composeWith(pic.develop ?? null);
  if (!lut) return null;
  try {
    const grader = makeFrameGrader(lut, bmp.width, bmp.height, 1, [], [], stack.film);
    try {
      const out = grader.render(bmp);
      const copy = new OffscreenCanvas(bmp.width, bmp.height);
      copy.getContext('2d')!.drawImage(out, 0, 0);
      return { image: copy, width: bmp.width, height: bmp.height };
    } finally {
      grader.dispose();
    }
  } catch {
    // No WebGL2 here: the picture draws as shot rather than not at all.
    return null;
  }
}

/**
 * The pictures a recap SHOWS, ready to paint: each print read from the
 * device or made once (`recap-media.ts`), decoded, then graded through the
 * picture's own develop under the recap's look — the Trips and Studio rule:
 * what the author did to a photograph is part of the photograph.
 */
export function useRecapPictures(doc: RecapDoc, keys: readonly string[], ctx: PrintContext, stack: LutStack): PicturesState {
  const bitmaps = useRef(new Map<string, ImageBitmap>());
  const graded = useRef(new Map<string, { key: string; drawable: Drawable | null }>());
  const asked = useRef(new Set<string>());
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(0);
  const [version, setVersion] = useState(0);
  const byKey = useMemo(() => new Map(doc.pictures.map((p) => [p.key, p])), [doc.pictures]);
  const byKeyRef = useRef(byKey);
  byKeyRef.current = byKey;
  const docRef = useRef(doc);
  docRef.current = doc;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // A RAW is loaded from its material (`recap-raw.ts`): a change of material is a different print.
  const wantKeys = keys.map((k) => {
    const pic = byKey.get(k);
    return pic ? printKey(k, pictureMaterial(pic, doc)) : k;
  });
  const loadedAs = useRef(new Map<string, string>());
  const keysKey = keys.join('|');
  const wantKey = wantKeys.join('|');
  useEffect(() => {
    let changed = false;
    keys.forEach((k, i) => {
      const was = loadedAs.current.get(k);
      if (was !== undefined && was !== wantKeys[i]) {
        bitmaps.current.get(k)?.close();
        bitmaps.current.delete(k);
        graded.current.delete(k);
        asked.current.delete(k);
        loadedAs.current.delete(k);
        changed = true;
      }
    });
    if (changed) setVersion((v) => v + 1);
  }, [wantKey]);
  // A picture that was missing is asked again when a way to it arrives (a file handed over, a Winnow connected).
  const ctxKey = `${ctx.instance ?? ''}|${ctx.files.size}`;

  useEffect(() => {
    let alive = true;
    const want = keysKey ? keysKey.split('|') : [];
    const todo = want.filter((k) => !bitmaps.current.has(k) && !asked.current.has(k));
    if (!todo.length) return;
    todo.forEach((k) => asked.current.add(k));
    setLoading((n) => n + todo.length);
    let next = 0;
    const one = async (key: string) => {
      const pic = byKeyRef.current.get(key);
      let ok = false;
      try {
        const material = pic ? pictureMaterial(pic, docRef.current) : 'render';
        const blob = pic ? await printOf(pic, ctxRef.current, material) : null;
        if (blob) {
          const bmp = await createImageBitmap(blob);
          bitmaps.current.get(key)?.close();
          bitmaps.current.set(key, bmp);
          loadedAs.current.set(key, printKey(key, material));
          ok = true;
        }
      } catch {
        ok = false;
      }
      if (!alive) return;
      if (!ok) asked.current.delete(key);
      setMissing((m) => (ok ? m.filter((x) => x !== key) : m.includes(key) ? m : [...m, key]));
      setLoading((n) => Math.max(0, n - 1));
      setVersion((v) => v + 1);
    };
    const worker = async () => {
      while (alive && next < todo.length) await one(todo[next++]);
    };
    void Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
    return () => {
      alive = false;
      // What was asked and not landed is asked again by the next run.
      for (const k of todo) if (!bitmaps.current.has(k)) asked.current.delete(k);
    };
  }, [keysKey, ctxKey, wantKey]);

  // A different look, or a picture's develop changed: its graded copy is made again at its next draw.
  const look = `${gradeKey(doc.look ?? null)}|${stack.composed ? 'c' : '-'}|${stack.layers.length}`;
  useEffect(() => {
    setVersion((v) => v + 1);
  }, [look]);

  useEffect(
    () => () => {
      for (const b of bitmaps.current.values()) b.close();
      bitmaps.current.clear();
      loadedAs.current.clear();
      // Emptied, so all of it is asked again if the editor comes back (a remount keeps the refs).
      asked.current.clear();
      graded.current.clear();
    },
    [],
  );

  const still = (key: string): Drawable | null => {
    const bmp = bitmaps.current.get(key);
    if (!bmp) return null;
    const pic = byKeyRef.current.get(key);
    const plain = { image: bmp, width: bmp.width, height: bmp.height };
    if (!pic) return plain;
    const wants = `${look}|${pic.develop ? JSON.stringify(pic.develop) : '-'}`;
    const held = graded.current.get(key);
    if (held && held.key === wants) return held.drawable ?? plain;
    const drawable = gradedCopy(stack, pic, bmp);
    graded.current.set(key, { key: wants, drawable });
    return drawable ?? plain;
  };

  return { still, loading, missing, version };
}
