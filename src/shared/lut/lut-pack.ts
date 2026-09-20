/**
 * A PACK of purchased looks: its index, the names it reads a folder tree into,
 * and the reference a document stores instead of a lattice.
 *
 * The plan is `docs/lut-packs.md`. Three of its rules shape this module:
 *
 * - **A document carries a REFERENCE, never a lattice** (§3, rule 1). A layer
 *   that wears a pack look stores pack id + look id + hash — about 200 bytes —
 *   in the `customText` a saved layer already has, exactly as a film stock
 *   stores its settings there. No document schema changes, in any tool.
 * - **A purchased look is never altered** (§3, rule 2). Nothing here resamples,
 *   renames a look's FILE or touches a lattice; the labels below are a
 *   presentation of the author's own folder names.
 * - **The tree's depth varies** (§2): `Conversion / DJI / a look` is three
 *   levels, `Creative / a look` is two. Nothing may assume a camera level.
 *
 * Pure and DOM-free: paths in, an index out. Reading the files, hashing them
 * and storing them is the vault's job.
 */

/** Where a look's preview must be baked — a conversion LUT expects LOG input (§7). */
export type PackFamily = 'log' | 'rec709';

/** A node of the pack's tree: a category, or a camera inside one. */
export interface PackNode {
  /** Path-shaped and stable: `conversion`, `conversion/dji`. */
  id: string;
  label: string;
  /** A caution the picker shows on the node — "D-Log, not D-Log M". */
  hint?: string;
  children?: PackNode[];
}

/** One look of the pack. */
export interface PackLook {
  /** Path-shaped and stable, the node's id plus the look's own slug. */
  id: string;
  label: string;
  /** The node this look hangs from (`''` for a look at the pack's root). */
  node: string;
  /** The file inside the pack folder, kept verbatim so a re-import matches. */
  file: string;
  /** Which reference its thumbnail is baked on. */
  family: PackFamily;
  /** Grid size, once the file has been parsed. */
  lattice?: number;
  /** Bytes of the source `.cube`. */
  bytes?: number;
  /** SHA-256 of the source file, lowercase hex — the vault's and file store's key. */
  hash?: string;
  /**
   * The look baked onto its family's reference at import, as a data URL
   * (`pack-thumbs.ts`): ~4 KB, so the picker draws 25 purchased looks without
   * decoding 41 MB of lattices, and a phone draws them at all.
   */
  thumb?: string;
}

/** The pack index — the small JSON half, the one that syncs (§5.1). */
export interface LutPackIndex {
  id: string;
  /** The pack's own name, e.g. `AUTHENTIC`. */
  name: string;
  author: string;
  /** Where it was bought, shown in the picker's credits popover. */
  url?: string;
  tree: PackNode[];
  looks: PackLook[];
  /** Node or look ids the author does not want offered — the looks stay stored. */
  hidden: string[];
}

/** What a saved layer carries in place of a lattice. */
export interface PackRef {
  pack: string;
  look: string;
  hash: string;
}

/** The `source` a pack layer carries, beside `custom`, `film` and the built-ins. */
export const PACK_SOURCE = 'pack';

export function isPackLayer(layer: { source: string }): boolean {
  return layer.source === PACK_SOURCE;
}

/** A reference as a layer stores it — JSON in `customText`, like a film stock's settings. */
export function writePackRef(ref: PackRef): string {
  return JSON.stringify({ pack: ref.pack, look: ref.look, hash: ref.hash });
}

/** A reference read back out of a document, or null if it says nothing usable. */
export function readPackRef(text: string | null | undefined): PackRef | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object') return null;
    const { pack, look, hash } = raw as Record<string, unknown>;
    if (typeof pack !== 'string' || !pack) return null;
    if (typeof look !== 'string' || !look) return null;
    return { pack, look, hash: typeof hash === 'string' ? hash : '' };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- stored */

/** Bumped when a stored index needs reading differently; `migratePackIndex` is where that happens. */
export const PACK_VERSION = 1;

/**
 * An index read back out of storage — or off a Winnow later — onto the
 * current shape, or null when it is not an index at all. Defensive for the
 * same reason `gradeOrNull` is (`saved-grade.ts`): a stored document is
 * untrusted input, and a half-read pack would offer looks whose bytes are
 * not there.
 */
export function migratePackIndex(raw: unknown): LutPackIndex | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (!Array.isArray(p.looks)) return null;
  const looks = p.looks.filter(isLookish).map(readLook);
  return {
    id: p.id,
    name: typeof p.name === 'string' ? p.name : '',
    author: typeof p.author === 'string' ? p.author : '',
    ...(typeof p.url === 'string' && p.url ? { url: p.url } : {}),
    tree: Array.isArray(p.tree) ? p.tree.filter(isNodeish).map(readNode) : [],
    looks,
    hidden: Array.isArray(p.hidden) ? p.hidden.filter((h): h is string => typeof h === 'string') : [],
  };
}

function isLookish(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const l = value as { id?: unknown; file?: unknown };
  return typeof l.id === 'string' && !!l.id && typeof l.file === 'string';
}

function readLook(raw: Record<string, unknown>): PackLook {
  const lattice = typeof raw.lattice === 'number' && Number.isFinite(raw.lattice) ? raw.lattice : undefined;
  const bytes = typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : undefined;
  return {
    id: String(raw.id),
    label: typeof raw.label === 'string' && raw.label ? raw.label : String(raw.id),
    node: typeof raw.node === 'string' ? raw.node : '',
    file: String(raw.file),
    family: raw.family === 'log' ? 'log' : 'rec709',
    ...(lattice ? { lattice } : {}),
    ...(bytes ? { bytes } : {}),
    ...(typeof raw.hash === 'string' && raw.hash ? { hash: raw.hash } : {}),
    // A data URL and nothing else: a stored index is untrusted input, and an
    // arbitrary string here would go straight into an <img src>.
    ...(typeof raw.thumb === 'string' && raw.thumb.startsWith('data:image/')
      ? { thumb: raw.thumb }
      : {}),
  };
}

function isNodeish(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const n = value as { id?: unknown };
  return typeof n.id === 'string' && !!n.id;
}

function readNode(raw: Record<string, unknown>): PackNode {
  const children = Array.isArray(raw.children) ? raw.children.filter(isNodeish).map(readNode) : [];
  return {
    id: String(raw.id),
    label: typeof raw.label === 'string' && raw.label ? raw.label : String(raw.id),
    ...(typeof raw.hint === 'string' && raw.hint ? { hint: raw.hint } : {}),
    ...(children.length ? { children } : {}),
  };
}

/* ------------------------------------------------------------------ names */

/**
 * The brands a pack names its folders after. The vocabulary exists because
 * one pack writes `Apple` and `APPLE` for the same camera in two categories:
 * without it, "my cameras" could not filter across them, and the tree would
 * show a brand twice (`docs/lut-packs.md` §5.3).
 */
const BRANDS: Record<string, string> = {
  apple: 'Apple',
  blackmagic: 'Blackmagic',
  canon: 'Canon',
  dji: 'DJI',
  fujifilm: 'Fujifilm',
  gopro: 'GoPro',
  insta360: 'Insta360',
  leica: 'Leica',
  nikon: 'Nikon',
  olympus: 'Olympus',
  panasonic: 'Panasonic',
  red: 'RED',
  samsung: 'Samsung',
  sigma: 'Sigma',
  sony: 'Sony',
};

/**
 * Log formats, as their makers write them. A folder or a file says `SLOG3` or
 * `S-LOG3`; a picker that says `Slog3` reads as a typo, and one that says
 * `S-Log3 · S-Gamut3.Cine` reads as the thing you shot.
 */
const TERMS: [RegExp, string][] = [
  [/^s-?log-?3$/i, 'S-Log3'],
  [/^s-?log-?2$/i, 'S-Log2'],
  [/^s-?gam(m)?ut-?3?\.?cine$/i, 'S-Gamut3.Cine'],
  [/^s-?gam(m)?ut-?3$/i, 'S-Gamut3'],
  [/^s-?gam(m)?ut$/i, 'S-Gamut'],
  [/^d-?log-?m$/i, 'D-Log M'],
  [/^d-?log$/i, 'D-Log'],
  [/^c-?log-?([23])$/i, 'C-Log$1'],
  [/^c-?log$/i, 'C-Log'],
  [/^n-?log$/i, 'N-Log'],
  [/^v-?log$/i, 'V-Log'],
  [/^f-?log-?2$/i, 'F-Log2'],
  [/^f-?log$/i, 'F-Log'],
  [/^i-?log$/i, 'I-Log'],
  [/^h-?log$/i, 'H-Log'],
  [/^b-?log$/i, 'B-Log'],
  [/^log$/i, 'Log'],
  [/^rec-?709$/i, 'Rec.709'],
  [/^lc-?709(type)?-?(a)?$/i, 'LC-709'],
  [/^gen-?([0-9])$/i, 'Gen $1'],
  [/^chaud$/i, 'warm'],
  [/^froid$/i, 'cold'],
  [/^hdr$/i, 'HDR'],
  [/^sdr$/i, 'SDR'],
];

/** Words a pack repeats on every folder and file, and that say nothing in a picker. */
const NOISE = /^(luts?|pack|preset|presets|cube|v[0-9]+)$/i;

/** Split a folder or file name into the words a label is built from. */
function words(raw: string): string[] {
  return raw
    .replace(/\.cube$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** One word, as a person writes it: a brand, a log format, or Title Case. */
function pretty(word: string): string {
  const brand = BRANDS[word.toLowerCase()];
  if (brand) return brand;
  for (const [re, out] of TERMS) if (re.test(word)) return word.replace(re, out);
  if (/^[0-9]+$/.test(word)) return word;
  // A word already written with inner capitals or punctuation is left alone:
  // it is either an acronym or the author's own styling.
  if (/[A-Z].*[A-Z]/.test(word) && !/^[A-Z]+$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * A folder or file name as the picker shows it: the pack's own name dropped
 * (every file in AUTHENTIC starts with `AUTHENTIC_LUT_`), the filler words
 * dropped, parenthesised remarks kept as a suffix, brands and log formats
 * spelled the way their makers do.
 */
export function prettyName(raw: string, drop: readonly string[] = []): string {
  const dropped = new Set(drop.map((d) => d.toLowerCase()).filter(Boolean));
  const [, head = raw, note = ''] = /^([^(]*)\(([^)]*)\)\s*$/.exec(raw.replace(/\.cube$/i, '')) ?? [];
  const base = words(head).filter((w) => !NOISE.test(w));
  const kept = base.filter((w) => !dropped.has(w.toLowerCase()));
  const suffix = note ? words(note).map(pretty).join(' ') : '';
  // A look named after the pack itself (`AUTHENTIC_LUT.cube`) would drop to
  // nothing: it keeps the author's own words, as the author wrote them.
  const label = kept.length ? kept.map(pretty).join(' ') : base.join(' ');
  if (label && suffix) return `${label} · ${suffix}`;
  return label || suffix || raw.replace(/\.cube$/i, '');
}

/** Words that say nothing on their own — what is left when a name is over-trimmed. */
const GENERIC = /^(log|hdr|sdr|rec\.709|warm|cold|clean|neutral)$/i;

/**
 * Drop the camera a file repeats from its own folder — `Sony_SLOG3…` under
 * `Sony` is `S-Log3` — but only ONE leading word, and never when what is left
 * says nothing: `APPLE_APPLE LOG` under `Apple` is the format **Apple Log**,
 * not `Log`, and the second `Apple` is the format's own word.
 */
export function stripNodePrefix(label: string, nodeLabel: string | undefined): string {
  if (!nodeLabel) return label;
  const nodeWords = new Set(words(nodeLabel).map((w) => w.toLowerCase()));
  const parts = label.split(' ');
  if (parts.length < 2 || !nodeWords.has(parts[0].toLowerCase())) return label;
  const rest = parts.slice(1);
  if (rest.every((w) => GENERIC.test(w))) return label;
  return rest.join(' ');
}

/** A path-shaped id: lowercase, punctuation folded to single dashes. */
export function slug(raw: string): string {
  return (
    raw
      .replace(/\.cube$/i, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

/**
 * Which reference a category's looks preview on. A conversion or one-click
 * look expects LOG input and reads wrong on anything else (§7); everything
 * else is judged on an ordinary picture. Read from the CATEGORY, because
 * that is the only thing a `.cube` file tells us about its input.
 */
export function familyFor(categoryName: string): PackFamily {
  return /conversion|one.?click|log|convert/i.test(categoryName) ? 'log' : 'rec709';
}

/**
 * A caution shown on a node: the pack ships DJI looks for **D-Log**, while
 * the maintainer's drones record **D-Log M** — the wrong input curve, which
 * is a thing to say on the node rather than a reason to hide the looks
 * (`docs/lut-packs.md` §2).
 */
function hintFor(nodeLabel: string, lookLabels: readonly string[]): string | undefined {
  if (!/^dji$/i.test(nodeLabel)) return undefined;
  const mentionsDLog = lookLabels.some((l) => /d-log(?! m)/i.test(l));
  const mentionsDLogM = lookLabels.some((l) => /d-log m/i.test(l));
  if (mentionsDLog && !mentionsDLogM) return 'D-Log, not D-Log M — check your camera’s profile.';
  return undefined;
}

/* ------------------------------------------------------------------ index */

/** One file of the folder the author picked. */
export interface PackFileEntry {
  /** Posix path relative to the pack's root folder. */
  path: string;
  bytes?: number;
  /** Grid size, when the file has already been parsed. */
  lattice?: number;
  hash?: string;
}

export interface BuildPackOptions {
  id: string;
  /** Defaults to the root folder's name. */
  name?: string;
  author?: string;
  url?: string;
  hidden?: readonly string[];
}

/**
 * Read a folder listing into an index: the tree the picker draws, and one
 * entry per look.
 *
 * Everything that is not a `.cube` is left out — the pack the maintainer
 * bought also ships four 140 MB grain clips and a tutorial, which are not
 * looks (§2). Depth beyond a category and a camera is FLATTENED into the
 * camera's label rather than nested further: three levels is what a picker
 * can show, and no pack seen so far goes deeper.
 */
export function buildPackIndex(
  files: readonly PackFileEntry[],
  options: BuildPackOptions,
): LutPackIndex {
  const name = (options.name ?? '').trim();
  const author = (options.author ?? '').trim();
  // Words to drop from every label: the pack's own name, however it is
  // written in a file name.
  const drop = [...words(name), ...words(name.replace(/[-]+/g, ' '))];

  const tree: PackNode[] = [];
  const looks: PackLook[] = [];
  const byId = new Map<string, PackNode>();
  const usedLookIds = new Set<string>();

  for (const entry of files) {
    const parts = entry.path.split('/').filter((p) => p && p !== '.');
    const fileName = parts.pop();
    if (!fileName || !/\.cube$/i.test(fileName)) continue;
    if (fileName.startsWith('.')) continue;

    const [categoryRaw, ...rest] = parts;
    const categoryLabel = categoryRaw ? prettyName(categoryRaw, drop) : '';
    const family = familyFor(categoryRaw ?? '');

    let node: PackNode | undefined;
    if (categoryRaw) {
      node = ensureNode(tree, byId, slug(categoryLabel || categoryRaw), categoryLabel);
      if (rest.length) {
        // Everything below the category is ONE level: `A/B/C/look.cube`
        // becomes the camera `B · C`, rather than a tree nobody can draw.
        const childLabel = rest.map((p) => prettyName(p, drop)).join(' · ');
        node = ensureNode(
          (node.children ??= []),
          byId,
          `${node.id}/${slug(childLabel)}`,
          childLabel,
        );
      }
    }

    const label = stripNodePrefix(prettyName(fileName, drop), node?.label);
    const base = node ? `${node.id}/${slug(label)}` : slug(label);
    let id = base;
    // Two files can clean up to the same label (`Rec709 Clean` in two
    // categories is fine — the node differs — but not twice in one node).
    for (let n = 2; usedLookIds.has(id); n += 1) id = `${base}-${n}`;
    usedLookIds.add(id);

    looks.push({
      id,
      label,
      node: node?.id ?? '',
      file: entry.path,
      family,
      ...(entry.lattice ? { lattice: entry.lattice } : {}),
      ...(entry.bytes ? { bytes: entry.bytes } : {}),
      ...(entry.hash ? { hash: entry.hash } : {}),
    });
  }

  for (const node of byId.values()) {
    const labels = looks.filter((l) => l.node === node.id).map((l) => l.label);
    const hint = hintFor(node.label, labels);
    if (hint) node.hint = hint;
  }

  return {
    id: options.id,
    name,
    author,
    ...(options.url ? { url: options.url } : {}),
    tree,
    looks,
    hidden: [...(options.hidden ?? [])],
  };
}

function ensureNode(
  into: PackNode[],
  byId: Map<string, PackNode>,
  id: string,
  label: string,
): PackNode {
  const known = byId.get(id);
  if (known) return known;
  const node: PackNode = { id, label };
  byId.set(id, node);
  into.push(node);
  return node;
}

/* ----------------------------------------------------------------- asking */

/** The look of this id, or null. */
export function lookIn(index: LutPackIndex, lookId: string): PackLook | null {
  return index.looks.find((l) => l.id === lookId) ?? null;
}

/**
 * True when the author put this look out of the way — its node is hidden, or
 * the look itself is. Hiding is presentation only: a grade that already wears
 * a hidden look still renders (§6).
 */
export function isHidden(index: LutPackIndex, look: PackLook): boolean {
  if (!index.hidden.length) return false;
  if (index.hidden.includes(look.id)) return true;
  return index.hidden.some((h) => look.node === h || look.node.startsWith(`${h}/`));
}

/** The looks the picker offers, in file order, hidden ones left out. */
export function visibleLooks(index: LutPackIndex): PackLook[] {
  return index.looks.filter((l) => !isHidden(index, l));
}

/** How a look is named where it must say which pack it came from. */
export function lookLabel(index: LutPackIndex, look: PackLook): string {
  const node = nodeLabelPath(index.tree, look.node);
  return [index.name || index.author, ...node, look.label].filter(Boolean).join(' · ');
}

/** The labels of a node's ancestors, outermost first. */
export function nodeLabelPath(tree: readonly PackNode[], nodeId: string): string[] {
  if (!nodeId) return [];
  const out: string[] = [];
  let level: readonly PackNode[] = tree;
  for (const step of nodeId.split('/')) {
    const found: PackNode | undefined = level.find((n) => n.id.split('/').pop() === step);
    if (!found) break;
    out.push(found.label);
    level = found.children ?? [];
  }
  return out;
}

/** Every node of the tree, flattened depth-first — what a rail draws. */
export function flattenNodes(
  tree: readonly PackNode[],
  depth = 0,
): { node: PackNode; depth: number }[] {
  const out: { node: PackNode; depth: number }[] = [];
  for (const node of tree) {
    out.push({ node, depth });
    if (node.children?.length) out.push(...flattenNodes(node.children, depth + 1));
  }
  return out;
}

/** The looks hanging from this node, its descendants included. */
export function looksUnder(index: LutPackIndex, nodeId: string): PackLook[] {
  return visibleLooks(index).filter(
    (l) => l.node === nodeId || l.node.startsWith(`${nodeId}/`),
  );
}
