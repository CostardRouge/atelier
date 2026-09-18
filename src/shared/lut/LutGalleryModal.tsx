/**
 * "Choose a look" — a grid of every built-in LUT (and, where asked, the film
 * stocks) baked live onto a sample image, so picking one means looking at the
 * actual result instead of reading a name off a `<select>`. A tile click IS
 * the choice — there is nothing further to confirm, since seeing it first was
 * the point.
 *
 * The sample is the truest thing on hand: a picture already open in the host
 * tool when one is passed in, otherwise a photo the author loads right here
 * ("Preview on a photo…"), otherwise a procedural test chart
 * (`lut-preview.ts`) — a sky, a neutral ramp, saturated colour and a skin
 * tone, the handful of things a look actually changes.
 *
 * Every look is resolved (fetched + parsed, or — a film stock — generated)
 * one at a time with a tick between each: a screenful of film stocks is real
 * CPU, ~100 ms apiece (`film-layer.ts`), and baking them as one burst would
 * hold a frame. Thumbnails pop in as they finish rather than all at once,
 * which reads as the grid filling in rather than the modal being slow.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CubeLut } from '../lib/cube-parser';
import { filmCubeFor } from '../film/film-layer';
import { FILM_GROUP_LABEL, FILM_STOCKS, filmSettingsFor } from '../film/stocks';
import { decodePhoto } from '../media/photo-frame';
import { pickFile } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import useDialogKeys from '../ui/use-dialog-keys';
import { LUT_GROUPS, UNGROUPED_LUTS } from './builtin-luts';
import {
  PREVIEW_SAMPLE_SIZE,
  bakeLutPreview,
  syntheticPreviewSample,
  type RgbBitmap,
} from './lut-preview';
import LutThumb from './LutThumb';
import { loadBuiltinLut } from './restore-grade';
import { useLutInterpolation } from './use-lut-interpolation';

/** Anything the modal can crop a preview sample from. */
export type LutPreviewSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement;

interface GalleryItem {
  id: string;
  name: string;
  resolve: () => Promise<CubeLut>;
}

interface GallerySection {
  /** Section header; '' draws no header (the ungrouped built-ins). */
  label: string;
  items: GalleryItem[];
}

function buildSections(includeFilm: boolean): GallerySection[] {
  const sections: GallerySection[] = [];
  if (includeFilm) {
    sections.push({
      label: FILM_GROUP_LABEL,
      items: FILM_STOCKS.map((s) => ({
        id: `film:${s.id}`,
        name: s.name,
        resolve: () => Promise.resolve(filmCubeFor(filmSettingsFor(s.id))),
      })),
    });
  }
  if (UNGROUPED_LUTS.length) {
    sections.push({
      label: '',
      items: UNGROUPED_LUTS.map((l) => ({
        id: l.id,
        name: l.name,
        resolve: () => loadBuiltinLut(l.id).then((r) => r.lut),
      })),
    });
  }
  for (const g of LUT_GROUPS) {
    sections.push({
      label: g.label,
      items: g.luts.map((l) => ({
        id: l.id,
        name: l.name,
        resolve: () => loadBuiltinLut(l.id).then((r) => r.lut),
      })),
    });
  }
  return sections;
}

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
  /** Highlighted with a ring: a builtin id, `film:<id>`, or 'none'. */
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
  const sections = useMemo(() => buildSections(includeFilm), [includeFilm]);

  const [query, setQuery] = useState('');
  const [customImage, setCustomImage] = useState<LutPreviewSource | null>(null);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const effectiveSource = customImage ?? previewImage;
  const [sample, setSample] = useState<RgbBitmap>(() =>
    effectiveSource ? sampleFromImage(effectiveSource, PREVIEW_SAMPLE_SIZE) : syntheticPreviewSample(),
  );
  useEffect(() => {
    setSample(
      effectiveSource ? sampleFromImage(effectiveSource, PREVIEW_SAMPLE_SIZE) : syntheticPreviewSample(),
    );
  }, [effectiveSource]);

  // Resolved one item at a time; the promise itself is cached by
  // `loadBuiltinLut`/`filmCubeFor`, so a look already loaded elsewhere in the
  // session (or by a previous open of this gallery) comes back instantly.
  const [resolved, setResolved] = useState<Record<string, CubeLut | 'error'>>({});
  useEffect(() => {
    let cancelled = false;
    setResolved({});
    (async () => {
      for (const item of sections.flatMap((s) => s.items)) {
        try {
          const cube = await item.resolve();
          if (cancelled) return;
          setResolved((prev) => ({ ...prev, [item.id]: cube }));
        } catch {
          if (!cancelled) setResolved((prev) => ({ ...prev, [item.id]: 'error' }));
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sections]);

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

  useDialogKeys({ onCancel: onClose });

  const q = query.trim().toLowerCase();
  const visibleSections = sections
    .map((s) => ({ ...s, items: q ? s.items.filter((i) => i.name.toLowerCase().includes(q)) : s.items }))
    .filter((s) => s.items.length > 0);
  const showNone =
    allowNone && (!q || 'no look'.includes(q) || 'original'.includes(q) || 'none'.includes(q));

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
          <IconButton label="Close" variant="ghost" onClick={onClose}>
            {Icons.close}
          </IconButton>
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

        <div className="flex-1 min-h-0 overflow-auto pr-1 -mr-1">
          <div className="flex flex-col gap-5">
            {showNone && (
              <section className="flex flex-col gap-2">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                  <Tile id="none" name="No look (original)" bitmap={noneBitmap} selected={selected === 'none'} onPick={onPick} />
                </div>
              </section>
            )}
            {visibleSections.map((section) => (
              <section key={section.label || '·'} className="flex flex-col gap-2">
                {section.label && (
                  <h3 className="m-0 font-mono text-2xs tracking-[0.16em] uppercase text-muted">
                    {section.label}
                  </h3>
                )}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                  {section.items.map((item) => (
                    <Tile
                      key={item.id}
                      id={item.id}
                      name={item.name}
                      bitmap={previews[item.id]}
                      failed={resolved[item.id] === 'error'}
                      selected={selected === item.id}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            ))}
            {visibleSections.length === 0 && !showNone && (
              <p className="m-0 text-sm text-muted">No look matches “{query}”.</p>
            )}
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

/** One look: the whole tile is the pick, exactly like `HookPicturesModal`'s grid. */
function Tile({
  id,
  name,
  bitmap,
  failed = false,
  selected,
  onPick,
}: {
  id: string;
  name: string;
  bitmap: RgbBitmap | undefined;
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
        {failed ? (
          <span className="grid place-items-center w-full h-full font-mono text-3xs text-danger">failed</span>
        ) : (
          <LutThumb bitmap={bitmap} />
        )}
      </span>
      <span className="block text-2xs leading-tight text-ink-soft truncate group-hover:text-ink">{name}</span>
    </button>
  );
}
