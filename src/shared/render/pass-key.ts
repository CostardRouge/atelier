/**
 * Keys for render passes — what lets a render SKIP the passes it drew last
 * time (`pass-plan.ts`, `planResume`; `graph.ts`, the kept upstream).
 *
 * A pass's `key` names everything it draws with: two passes with the same key
 * draw the same picture from the same input. A factory builds it from its
 * parameters when they are plain data (`dataKey`), or from the identity of
 * an object that is immutable and replaced on change — a composed cube, a
 * gain field (`identityKey`). A pass that reads anything else at draw time
 * (a clock, a counter) has NO key, and the graph never skips it nor anything
 * after it.
 *
 * Pure and DOM-free.
 */

const ids = new WeakMap<object, number>();
let next = 1;

/** A short id for an object, the same for its lifetime, never reused. */
export function identityKey(o: object | null | undefined): string {
  if (!o) return '0';
  let id = ids.get(o);
  if (id === undefined) {
    id = next;
    next += 1;
    ids.set(o, id);
  }
  return String(id);
}

/** Plain parameters as one string; a typed array is spelt out, not `[object]`. */
export function dataKey(...parts: unknown[]): string {
  return JSON.stringify(parts, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v));
}

let serial = 0;

/** A key no other pass ever gets: for a pass built afresh whenever its inputs change. */
export function freshKey(prefix: string): string {
  serial += 1;
  return `${prefix}#${serial}`;
}
