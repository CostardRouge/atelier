import { useEffect, useRef, useState } from 'react';
import {
  BORDER_MARGIN_MAX,
  BORDER_SWATCHES,
  DEFAULT_BORDER,
  borderLayout,
  scaleLayout,
  type RollBorder,
} from '../../shared/develop/border-layout';
import { drawDelivered } from '../../shared/develop/border-paint';
import { developButtonClass } from '../../shared/develop/develop-classes';
import type { DevelopPicture } from '../../shared/develop/use-develop-picture';
import { ASPECT_PRESETS } from '../../shared/projects/project-types';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, InspectorSection, RangeField, ToggleField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import type { CropZoneApi } from './use-crop-zone';

/** A batch verb of the Borders section: handed this picture's border (null = none) on its click. */
export interface BorderApplyVerb {
  id: string;
  label: string;
  hint?: string;
  run: (border: RollBorder | null) => void;
}

const FILE_FORMATS = [
  { id: 'free', label: 'Free', title: 'The crop and its margins, whatever shape that makes' },
  ...[...ASPECT_PRESETS].sort((a, b) => a.w / a.h - b.w / b.h).map((p) => ({ id: p.id, label: p.id, title: p.label })),
];

const PREVIEW_EDGE = 240;

/**
 * The picture as the file will be — the crop on its border — small, in the
 * panel: the stage shows the whole picture for cropping, so this is the one
 * place the border is seen while it is set. Drawn by the export's own painter.
 */
function DeliveredPreview({
  picture,
  crop,
  border,
  size,
}: {
  picture: DevelopPicture;
  crop: CropZoneApi;
  border: RollBorder | null;
  size: { w: number; h: number } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { source, cube, delivered } = picture;
  const { zone, framing, src } = crop;
  useEffect(() => {
    const canvas = ref.current;
    const image = delivered();
    if (!canvas || !zone || !src || !image) return;
    const full = borderLayout(zone.w, zone.h, border);
    const k = PREVIEW_EDGE / Math.max(full.w, full.h);
    const w = Math.max(1, Math.round(full.w * k));
    const h = Math.max(1, Math.round(full.h * k));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    drawDelivered(ctx, image, src.width, src.height, framing, scaleLayout(full, canvas.width / full.w), border);
  }, [zone, framing, src, border, source, cube, delivered]);
  if (!source || !zone) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-control border border-line bg-paper-2 p-2">
      <canvas ref={ref} aria-label="What the export delivers" className="block max-w-full shadow-[0_1px_3px_rgba(0,0,0,0.25)]" />
      <span className="font-mono text-2xs tabular-nums text-muted">
        {size ? `delivers ${size.w} × ${size.h} px` : 'what the export delivers'}
      </span>
    </div>
  );
}

/**
 * Borders — a subsection under Crop in the same tab (the maintainer's call:
 * the tab keeps the name Crop). Off, the file is exactly the crop. On: the
 * FILE's format (Free is the crop plus its margins), the fill (four swatches,
 * any colour, or the picture itself blurred) and the two margins, linked by
 * default. Every change is written to the roll at once, like the aspect.
 */
export default function BorderSection({
  picture,
  crop,
  border,
  onBorder,
  deliveredSize,
  verbs = [],
  onTold,
}: {
  picture: DevelopPicture;
  crop: CropZoneApi;
  border: RollBorder | null;
  onBorder: (border: RollBorder | null) => void;
  /** The file's size as the export will write it, once the picture is measured. */
  deliveredSize: { w: number; h: number } | null;
  verbs?: readonly BorderApplyVerb[];
  onTold?: (message: string) => void;
}) {
  // What turning it back on restores: the last border this picture wore in
  // this visit, not the default — off and on is a comparison, not a reset.
  const last = useRef<RollBorder>(border ?? { ...DEFAULT_BORDER, margin: { ...DEFAULT_BORDER.margin } });
  if (border) last.current = border;
  const [linked, setLinked] = useState(() => !border || border.margin.x === border.margin.y);
  const b = border;
  const set = (patch: Partial<RollBorder>) => b && onBorder({ ...b, ...patch, margin: { ...(patch.margin ?? b.margin) } });
  const marginTo = (axis: 'x' | 'y', v: number) => {
    if (!b) return;
    set({ margin: linked ? { x: v, y: v } : { ...b.margin, [axis]: v } });
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const customFill = b && b.fill !== 'blur' && !BORDER_SWATCHES.some((s) => s.fill === b.fill);

  return (
    <>
      <DeliveredPreview picture={picture} crop={crop} border={border} size={deliveredSize} />
      <InspectorSection
        id="develop.border"
        title="Borders"
        info={
          <>
            <p>
              A canvas round the crop: bars to reach a format (a landscape picture on a 4:5 post), or
              margins like a print’s. Off, the file is exactly the crop.
            </p>
            <p>
              The margins are a share of the crop’s short side, so they look the same whatever size
              the file is written at. <strong>Blur</strong> fills the canvas with the picture itself,
              softened and slightly darkened — made here, nothing is fetched.
            </p>
          </>
        }
        actions={
          <ToggleField label="Borders" checked={b !== null} onChange={(on) => onBorder(on ? last.current : null)} />
        }
      >
        {b && (
          <>
            <FieldRow label="File">
              <Segmented
                fill
                columns={3}
                size="sm"
                label="File format"
                value={b.aspect ?? 'free'}
                onChange={(id) => set({ aspect: id === 'free' ? null : id })}
                options={FILE_FORMATS}
                className="flex-1 min-w-0"
              />
            </FieldRow>
            <FieldRow label="Fill">
              <div className="flex flex-wrap items-center gap-1.5">
                {BORDER_SWATCHES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.label}
                    aria-label={`Fill: ${s.label}`}
                    aria-pressed={b.fill === s.fill}
                    onClick={() => set({ fill: s.fill })}
                    className={`w-7 h-7 rounded-full border cursor-pointer ${
                      b.fill === s.fill ? 'ring-2 ring-accent ring-offset-1 border-ink' : 'border-line-strong'
                    }`}
                    style={{ background: s.fill }}
                  />
                ))}
                <label
                  title="Any colour"
                  className={`relative w-7 h-7 rounded-full border cursor-pointer overflow-hidden ${
                    customFill ? 'ring-2 ring-accent ring-offset-1 border-ink' : 'border-line-strong'
                  }`}
                  style={{
                    background: customFill
                      ? b.fill
                      : 'conic-gradient(#d9442a, #e8c547, #4f9a5a, #4a7fd0, #9a5ac8, #d9442a)',
                  }}
                >
                  <input
                    type="color"
                    aria-label="Fill: any colour"
                    value={b.fill === 'blur' ? '#000000' : b.fill}
                    onChange={(e) => set({ fill: e.target.value.toLowerCase() })}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <button
                  type="button"
                  aria-pressed={b.fill === 'blur'}
                  onClick={() => set({ fill: 'blur' })}
                  className={`h-7 px-2.5 rounded-full border font-mono text-2xs cursor-pointer ${
                    b.fill === 'blur' ? 'ring-2 ring-accent ring-offset-1 border-ink text-ink' : 'border-line-strong text-ink-soft'
                  }`}
                >
                  Blur
                </button>
              </div>
            </FieldRow>
            <FieldRow label="Left · right">
              <RangeField
                label="Left and right margin"
                min={0}
                max={BORDER_MARGIN_MAX}
                step={0.005}
                value={b.margin.x}
                onChange={(v) => marginTo('x', v)}
                format={pct}
              />
            </FieldRow>
            <FieldRow label="Top · bottom">
              <RangeField
                label="Top and bottom margin"
                min={0}
                max={BORDER_MARGIN_MAX}
                step={0.005}
                value={b.margin.y}
                onChange={(v) => marginTo('y', v)}
                format={pct}
              />
              <IconButton
                size="sm"
                label={linked ? 'The same margin everywhere — click to set them apart' : 'Set the same margin everywhere'}
                aria-pressed={linked}
                onClick={() => {
                  setLinked(!linked);
                  if (!linked && b.margin.y !== b.margin.x) set({ margin: { x: b.margin.x, y: b.margin.x } });
                }}
                className={linked ? 'text-accent-ink' : ''}
              >
                {Icons.link}
              </IconButton>
            </FieldRow>
          </>
        )}
      </InspectorSection>
      {verbs.length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t border-line">
          <SectionLegend label="Apply borders to…">
            <p>
              This border — or none — written onto other pictures, now, each as its own copy. Their crops
              are left as they are: a roll can wear one border over crops that each differ.
            </p>
          </SectionLegend>
          {verbs.map((verb) => (
            <div key={verb.id} className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => {
                  verb.run(border);
                  onTold?.(`done · ${verb.label.toLowerCase()}`);
                }}
                className={developButtonClass}
              >
                {verb.label}
              </button>
              {verb.hint && <span className="font-mono text-3xs text-faint leading-relaxed">{verb.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
