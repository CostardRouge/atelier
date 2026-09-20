/**
 * "Choose a look" — a rail of families on the left, a grid of looks baked
 * live on the right, so picking one means looking at the actual result
 * instead of reading a name off a `<select>`. A tile click IS the choice —
 * there is nothing further to confirm, since seeing it first was the point.
 *
 * **The rail is what makes a purchased pack affordable** (variant B of
 * `docs/lut-packs.md` §6, the maintainer's choice): only the open node's
 * looks are ever resolved, so a 25-look pack of 65³ lattices — 41 MB — never
 * has to be decoded to draw a screen. A pack look does not even bake: its
 * thumbnail was baked once at import, on the reference its family asks for
 * (`pack-thumbs.ts`). On a phone the rail becomes a row of crumbs.
 *
 * The sample is the truest thing on hand: a picture already open in the host
 * tool when one is passed in, otherwise a photo the author loads right here
 * ("Preview on a photo…"), otherwise a procedural test chart
 * (`lut-preview.ts`) — a sky, a neutral ramp, saturated colour and a skin
 * tone, the handful of things a look actually changes.
 *
 * Every built-in or film look is resolved (fetched + parsed, or generated)
 * one at a time with a tick between each: a screenful of film stocks is real
 * CPU, ~100 ms apiece (`film-layer.ts`), and baking them as one burst would
 * hold a frame. Thumbnails pop in as they finish rather than all at once,
 * which reads as the grid filling in rather than the modal being slow.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CubeLut } from '../lib/cube-parser';
import { decodePhoto } from '../media/photo-frame';
import { pickFile } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import useDialogKeys from '../ui/use-dialog-keys';
import { galleryNodes, matchingItems, type GalleryNode } from './gallery-nodes';
import {
  PREVIEW_SAMPLE_SIZE,
  bakeLutPreview,
  syntheticPreviewSample,
  type RgbBitmap,
} from './lut-preview';
import LutPackImportModal from './LutPackImportModal';
import LutThumb from './LutThumb';
import { useLutInterpolation } from './use-lut-interpolation';
import { useLutPacks } from './use-lut-packs';

/** Anything the modal can crop a preview sample from. */
export type LutPreviewSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

/** Crop `source` to a centred square and read it back as a small `RgbBitmap`. */
function sampleFromImage(source: LutPreviewSource, size: number): RgbBitmap {
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) return syntheticPreviewSample(size);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return syntheticPreviewSample(size);
  const side = Math.min(sw, sh);
  ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data };
}

export interface LutGalleryModalProps {
  /** Highlighted with a ring: a builtin id, `film:<id>`, `pack:<pack>/<look>`, or 'none'. */
  selected?: string;
  /** Draws a "No look (original)" tile first — the single-pick "Look" control wants this. */
  allowNone?: boolean;
  /** Include the film stocks section — `GradePanel`'s "Add a look" already offers them. */
  includeFilm?: boolean;
  /** A picture already open in the host tool — the truest preview. Falls back to a test chart. */
  previewImage?: LutPreviewSource | null;
  title?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}

export default function LutGalleryModal({
  selected,
  allowNone = false,
  includeFilm = false,
  previewImage = null,
  title = 'Choose a look',
  onPick,
  onClose,
}: LutGalleryModalProps) {
  const { interpolation } = useLutInterpolation();
  const packIndexes = useLutPacks();
  const nodes = useMemo(
    () => galleryNodes(packIndexes, includeFilm),
    [packIndexes, includeFilm],
  );

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string>(() => (includeFilm ? 'film' : 'builtin'));
  const [credits, setCredits] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState<LutPreviewSource | null>(null);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);

  // A pack forgotten while its node was open, or a first import: the rail
  // must never point at a node that is gone.
  const open = nodes.find((n) => n.id === openId) ?? nodes[0] ?? null;

  const effectiveSource = customImage ?? previewImage;
  const [sample, setSample] = useState<RgbBitmap>(() =>
    effectiveSource ? sampleFromImage(effectiveSource, PREVIEW_SAMPLE_SIZE) : syntheticPreviewSample(),
  );
  useEffect(() => {
    setSample(
      effectiveSource ? sampleFromImage(effectiveSource, PREVIEW_SAMPLE_SIZE) : syntheticPreviewSample(),
    );
  }, [effectiveSource]);

  const shown = useMemo(
    () =>
      query.trim()
        ? matchingItems(nodes, query)
        : open
          ? [{ node: open, items: open.items }]
          : [],
    [nodes, query, open],
  );
  // Only what is on SCREEN is resolved — the rail's whole point, and the
  // difference between opening a pack's picker and decoding 41 MB.
  const pending = useMemo(
    () => shown.flatMap(({ items }) => items).filter((i) => !i.thumb && i.resolve),
    [shown],
  );

  // Resolved one item at a time; the promise itself is cached by
  // `loadBuiltinLut`/`filmCubeFor`, so a look already loaded elsewhere in the
  // session (or by a previous open of this gallery) comes back instantly.
  const [resolved, setResolved] = useState<Record<string, CubeLut | 'error'>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of pending) {
        try {
          const cube = await item.resolve!();
          if (cancelled) return;
          setResolved((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: cube }));
        } catch {
          if (!cancelled) setResolved((prev) => ({ ...prev, [item.id]: 'error' }));
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const previews = useMemo(() => {
    const next: Record<string, RgbBitmap> = {};
    for (const [id, cube] of Object.entries(resolved)) {
      if (cube === 'error') continue;
      next[id] = bakeLutPreview(sample, cube, 1, interpolation);
    }
    return next;
  }, [resolved, sample, interpolation]);

  const noneBitmap = useMemo(
    () => bakeLutPreview(sample, null, 1, interpolation),
    [sample, interpolation],
  );

  const chooseImage = async () => {
    setImageError(null);
    const file = await pickFile('image/*');
    if (!file) return;
    setImageBusy(true);
    try {
      setCustomImage(await decodePhoto(file));
      setCustomLabel(file.name);
    } catch {
      setImageError(`Could not read “${file.name}” as a photo.`);
    } finally {
      setImageBusy(false);
    }
  };

  useDialogKeys({ onCancel: credits ? () => setCredits(null) : onClose });

  const q = query.trim().toLowerCase();
  const showNone =
    allowNone && (!q || 'no look'.includes(q) || 'original'.includes(q) || 'none'.includes(q));

  if (packsOpen) return <LutPackImportModal onClose={() => setPacksOpen(false)} />;

  const creditsFor = nodes.find((n) => n.id === credits)?.pack ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[56rem] h-[min(88dvh,50rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 pb-5 min-h-0 max-[820px]:max-w-none max-[820px]:h-[var(--app-h,100dvh)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:px-4 max-[820px]:pt-[max(1rem,env(safe-area-inset-top))] max-[820px]:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 font-serif text-2xl">{title}</h2>
            <p className="m-0 mt-1 text-sm text-muted">Every look, baked live — click one to use it.</p>
          </div>
          <div className="flex items-center gap-1">
            {/* Purchased packs live in this browser's vault, not in the
                build, so importing one is a verb of the picker rather than a
                setting somewhere else (`docs/lut-packs.md` §6). */}
            <Button size="sm" variant="ghost" onClick={() => setPacksOpen(true)}>
              Packs…
            </Button>
            <IconButton label="Close" variant="ghost" onClick={onClose}>
              {Icons.close}
            </IconButton>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-y border-line py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-8 h-8 rounded-control overflow-hidden border border-line shrink-0">
              <LutThumb bitmap={sample} />
            </span>
            <span className="text-xs text-muted min-w-0 truncate">
              Previewing on{' '}
              {customLabel ? `“${customLabel}”` : previewImage ? 'the open picture' : 'a sample chart'}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void chooseImage()} disabled={imageBusy}>
              {imageBusy ? 'Reading…' : 'Preview on a photo…'}
            </Button>
            {customImage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCustomImage(null);
                  setCustomLabel(null);
                }}
              >
                Use {previewImage ? 'the open picture' : 'the sample chart'}
              </Button>
            )}
          </div>
          {/* Its own row, always full-width — sharing a flex-wrap row with the
              buttons above left it squeezed to a fixed `w-40` on a phone, since
              a plain `w-*` utility and a `max-[…]:w-full` one can land in
              either order in the generated stylesheet and the LAST one wins,
              not the more specific one. */}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter looks…"
            aria-label="Filter looks"
            className="w-full font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 max-[820px]:text-base"
          />
        </div>
        {imageError && <p className="m-0 -mt-2 text-xs text-danger">{imageError}</p>}

        <div className="flex-1 min-h-0 flex gap-4">
          {/* The rail: every family, one open at a time. */}
          <nav
            className="w-[13.5rem] flex-none overflow-auto pr-1 -mr-1 border-r border-line max-[820px]:hidden"
            aria-label="Look families"
          >
            {nodes.map((node) => (
              <RailRow
                key={node.id}
                node={node}
                open={!query.trim() && node.id === open?.id}
                onOpen={() => {
                  setOpenId(node.id);
                  setQuery('');
                }}
              />
            ))}
          </nav>

          <div className="flex-1 min-w-0 overflow-auto pr-1 -mr-1">
            {/* On a phone the rail is a row of crumbs — the families, then the
                open branch, in the thumb's reach. */}
            <div className="hidden max-[820px]:flex gap-1.5 flex-wrap mb-3">
              {nodes
                .filter((n) => n.depth === 0 || n.id.startsWith(`${open?.id ?? ''}/`) || open?.id.startsWith(`${n.id}/`))
                .map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => {
                      setOpenId(node.id);
                      setQuery('');
                    }}
                    aria-pressed={node.id === open?.id}
                    className={`px-2.5 py-1 rounded-full border text-xs ${
                      node.id === open?.id
                        ? 'border-accent bg-accent-wash text-accent-ink'
                        : 'border-line-strong bg-paper text-ink-soft'
                    }`}
                  >
                    {node.depth > 0 && <span className="text-muted">› </span>}
                    {node.label}
                  </button>
                ))}
            </div>

            <div className="flex flex-col gap-5">
              {showNone && (
                <section className="flex flex-col gap-2">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                    <Tile
                      id="none"
                      name="No look (original)"
                      bitmap={noneBitmap}
                      selected={selected === 'none'}
                      onPick={onPick}
                    />
                  </div>
                </section>
              )}
              {shown.map(({ node, items }) => (
                <section key={node.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
                      {node.label}
                    </h3>
                    {node.pack && (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={`About ${node.label}`}
                        onClick={() => setCredits(credits === node.id ? null : node.id)}
                      >
                        {Icons.info}
                      </IconButton>
                    )}
                    {node.hint && <span className="text-2xs text-warn">{node.hint}</span>}
                  </div>
                  {credits === node.id && creditsFor && (
                    <p className="m-0 px-3 py-2 rounded-control bg-paper-2 border border-line text-xs text-ink-soft">
                      <span className="font-medium text-ink">{creditsFor.name || 'Pack'}</span>
                      {creditsFor.author && <> — {creditsFor.author}</>}
                      {creditsFor.url && (
                        <>
                          {' · '}
                          <a
                            href={creditsFor.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-accent-ink underline"
                          >
                            where it came from
                          </a>
                        </>
                      )}
                      <br />
                      <span className="text-muted">
                        Bought looks, kept in this browser — they never leave it.
                      </span>
                    </p>
                  )}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                    {items.map((item) => (
                      <Tile
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        thumb={item.thumb}
                        bitmap={previews[item.id]}
                        failed={resolved[item.id] === 'error'}
                        selected={selected === item.id}
                        onPick={onPick}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {shown.length === 0 && !showNone && (
                <p className="m-0 text-sm text-muted">
                  {query.trim() ? `No look matches “${query}”.` : 'Nothing here yet.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="m-0 text-xs text-muted">
            Baked from the same lattice the export uses — what you see here is what you get.
          </p>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One family in the rail: its name, its depth, how many looks it holds. */
function RailRow({
  node,
  open,
  onOpen,
}: {
  node: GalleryNode;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={open}
      title={node.hint ?? node.label}
      className={`flex w-full items-center gap-2 text-left px-2 py-1.5 rounded-control text-sm transition-colors ${
        open ? 'bg-accent-wash text-accent-ink' : 'text-ink-soft hover:bg-paper-2'
      }`}
      style={{ paddingLeft: `${0.5 + node.depth * 0.85}rem` }}
    >
      <span className={`flex-1 min-w-0 truncate ${node.depth === 0 ? 'font-medium text-ink' : ''}`}>
        {node.label}
      </span>
      {node.hint && <span className="text-warn" aria-hidden="true">•</span>}
      <span className="font-mono text-2xs text-muted tabular-nums">{node.items.length}</span>
    </button>
  );
}

/** One look: the whole tile is the pick, exactly like `HookPicturesModal`'s grid. */
function Tile({
  id,
  name,
  thumb,
  bitmap,
  failed = false,
  selected,
  onPick,
}: {
  id: string;
  name: string;
  thumb?: string;
  bitmap?: RgbBitmap | undefined;
  failed?: boolean;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={selected}
      title={name}
      className={`group flex flex-col gap-1 p-1 rounded-control border cursor-pointer bg-paper text-left transition-colors ${
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-line hover:border-line-strong'
      }`}
    >
      <span className="block w-full h-[74px] rounded-[6px] overflow-hidden bg-paper-2 max-[820px]:h-[92px]">
        {thumb ? (
          // Baked at import on the reference this look's family asks for —
          // nothing to decode here, which is what lets a pack be drawn at all.
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : failed ? (
          <span className="grid place-items-center w-full h-full font-mono text-3xs text-danger">failed</span>
        ) : (
          <LutThumb bitmap={bitmap} />
        )}
      </span>
      <span className="block text-2xs leading-tight text-ink-soft truncate group-hover:text-ink">{name}</span>
    </button>
  );
}
