import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader, type FrameGrader } from '../lut/frame-grader';
import GradePanel from '../lut/GradePanel';
import type { LutStack } from '../lut/use-lut-stack';
import { stageFrameSize } from '../overlay/stage-size';
import { loadBadgeSource, type BadgeSource } from '../roadtrip/badge-render';
import SectionLegend from '../ui/SectionLegend';
import useDialogKeys from '../ui/use-dialog-keys';
import {
  DEFAULT_DEVELOP,
  DEVELOP_RANGES,
  describeDevelop,
  isDefaultDevelop,
  signed,
  type DevelopKey,
  type DevelopSettings,
} from './develop';

/**
 * How wide a picture is kept for the sheet. A develop is judged on a screen,
 * never at 48 megapixels: the stage budget (`stage-size.ts`) bounds the
 * canvas, and this bounds the bitmap behind it — a 194 MB bitmap for a
 * preview is the arithmetic that killed an iPhone's tab. The export composes
 * from the source at its own density, never from here.
 */
const KEEP_MAX_WIDTH = 3840;

/**
 * A source no wider than the cap — and NEVER wider than it was: the decode
 * option `loadBadgeSource` offers enlarges a small picture up to the cap
 * (right for a thumbnail cell, wrong here — measured: a 1600 px probe came
 * back at 3840). So the picture is decoded as it is and only a big one is
 * scaled down from the decoded bitmap, which is a resample, not a second
 * decode; the big bitmap is released at once.
 */
async function boundedSource(file: File, videoTimeSeconds: number): Promise<BadgeSource> {
  const source = await loadBadgeSource(file, videoTimeSeconds);
  if (source.width <= KEEP_MAX_WIDTH || !(source.image instanceof ImageBitmap)) return source;
  const small = await createImageBitmap(source.image, {
    resizeWidth: KEEP_MAX_WIDTH,
    resizeQuality: 'high',
  });
  source.release();
  return { image: small, width: small.width, height: small.height, release: () => small.close() };
}

const LABELS: Readonly<Record<DevelopKey, string>> = {
  exposure: 'Exposure',
  brightness: 'Brightness',
  contrast: 'Contrast',
  highlights: 'Highlights',
  shadows: 'Shadows',
  whites: 'Whites',
  blacks: 'Blacks',
  temperature: 'Temperature',
  tint: 'Tint',
  saturation: 'Saturation',
  vibrance: 'Vibrance',
};

/** The column, top to bottom — the pipeline's own order. */
const GROUPS: ReadonlyArray<{ legend: string; keys: readonly DevelopKey[]; hint: string }> = [
  {
    legend: 'Light',
    keys: ['exposure', 'brightness', 'contrast'],
    hint: 'Exposure is a gain in stops, in scene light. Brightness lifts the midtones and leaves black and white where they are. Contrast stretches around 18 % grey.',
  },
  {
    legend: 'Tone',
    keys: ['highlights', 'shadows', 'whites', 'blacks'],
    hint: 'Highlights and shadows work the upper and lower halves without reaching the ends; whites and blacks move the ends themselves. On an 8-bit picture nothing above white can come back — only a RAW keeps it.',
  },
  {
    legend: 'Colour',
    keys: ['temperature', 'tint', 'saturation', 'vibrance'],
    hint: 'Temperature and tint are channel gains in linear light. Vibrance is saturation weighted by how pale a colour already is, so a strong colour barely moves — that is what protects skin.',
  },
];

const legendClass = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const pillClass =
  'inline-flex items-center h-[1.4rem] px-2 rounded-full border border-line-strong font-mono text-[0.55rem] tracking-[0.12em] uppercase text-muted whitespace-nowrap';
const buttonClass =
  'px-3 py-[0.4rem] rounded-full border border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default';
const linkClass =
  'p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink disabled:opacity-50 disabled:cursor-default disabled:no-underline';

export interface DevelopSheetProps {
  /** The picture, or null when the slide has none — the controls still show. */
  file: File | null;
  /** Frame of a clip to sit on; ignored for a photo. */
  videoTimeSeconds?: number;
  /** What the sheet is about, in the header: usually the file's name. */
  title: string;
  /** What the picture IS — `JPEG · 8-bit`, `proxy · 8-bit`, later `RAW · 16-bit`. */
  fidelity?: string | null;
  /** One line under the picture: what this picture can and cannot give back. */
  note?: string | null;
  /**
   * The host's stack. The sheet holds its DRAFT in `stack.develop`, so the
   * preview bakes through the deferred path the strength slider already uses;
   * the host's own renderers keep reading the stored value through
   * `composeWith` until Done writes it.
   */
  stack: LutStack;
  /** What the sheet opened on. */
  value: DevelopSettings | null;
  /** The corrected picture's numbers; null when it came back to as shot. */
  onDone: (develop: DevelopSettings | null) => void;
  onCancel: () => void;
  /** Drawn above the Look panel — a host's scope chips. */
  lookHeader?: ReactNode;
  /** What Done writes to, in the footer: "writes to this slide". */
  footerHint?: string;
}

/**
 * The Develop sheet: one picture, its correction as sliders, the look under
 * it, and Done.
 *
 * ONE component, every host (`docs/photo-develop.md` §7.1): Trips opens it
 * over a slide, the Studio over its active media. What it draws is
 * develop → look → output — the host's stack with the draft baked in first —
 * so the picture on the sheet IS what the piece will deliver, and the
 * before/after is the untouched frame against it.
 *
 * The draft lives in `stack.develop` while the sheet is open: each slider
 * change goes through the stack's deferred bake exactly as the strength
 * slider does, and the host keeps drawing its stage through the STORED value
 * (`composeWith(slide.develop)`) until Done. Cancel puts the stack back.
 */
export default function DevelopSheet({
  file,
  videoTimeSeconds = 0,
  title,
  fidelity = null,
  note = null,
  stack,
  value,
  onDone,
  onCancel,
  lookHeader,
  footerHint,
}: DevelopSheetProps) {
  const [draft, setDraft] = useState<DevelopSettings>(value ?? DEFAULT_DEVELOP);
  const [wipe, setWipe] = useState(1);
  const [holding, setHolding] = useState(false);

  // The draft rides the stack while the sheet is up, and leaves with it.
  const { setDevelop } = stack;
  useEffect(() => {
    setDevelop(draft);
  }, [draft, setDevelop]);
  useEffect(() => () => setDevelop(null), [setDevelop]);

  const done = useCallback(() => {
    onDone(isDefaultDevelop(draft) ? null : draft);
  }, [draft, onDone]);
  useDialogKeys({ onCancel, onConfirm: done });

  const set = (key: DevelopKey, v: number) => setDraft((d) => ({ ...d, [key]: v }));

  // --- the picture ----------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<BadgeSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setProblem(null);
    if (!file) return;
    let loaded: BadgeSource | null = null;
    void boundedSource(file, videoTimeSeconds)
      .then((s) => {
        if (cancelled) {
          s.release();
          return;
        }
        loaded = s;
        setSource(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setProblem(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      loaded?.release();
    };
  }, [file, videoTimeSeconds]);

  // One grader, re-made only when the cube or the source's size changes — a
  // WebGL2 context per repaint is never reclaimed (the stage's own rule).
  const cube = stack.composed;
  const graderRef = useRef<{ lut: CubeLut; w: number; h: number; grader: FrameGrader } | null>(
    null,
  );
  const graderFor = useCallback(
    (lut: CubeLut | null, s: BadgeSource): FrameGrader | null => {
      const cur = graderRef.current;
      if (!lut) {
        cur?.grader.dispose();
        graderRef.current = null;
        return null;
      }
      if (cur && cur.lut === lut && cur.w === s.width && cur.h === s.height) return cur.grader;
      cur?.grader.dispose();
      const grader = makeFrameGrader(lut, s.width, s.height);
      graderRef.current = { lut, w: s.width, h: s.height, grader };
      return grader;
    },
    [],
  );
  useEffect(
    () => () => {
      graderRef.current?.grader.dispose();
      graderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source || source.width <= 0) return;
    const { w, h } = stageFrameSize(source.width, source.height);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grader = holding ? null : graderFor(cube, source);
    const graded = grader ? grader.render(source.image) : source.image;
    ctx.drawImage(graded, 0, 0, source.width, source.height, 0, 0, w, h);
    // The wipe: the untouched picture to the RIGHT of the divider, the way
    // the shader's own split works — graded on the left.
    if (grader && wipe < 1) {
      const x = Math.round(wipe * w);
      const sx = Math.round(wipe * source.width);
      ctx.drawImage(source.image, sx, 0, source.width - sx, source.height, x, 0, w - x, h);
      ctx.save();
      ctx.strokeStyle = 'rgba(251,248,241,0.9)';
      ctx.lineWidth = Math.max(1.5, h * 0.003);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      ctx.restore();
    }
  }, [source, cube, wipe, holding, graderFor]);

  // Drag anywhere on the picture to place the divider.
  const dragging = useRef(false);
  const wipeFrom = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setWipe(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  const asShot = isDefaultDevelop(draft);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Develop ${title}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[64rem] h-[min(90dvh,54rem)] flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 overflow-hidden max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:p-3 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Header: what, what it is, back to as shot, close. */}
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-[1.1rem] min-w-0 truncate" title={title}>
            Develop · {title}
          </h2>
          {fidelity && <span className={pillClass}>{fidelity}</span>}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_DEVELOP })}
            disabled={asShot}
            className={`${linkClass} whitespace-nowrap`}
          >
            As shot
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2.5 py-[3px] hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 flex gap-4 max-[820px]:flex-col max-[820px]:gap-3">
          {/* The picture: develop → look → output, in a frame; the divider
              reveals the untouched frame to its right. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 max-[820px]:flex-none">
            <div
              // On a phone the picture takes a fixed share of the MEASURED
              // app height (`--app-h`, never `vh`: a locked document is where
              // a stale unit can never be corrected — `frontend.md`) and the
              // column scrolls under it.
              className="relative flex-1 min-h-0 bg-frame rounded-paper overflow-hidden touch-none select-none cursor-col-resize max-[820px]:flex-none max-[820px]:h-[calc(var(--app-h)*0.38)]"
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                wipeFrom(e);
              }}
              onPointerMove={(e) => {
                if (dragging.current) wipeFrom(e);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain"
                aria-label="The picture, corrected"
              />
              {!file && (
                <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-[0.66rem] text-muted">
                  This slide has no picture yet — tick one in the Library.
                </span>
              )}
              {problem && (
                <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-[0.66rem] text-paper">
                  {problem}
                </span>
              )}
              {file && !source && !problem && (
                <span className="absolute inset-0 grid place-items-center font-mono text-[0.66rem] text-muted">
                  decoding…
                </span>
              )}
              {source && cube && (
                <>
                  <span className={`absolute top-2 left-2.5 ${pillClass} bg-[rgba(251,248,241,0.86)] text-ink-soft`}>
                    {holding ? 'before' : wipe < 1 ? 'after · before' : 'after'}
                  </span>
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setHolding(true);
                    }}
                    onPointerUp={() => setHolding(false)}
                    onPointerLeave={() => setHolding(false)}
                    onPointerCancel={() => setHolding(false)}
                    className={`absolute bottom-2 right-2.5 ${pillClass} bg-[rgba(251,248,241,0.86)] text-ink-soft cursor-pointer hover:border-accent`}
                    title="Hold to see the picture as shot"
                  >
                    ◐ hold for before
                  </button>
                </>
              )}
            </div>
            <p className="m-0 flex-none font-mono text-[0.62rem] text-faint leading-relaxed">
              {describeDevelop(draft)}
              {note ? ` — ${note}` : ''}
              {source && cube
                ? ' · drag across the picture to compare'
                : source && !cube
                  ? ' · nothing changes the picture yet'
                  : ''}
            </p>
          </div>

          {/* The column: the pipeline in order, then the look under it. */}
          <div className="w-[22rem] flex-none min-h-0 overflow-y-auto overscroll-contain pr-1.5 flex flex-col gap-4 max-[820px]:w-full max-[820px]:flex-1">
            {GROUPS.map((group) => (
              <div key={group.legend} className="flex flex-col gap-2">
                <SectionLegend label={group.legend}>
                  <p>{group.hint}</p>
                </SectionLegend>
                {group.keys.map((key) => (
                  <Slider key={key} k={key} value={draft[key]} onChange={(v) => set(key, v)} />
                ))}
              </div>
            ))}

            <div className="flex flex-col gap-2 pt-3 border-t border-line">
              <span className="flex items-center gap-2">
                <SectionLegend label="Look">
                  <p>
                    The same grade the piece already wears, applied AFTER this
                    correction — set both in one place. Looks apply top to bottom
                    and the output transform last.
                  </p>
                </SectionLegend>
              </span>
              {lookHeader}
              <GradePanel stack={stack} />
            </div>
          </div>
        </div>

        {/* Footer: Enter is Done, Escape is Cancel. */}
        <div className="flex-none flex items-center gap-2 pt-3 border-t border-line">
          {footerHint && <span className={legendClass}>{footerHint}</span>}
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={buttonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={done}
            className="px-4 py-[0.4rem] rounded-full border border-ink bg-ink text-paper text-[0.78rem] font-semibold cursor-pointer hover:bg-accent hover:border-accent"
          >
            Done
            <span className="ml-1.5 font-mono text-[0.58rem] opacity-70">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One slider: its name, its value in the mono face, the range. Double-click
 * the row to put it back to 0; Shift with the arrow keys steps ten at a time.
 */
function Slider({
  k,
  value,
  onChange,
}: {
  k: DevelopKey;
  value: number;
  onChange: (v: number) => void;
}) {
  const range = DEVELOP_RANGES[k];
  const printed = k === 'exposure' ? `${signed(value, 2)} ${range.unit}` : signed(value);
  return (
    <div className="flex flex-col gap-1" onDoubleClick={() => onChange(0)}>
      <div className="flex items-baseline justify-between">
        <span className="text-[0.8rem] text-ink">{LABELS[k]}</span>
        <span
          className={`font-mono text-[0.68rem] tabular-nums ${value === 0 ? 'text-faint' : 'text-ink-soft'}`}
        >
          {printed}
        </span>
      </div>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          if (!e.shiftKey) return;
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          onChange(Math.min(range.max, Math.max(range.min, value + dir * range.step * 10)));
        }}
        className="w-full accent-accent cursor-pointer"
        aria-label={LABELS[k]}
      />
    </div>
  );
}
