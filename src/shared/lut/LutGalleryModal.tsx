/**
 * "Choose a look" — on a desktop a WORKBENCH: the host's picture in a column
 * at the left, as tall as the dialog, with its controls under it; the looks
 * as a panel at the right (the filter, what the tiles are shown on, the rail
 * of families, the grid); one verb in a pinned footer. A tile click AIMS the
 * look at the picture, and the pick is the second click, Enter or "Use this
 * look" (`docs/look-picker-redesign.md`, face A — the maintainer's pick on
 * 2026-10-01 over the band it replaced).
 *
 * **The stage column is as wide as the picture needs, never wider**
 * (`stageColumnBox`, `look-scene.ts`): a portrait frame is bounded by the
 * column's height and hands the width it does not use to the grid; a
 * landscape one is capped at half the body. The old band gave a portrait
 * picture 189 × 336 px on the maintainer's screen and three quarters of its
 * width to a black table; the column gives it 565 × 1004.
 *
 * **The rail is what makes a purchased pack affordable** (variant B of
 * `docs/lut-packs.md` §6, the maintainer's choice): only the open node's
 * looks are ever resolved, so a 25-look pack of 65³ lattices — 41 MB — never
 * has to be decoded to draw a screen. Where the shell is `expanded` the rail
 * is a column; on a `medium` shell (a tablet) and on a phone it is one line
 * of crumbs over the grid, since a 152px rail beside a half-width stage would
 * leave the grid one tile wide.
 *
 * **Opening it costs nothing (§7).** Every tile it draws was baked once
 * already: a pack's at import (`pack-thumbs.ts`), a built-in's and a film
 * stock's by `scripts/gen-lut-thumbs.mjs` and shipped in `public/lut-thumbs/`
 * — each look on the reference its family asks for, since a conversion LUT
 * read on a display-referred picture previews over-contrasted. So the gallery
 * opens without fetching or parsing a single `.cube`.
 *
 * **"On my picture" is still here, as a CHOICE** — a `Segmented` now, where a
 * sentence and two ghost verbs stood: the open picture the host passed in, or
 * a photo the author loads right here. Then — and only then — every look on
 * screen resolves its lattice and is baked live, one at a time with a tick
 * between each, because a screenful of film stocks is real CPU (~100 ms
 * apiece, `film-layer.ts`) and one burst would hold a frame.
 *
 * ## What is NOT drawn any more on a desktop, and why
 *
 * The subtitle, the "tiles on…" sentence, the lattice sentence under the verb
 * and the footer's sentence are one note behind an ⓘ beside the title — the
 * suite's rule for standing prose (`frontend.md`, «Standing prose folds behind
 * InfoDot»); the phone branch had already dropped every one of them. The
 * footer's Close went with it: ✕ in the header is the one way out, and the
 * footer exists only where there is a verb to pin. The wipe's second slider
 * went too — two sliders of one dress for two different numbers read as a
 * misalignment, and the divider is dragged on the picture, where a press
 * places it. The controls are `FieldRow`s — the inspector grammar every side
 * panel speaks — so their label column and their tracks line up.
 *
 * ## On a phone the GRID is what the screen is for
 *
 * The compact arrangement of 2026-09-21 is untouched: a one-row header; the
 * scene at a fixed share of the measured app height with only the aimed
 * look's name and the A/B pill under it (the wipe is the drag across the
 * picture); the filter beside a ⋯ menu holding the "tiles on…" choices; the
 * family crumbs pinned OUTSIDE the scroller as one swipeable line; and the
 * "Use this look" verb in a footer of its own, in the thumb's reach. Measured
 * at 390×844 and 390×664: six tiles, two full rows.
 *
 * ## The STRENGTH is part of the choice, not a setting found afterwards
 *
 * A look at 100 % and the same look at 40 % are different pictures, and the
 * question "which look" cannot be answered without the second number — which
 * is why the card carries a strength slider and why the pick hands it to the
 * host (`onPick(id, intensity)`), where it becomes the new layer's own. The
 * grid follows it wherever it is baking LIVE; the shipped reference tiles do
 * not, and the ⓘ says they are the looks as authored.
 *
 * ## The dialog is as big as the screen allows
 *
 * The height is the MEASURED screen (`--app-h`, `frontend.md`) less the
 * backdrop's gutter, with no rem ceiling; the width is `min(96vw, 100rem)`,
 * where a 76rem cap used to hold the picture and the tiles back on exactly
 * the screens that had room for them.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CubeLut } from '../lib/cube-parser';
import { decodePhoto } from '../media/photo-frame';
import { pickFile } from '../sources/file-sources';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';
import { InfoDotButton } from '../ui/InfoDot';
import { FieldRow } from '../ui/Inspector';
import OverflowMenu, { type OverflowItem } from '../ui/OverflowMenu';
import Segmented, { type SegmentedOption } from '../ui/Segmented';
import useDialogKeys from '../ui/use-dialog-keys';
import { useAtLeast, useIsCompact } from '../ui/use-layout-mode';
import { loadBuiltinThumbs } from './builtin-thumbs';
import { galleryNodes, matchingItems, type GalleryItem, type GalleryNode } from './gallery-nodes';
import LookScene from './LookScene';
import {
  SCENE_PIXELS,
  asPreviewPicture,
  sceneNote,
  stageColumnBox,
  type LutPreviewPicture,
  type StageBox,
} from './look-scene';
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
import { revealInScroller } from '../ui/reveal';

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

/** The gap between the picture and the card under it, in the stage column. */
const STAGE_GAP = 12;

/** What the tiles are shown on. `null` in state is the reference frames. */
type ShownOn = 'reference' | 'open' | 'custom';

export interface LutGalleryModalProps {
  /** Highlighted with a ring: a builtin id, `film:<id>`, `pack:<pack>/<look>`, or 'none'. */
  selected?: string;
  /** Draws a "No look (original)" tile first — the single-pick "Look" control wants this. */
  allowNone?: boolean;
  /** Include the film stocks section — `GradePanel`'s "Add a look" already offers them. */
  includeFilm?: boolean;
  /**
   * A picture already open in the host tool. It is OFFERED — "My picture" —
   * and never taken by default: the shipped tiles cost nothing, and a live
   * bake costs a lattice per look (§7).
   */
  previewImage?: LutPreviewSource | null;
  /** What that picture is called, for the line under the look's name. */
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
   * the card's slider, and a host that has nowhere to put it may ignore it.
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
  // The rail is a column only where the shell is wide enough to pay for one
  // beside a stage; a tablet gets the crumbs a phone already had.
  const railed = useAtLeast('expanded');

  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string>(() => (includeFilm ? 'film' : 'builtin'));
  const [credits, setCredits] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState<LutPreviewSource | null>(null);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  // The picture picked here is this modal's alone: it goes with the modal.
  const customRef = useRef<LutPreviewSource | null>(null);
  customRef.current = customImage;
  useEffect(
    () => () => {
      const held = customRef.current;
      if (typeof ImageBitmap !== 'undefined' && held instanceof ImageBitmap) held.close();
    },
    [],
  );
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
  /** The standing explanation, behind the ⓘ beside the title. */
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutId = useId();
  const strengthId = useId();

  /**
   * THE SCENE — the aimed look on the host's own picture.
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
   * the switch that drives it belongs in the card under the picture — a
   * control over a photograph is a control in the way of what it is for — and
   * the drag across the picture writes the divider's position.
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
   * once, as the look was authored, and the ⓘ says so.
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
      // At the scene's own budget, never whole — the scene draws 1280 × 720
      // and uploads what it is handed per draw — and the picture it replaces
      // is let go, as it now is on close.
      const next = await decodePhoto(file, { budgetPixels: SCENE_PIXELS });
      setCustomImage((prev) => {
        if (prev instanceof ImageBitmap) prev.close();
        return next;
      });
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
    // focused field and for a focused button, so a tile's own Enter is one
    // pick, not two.
    onConfirm: scene && aimed && !aimedBusy ? () => onPick(aimed, strength) : null,
  });

  /**
   * THE STAGE COLUMN'S SIZE, measured. The body's size and the card's height
   * are read off the DOM (a ResizeObserver on both — the card grows when the
   * caution appears) and `stageColumnBox` turns them into a width for the
   * column and a height for the picture's box; a layout effect, so the first
   * paint is already at the measured size and nothing jumps when the dialog
   * opens.
   */
  const bodyRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState<StageBox | null>(null);
  useLayoutEffect(() => {
    if (compact || !picture) return;
    const body = bodyRef.current;
    if (!body) return;
    const aspect = picture.height > 0 ? picture.width / picture.height : 0;
    const measure = () => {
      const card = cardRef.current;
      setStageBox(
        stageColumnBox({
          bodyWidth: body.clientWidth,
          bodyHeight: body.clientHeight,
          cardHeight: card ? card.offsetHeight + STAGE_GAP : 0,
          aspect,
        }),
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    if (cardRef.current) ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [compact, picture]);

  /**
   * ← → ↑ ↓ walk the tiles — the aim, where there is a scene, and the focus
   * everywhere — so a look is found with the hands on the keyboard, the way
   * the Develop filmstrip is. The column count is read off the layout rather
   * than assumed: the grid is `auto-fill`.
   */
  const walkTiles = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    if ((e.target as HTMLElement).closest('input')) return;
    const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-tile]'));
    if (!tiles.length) return;
    const focused = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]');
    const current = tiles.findIndex((t) => t === focused || (!focused && t.dataset.tile === ringed));
    const perRow = Math.max(1, tiles.filter((t) => Math.abs(t.offsetTop - tiles[0].offsetTop) < 2).length);
    const from = current < 0 ? 0 : current;
    const step =
      e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? perRow : -perRow;
    const next = current < 0 ? 0 : Math.max(0, Math.min(tiles.length - 1, from + step));
    e.preventDefault();
    const tile = tiles[next];
    const id = tile.dataset.tile!;
    tile.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    revealInScroller(tile, { block: 'nearest', inline: 'nearest' });
    if (scene) setAimed(id);
  };

  const q = query.trim().toLowerCase();
  const showNone =
    allowNone && (!q || 'no look'.includes(q) || 'original'.includes(q) || 'none'.includes(q));

  const creditsFor = nodes.find((n) => n.id === credits)?.pack ?? null;

  /**
   * What the looks are shown ON. The default costs nothing — the tiles were
   * baked once, each look on the reference its family asks for — so putting
   * them on YOUR picture is a choice you make rather than a price you pay for
   * opening the picker (`docs/lut-packs.md` §7). On a desktop the choice is a
   * `Segmented` with a "Photo…" verb beside it; on a phone the same choices
   * are a ⋯ menu beside the filter, and a sentence is its title.
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
  const shownOn: ShownOn = liveOn ?? 'reference';
  const shownOnOptions: SegmentedOption<ShownOn>[] = [
    {
      id: 'reference',
      label: 'Reference',
      title: 'Every look on the reference frame its family asks for — nothing fetched',
    },
    ...(picture
      ? [
          {
            id: 'open' as const,
            label: 'My picture',
            title: 'Every look on screen baked on the open picture — one lattice per look',
          },
        ]
      : []),
    ...(customImage
      ? [{ id: 'custom' as const, label: 'Photo', title: customLabel ? `On “${customLabel}”` : 'On the photo you loaded' }]
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
    revealInScroller(crumbStrip.current?.querySelector<HTMLElement>('[aria-pressed="true"]'), { inline: 'nearest', block: 'nearest' });
  }, [open?.id]);

  // After the LAST hook: this return used to sit above the two hooks of the
  // crumb strip, so opening the import rendered fewer hooks than the gallery
  // had — React's "rendered fewer hooks than expected", straight into the
  // error boundary — the moment *Import a pack…* was clicked.
  if (packsOpen) return <LutPackImportModal onClose={() => setPacksOpen(false)} />;

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

  /**
   * The strength, under the picture it is judged on. Dead without a look —
   * shown disabled rather than hidden, so the row does not appear and
   * disappear under the pointer as looks are aimed at.
   */
  const noLook = !aimedItem || aimedItem.id === 'none';
  const strengthSlider = (
    <>
      <input
        id={strengthId}
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

  /** The families as a swipeable line — a phone's rail, and a tablet's. */
  const crumbStripNav = (
    <nav
      ref={crumbStrip}
      className={`flex-none flex gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        compact ? '-mx-3 px-3' : ''
      }`}
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
  );

  /**
   * The grid: one section per shown node (a search lists one per family it
   * hit). A heading is drawn only where it carries something the rail or the
   * crumb does not — a search result's family, a pack's ⓘ, a hint — because
   * a heading that repeats the open row is a row of looks not shown. The "No
   * look" tile joins the first grid rather than sitting on a row of its own.
   */
  const noneTile = (
    <Tile
      id="none"
      name="No look (original)"
      {...(effectiveSource ? {} : thumbs.none ? { thumb: thumbs.none } : {})}
      bitmap={noneBitmap}
      selected={selected === 'none'}
      aimed={ringed === 'none'}
      hint={scene && !compact}
      onPick={touch}
    />
  );
  // Fixed 8rem tracks on a desktop, never `minmax(8rem, 1fr)`: a flexible
  // track stretches a tile towards a strip whenever the row's width is just
  // short of one more column, and a fixed one leaves that slack at the end of
  // the row instead, where it reads as margin. (A `minmax` with a LENGTH as
  // its max is worse still: `auto-fill` then counts tracks by that max.)
  const gridClass = `grid gap-2 ${
    compact ? 'grid-cols-[repeat(auto-fill,minmax(88px,1fr))]' : 'grid-cols-[repeat(auto-fill,8rem)]'
  }`;
  const grid = (
    <div
      className="flex-1 min-w-0 min-h-0 overflow-auto overscroll-contain pr-1 -mr-1"
      onKeyDown={walkTiles}
    >
      <div className="flex flex-col gap-5">
        {showNone && shown.length === 0 && (
          <section className="flex flex-col gap-2">
            <div className={gridClass}>{noneTile}</div>
          </section>
        )}
        {shown.map(({ node, items }, index) => (
          <section key={node.id} className="flex flex-col gap-2">
            {(q || node.pack || node.hint) && (
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
            <div className={gridClass}>
              {showNone && index === 0 && noneTile}
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
                  hint={scene && !compact}
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
  );

  const rail = (
    <nav
      className="w-[9.5rem] flex-none overflow-auto pr-1 -mr-1 border-r border-line"
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
  );

  /** What the footer says about the state, beside the verb. */
  const say = aimedItem ? (
    <>
      <span className="font-medium text-ink">{aimedItem.name}</span>
      {!noLook && strength !== 1 && (
        <span className="font-mono text-xs text-muted"> · {Math.round(strength * 100)} %</span>
      )}
      {note && <span className="text-warn"> · expects a log source</span>}
    </>
  ) : (
    'Aim a look to see it on your picture.'
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
      {/* As tall as the screen allows: the MEASURED height (`--app-h`) less
          the backdrop's 1rem gutter top and bottom, with no rem cap — and as
          wide as the screen allows too, where a 76rem cap used to hold the
          picture and the tiles back. On a phone it is the whole screen
          already, with tighter gaps: every 8px between bands is 8px of grid. */}
      <div
        className={
          compact
            ? 'w-full h-[var(--app-h,100dvh)] flex flex-col gap-2.5 bg-surface min-h-0 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]'
            : 'w-full max-w-[min(96vw,100rem)] h-[calc(var(--app-h,100dvh)-2rem)] flex flex-col gap-3.5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-5 pb-4 min-h-0'
        }
      >
        <div className="flex-none flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <h2 className={`m-0 font-serif truncate ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</h2>
            {!compact && (
              <InfoDotButton
                about="this picker"
                open={aboutOpen}
                controls={aboutId}
                onToggle={() => setAboutOpen((v) => !v)}
              />
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
        {!compact && aboutOpen && (
          /* The standing prose, in one place and only when asked for: what the
             gesture is, what the tiles are, what the preview is worth. */
          <p id={aboutId} className="flex-none m-0 -mt-1.5 max-w-[80ch] text-xs leading-relaxed text-muted">
            {scene ? (
              <>
                <span className="text-ink-soft">Aim, then take.</span> A click shows the look on your
                picture; a second click, Enter or “Use this look” takes it, at the strength you set.{' '}
              </>
            ) : (
              <>
                <span className="text-ink-soft">A click is the pick</span> — there is no picture here to
                aim at.{' '}
              </>
            )}
            The tiles show every look on the reference frame its family asks for, so two looks stay
            comparable; <span className="text-ink-soft">My picture</span> bakes them on your own picture
            instead, one lattice per look. What you see is baked from the same lattice the export uses.
          </p>
        )}

        {compact ? (
          <>
            {picture && (
              /* The band, as on 2026-09-21: the picture at a quarter of the
                 measured screen, floor 8rem, and ONE row under it. */
              <div className="flex-none flex flex-col gap-1.5">
                <div className="flex-none w-full h-[calc(var(--app-h,100dvh)*0.25)] min-h-[8rem]">
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
                {/* ONE row under the picture, and it is the strength: the
                    wipe's own slider is not here (the drag across the picture
                    writes that number, and a finger is already on the
                    picture), and the aimed look's NAME is in the footer, which
                    is drawn at this width anyway. A second row here would be a
                    row of looks. */}
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
              </div>
            )}

            {/* The filter, and the "tiles on…" choices behind one ⋯: on a phone
                the sentence and its three buttons were three rows over the grid
                for a preference set once. The sample thumbnail says which
                picture the tiles are on, when it is not the reference. */}
            <div className="flex-none flex items-center gap-2">
              {effectiveSource && (
                <span className="w-8 h-8 rounded-control overflow-hidden border border-line shrink-0" title={sourceLine}>
                  <LutThumb bitmap={sample} />
                </span>
              )}
              <div className="flex-1 min-w-0">{filterField}</div>
              <OverflowMenu label="What the tiles are shown on" items={sourceVerbs} size="md" />
            </div>
            {imageError && <p className="m-0 -mt-1 text-xs text-danger">{imageError}</p>}

            {/* The rail as ONE line of crumbs, pinned above the scroller so
                the way to another family is never scrolled away. */}
            {crumbStripNav}

            <div className="flex-1 min-h-0 flex">{grid}</div>

            {/* The verb, in the thumb's reach — only where there is a scene to
                aim in. Without one a tap IS the pick, the ✕ is in the header,
                and a footer would be a band of nothing over the grid. */}
            {scene && (
              <div className="flex-none flex items-center gap-3 border-t border-line pt-2.5">
                <span className="flex-1 min-w-0 text-xs text-muted truncate">
                  {aimedItem
                    ? noLook || strength === 1
                      ? aimedItem.name
                      : `${aimedItem.name} · ${Math.round(strength * 100)}%`
                    : 'Tap a look to see it on your picture.'}
                </span>
                <Button size="md" variant="primary" disabled={!aimed || aimedBusy} onClick={() => aimed && onPick(aimed, strength)}>
                  Use this look
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* THE WORKBENCH: the stage column, then the looks panel. */}
            <div ref={bodyRef} className="flex-1 min-h-0 flex gap-5">
              {picture && (
                <div
                  className="flex-none flex flex-col min-h-0"
                  style={{ width: stageBox?.width ?? '46%', gap: STAGE_GAP }}
                >
                  {/* The picture's box is as tall as the picture at this
                      width and no taller, so the card sits right under it and
                      a landscape frame's leftover falls below the pair; until
                      measured it takes the column. */}
                  <div
                    className={stageBox ? 'flex-none min-h-0' : 'flex-1 min-h-0'}
                    style={stageBox ? { height: stageBox.height } : undefined}
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
                  {/* The card: the inspector grammar, so the label column and
                      the tracks line up — Look · Strength · Compare, and the
                      caution only a preview on YOUR picture can give. */}
                  <div
                    ref={cardRef}
                    className="flex-none flex flex-col gap-2 rounded-paper border border-line bg-surface px-3 py-2.5"
                  >
                    <FieldRow label="Look">
                      <span className="min-w-0 flex flex-col leading-tight">
                        <span className="truncate text-sm font-medium text-ink">
                          {aimedItem?.name ?? 'Your picture, as it is'}
                        </span>
                        {(previewLabel || aimedItem) && (
                          <span className="truncate font-mono text-2xs text-muted">
                            {[previewLabel, aimedItem ? 'the look alone, without your correction' : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                      {aimedItem?.family === 'log' && (
                        <span className="shrink-0 inline-flex items-center h-5 px-2 rounded-full border border-warn-line bg-warn-wash font-mono text-3xs tracking-[0.1em] uppercase text-warn">
                          Conversion
                        </span>
                      )}
                    </FieldRow>
                    <FieldRow label="Strength" htmlFor={strengthId}>
                      {strengthSlider}
                    </FieldRow>
                    <FieldRow label="Compare">
                      <CompareToggle compare={compare} onToggle={() => setCompare((v) => !v)} />
                      <span className="min-w-0 truncate text-xs text-muted">
                        {compare
                          ? 'Drag across the picture to move the divider'
                          : 'The original left of the divider, the look right'}
                      </span>
                    </FieldRow>
                    {note && (
                      <p className="m-0 px-2.5 py-1.5 rounded-control bg-warn-wash border border-warn-line text-xs leading-snug text-warn">
                        {note}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2.5">
                {/* The panel's toolbar: the filter, what the tiles are shown
                    on, and the photo verb. */}
                <div className="flex-none flex items-center gap-2.5 flex-wrap">
                  <div className="flex-1 min-w-[10rem] max-w-[22rem]">{filterField}</div>
                  {shownOnOptions.length > 1 && (
                    <Segmented
                      size="sm"
                      label="What the tiles are shown on"
                      options={shownOnOptions}
                      value={shownOn}
                      onChange={(id) => setLiveOn(id === 'reference' ? null : id)}
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={imageBusy}
                    title="Show every look on a photo of yours"
                    onClick={() => void chooseImage()}
                  >
                    {imageBusy ? 'Reading…' : 'Photo…'}
                  </Button>
                </div>
                {imageError && <p className="m-0 -mt-1 text-xs text-danger">{imageError}</p>}
                {!railed && crumbStripNav}
                <div className="flex-1 min-h-0 flex gap-3.5">
                  {railed && rail}
                  {grid}
                </div>
              </div>
            </div>

            {/* The footer, only where there is a verb to pin: the state at the
                left, Cancel and the primary at the right — the two-group row
                every sheet in the suite ends on. */}
            {scene && (
              <div className="flex-none flex items-center gap-3 border-t border-line pt-3.5">
                <span className="flex-1 min-w-0 text-sm text-ink-soft truncate">{say}</span>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!aimed || aimedBusy}
                  onClick={() => aimed && onPick(aimed, strength)}
                  trailing={<kbd className="font-mono text-2xs opacity-70">↵</kbd>}
                >
                  Use this look
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The wipe as a switch: `A/B`, the Develop sheet's own word for the same
 * control, in its dress — one wipe control across the suite.
 */
function CompareToggle({ compare, onToggle }: { compare: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={compare}
      title={
        compare
          ? 'Before / after — on; a drag across the picture places the divider'
          : 'Before / after — off: the whole picture is shown with the look'
      }
      className={`flex-none inline-flex items-center justify-center h-7 px-2.5 rounded-full border font-mono text-2xs tracking-[0.06em] whitespace-nowrap cursor-pointer transition-colors ${
        compare
          ? 'border-accent bg-accent-wash text-accent-ink'
          : 'border-line-strong bg-surface text-muted hover:border-accent hover:text-accent-ink'
      }`}
    >
      A/B
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
 * devices do not have. The ✓ marks the look the stack WEARS now, which the
 * ring could not once it moved to the aim; the `Use ↵` chip on the aimed tile
 * says the second gesture, where the subtitle used to.
 *
 * The thumbnail keeps a FIXED pixel height: a `1fr` track cannot be trusted
 * to carry `aspect-ratio` (`frontend.md`), and the desktop track is a fixed
 * 8rem so a row never stretches a tile into a strip.
 */
function Tile({
  id,
  name,
  thumb,
  bitmap,
  failed = false,
  selected,
  aimed = false,
  hint = false,
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
  /** Draw the `Use ↵` chip on the aimed tile — where a second click is the pick. */
  hint?: boolean;
  favourite?: boolean;
  onPick: (id: string) => void;
  /** Omitted for "No look (original)", which is the absence of a look, not one. */
  onToggleFavourite?: (id: string) => void;
}) {
  return (
    <div
      data-tile={id}
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
        <span className="block w-full h-[92px] rounded-[6px] overflow-hidden bg-paper-2">
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
      {selected && (
        <span
          className="absolute left-2 top-2 grid place-items-center w-[18px] h-[18px] rounded-full bg-accent text-paper [&>svg]:w-3 [&>svg]:h-3"
          title="On the stack now"
          aria-label="On the stack now"
        >
          {Icons.check}
        </span>
      )}
      {aimed && hint && (
        <span
          className="absolute left-1/2 bottom-7 -translate-x-1/2 px-1.5 py-px rounded-full bg-surface/90 border border-accent font-mono text-3xs tracking-[0.08em] uppercase text-accent-ink whitespace-nowrap pointer-events-none"
          aria-hidden="true"
        >
          Use ↵
        </span>
      )}
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
