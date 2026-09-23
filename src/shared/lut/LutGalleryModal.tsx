/**
 * "Choose a look" — a rail of families on the left, a grid of looks on a real
 * photograph on the right, so picking one means looking at the actual result
 * instead of reading a name off a `<select>`. A tile click IS the choice —
 * there is nothing further to confirm, since seeing it first was the point.
 * The ★ in a tile's corner is the one thing on it that is not the choice:
 * it builds the Favourites row at the top of the rail (§6).
 *
 * **The rail is what makes a purchased pack affordable** (variant B of
 * `docs/lut-packs.md` §6, the maintainer's choice): only the open node's
 * looks are ever resolved, so a 25-look pack of 65³ lattices — 41 MB — never
 * has to be decoded to draw a screen. On a phone the rail becomes a row of
 * crumbs.
 *
 * **Opening it costs nothing (§7).** Every tile it draws was baked once
 * already: a pack's at import (`pack-thumbs.ts`), a built-in's and a film
 * stock's by `scripts/gen-lut-thumbs.mjs` and shipped in `public/lut-thumbs/`
 * — each look on the reference its family asks for, since a conversion LUT
 * read on a display-referred picture previews over-contrasted. So the gallery
 * opens without fetching or parsing a single `.cube`, where it used to fetch
 * and parse all 37 MB of them on every open to redraw pixels that could not
 * have changed.
 *
 * **"On my picture" is still here, as a CHOICE**: the open picture the host
 * passed in, or a photo the author loads right here. Then — and only then —
 * every look on screen resolves its lattice and is baked live, one at a time
 * with a tick between each, because a screenful of film stocks is real CPU
 * (~100 ms apiece, `film-layer.ts`) and one burst would hold a frame.
 * Thumbnails pop in as they finish, which reads as the grid filling in rather
 * than the modal being slow.
 *
 * ## On a phone the GRID is what the screen is for
 *
 * At 390×844 the desktop arrangement stacked — a two-line title, the scene
 * with its name, its file line, its slider and its button, the three-row
 * "tiles on…" band, the crumbs, then the footer's sentence — left ONE row of
 * tiles visible, and the maintainer's report was exactly that: *"we barely
 * see the look we want to pick"*. So the compact shell (`useIsCompact`) is a
 * different arrangement of the same parts rather than the same one squeezed:
 * a one-row header; the scene at a fixed share of the measured app height
 * with only the aimed look's name and the Compare pill under it (the wipe is
 * the drag across the picture); the filter beside a ⋯ menu holding the
 * "tiles on…" choices; the family crumbs pinned OUTSIDE the scroller as one
 * swipeable line; and the "Use this look" verb in a footer of its own, in the
 * thumb's reach, where the sentence about lattices used to be. Everything
 * that only explains is gone from that width — the sheet has an ⓘ elsewhere
 * for it — because every explaining line was a row of looks not shown.
 *
 * ## The STRENGTH is part of the choice, not a setting found afterwards
 *
 * A look at 100 % and the same look at 40 % are different pictures, and the
 * question "which look" cannot be answered without the second number — which
 * is why the scene carries a strength slider and why the pick hands it to the
 * host (`onPick(id, intensity)`), where it becomes the new layer's own. The
 * grid follows it wherever it is baking LIVE; the shipped reference tiles do
 * not, and their line already says they are the looks as authored.
 *
 * ## On desktop the modal is as tall as the screen allows
 *
 * It used to be `min(92dvh, 54rem)`, and the cap was the whole of the
 * maintainer's report: on a 1440-tall screen the header, the scene, the "tiles
 * on…" band and the footer left barely two rows of looks under them. The
 * height is now the MEASURED screen (`--app-h`, `frontend.md`) less the
 * backdrop's gutter, with no rem ceiling, and the scene takes a SHARE of it
 * rather than a fixed 21rem — so every pixel a taller screen brings is a pixel
 * of grid.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CubeLut } from '../lib/cube-parser';
import { decodePhoto } from '../media/photo-frame';
import { pickFile } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import OverflowMenu, { type OverflowItem } from '../ui/OverflowMenu';
import useDialogKeys from '../ui/use-dialog-keys';
import { useIsCompact } from '../ui/use-layout-mode';
import { loadBuiltinThumbs } from './builtin-thumbs';
import { galleryNodes, matchingItems, type GalleryItem, type GalleryNode } from './gallery-nodes';
import LookScene from './LookScene';
import { asPreviewPicture, sceneNote, type LutPreviewPicture } from './look-scene';
import {
  PREVIEW_SAMPLE_SIZE,
  bakeLutPreview,
  syntheticPreviewSample,
  type RgbBitmap,
} from './lut-preview';
import { MAX_LAYER_INTENSITY } from './lut-stack';
import LutPackImportModal from './LutPackImportModal';
import LutThumb from './LutThumb';
import { useLutFavourites, toggleFavourite } from './use-lut-favourites';
import { useLutInterpolation } from './use-lut-interpolation';
import { useLutPacks } from './use-lut-packs';

/**
 * Anything the modal can crop a preview sample from — a bare bitmap or
 * canvas, or a picture whose size is already measured beside it
 * (`look-scene.ts`), which is the shape both Develop hosts hold.
 */
export type LutPreviewSource =
  | ImageBitmap
  | HTMLCanvasElement
  | HTMLImageElement
  | LutPreviewPicture;

/** Crop `source` to a centred square and read it back as a small `RgbBitmap`. */
function sampleFromImage(source: LutPreviewPicture, size: number): RgbBitmap {
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) return syntheticPreviewSample(size);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return syntheticPreviewSample(size);
  const side = Math.min(sw, sh);
  ctx.drawImage(source.image, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
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
  /**
   * A picture already open in the host tool. It is OFFERED — "Preview on the
   * open picture" — and never taken by default: the shipped tiles cost
   * nothing, and a live bake costs a lattice per look (§7).
   */
  previewImage?: LutPreviewSource | null;
  /** What that picture is called, for the line under the scene. */
  previewLabel?: string | null;
  /**
   * True when the host's picture is LOG footage. Every host that passes a
   * picture today passes a photograph, which is display-referred — so the
   * default is the honest one, and a caller that ever hands over a log clip
   * says so rather than letting the scene caution it wrongly (`look-scene.ts`).
   */
  previewIsLog?: boolean;
  /**
   * What the strength slider starts at. A host that already has a look on the
   * picture passes its own (the single-pick "Look" control); one that ADDS a
   * layer leaves it at 1, since that is what the new layer would carry.
   */
  intensity?: number;
  title?: string;
  /**
   * The look, and how strongly the author judged it — the second number is
   * the scene's slider, and a host that has nowhere to put it may ignore it.
   */
  onPick: (id: string, intensity: number) => void;
  onClose: () => void;
}

export default function LutGalleryModal({
  selected,
  allowNone = false,
  includeFilm = false,
  previewImage = null,
  previewLabel = null,
  previewIsLog = false,
  intensity = 1,
  title = 'Choose a look',
  onPick,
  onClose,
}: LutGalleryModalProps) {
  const { interpolation } = useLutInterpolation();
  const packIndexes = useLutPacks();
  const compact = useIsCompact();

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string>(() => (includeFilm ? 'film' : 'builtin'));
  const [credits, setCredits] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState<LutPreviewSource | null>(null);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  /**
   * Which picture the looks are shown on. `null` — the default — is the
   * shipped tiles, each look on the reference its family asks for and nothing
   * fetched or parsed at all. Anything else is the LIVE bake, which is now an
   * explicit choice (`docs/lut-packs.md` §7): it is worth a lattice per look
   * only when the author asked to see them on this picture.
   */
  const [liveOn, setLiveOn] = useState<'open' | 'custom' | null>(null);

  /**
   * THE SCENE — the aimed look on the host's own picture, above the grid.
   *
   * It exists only when a host handed one over, and where it does the gesture
   * changes: a click AIMS (the scene answers), and the pick is the second
   * click, the "Use this look" button, or Enter. Without a picture there is
   * nothing to answer with, so a click stays the choice it has always been —
   * asking for two where the first shows nothing would be a regression, not a
   * convention.
   */
  const picture = useMemo(() => asPreviewPicture(previewImage), [previewImage]);
  const scene = !!picture;
  const [aimed, setAimed] = useState<string | null>(selected ?? null);
  /**
   * The before/after wipe. It lives HERE rather than in `LookScene` because
   * the slider that drives it belongs in the column beside the picture — a
   * control over a photograph is a control in the way of what it is for — and
   * the drag across the picture writes the same number.
   */
  const [compare, setCompare] = useState(false);
  const [splitX, setSplitX] = useState(0.5);
  /**
   * How strongly the aimed look is applied, and what the pick carries out.
   * Seeded from the host and kept across aims on purpose: judging three looks
   * at 60 % is one decision, not three.
   */
  const [strength, setStrength] = useState(intensity);

  // The shipped tiles. `{}` until they answer, and `{}` for good if this build
  // ships none — in which case every look simply bakes live, as it used to.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void loadBuiltinThumbs().then((t) => {
      if (live) setThumbs(t);
    });
    return () => {
      live = false;
    };
  }, []);

  const custom = useMemo(() => asPreviewPicture(customImage), [customImage]);
  const effectiveSource = liveOn === 'custom' ? custom : liveOn === 'open' ? picture : null;

  const favourites = useLutFavourites();
  const nodes = useMemo(
    () => galleryNodes(packIndexes, includeFilm, effectiveSource ? null : thumbs, favourites),
    [packIndexes, includeFilm, effectiveSource, thumbs, favourites],
  );

  // A pack forgotten while its node was open, or a first import: the rail
  // must never point at a node that is gone.
  const open = nodes.find((n) => n.id === openId) ?? nodes[0] ?? null;

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

  /**
   * A tile baked HERE follows the strength — it is on the author's own
   * picture, at the number they are judging at, and showing it at 100 %
   * beside a scene at 40 % would be two answers to one question. A shipped
   * reference tile cannot follow it and does not pretend to: it was baked
   * once, as the look was authored, and the line above the grid says so.
   */
  const tileStrength = effectiveSource ? strength : 1;
  const previews = useMemo(() => {
    const next: Record<string, RgbBitmap> = {};
    for (const [id, cube] of Object.entries(resolved)) {
      if (cube === 'error') continue;
      next[id] = bakeLutPreview(sample, cube, tileStrength, interpolation);
    }
    return next;
  }, [resolved, sample, tileStrength, interpolation]);

  const noneBitmap = useMemo(
    () => bakeLutPreview(sample, null, 1, interpolation),
    [sample, interpolation],
  );

  /** The aimed look, found across every node — a search result included. */
  const aimedItem = useMemo<GalleryItem | null>(
    () => (aimed ? (nodes.flatMap((n) => n.items).find((i) => i.id === aimed) ?? null) : null),
    [nodes, aimed],
  );

  // ONE lattice, the aimed one. This is the whole economy of the scene: the
  // grid keeps its pre-baked tiles and resolves nothing, and the only look
  // that costs anything is the one being looked at. The promise itself is
  // cached by `loadBuiltinLut` / `filmCubeFor` / `resolvePackLattice`, so
  // coming back to a look is free.
  const [aimedCube, setAimedCube] = useState<CubeLut | null>(null);
  const [aimedBusy, setAimedBusy] = useState(false);
  const [aimedError, setAimedError] = useState<string | null>(null);
  useEffect(() => {
    setAimedError(null);
    if (!scene || !aimedItem?.resolve || aimedItem.id === 'none') {
      setAimedCube(null);
      setAimedBusy(false);
      return;
    }
    let cancelled = false;
    setAimedBusy(true);
    aimedItem
      .resolve()
      .then((cube) => {
        if (!cancelled) setAimedCube(cube);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAimedCube(null);
        // A purchased look this device does not hold says why — the vault's
        // own sentence, not a generic failure (`pack-vault.ts`).
        setAimedError((e as Error).message || 'That look could not be read here.');
      })
      .finally(() => {
        if (!cancelled) setAimedBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scene, aimedItem]);

  /** A click on a tile: aim while there is a scene to answer with, else pick. */
  const touch = useCallback(
    (id: string) => {
      if (!scene) {
        // No scene, no strength slider — the look leaves as it was authored.
        onPick(id, 1);
        return;
      }
      if (id === aimed) onPick(id, strength);
      else setAimed(id);
    },
    [scene, aimed, strength, onPick],
  );
  /** What the ring sits on: the aimed look, or the worn one when nothing aims. */
  const ringed = scene ? aimed : (selected ?? null);
  const note = aimedItem ? sceneNote(aimedItem.family, previewIsLog) : null;

  const chooseImage = async () => {
    setImageError(null);
    const file = await pickFile('image/*');
    if (!file) return;
    setImageBusy(true);
    try {
      setCustomImage(await decodePhoto(file));
      setCustomLabel(file.name);
      setLiveOn('custom');
    } catch {
      setImageError(`Could not read “${file.name}” as a photo.`);
    } finally {
      setImageBusy(false);
    }
  };

  useDialogKeys({
    onCancel: credits ? () => setCredits(null) : onClose,
    // Enter takes the aimed look — `dialog-keys.ts` already stands down for a
    // focused field, so typing in the filter is untouched.
    onConfirm: scene && aimed && !aimedBusy ? () => onPick(aimed, strength) : null,
  });

  const q = query.trim().toLowerCase();
  const showNone =
    allowNone && (!q || 'no look'.includes(q) || 'original'.includes(q) || 'none'.includes(q));

  if (packsOpen) return <LutPackImportModal onClose={() => setPacksOpen(false)} />;

  const creditsFor = nodes.find((n) => n.id === credits)?.pack ?? null;

  /**
   * What the looks are shown ON. The default costs nothing — the tiles were
   * baked once, each look on the reference its family asks for — so putting
   * them on YOUR picture is a choice you make rather than a price you pay for
   * opening the picker (`docs/lut-packs.md` §7). One sentence says the state,
   * and the same three verbs change it, drawn as buttons where there is a row
   * for them and as a ⋯ menu on a phone.
   */
  const sourceLine =
    liveOn === 'custom' && customLabel
      ? `Tiles on “${customLabel}”`
      : liveOn === 'open'
        ? 'Tiles on the open picture — one lattice per look'
        : scene
          ? 'Tiles on their reference frames, so two looks stay comparable'
          : 'Each look on its own reference frame — log looks on a D-Log M frame, the rest on a photograph';
  const sourceVerbs: OverflowItem[] = [
    ...(picture && liveOn !== 'open'
      ? [
          {
            id: 'open',
            label: scene ? 'Tiles on my picture too' : 'Preview on the open picture',
            onSelect: () => setLiveOn('open'),
          },
        ]
      : []),
    {
      id: 'custom',
      label: imageBusy ? 'Reading…' : customImage ? `Preview on “${customLabel}”` : 'Preview on a photo…',
      onSelect: () => {
        // Already decoded once this session: switching back costs no second
        // read of the file.
        if (customImage) setLiveOn('custom');
        else void chooseImage();
      },
      disabled: imageBusy || liveOn === 'custom',
    },
    ...(liveOn
      ? [{ id: 'reference', label: 'Use the reference frames', onSelect: () => setLiveOn(null) }]
      : []),
  ];

  /**
   * The families as one line of crumbs: every root, the open node's
   * ancestors, its SIBLINGS and its children. The siblings are what make a
   * phone's rail usable — DJI → Classic is one tap, not back to Built-in and
   * down again — and the open node itself is in the list, which the first
   * version of this filter forgot (its branch was drawn without it, so the
   * strip read "Built-in" alone while DJI's looks were on screen).
   */
  const parentOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf('/')));
  const crumbs = nodes.filter(
    (n) =>
      n.depth === 0 ||
      (open &&
        (n.id === open.id ||
          parentOf(n.id) === parentOf(open.id) ||
          parentOf(n.id) === open.id ||
          open.id.startsWith(`${n.id}/`))),
  );
  const openNode = (node: GalleryNode) => {
    setOpenId(node.id);
    setQuery('');
  };
  // The strip swipes, so the open crumb is brought into view when the open
  // node changes — never on every render, which would fight a swipe in
  // progress. `nearest` moves nothing when it is already on screen.
  const crumbStrip = useRef<HTMLElement>(null);
  useEffect(() => {
    crumbStrip.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [open?.id]);

  const filterField = (
    <input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Filter looks…"
      aria-label="Filter looks"
      // 16px on a phone, or iOS zooms the page on focus and never zooms back.
      className={`w-full font-sans h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${
        compact ? 'text-base' : 'text-sm'
      }`}
    />
  );

  const useThisLook = (
    <Button
      size={compact ? 'md' : 'sm'}
      variant={compact ? 'primary' : 'default'}
      disabled={!aimed || aimedBusy}
      onClick={() => aimed && onPick(aimed, strength)}
    >
      Use this look
    </Button>
  );

  /**
   * The strength, beside the picture it is judged on. Dead without a look —
   * shown disabled rather than hidden, so the row does not appear and
   * disappear under the pointer as looks are aimed at.
   */
  const noLook = !aimedItem || aimedItem.id === 'none';
  const strengthSlider = (
    <>
      <input
        type="range"
        min={0}
        max={MAX_LAYER_INTENSITY}
        step={0.05}
        value={strength}
        disabled={noLook}
        onChange={(e) => setStrength(Number(e.target.value))}
        // The one gesture that says "as authored" without hunting for 100.
        onDoubleClick={() => setStrength(1)}
        aria-label="How strongly the look is applied"
        title="How strongly the look is applied (double-click for 100%)"
        className="flex-1 min-w-0 accent-accent disabled:opacity-40"
      />
      <span className="font-mono text-2xs tabular-nums text-muted min-w-[3.4ch] text-right">
        {Math.round(strength * 100)}%
      </span>
    </>
  );

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
      {/* Wider than it was (56rem), and on desktop as tall as the screen
          allows: the MEASURED height (`--app-h`) less the backdrop's 1rem
          gutter top and bottom, with no rem cap — a 54rem ceiling on a tall
          screen is a screenful of paper where rows of looks should be. On a
          phone it is the whole screen already, with tighter gaps: every 8px
          between bands is 8px of grid. */}
      <div
        className={
          compact
            ? 'w-full h-[var(--app-h,100dvh)] flex flex-col gap-2.5 bg-surface min-h-0 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]'
            : 'w-full max-w-[76rem] h-[calc(var(--app-h,100dvh)-2rem)] flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6 pb-5 min-h-0'
        }
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`m-0 font-serif truncate ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</h2>
            {!compact && (
              <p className="m-0 mt-1 text-sm text-muted">
                {scene
                  ? 'Aim a look to see it on your picture — click it again to use it.'
                  : 'Every look, on a real picture — click one to use it.'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
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

        {picture && (
          /* The band: your picture with ONE look on it. It takes HEIGHT and
             not width, which is the whole reason it is here and not in a
             third column — measured, the modal is 848 px wide inside, the
             rail takes 216, and a 420 px panel beside them leaves room for
             one tile per row. */
          <div
            className={
              compact
                ? 'flex-none flex flex-col gap-1.5'
                : 'flex-none flex gap-4 border-t border-line pt-3'
            }
          >
            {/* The picture takes the room and is shown WHOLE inside it, its
                surround the dark of a light table. */}
            {/* HEIGHT is what gives the picture presence: the band is wide
                enough for a 16:9 frame long before it is tall enough for a
                4:3 one, so growing it downwards is what fills the room. It is
                a SHARE of the measured screen at BOTH widths — a quarter on a
                phone, 28 % on desktop between a 13rem floor and a 21rem
                ceiling — so a taller screen gives the scene a little and the
                grid the rest, rather than the scene taking a fixed 21rem out
                of a short laptop's. */}
            <div
              className={
                compact
                  ? 'flex-none w-full h-[calc(var(--app-h,100dvh)*0.25)] min-h-[8rem]'
                  : 'flex-1 min-w-0 h-[clamp(13rem,calc(var(--app-h,100dvh)*0.28),21rem)]'
              }
            >
              <LookScene
                source={picture}
                cube={aimedCube}
                intensity={strength}
                interpolation={interpolation}
                compare={compare}
                splitX={splitX}
                onSplit={(x) => {
                  setCompare(true);
                  setSplitX(x);
                }}
                busy={aimedBusy}
                error={aimedError}
              />
            </div>
            {compact ? (
              /* ONE row under the picture, and it is the strength: the wipe's
                 own slider is not here (the drag across the picture writes
                 that number, and a finger is already on the picture), and the
                 aimed look's NAME is in the footer, which is drawn at this
                 width anyway. A second row here would be a row of looks. */
              <div className="flex items-center gap-2 min-w-0">
                {noLook ? (
                  <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate">
                    {aimedItem?.name ?? 'Your picture, as it is'}
                  </span>
                ) : (
                  strengthSlider
                )}
                {note && (
                  <span className="shrink-0 w-2 h-2 rounded-full bg-warn" title={note} aria-label={note} />
                )}
                <CompareToggle compare={compare} onToggle={() => setCompare((v) => !v)} />
              </div>
            ) : (
              <div className="w-[21rem] flex-none flex flex-col gap-1.5">
                <span className="text-base font-medium text-ink truncate">
                  {aimedItem?.name ?? 'Your picture, as it is'}
                </span>
                <span className="font-mono text-2xs text-muted">
                  {[previewLabel, aimedItem ? 'the look alone, without your correction' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {/* The comparison slider: what the picture is worth against the
                    original, said with a control you can put anywhere rather
                    than a gesture you have to discover. Moving it turns the
                    wipe ON — a slider that does nothing until a switch is found
                    is a dead control. */}
                {/* A DIV, not a label: a `<label>` around both made the
                    button's accessible name the slider's VALUE ("50") — the
                    browser takes a labelled control's name from the label's
                    whole text, and a screen reader then announces the switch as
                    a number. The slider names itself with `aria-label`. */}
                <div className="flex items-center gap-2.5 mt-1 text-xs text-ink-soft">
                  <CompareToggle compare={compare} onToggle={() => setCompare((v) => !v)} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(splitX * 100)}
                    onChange={(e) => {
                      setCompare(true);
                      setSplitX(Number(e.target.value) / 100);
                    }}
                    aria-label="Where the before/after divider sits"
                    className="flex-1 min-w-0 accent-accent"
                  />
                </div>
                {/* The strength, right under the wipe: the two questions a
                    look raises on your own picture are "how much of it" and
                    "against what", and they belong side by side. */}
                <div className="flex items-center gap-2.5 text-xs text-ink-soft">
                  <span className="font-mono text-2xs tracking-[0.12em] uppercase text-muted select-none">
                    Strength
                  </span>
                  {strengthSlider}
                </div>
                {note && (
                  <p className="m-0 px-2.5 py-1.5 rounded-control bg-warn-wash border border-warn-line text-xs leading-snug text-warn">
                    {note}
                  </p>
                )}
                <div className="mt-auto flex items-center gap-2 flex-wrap">
                  {useThisLook}
                  <span className="text-2xs leading-snug text-muted">
                    One lattice read — and the strength goes with your pick.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {compact ? (
          /* The filter, and the "tiles on…" choices behind one ⋯: on a phone
             the sentence and its three buttons were three rows over the grid
             for a preference set once. The sample thumbnail says which
             picture the tiles are on, when it is not the reference. */
          <div className="flex-none flex items-center gap-2">
            {effectiveSource && (
              <span className="w-8 h-8 rounded-control overflow-hidden border border-line shrink-0" title={sourceLine}>
                <LutThumb bitmap={sample} />
              </span>
            )}
            <div className="flex-1 min-w-0">{filterField}</div>
            <OverflowMenu label="What the tiles are shown on" items={sourceVerbs} size="md" />
          </div>
        ) : (
          /* ONE row, and it wraps: the sentence, the three verbs and the
             filter. It was two rows — the filter always full-width below —
             because sharing them squeezed the field to a fixed `w-40` on a
             phone; that width has its own branch now, and a second row over
             the grid on a laptop is a third of a row of looks. */
          <div className="flex items-center gap-3 flex-wrap border-y border-line py-3">
            {effectiveSource && (
              <span className="w-8 h-8 rounded-control overflow-hidden border border-line shrink-0">
                <LutThumb bitmap={sample} />
              </span>
            )}
            <span className="text-xs text-muted min-w-0 truncate">{sourceLine}</span>
            {sourceVerbs.map((verb) => (
              <Button key={verb.id} size="sm" variant="ghost" onClick={verb.onSelect} disabled={verb.disabled}>
                {verb.label}
              </Button>
            ))}
            <div className="flex-1 min-w-[12rem] max-w-[22rem] ml-auto">{filterField}</div>
          </div>
        )}
        {imageError && <p className="m-0 -mt-2 text-xs text-danger">{imageError}</p>}

        {compact && (
          /* The rail as ONE line of crumbs — the families, then the open
             branch — that swipes sideways and never wraps, pinned above the
             scroller so the way to another family is never scrolled away.
             34px tall: a finger's target, the height of the field above. */
          <nav
            ref={crumbStrip}
            className="flex-none flex gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-3 px-3"
            aria-label="Look families"
          >
            {crumbs.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => openNode(node)}
                aria-pressed={node.id === open?.id}
                className={`shrink-0 h-[2.125rem] px-3 rounded-full border text-sm whitespace-nowrap ${
                  node.id === open?.id
                    ? 'border-accent bg-accent-wash text-accent-ink'
                    : 'border-line-strong bg-paper text-ink-soft'
                }`}
              >
                {node.depth > 0 && <span className="text-muted">› </span>}
                {node.label}
                <span className="ml-1.5 font-mono text-2xs text-muted tabular-nums">{node.items.length}</span>
              </button>
            ))}
          </nav>
        )}

        <div className={compact ? 'flex-1 min-h-0 flex' : 'flex-1 min-h-0 flex gap-4'}>
          {/* The rail: every family, one open at a time. */}
          {!compact && (
            <nav
              className="w-[13.5rem] flex-none overflow-auto pr-1 -mr-1 border-r border-line"
              aria-label="Look families"
            >
              {nodes.map((node) => (
                <RailRow
                  key={node.id}
                  node={node}
                  open={!query.trim() && node.id === open?.id}
                  onOpen={() => openNode(node)}
                />
              ))}
            </nav>
          )}

          <div className="flex-1 min-w-0 overflow-auto overscroll-contain pr-1 -mr-1">
            <div className="flex flex-col gap-5">
              {/* On a phone the "No look" tile joins the open family's grid
                  rather than sitting alone on a row of its own: a row is a
                  third of the looks on screen there. */}
              {showNone && !(compact && shown.length > 0) && (
                <section className="flex flex-col gap-2">
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                    <Tile
                      id="none"
                      name="No look (original)"
                      {...(effectiveSource ? {} : thumbs.none ? { thumb: thumbs.none } : {})}
                      bitmap={noneBitmap}
                      selected={selected === 'none'}
                      aimed={ringed === 'none'}
                      onPick={touch}
                    />
                  </div>
                </section>
              )}
              {shown.map(({ node, items }) => (
                <section key={node.id} className="flex flex-col gap-2">
                  {/* On a phone the open crumb already names the family, so
                      the heading is drawn only where it carries something
                      else — a search result's family, a pack's ⓘ, a hint. */}
                  {(!compact || q || node.pack || node.hint) && (
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
                  )}
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
                    {showNone && compact && node.id === shown[0]?.node.id && (
                      <Tile
                        id="none"
                        name="No look (original)"
                        {...(effectiveSource ? {} : thumbs.none ? { thumb: thumbs.none } : {})}
                        bitmap={noneBitmap}
                        selected={selected === 'none'}
                        aimed={ringed === 'none'}
                        onPick={touch}
                      />
                    )}
                    {items.map((item) => (
                      <Tile
                        key={item.id}
                        id={item.id}
                        name={item.name}
                        thumb={item.thumb}
                        bitmap={previews[item.id]}
                        failed={resolved[item.id] === 'error'}
                        selected={selected === item.id}
                        aimed={ringed === item.id}
                        favourite={favourites.includes(item.id)}
                        onPick={touch}
                        onToggleFavourite={toggleFavourite}
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

        {compact ? (
          /* The verb, in the thumb's reach — only where there is a scene to
             aim in. Without one a tap IS the pick, the ✕ is in the header,
             and a footer would be a band of nothing over the grid. */
          scene && (
            <div className="flex-none flex items-center gap-3 border-t border-line pt-2.5">
              <span className="flex-1 min-w-0 text-xs text-muted truncate">
                {aimedItem
                  ? noLook || strength === 1
                    ? aimedItem.name
                    : `${aimedItem.name} · ${Math.round(strength * 100)}%`
                  : 'Tap a look to see it on your picture.'}
              </span>
              {useThisLook}
            </div>
          )
        ) : (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="m-0 text-xs text-muted">
              Baked from the same lattice the export uses — what you see here is what you get.
            </p>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The wipe as a switch: what it IS, not what pressing it does. */
function CompareToggle({ compare, onToggle }: { compare: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={compare}
      title={compare ? 'Show the graded picture whole' : 'Wipe it against the original'}
      className={`flex-none h-7 px-2 rounded-control border font-mono text-2xs tracking-[0.08em] uppercase cursor-pointer transition-colors ${
        compare
          ? 'border-accent bg-accent-wash text-accent-ink'
          : 'border-line-strong bg-paper text-muted hover:text-ink'
      }`}
    >
      Compare
    </button>
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

/**
 * One look: the whole tile is the pick, exactly like `HookPicturesModal`'s
 * grid — plus a ★ in its corner, which is the one thing on the tile that is
 * NOT the pick. That is why the tile is a `<div>` holding two buttons rather
 * than a button with a button inside it, which is invalid HTML and leaves the
 * star unreachable from a keyboard.
 *
 * The star is drawn at every width rather than on hover: a phone has no
 * hover, and a control you can only find with a pointer is a control half the
 * devices do not have.
 */
function Tile({
  id,
  name,
  thumb,
  bitmap,
  failed = false,
  selected,
  aimed = false,
  favourite = false,
  onPick,
  onToggleFavourite,
}: {
  id: string;
  name: string;
  thumb?: string;
  bitmap?: RgbBitmap | undefined;
  failed?: boolean;
  selected: boolean;
  /**
   * The look the SCENE is showing. Where there is no scene the caller sets it
   * from the selection, so a picker without a picture looks exactly as it
   * always did.
   */
  aimed?: boolean;
  favourite?: boolean;
  onPick: (id: string) => void;
  /** Omitted for "No look (original)", which is the absence of a look, not one. */
  onToggleFavourite?: (id: string) => void;
}) {
  return (
    <div
      className={`group relative flex flex-col gap-1 p-1 rounded-control border bg-paper transition-colors ${
        aimed
          ? 'border-accent ring-2 ring-accent/40'
          : selected
            ? 'border-accent'
            : 'border-line hover:border-line-strong'
      }`}
    >
      <button
        type="button"
        onClick={() => onPick(id)}
        aria-pressed={selected}
        title={name}
        className="flex flex-col gap-1 cursor-pointer text-left"
      >
        <span className="block w-full h-[74px] rounded-[6px] overflow-hidden bg-paper-2 max-[820px]:h-[92px]">
          {thumb ? (
            // Baked once already — at import for a pack, at
            // `gen-lut-thumbs.mjs` time for a built-in — on the reference this
            // look's family asks for. Nothing is decoded here, which is what
            // lets the gallery open without touching a `.cube` at all.
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          ) : failed ? (
            <span className="grid place-items-center w-full h-full font-mono text-3xs text-danger">failed</span>
          ) : (
            <LutThumb bitmap={bitmap} />
          )}
        </span>
        <span className="block text-2xs leading-tight text-ink-soft truncate group-hover:text-ink">{name}</span>
      </button>
      {onToggleFavourite && (
        <button
          type="button"
          onClick={() => onToggleFavourite(id)}
          aria-pressed={favourite}
          aria-label={favourite ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
          title={favourite ? 'In your favourites' : 'Add to favourites'}
          // 28px: a finger's target on a tile, where 24 read as decoration.
          className={`absolute top-1.5 right-1.5 grid place-items-center w-7 h-7 rounded-full text-sm leading-none transition-colors ${
            favourite
              ? 'bg-accent-wash text-accent-ink'
              : 'bg-[rgba(20,18,15,0.35)] text-on-media opacity-70 hover:opacity-100'
          }`}
        >
          <span aria-hidden="true">{favourite ? '★' : '☆'}</span>
        </button>
      )}
    </div>
  );
}
