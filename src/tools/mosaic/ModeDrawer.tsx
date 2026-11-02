import { useEffect, useRef, useState, type RefObject } from 'react';
import { MODE_FAMILIES, MODE_WORDS, PREVIEW_AIM, PREVIEW_PERIOD, previewFrame } from '../../shared/mosaic/mode-catalog';
import type { Recipe } from '../../shared/mosaic/motion';
import BottomSheet from '../../shared/ui/BottomSheet';
import { Icons } from '../../shared/ui/icons';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import type { MosaicScene } from './scene-builder';

/**
 * The mode drawer (lab 4, L1, https://claude.ai/artifact/F9JVY7nwTsuVvGgR3Qjpw6):
 * the recipes as tiles in three families (`mode-catalog.ts`), each a small
 * preview of its motion painted from the stage's OWN mosaic — the scene on
 * screen and its mirror as "the next one" — so what is chosen is seen, not
 * read. A popover over the stage beside the transport; on a phone a sheet.
 * The tile under the hand and the current one play; the rest hold a frame;
 * reduced motion holds them all. Still is not here (the transport's own
 * button), and Custom opens the Motion section.
 */

interface PreviewParts {
  /** The mosaic mirrored, standing in for the next one. */
  other: HTMLCanvasElement;
  /** The cells in a scattered order, for a reveal. */
  order: Uint32Array;
  /** How far the scene was painted when the mirror was taken: a scene still landing its lots is mirrored again. */
  progress: number;
}
const parts = new WeakMap<MosaicScene, PreviewParts>();

function partsOf(scene: MosaicScene): PreviewParts {
  const have = parts.get(scene);
  if (have && have.progress >= scene.progress) return have;
  const other = document.createElement('canvas');
  other.width = scene.canvas.width;
  other.height = scene.canvas.height;
  const c = other.getContext('2d');
  if (c) {
    c.setTransform(-1, 0, 0, 1, other.width, 0);
    c.drawImage(scene.canvas, 0, 0);
  }
  const n = scene.shape.cols * scene.shape.rows;
  const keyed = Array.from({ length: n }, (_, i) => [Math.imul(i + 1, 2654435761) >>> 0, i] as const).sort((a, b) => a[0] - b[0]);
  const made = { other, order: have?.order ?? Uint32Array.from(keyed.map((k) => k[1])), progress: scene.progress };
  parts.set(scene, made);
  return made;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * One frame of `recipe`'s preview at `t` into `ctx`, from the scene on the stage — painted at the scene's own shape,
 * then laid into the tile centred and cropped to cover it, so an upright or square mosaic is never stretched.
 */
export function paintPreview(ctx: CanvasRenderingContext2D, recipe: Recipe, t: number, scene: MosaicScene | null): void {
  const TW = ctx.canvas.width;
  const TH = ctx.canvas.height;
  const aspect = scene && scene.stageW > 0 && scene.stageH > 0 ? scene.stageW / scene.stageH : TW / TH;
  if (!scene || Math.abs(aspect - TW / TH) < 0.01) {
    paintAt(ctx, recipe, t, scene);
    return;
  }
  scratch ??= document.createElement('canvas');
  const w = aspect >= TW / TH ? Math.round(TH * aspect) : TW;
  const h = aspect >= TW / TH ? TH : Math.round(TW / aspect);
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sc = scratch.getContext('2d');
  if (!sc) return;
  paintAt(sc, recipe, t, scene);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(scratch, (w - TW) / 2, (h - TH) / 2, TW, TH, 0, 0, TW, TH);
}

function paintAt(ctx: CanvasRenderingContext2D, recipe: Recipe, t: number, scene: MosaicScene | null): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#100f0d';
  ctx.fillRect(0, 0, W, H);
  if (!scene) return;
  const { other, order } = partsOf(scene);
  const f = previewFrame(recipe, t);
  const sources = [scene.canvas, other] as const;
  const base = sources[f.base];
  const next = sources[1 - f.base];
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(f.s, 0, 0, f.s, W / 2 - f.cx * W * f.s, H / 2 - f.cy * H * f.s);
  ctx.drawImage(base, 0, 0, W, H);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const { cols, rows } = scene.shape;
  const cw = W / cols;
  const ch = H / rows;
  const sw = base.width / cols;
  const sh = base.height / rows;
  if (f.flipped > 0) {
    // Each flipped cell shows its part of the photo.
    const r = scene.targetRect;
    const n = Math.floor(f.flipped * order.length);
    for (let q = 0; q < n; q++) {
      const cell = order[q];
      const i = cell % cols;
      const j = (cell - i) / cols;
      ctx.drawImage(scene.target, r.x + (i / cols) * r.w, r.y + (j / rows) * r.h, r.w / cols, r.h / rows, i * cw, j * ch, cw + 0.5, ch + 0.5);
    }
  }
  if (f.wave > 0) {
    const reach = f.wave * Math.hypot(cols, rows);
    const ai = PREVIEW_AIM.x * cols;
    const aj = PREVIEW_AIM.y * rows;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) if (Math.hypot(i + 0.5 - ai, j + 0.5 - aj) < reach) ctx.drawImage(next, i * sw, j * sh, sw, sh, i * cw, j * ch, cw + 0.5, ch + 0.5);
  }
  if (f.photo > 0) {
    const r = scene.targetRect;
    ctx.globalAlpha = f.photo;
    ctx.drawImage(scene.target, r.x, r.y, r.w, r.h, 0, 0, W, H);
  }
  if (f.next > 0) {
    ctx.globalAlpha = f.next;
    ctx.drawImage(next, 0, 0, W, H);
  }
  ctx.globalAlpha = 1;
  if (f.ring > 0) {
    ctx.strokeStyle = '#ef5638';
    ctx.lineWidth = Math.max(1.5, W / 120);
    ctx.globalAlpha = 1 - f.ring * 0.6;
    ctx.beginPath();
    ctx.arc(PREVIEW_AIM.x * W, PREVIEW_AIM.y * H, (0.2 + f.ring) * Math.min(cw, ch) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** A frame of a recipe held still: a moment where its motion reads. */
const HELD_AT = PREVIEW_PERIOD * 0.6;

function Tile({ recipe, current, scene, playing, onPick, onHover }: { recipe: Recipe; current: boolean; scene: MosaicScene | null; playing: boolean; onPick: () => void; onHover: (on: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    if (!playing) {
      paintPreview(ctx, recipe, HELD_AT, scene);
      return;
    }
    let raf = 0;
    const start = performance.now() - HELD_AT * 1000;
    const loop = (now: number) => {
      paintPreview(ctx, recipe, Math.max(0, (now - start) / 1000), scene);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recipe, scene, playing, scene?.progress]);
  const words = MODE_WORDS[recipe];
  return (
    <button
      type="button"
      aria-pressed={current}
      data-mode={recipe}
      onClick={onPick}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      title={words.line}
      className={`group flex flex-col gap-1.5 p-1.5 text-left rounded-control border bg-surface cursor-pointer transition-colors ${
        current ? 'border-accent' : 'border-line hover:border-line-strong'
      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      <canvas ref={ref} width={192} height={108} className="block w-full aspect-video rounded-[6px] bg-frame" aria-hidden="true" />
      <span className="px-0.5 text-sm font-semibold leading-tight">{words.label}</span>
      <span className="px-0.5 pb-0.5 text-2xs text-muted leading-snug">{words.line}</span>
    </button>
  );
}

function Families({ current, scene, onPick, onCustom }: { current: Recipe | 'custom' | null; scene: MosaicScene | null; onPick: (r: Recipe) => void; onCustom: () => void }) {
  const [hovered, setHovered] = useState<Recipe | null>(null);
  const still = prefersReducedMotion();
  return (
    <div className="flex flex-col gap-3">
      {MODE_FAMILIES.map((family) => (
        <div key={family.id} className="flex flex-col gap-1.5" role="group" aria-label={family.label}>
          <p className="m-0 font-mono text-3xs tracking-[0.14em] uppercase text-muted">{family.label}</p>
          <div className="grid grid-cols-2 @[34rem]:grid-cols-4 gap-2">
            {family.modes.map((r) => (
              <Tile
                key={r}
                recipe={r}
                current={r === current}
                scene={scene}
                playing={!still && (hovered === r || (hovered === null && r === current))}
                onPick={() => onPick(r)}
                onHover={(on) => setHovered((h) => (on ? r : h === r ? null : h))}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-xs text-muted">Each part of the step, by hand</span>
        <button
          type="button"
          onClick={onCustom}
          aria-pressed={current === 'custom'}
          className={`inline-flex items-center gap-1.5 h-[2.125rem] px-3 rounded-control border text-sm font-medium cursor-pointer ${
            current === 'custom' ? 'border-accent text-accent-ink' : 'border-line-strong text-ink-soft hover:border-accent hover:text-accent-ink'
          }`}
        >
          <span className="inline-flex w-4 h-4">{Icons.sliders}</span>
          Custom…
        </button>
      </div>
    </div>
  );
}

interface ModeDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The recipe on the button: the mode, or the one Play would start from Still. */
  current: Recipe | 'custom' | null;
  scene: MosaicScene | null;
  onPick: (recipe: Recipe) => void;
  onCustom: () => void;
  compact: boolean;
  /** The button that opened it: a press on it is not a press outside. */
  anchor: RefObject<HTMLElement | null>;
}

export default function ModeDrawer({ open, onClose, current, scene, onPick, onCustom, compact, anchor }: ModeDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || compact) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, compact, onClose, anchor]);
  if (!open) return null;
  const body = <Families current={current} scene={scene} onPick={onPick} onCustom={onCustom} />;
  if (compact) {
    return (
      <BottomSheet open onClose={onClose} title="Mode" hint="what Play plays">
        <div className="@container px-1 pb-2">{body}</div>
      </BottomSheet>
    );
  }
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Mode"
      className="@container absolute left-0 right-0 bottom-full mb-2 z-30 max-h-[min(34rem,calc(var(--app-h)*0.7))] overflow-y-auto p-3 border border-line rounded-control bg-paper-2 shadow-paper"
    >
      {body}
    </div>
  );
}

/** The transport's mode button: the recipe's held frame, its name, the chevron. */
export function ModeButton({ recipe, scene, active, expanded, onClick, buttonRef }: { recipe: Recipe | 'custom'; scene: MosaicScene | null; active: boolean; expanded: boolean; onClick: () => void; buttonRef: RefObject<HTMLButtonElement> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paintPreview(ctx, recipe === 'custom' ? 'mosaics' : recipe, HELD_AT, scene);
  }, [recipe, scene, scene?.progress]);
  const label = recipe === 'custom' ? 'Custom' : MODE_WORDS[recipe].label;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={recipe === 'custom' ? 'The Motion section’s own settings' : MODE_WORDS[recipe].line}
      className={`inline-flex items-center gap-2 h-[2.125rem] pl-1 pr-2.5 rounded-control border text-sm font-medium cursor-pointer transition-colors ${
        active ? 'border-line-strong bg-paper text-ink' : 'border-line text-ink-soft hover:border-line-strong'
      } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      <canvas ref={ref} width={64} height={36} className="block w-8 h-[1.125rem] rounded-[4px] bg-frame" aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
      <span className="inline-flex w-3.5 h-3.5 text-muted" aria-hidden="true">
        {Icons.down}
      </span>
    </button>
  );
}
