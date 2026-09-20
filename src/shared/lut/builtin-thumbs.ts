/**
 * The built-in looks' PRE-BAKED picker tiles — `public/lut-thumbs/`, made by
 * `scripts/gen-lut-thumbs.mjs` and committed.
 *
 * The gallery used to fetch and parse every lattice and re-bake every tile on
 * each open, on a synthetic chart that never changes: 37 MB of `.cube` text to
 * draw a grid whose pixels could not differ from the last time. A built-in
 * look and the two reference pictures are both fixed at build time, so the
 * tile is too (`docs/lut-packs.md` §7).
 *
 * **A missing manifest is a valid state, not an error.** Nothing here is
 * required: without it the gallery bakes live exactly as it used to, which is
 * also what makes the generator safe to forget after dropping a `.cube` into
 * `public/luts/` — the new look simply costs what the others no longer do.
 */

/** Read once per tab; a failure answers `{}` and is not retried into a loop. */
let pending: Promise<Record<string, string>> | null = null;

/**
 * `<gallery item id> → absolute URL`, for the tiles this build ships.
 *
 * The ids are the gallery's own (`gallery-nodes.ts`): a built-in's manifest
 * id, `film:<stock>`, and `none` for the untouched tile.
 */
export function loadBuiltinThumbs(): Promise<Record<string, string>> {
  pending ??= fetchManifest().catch(() => ({}));
  return pending;
}

async function fetchManifest(): Promise<Record<string, string>> {
  // Through `BASE_URL`, never a literal base path (`deployment.md`).
  const dir = `${import.meta.env.BASE_URL}lut-thumbs/`;
  const res = await fetch(`${dir}index.json`);
  if (!res.ok) return {};
  const raw: unknown = await res.json();
  const thumbs = (raw as { thumbs?: unknown })?.thumbs;
  if (!thumbs || typeof thumbs !== 'object' || Array.isArray(thumbs)) return {};
  const out: Record<string, string> = {};
  for (const [id, file] of Object.entries(thumbs as Record<string, unknown>)) {
    // A generated file, but it is still fetched input: only a plain relative
    // file name becomes an `<img src>`.
    if (typeof file === 'string' && /^[a-z0-9._-]+$/i.test(file)) out[id] = `${dir}${file}`;
  }
  return out;
}

/** Tests, and anything that needs the next read to go back to the network. */
export function resetBuiltinThumbs(): void {
  pending = null;
}
