import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { CubeLut } from '../lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import GradePanel from '../lut/GradePanel';
import { holdGrades, type HeldGrader } from '../lut/held-grader';
import type { LutStack } from '../lut/use-lut-stack';
import { stageFrameSize } from '../overlay/stage-size';
import { boundSource, loadBadgeSource, type BadgeSource } from '../roadtrip/badge-render';
import SectionLegend from '../ui/SectionLegend';
import StageZoomControl from '../ui/StageZoomControl';
import useDialogKeys from '../ui/use-dialog-keys';
import { usePictureZoom } from '../ui/use-picture-zoom';
import {
  DEFAULT_DEVELOP,
  DEVELOP_RANGES,
  describeDevelop,
  isDefaultDevelop,
  signed,
  type DevelopKey,
  type DevelopPreset,
  type DevelopSettings,
} from './develop';
import {
  copyDevelop,
  hasCopiedDevelop,
  pasteDevelop,
  subscribeDevelopClipboard,
} from './develop-clipboard';

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

const legendClass = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const pillClass =
  'inline-flex items-center h-[1.4rem] px-2 rounded-full border border-line-strong font-mono text-3xs tracking-[0.12em] uppercase text-muted whitespace-nowrap';
const buttonClass =
  'px-3 py-[0.4rem] rounded-full border border-line-strong bg-paper text-xs font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-default';
const linkClass =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink disabled:opacity-50 disabled:cursor-default disabled:no-underline';

/** How close to the frame's side the divider's handle may be held, in px. */
const HANDLE_INSET = 14;
/** How far a finger travels before it moves the divider, in px. */
const TOUCH_SLOP = 6;

/**
 * Whether a press on the picture places the divider rather than panning:
 * always at the fitted size, where there is nothing to pan; once zoomed, only
 * on the divider's own handle. A control over the picture keeps its press.
 */
function wipeClaims(target: EventTarget | null, zoomed: boolean): boolean {
  const el = target as Element | null;
  if (el?.closest?.('button')) return false;
  return !zoomed || Boolean(el?.closest?.('[data-wipe-handle]'));
}

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
  /**
   * The host's presets — a trip's. A chip applies a COPY into the draft
   * (applied, never followed); `Save current as…` hands the draft back under
   * a name. A host with none passes nothing and the section is not drawn.
   */
  presets?: DevelopPresets;
  /**
   * Batch verbs the host offers, each naming its count in its label ("Apply
   * to 3 other slides"). The sheet draws them and hands them the DRAFT; the
   * host writes a copy into each target's own field, now — it does not wait
   * for Done, which writes the open picture alone.
   */
  applyTo?: readonly DevelopApplyVerb[];
}

export interface DevelopPresets {
  list: readonly DevelopPreset[];
  onSave: (name: string, settings: DevelopSettings) => void;
  onRemove: (id: string) => void;
}

export interface DevelopApplyVerb {
  id: string;
  label: string;
  /** What the batch will write, told beside the verb. */
  hint?: string;
  run: (settings: DevelopSettings) => void;
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
  presets,
  applyTo,
}: DevelopSheetProps) {
  const [draft, setDraft] = useState<DevelopSettings>(value ?? DEFAULT_DEVELOP);
  const [wipe, setWipe] = useState(1);
  const [holding, setHolding] = useState(false);
  // The session clipboard: Copy keeps the draft, Paste replaces it. Module
  // state, so the same correction crosses Trips ↔ Studio with zero storage.
  const canPaste = useSyncExternalStore(subscribeDevelopClipboard, hasCopiedDevelop);
  // What a verb or a preset last did, told for a moment under its button.
  const [told, setTold] = useState<string | null>(null);
  useEffect(() => {
    if (!told) return;
    const t = window.setTimeout(() => setTold(null), 2400);
    return () => window.clearTimeout(t);
  }, [told]);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');

  // The draft rides the stack while the sheet is up, and leaves with it.
  const { setDevelop } = stack;
  useEffect(() => {
    setDevelop(draft);
  }, [draft, setDevelop]);
  useEffect(() => () => setDevelop(null), [setDevelop]);

  const done = useCallback(() => {
    onDone(isDefaultDevelop(draft) ? null : draft);
  }, [draft, onDone]);
  // While a preset is being named, Enter belongs to that field's own form.
  useDialogKeys({ onCancel, onConfirm: naming ? null : done });

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
    // A develop is judged on a screen, never at 48 megapixels: the picture is
    // kept within the stage budget, and the export decodes the file again.
    void loadBadgeSource(file, videoTimeSeconds)
      .then((s) => boundSource(s))
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
  // WebGL2 context per repaint is never reclaimed (the stage's own rule). It
  // holds its grade, so dragging the wipe or holding the original does not
  // grade the same picture again on every step (`held-grader.ts`).
  const cube = stack.composed;
  const graderRef = useRef<{ lut: CubeLut; w: number; h: number; grader: HeldGrader } | null>(
    null,
  );
  const graderFor = useCallback(
    (lut: CubeLut | null, s: BadgeSource): HeldGrader | null => {
      const cur = graderRef.current;
      if (!lut) {
        cur?.grader.dispose();
        graderRef.current = null;
        return null;
      }
      if (cur && cur.lut === lut && cur.w === s.width && cur.h === s.height) return cur.grader;
      cur?.grader.dispose();
      const grader = holdGrades(makeFrameGrader(lut, s.width, s.height));
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
    // The divider itself is drawn over the canvas, in the page, so it stays a
    // hairline at any zoom and can be grabbed.
    if (grader && wipe < 1) {
      const x = Math.round(wipe * w);
      const sx = Math.round(wipe * source.width);
      ctx.drawImage(source.image, sx, 0, source.width - sx, source.height, x, 0, w - x, h);
    }
  }, [source, cube, wipe, holding, graderFor]);

  // Looking closer: wheel, pinch, and a drag that pans once zoomed. Fitted, a
  // drag anywhere places the divider, as it always did; zoomed, the drag is
  // the pan's and the divider keeps a handle that works at any zoom.
  // A finger does not move the divider until it has travelled (or lifts as a
  // tap): the first of two fingers landing for a pinch would otherwise throw
  // the divider to wherever it touched. A mouse places it at once.
  const dragging = useRef<{ startX: number; live: boolean } | null>(null);
  const fingers = useRef(0);
  const zoomedRef = useRef(false);
  const natural = useMemo(
    () => (source ? { width: source.width, height: source.height } : null),
    [source],
  );
  const view = usePictureZoom({
    natural,
    resetKey: source,
    claim: (e) => wipeClaims(e.target, zoomedRef.current),
    onTakeover: () => {
      dragging.current = null;
    },
  });
  zoomedRef.current = view.zoomed;
  const wipeFrom = (e: React.PointerEvent<HTMLElement>) => {
    const f = view.fractionAt(e.clientX, e.clientY).x;
    setWipe(Math.min(1, Math.max(0, f)));
  };
  const comparing = Boolean(source && cube && !holding);
  // The divider, where the picture is — held inside the frame so its handle
  // can always be reached, even when the line itself is panned out of view.
  const { rect, viewport } = view;
  const dividerX = Math.min(Math.max(rect.x + wipe * rect.width, HANDLE_INSET), Math.max(HANDLE_INSET, viewport.width - HANDLE_INSET));
  const dividerTop = Math.max(0, rect.y);
  const dividerBottom = Math.min(viewport.height, rect.y + rect.height);

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
          <h2 className="m-0 font-serif text-lg min-w-0 truncate" title={title}>
            Develop · {title}
          </h2>
          {fidelity && <span className={pillClass}>{fidelity}</span>}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              copyDevelop(draft);
              setTold('copied');
            }}
            disabled={asShot}
            className={`${linkClass} whitespace-nowrap`}
            title="Keep these numbers for the next picture, in this session"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              const pasted = pasteDevelop();
              if (pasted) setDraft(pasted);
            }}
            disabled={!canPaste}
            className={`${linkClass} whitespace-nowrap`}
            title={canPaste ? 'Replace these numbers with the copied ones' : 'Nothing copied yet'}
          >
            Paste
          </button>
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_DEVELOP })}
            disabled={asShot}
            className={`${linkClass} whitespace-nowrap`}
          >
            As shot
          </button>
          {/* In the header, never over the picture (the lightbox's rule); under
              820px there is none — the pinch is the gesture there. */}
          {source && (
            <StageZoomControl zoom={view.zoom} hint="wheel, or pinch" className="flex-none max-[820px]:hidden" />
          )}
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-2.5 py-[3px] hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
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
              ref={view.viewportRef}
              // On a phone the picture takes a fixed share of the MEASURED
              // app height (`--app-h`, never `vh`: a locked document is where
              // a stale unit can never be corrected — `frontend.md`) and the
              // column scrolls under it.
              className={`relative flex-1 min-h-0 bg-frame rounded-paper overflow-hidden touch-none select-none max-[820px]:flex-none max-[820px]:h-[calc(var(--app-h)*0.38)] ${
                view.zoomed ? (view.panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-col-resize'
              }`}
              onPointerDown={(e) => {
                const touch = e.pointerType === 'touch';
                if (touch) fingers.current += 1;
                // A second finger is the pinch's (`onTakeover`), never a wipe.
                if (dragging.current || (touch && fingers.current > 1)) return;
                if (!wipeClaims(e.target, view.zoomed)) return;
                dragging.current = { startX: e.clientX, live: !touch };
                e.currentTarget.setPointerCapture(e.pointerId);
                if (!touch) wipeFrom(e);
              }}
              onPointerMove={(e) => {
                const d = dragging.current;
                if (!d) return;
                if (!d.live && Math.abs(e.clientX - d.startX) > TOUCH_SLOP) d.live = true;
                if (d.live) wipeFrom(e);
              }}
              onPointerUp={(e) => {
                if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
                // A finger that never travelled was a tap: it places the divider.
                if (dragging.current && !dragging.current.live) wipeFrom(e);
                dragging.current = null;
              }}
              onPointerCancel={(e) => {
                if (e.pointerType === 'touch') fingers.current = Math.max(0, fingers.current - 1);
                dragging.current = null;
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  transform: view.transform,
                  // A finger is followed as it moves; a button is animated.
                  transition: view.settling ? 'transform 220ms var(--ease-paper)' : undefined,
                }}
                aria-label="The picture, corrected"
              />
              {comparing && (
                <div
                  data-wipe-handle
                  className="absolute w-7 -ml-3.5 cursor-col-resize group"
                  style={{ left: dividerX, top: dividerTop, height: Math.max(0, dividerBottom - dividerTop) }}
                  title="Drag to compare with the picture as shot"
                  aria-hidden="true"
                >
                  {wipe < 1 && (
                    <span className="absolute inset-y-0 left-1/2 w-[1.5px] -ml-[0.75px] bg-[rgba(251,248,241,0.9)] pointer-events-none" />
                  )}
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-[rgba(251,248,241,0.92)] border border-line-strong text-ink-soft shadow-paper group-hover:border-accent group-hover:text-accent-ink pointer-events-none">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
                    </svg>
                  </span>
                </div>
              )}
              {!file && (
                <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-2xs text-muted">
                  This slide has no picture yet — tick one in the Library.
                </span>
              )}
              {problem && (
                <span className="absolute inset-0 grid place-items-center px-6 text-center font-mono text-2xs text-paper">
                  {problem}
                </span>
              )}
              {file && !source && !problem && (
                <span className="absolute inset-0 grid place-items-center font-mono text-2xs text-muted">
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
            <p className="m-0 flex-none font-mono text-2xs text-faint leading-relaxed">
              {describeDevelop(draft)}
              {note ? ` — ${note}` : ''}
              {source && cube
                ? view.zoomed
                  ? ' · drag to look around, the handle on the divider compares'
                  : ' · drag across the picture to compare, wheel or pinch to look closer'
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

            {presets && (
              <div className="flex flex-col gap-2 pt-3 border-t border-line">
                <SectionLegend label="Presets">
                  <p>
                    Your own names for a light, kept on the trip. A chip writes a COPY
                    of its numbers here — applied, never followed, so editing a preset
                    later changes no picture. There is no factory set.
                  </p>
                </SectionLegend>
                {presets.list.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {presets.list.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center rounded-full border border-line-strong bg-paper overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ ...DEFAULT_DEVELOP, ...p.settings });
                            setTold(`applied ${p.name}`);
                          }}
                          className="px-2.5 py-[0.3rem] border-0 bg-transparent text-xs text-ink-soft cursor-pointer hover:text-accent-ink"
                          title={describeDevelop(p.settings)}
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => presets.onRemove(p.id)}
                          className="px-2 py-[0.3rem] border-0 border-l border-line bg-transparent font-mono text-3xs text-muted cursor-pointer hover:text-accent"
                          aria-label={`Remove preset ${p.name}`}
                          title="Remove this preset — the pictures it was applied to keep their numbers"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {naming ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = presetName.trim();
                      if (!name) return;
                      presets.onSave(name, { ...draft });
                      setTold(`saved ${name}`);
                      setPresetName('');
                      setNaming(false);
                    }}
                  >
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => {
                        // The sheet's own Escape closes it; here it closes the field.
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setNaming(false);
                        }
                      }}
                      placeholder="Name this light"
                      aria-label="Preset name"
                      autoFocus
                      className="flex-1 min-w-0 px-2.5 py-[0.3rem] rounded-full border border-line-strong bg-paper text-base leading-tight text-ink focus:outline-none focus:border-accent"
                    />
                    <button type="submit" className={buttonClass} disabled={!presetName.trim()}>
                      Save
                    </button>
                    <button type="button" onClick={() => setNaming(false)} className={linkClass}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNaming(true)}
                    disabled={asShot}
                    className={`${buttonClass} self-start`}
                    title={asShot ? 'Move a slider first' : 'Keep these numbers under a name of your own'}
                  >
                    Save current as…
                  </button>
                )}
              </div>
            )}

            {applyTo && applyTo.length > 0 && (
              <div className="flex flex-col gap-2 pt-3 border-t border-line">
                <SectionLegend label="Apply to…">
                  <p>
                    The same numbers written onto other pictures, now, each as its own
                    copy — the look under it stays theirs. Done still writes this one.
                  </p>
                </SectionLegend>
                {applyTo.map((verb) => (
                  <div key={verb.id} className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        verb.run({ ...draft });
                        setTold(`done · ${verb.label.toLowerCase()}`);
                      }}
                      className={buttonClass}
                    >
                      {verb.label}
                    </button>
                    {verb.hint && (
                      <span className="font-mono text-3xs text-faint leading-relaxed">
                        {verb.hint}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

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
          {told && (
            <span className="font-mono text-2xs text-accent-ink" role="status">
              · {told}
            </span>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={buttonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={done}
            className="px-4 py-[0.4rem] rounded-full border border-ink bg-ink text-paper text-xs font-semibold cursor-pointer hover:bg-accent hover:border-accent"
          >
            Done
            <span className="ml-1.5 font-mono text-3xs opacity-70">↵</span>
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
        <span className="text-xs text-ink">{LABELS[k]}</span>
        <span
          className={`font-mono text-2xs tabular-nums ${value === 0 ? 'text-faint' : 'text-ink-soft'}`}
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
