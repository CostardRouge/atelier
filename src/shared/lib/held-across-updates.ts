/**
 * A value read from a bundled file, kept LIVE across hot updates — for a
 * module the dev server's writer rewrites under a running app (a house style:
 * `shared/roadtrip/house-style-bundle.ts`, `shared/projects/house-style-bundle.ts`).
 *
 * Such a module accepts its own update so saving never reloads the page. The
 * obvious way to refresh the value — copy it into the old instance from an
 * `accept(cb)` callback — works ONCE: Vite clears the old instance's callbacks
 * when the new one registers, so from the second update on the value lands in
 * an instance nobody imports. Here it lives in a holder kept in `hot.data`,
 * which survives every re-evaluation, and each new instance writes into it.
 *
 * The caller still writes `import.meta.hot.accept()` itself: Vite recognises a
 * self-accepting module by reading that call in the module's own source.
 */
export function heldAcrossUpdates<T>(hot: ImportMeta['hot'], value: T): () => T {
  const holder = (hot?.data.held as { value: T } | undefined) ?? { value };
  holder.value = value;
  if (hot) hot.data.held = holder;
  return () => holder.value;
}
