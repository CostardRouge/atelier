import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import Button from '../../shared/ui/Button';
import { useRef, useState } from 'react';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_RADIUS,
  DEFAULT_COLOUR_RANGE,
  MAX_COLOUR_SAMPLES,
  defaultMask,
  describeMask,
  subjectRefineOf,
  withSubjectRefine,
  type Mask,
  type MaskOp,
  type ShadeMask,
  type SubjectMask,
} from '../../shared/render/mask';
import {
  MAX_MASK_PARTS,
  addPart,
  componentMask,
  describePart,
  exceptCandidates,
  layerLabel,
  patchPart,
  removePart,
  withComponentMask,
  type AdjustLayer,
} from '../../shared/develop/layer';
import { isDefaultDevelop } from '../../shared/develop/develop';
import { developLinkClass } from '../../shared/develop/develop-classes';
import {
  MAX_CORE,
  SHADE_FALLOFFS,
  centreAxis,
  isRoundShade,
  shadeCentre,
  shadeCore,
  shadeFalloff,
} from '../../shared/shades/shade-shape';
import { ShadeDirectionPicker, ShadeFalloffPicker } from '../../shared/shades/ShadePickers';
import KindGlyph from './KindGlyph';
import KindPalette from './KindPalette';
import { kindLabel, takesPointer, type PaletteKind, type PaletteMode } from './kind-palette';
import {
  DEFAULT_TOLERANCE,
  GROW_LIMIT,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  type SubjectEdge,
} from '../../shared/segment/subject-refine';

const OP_OPTIONS: readonly { id: MaskOp; label: string }[] = [
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'intersect', label: 'Intersect' },
];

const COMBINE_HINT =
  'Combine a further mask with this one, the way Lightroom does. Add takes in the new shape as well (the larger of the two wherever they overlap, so a shape added to itself changes nothing); Subtract takes it out — a sky minus the mountain you paint over; Intersect keeps only where both are — the shadows, but only inside an ellipse. Parts apply in order, each one reading what the ones above it made, and each has its own invert. A subject is not offered as a part: a Subject layer can carry parts of its own, and “everything but the subject” is Except, below.';

const COLOUR_HINT =
  'Turn Pick on and tap a colour on the picture: every pixel near that colour is in the mask, wherever it is — a sky’s blue, a jacket, the green of a hillside. Tap again elsewhere to add up to five colours; tap a marker to remove it. The colour is taken from the picture as THIS layer sees it — the develop, the look and the layers below, not this layer’s own change nor anything above it — and stored, so the mask does not move when a slider does. Refine widens or narrows how far a colour may stray and still be in; lightness counts half as much as hue, so a sampled blue takes in the sky’s lighter and darker blues but not a grey of the same brightness.';

const SUBJECT_HINT =
  'A model finds the subject you tap. Turn Pick on and tap the thing you mean — a person, a car, a dog — and tap again anywhere else to add to it, which is how you take in someone AND their bag. When it takes in too much — the bench the person leans on, a second person far away — switch to Remove (or hold ⌥ for one tap) and tap the part you do not want: the model finds that object too, and it is taken out of the subject. Tapping a point you already placed takes it off. “Background” is this mask inverted — the checkbox below.';

const REFINE_HINT =
  'The model answers a tap with how SURE it is, pixel by pixel; these three work on that answer, never on the points. Tolerance moves the cut: higher takes in what it was less sure of — an edge, a neighbour it half-joined — lower keeps only the core; 50 % is the model’s own answer. Only what touches my + points drops every region no added point lands in — the second person a tap on the first also found. Grow / Shrink moves the edge, in pixels of the 1024 px picture the model is shown. A removed region is cut at the same Tolerance and taken out after, so growing never creeps back into it. Edge is made last: As found is the cut as it is, Soft feathers it, and Snap pulls an edge the model drew roughly onto the picture’s own, within a few pixels — a guided filter over what the model was shown. It refines an edge; it cannot bring back a part the model left out (tap that part, or paint it).';

const EDGE_OPTIONS: readonly { id: SubjectEdge; label: string }[] = [
  { id: 'found', label: 'As found' },
  { id: 'soft', label: 'Soft' },
  { id: 'snap', label: 'Snap to edges' },
];

const SUBJECT_TONES: readonly { id: 'add' | 'remove'; label: string }[] = [
  { id: 'add', label: '+ Add' },
  { id: 'remove', label: '− Remove' },
];

const PAINT_HINT =
  'With Paint on, a drag across the picture lays a stroke; the before/after wipe waits until it is off. Erase takes coverage away, and only from what is already there — a stroke painted after an eraser comes back, because strokes apply in the order they were made. Size and Softness are set before a stroke, not after: each stroke keeps the ones it was painted with, which is what lets a soft edge and a hard one live in the same mask.';

const HINT =
  'Feather is the width of the transition, measured against half the picture’s diagonal — so it means the same on a wide frame and on a square crop of it. A linear mask reads 0.5 exactly on its line, and its angle is a compass bearing: 0 covers the top, 90 the right. A radial mask is FULL inside its ellipse and fades outward, so the shape is what is affected rather than the middle of a ramp. A shade is the shape a Trips shade draws — see its own note. Invert applies the layer everywhere the mask is not.';

const SHADE_HINT =
  'The shape a shade draws in Trips, here weighing this layer’s develop instead of painting a colour: full where a Trips shade is at full strength, clear where it clears, and the layer’s opacity is its strength. Pick where it comes from on the grid — an edge, a corner, or in the centre a radial and the two middle bands. Reach is how far the fade travels (a radius for the round ones, against the picture’s shorter side so a radial stays a circle); Core holds the full effect over part of it before the fade starts, which is what makes a zone rather than a line; Falloff is the curve of the fade. A band or a radial can be moved: Place on the picture, then press or drag where it should sit. Invert here is the shade’s own — clear at the anchor and full at the far end of the reach, the core held there.';

/** What the painting and picking controls report about the open subject. */
export interface SubjectStatus {
  working: boolean;
  state: string;
  resolved: boolean;
}

/**
 * The selected layer's mask and opacity — its own mask, and the further masks
 * COMBINED with it (item 16), one of them open at a time.
 *
 * The procedural shapes are set with NUMBERS — dragging a gradient's line on
 * the picture needs a hit-tested overlay with its own gesture rules, which is a
 * piece of work rather than a control, and "show the mask" plus these sliders
 * already place one accurately. A PAINTED mask, a SUBJECT and a COLOUR are the
 * exceptions: there is no number that means "here" or "this blue", so they
 * take the pointer — and the pointer acts on the component OPEN here. So
 * does a SHADE's centre, placed by a press on the picture the way Trips
 * places it; its other numbers are set with the very pickers Trips uses
 * (`shared/shades/ShadePickers.tsx`).
 *
 * The maths is `shared/render/mask.ts`.
 */
export default function MaskPanel({
  layer,
  layers,
  part,
  onPart,
  onPatch,
  brush,
  onBrush,
  painting,
  onPainting,
  subjectTone,
  onSubjectTone,
  subject,
}: {
  layer: AdjustLayer;
  /** The whole stack, for the subjects this layer may take out of itself. */
  layers: readonly AdjustLayer[];
  /** The component open: null is the layer's own mask, 0.. a part. */
  part: number | null;
  onPart: (part: number | null) => void;
  onPatch: (patch: Partial<Omit<AdjustLayer, 'id'>>) => void;
  /** The settings the NEXT stroke is painted with. */
  brush: { radius: number; hardness: number; erase: boolean };
  onBrush: (patch: Partial<{ radius: number; hardness: number; erase: boolean }>) => void;
  painting: boolean;
  onPainting: (on: boolean) => void;
  /** What a tap on a subject does — added to it, or taken out (⌥ flips it). */
  subjectTone?: 'add' | 'remove';
  onSubjectTone?: (tone: 'add' | 'remove') => void;
  /** Present only for a subject mask — how its segmentation is getting on. */
  subject: SubjectStatus | null;
}) {
  // The palette of kinds, open from the kind chip (change it) or from
  // Combine (add a term) — one palette for both, `kind-palette.ts`.
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const kindRef = useRef<HTMLButtonElement>(null);
  const combineRef = useRef<HTMLButtonElement>(null);
  const parts = layer.parts ?? [];
  const open = part !== null && parts[part] ? part : null;
  const mask = componentMask(layer, open);
  const invert = open === null ? layer.invert : parts[open].invert;
  // The subjects this layer may SUBTRACT — «sauf le sujet», the maintainer's
  // pick (2026-09-23). Offered only where one exists: a control with nothing
  // to choose is a question the author cannot answer.
  const cuts = exceptCandidates(layers, layer.id);
  const exceptOptions = [
    { id: 'none', label: 'Nothing' },
    ...cuts.map((l) => ({ id: l.id, label: cuts.length === 1 ? 'The subject' : layerLabel(l, layers) })),
  ];

  const setMask = (next: Mask | null) => {
    if (open === null) onPatch({ mask: next });
    else if (next) onPatch({ parts: withComponentMask(layer, open, next).parts });
  };
  const setKind = (next: PaletteKind) => {
    // Switching kinds STARTS the new shape fresh rather than carrying numbers
    // across: a radius is not an angle, and a half-translated shape is worse
    // than an obvious default.
    setMask(next === 'whole' ? null : defaultMask(next));
    onPainting(takesPointer(next));
  };
  const currentKind: PaletteKind = mask?.kind ?? 'whole';
  const paletteAnchor = palette === 'part' ? combineRef : kindRef;
  const patchMask = (patch: Partial<Record<string, number>>) => {
    if (!mask) return;
    setMask({ ...mask, ...patch } as Mask);
  };
  const setInvert = (on: boolean) => {
    if (open === null) onPatch({ invert: on });
    else onPatch({ parts: patchPart(layer, open, { invert: on }).parts });
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={parts.length ? `Mask · ${parts.length + 1} combined` : `Mask · ${describeMask(layer.mask)}`}>
        <p>{HINT}</p>
      </SectionLegend>

      {/* The COMPONENTS, once there is more than one: the layer's own mask,
          then each part in the order it applies. A row opens it below — the
          controls, and what the stage's Pick / Paint act on. */}
      {parts.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {[null, ...parts.map((_, i) => i)].map((i) => {
            const selected = i === open;
            const label =
              i === null
                ? `${layer.invert ? 'not ' : ''}${describeMask(layer.mask)}`
                : describePart(parts[i]);
            return (
              <li
                key={i === null ? 'own' : i}
                className={`flex items-center gap-1 rounded-paper border px-1.5 py-0.5 ${
                  selected ? 'border-accent bg-surface-raised' : 'border-line'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  className="flex-1 min-w-0 truncate bg-transparent border-0 p-0 text-left font-mono text-2xs text-ink"
                  onClick={() => onPart(i)}
                >
                  {i === null ? <span className="text-faint">mask · </span> : null}
                  {label}
                </button>
                {i !== null && (
                  <IconButton
                    size="sm"
                    label={`Remove ${label}`}
                    onClick={() => {
                      onPatch({ parts: removePart(layer, i).parts });
                      onPart(null);
                    }}
                  >
                    {Icons.trash}
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open !== null && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint">This part</span>
          <Segmented
            size="sm"
            label="How this part combines"
            value={parts[open].op}
            onChange={(v) => onPatch({ parts: patchPart(layer, open, { op: v as MaskOp }).parts })}
            options={OP_OPTIONS}
          />
        </div>
      )}

      {/* The kind, as a chip that opens the palette — where an eight-way
          switch used to sit (`kind-palette.ts`). */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-3xs text-faint">{open === null ? 'Mask' : 'This term'}</span>
        <button
          ref={kindRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={palette === 'type' || palette === 'part-type'}
          title={open === null ? 'Change what this layer’s mask is' : 'Change what this term is'}
          onClick={() => setPalette((m) => (m ? null : open === null ? 'type' : 'part-type'))}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper pl-1.5 pr-2.5 py-0.5 text-xs text-ink cursor-pointer hover:border-ink-soft"
        >
          <KindGlyph kind={currentKind} className="w-[22px] h-[15px]" />
          {kindLabel(currentKind)} ▾
        </button>
      </div>
      {palette && (
        <KindPalette
          mode={palette}
          current={palette === 'part' ? null : currentKind}
          anchorRect={() => paletteAnchor.current?.getBoundingClientRect() ?? null}
          within={paletteAnchor}
          onClose={() => setPalette(null)}
          onPick={(picked, op) => {
            setPalette(null);
            if (palette === 'part') {
              if (picked === 'whole') return;
              onPatch({ parts: addPart(layer, op, picked).parts });
              onPart(parts.length);
              onPainting(takesPointer(picked));
            } else if (picked !== currentKind) {
              setKind(picked);
            }
          }}
        />
      )}

      {mask && (
        <ShapeControls
          mask={mask}
          layer={layer}
          patchMask={patchMask}
          setMask={setMask}
          brush={brush}
          onBrush={onBrush}
          painting={painting}
          onPainting={onPainting}
          subjectTone={subjectTone}
          onSubjectTone={onSubjectTone}
          subject={subject}
        />
      )}

      {/* A shade carries its OWN invert (dark at the far end of the reach),
          drawn with its controls. This one — the complement — stays
          reachable only where it is on, so it can be turned off. */}
      {mask && (mask.kind !== 'shade' || invert) && (
        <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
          {open === null ? 'invert — apply everywhere the mask is not' : 'invert this part before it combines'}
        </label>
      )}

      <RangeSlider
        label="Opacity"
        value={layer.opacity}
        range={{ min: 0, max: 1, step: 0.01, unit: '' }}
        reset={1}
        printed={`${Math.round(layer.opacity * 100)} %`}
        onChange={(v) => onPatch({ opacity: v })}
      />

      {cuts.length > 0 && (
        <div className="flex flex-col gap-1">
          <Segmented
            size="sm"
            label="Except"
            columns={exceptOptions.length > 3 ? 2 : undefined}
            value={layer.except && cuts.some((l) => l.id === layer.except) ? layer.except : 'none'}
            onChange={(id) => onPatch({ except: id === 'none' ? null : id })}
            options={exceptOptions}
          />
          <span className="font-mono text-3xs text-faint">
            {layer.except
              ? 'except — the subject is taken out of this layer, so its own layer alone decides it'
              : 'except — take a subject out of this layer: darken everything but the person'}
          </span>
        </div>
      )}
      {parts.length < MAX_MASK_PARTS && (
        <div className="flex items-center justify-between gap-2">
          <SectionLegend label="Combine">
            <p>{COMBINE_HINT}</p>
          </SectionLegend>
          {/* Add, subtract or intersect is chosen at the head of the same
              palette, with the kind. */}
          <Button
            ref={combineRef}
            size="sm"
            variant="ghost"
            aria-haspopup="dialog"
            aria-expanded={palette === 'part'}
            onClick={() => setPalette((m) => (m === 'part' ? null : 'part'))}
          >
            + Combine…
          </Button>
        </div>
      )}

    </div>
  );
}

/** One mask's own controls — the same whether it is a layer's mask or a part. */
function ShapeControls({
  mask,
  layer,
  patchMask,
  setMask,
  brush,
  onBrush,
  painting,
  onPainting,
  subjectTone = 'add',
  onSubjectTone,
  subject,
}: {
  mask: Mask;
  layer: AdjustLayer;
  patchMask: (patch: Partial<Record<string, number>>) => void;
  setMask: (mask: Mask) => void;
  brush: { radius: number; hardness: number; erase: boolean };
  onBrush: (patch: Partial<{ radius: number; hardness: number; erase: boolean }>) => void;
  painting: boolean;
  onPainting: (on: boolean) => void;
  subjectTone?: 'add' | 'remove';
  onSubjectTone?: (tone: 'add' | 'remove') => void;
  subject: SubjectStatus | null;
}) {
  return (
    <>
      {mask?.kind === 'linear' && (
        <>
          <RangeSlider
            label="Across"
            value={mask.x}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.x * 100)} %`}
            onChange={(v) => patchMask({ x: v })}
          />
          <RangeSlider
            label="Down"
            value={mask.y}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.4}
            printed={`${Math.round(mask.y * 100)} %`}
            onChange={(v) => patchMask({ y: v })}
          />
          <RangeSlider
            label="Angle"
            value={mask.angle}
            range={{ min: -180, max: 180, step: 1, unit: '' }}
            reset={0}
            printed={`${Math.round(mask.angle)}°`}
            onChange={(v) => patchMask({ angle: v })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1.5, step: 0.01, unit: '' }}
            reset={0.35}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'radial' && (
        <>
          <RangeSlider
            label="Across"
            value={mask.x}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.x * 100)} %`}
            onChange={(v) => patchMask({ x: v })}
          />
          <RangeSlider
            label="Down"
            value={mask.y}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.5}
            printed={`${Math.round(mask.y * 100)} %`}
            onChange={(v) => patchMask({ y: v })}
          />
          <RangeSlider
            label="Width"
            value={mask.radiusX}
            range={{ min: 0.02, max: 1.5, step: 0.01, unit: '' }}
            reset={0.4}
            printed={mask.radiusX.toFixed(2)}
            onChange={(v) => patchMask({ radiusX: v })}
          />
          <RangeSlider
            label="Height"
            value={mask.radiusY}
            range={{ min: 0.02, max: 1.5, step: 0.01, unit: '' }}
            reset={0.4}
            printed={mask.radiusY.toFixed(2)}
            onChange={(v) => patchMask({ radiusY: v })}
          />
          <RangeSlider
            label="Turn"
            value={mask.angle}
            range={{ min: -180, max: 180, step: 1, unit: '' }}
            reset={0}
            printed={`${Math.round(mask.angle)}°`}
            onChange={(v) => patchMask({ angle: v })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1.5, step: 0.01, unit: '' }}
            reset={0.3}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'shade' && (
        <ShadeControls mask={mask} setMask={setMask} placing={painting} onPlacing={onPainting} />
      )}

      {mask?.kind === 'luma' && (
        <>
          <RangeSlider
            label="From"
            value={mask.from}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0}
            printed={mask.from.toFixed(2)}
            onChange={(v) => patchMask({ from: Math.min(v, mask.to) })}
          />
          <RangeSlider
            label="To"
            value={mask.to}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.35}
            printed={mask.to.toFixed(2)}
            onChange={(v) => patchMask({ to: Math.max(v, mask.from) })}
          />
          <RangeSlider
            label="Feather"
            value={mask.feather}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={0.15}
            printed={mask.feather.toFixed(2)}
            onChange={(v) => patchMask({ feather: v })}
          />
        </>
      )}

      {mask?.kind === 'brush' && (
        <>
          <SectionLegend label="Painting">
            <p>{PAINT_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={painting ? 'primary' : 'ghost'}
              onClick={() => onPainting(!painting)}
            >
              {painting ? 'Painting' : 'Paint'}
            </Button>
            <Button
              size="sm"
              variant={brush.erase ? 'primary' : 'ghost'}
              onClick={() => onBrush({ erase: !brush.erase })}
            >
              Erase
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={() => setMask({ kind: 'brush', strokes: mask.strokes.slice(0, -1) })}>
              Undo stroke
            </Button>
            <Button size="sm" variant="ghost" disabled={!mask.strokes.length} onClick={() => setMask({ kind: 'brush', strokes: [] })}>
              Clear
            </Button>
          </div>
          <RangeSlider
            label="Size"
            value={brush.radius}
            range={{ min: 0.01, max: 0.8, step: 0.005, unit: '' }}
            reset={DEFAULT_BRUSH_RADIUS}
            printed={`${Math.round(brush.radius * 100)} %`}
            onChange={(v) => onBrush({ radius: v })}
          />
          <RangeSlider
            label="Softness"
            value={1 - brush.hardness}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={1 - DEFAULT_BRUSH_HARDNESS}
            printed={`${Math.round((1 - brush.hardness) * 100)} %`}
            onChange={(v) => onBrush({ hardness: 1 - v })}
          />
          {mask.strokes.length === 0 && (
            <span className="font-mono text-3xs text-faint">
              nothing painted yet — an empty painted mask covers nothing, so the layer does nothing
            </span>
          )}
        </>
      )}

      {mask?.kind === 'subject' && (
        <>
          <SectionLegend label="Subject">
            <p>{SUBJECT_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={painting ? 'primary' : 'ghost'}
              onClick={() => onPainting(!painting)}
            >
              {painting ? 'Picking' : 'Pick'}
            </Button>
            {onSubjectTone && (
              <Segmented
                size="sm"
                label="What a tap on the picture does"
                value={subjectTone}
                onChange={(v) => onSubjectTone(v)}
                options={SUBJECT_TONES}
              />
            )}
            <span className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              disabled={!mask.points.length && !mask.minus?.length}
              onClick={() => setMask({ kind: 'subject', model: mask.model, points: [] })}
            >
              Clear
            </Button>
          </div>
          <span className="font-mono text-3xs text-faint">
            {subject?.state === 'unavailable'
              ? 'the model could not be loaded — every other mask still works'
              : mask.points.length === 0
                ? mask.minus?.length
                  ? 'tap the subject to add it — a removal alone takes away from nothing'
                  : 'tap the subject on the picture'
                : subject?.working
                  ? `finding it… (${pointCount(mask)})`
                  : subject?.resolved
                    ? `${pointCount(mask)} · ⌥-tap takes a part out · tap a point to drop it${
                        // Found, and still doing nothing: said, or a subject
                        // that the model answered reads as a pick that failed.
                        isDefaultDevelop(layer.develop) ? ' · found — move a slider below to act on it' : ''
                      }`
                    : 'the model is loading — 17 MB, once per visit'}
          </span>
          {mask.points.length > 0 && <SubjectRefineControls mask={mask} setMask={setMask} />}
        </>
      )}


      {mask?.kind === 'colour' && (
        <>
          <SectionLegend label="Colour range">
            <p>{COLOUR_HINT}</p>
          </SectionLegend>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant={painting ? 'primary' : 'ghost'} onClick={() => onPainting(!painting)}>
              {painting ? 'Picking' : 'Pick'}
            </Button>
            {mask.samples.map((c, i) => (
              <button
                key={i}
                type="button"
                title="Remove this colour"
                aria-label={`Remove colour ${i + 1}`}
                className="h-5 w-5 rounded-paper border border-line"
                style={{ background: `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})` }}
                onClick={() => setMask({ ...mask, samples: mask.samples.filter((_, k) => k !== i) })}
              />
            ))}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={!mask.samples.length} onClick={() => setMask({ ...mask, samples: [] })}>
              Clear
            </Button>
          </div>
          <RangeSlider
            label="Refine"
            value={mask.range}
            range={{ min: 0, max: 1, step: 0.01, unit: '' }}
            reset={DEFAULT_COLOUR_RANGE}
            printed={`${Math.round(mask.range * 100)}`}
            onChange={(v) => patchMask({ range: v })}
          />
          <span className="font-mono text-3xs text-faint">
            {mask.samples.length === 0
              ? 'tap a colour on the picture — an empty range covers nothing, so the layer does nothing'
              : mask.samples.length >= MAX_COLOUR_SAMPLES
                ? `${MAX_COLOUR_SAMPLES} colours is the most one range holds · tap a marker to remove one`
                : `${mask.samples.length} colour${mask.samples.length === 1 ? '' : 's'} · tap another to add it, a marker to remove it`}
          </span>
        </>
      )}
    </>
  );
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** `2 points`, `2 points, 1 taken out`. */
function pointCount(mask: { points: readonly unknown[]; minus?: readonly unknown[] }): string {
  const n = mask.points.length;
  const out = mask.minus?.length ?? 0;
  return `${n} point${n === 1 ? '' : 's'}${out ? `, ${out} taken out` : ''}`;
}

/** Where a shape is darkest when it is not inverted, in a word. */
function anchorWord(direction: ShadeMask['direction']): string {
  if (direction === 'radial') return 'centre';
  if (direction === 'middle-vertical' || direction === 'middle-horizontal') return 'middle';
  return isRoundShade(direction) ? 'corner' : 'edge';
}

/**
 * A SHADE's own controls: Trips' pickers for where it comes from and how it
 * fades, and the reach, the core and the centre as this inspector's sliders.
 * No strength and no colour — the layer's opacity is the strength, its
 * develop what lands.
 */
function ShadeControls({
  mask,
  setMask,
  placing,
  onPlacing,
}: {
  mask: ShadeMask;
  setMask: (mask: Mask) => void;
  /** The stage is placing this shade's centre. */
  placing: boolean;
  onPlacing: (on: boolean) => void;
}) {
  const patch = (next: Partial<ShadeMask>) => setMask({ ...mask, ...next });
  const round = isRoundShade(mask.direction);
  const falloff = shadeFalloff(mask);
  const core = shadeCore(mask);
  const centre = shadeCentre(mask);
  const axis = centreAxis(mask.direction);
  const centred = (axis === 'y' || centre.x === 0.5) && (axis === 'x' || centre.y === 0.5);
  return (
    <>
      <SectionLegend label="Shade">
        <p>{SHADE_HINT}</p>
      </SectionLegend>
      <ShadeDirectionPicker
        direction={mask.direction}
        label="Shade mask"
        onPick={(direction) => {
          patch({ direction });
          // An edge or a corner is its own position: nothing left to place.
          if (placing && !centreAxis(direction)) onPlacing(false);
        }}
      />
      <RangeSlider
        label={round ? 'Radius' : 'Reach'}
        value={mask.reach}
        range={{ min: 0, max: 1, step: 0.01, unit: '' }}
        reset={0.55}
        printed={pct(mask.reach)}
        onChange={(reach) => patch({ reach })}
      />
      <RangeSlider
        label="Core"
        value={core}
        range={{ min: 0, max: MAX_CORE, step: 0.01, unit: '' }}
        reset={0}
        printed={pct(core)}
        onChange={(next) => patch({ core: next })}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-ink">Falloff</span>
        <ShadeFalloffPicker falloff={falloff} label="Shade mask" onPick={(next) => patch({ falloff: next })} />
        <span className="font-mono text-3xs text-faint">{SHADE_FALLOFFS.find((f) => f.id === falloff)?.hint}</span>
      </div>
      {axis && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant={placing ? 'primary' : 'ghost'} aria-pressed={placing} onClick={() => onPlacing(!placing)}>
              {placing ? 'Placing' : 'Place on the picture'}
            </Button>
            <span className="flex-1" />
            {!centred && (
              <button type="button" className={developLinkClass} onClick={() => patch({ center: undefined })}>
                Back to the middle
              </button>
            )}
          </div>
          {axis !== 'y' && (
            <RangeSlider
              label="Across"
              value={centre.x}
              range={{ min: 0, max: 1, step: 0.01, unit: '' }}
              reset={0.5}
              printed={pct(centre.x)}
              onChange={(x) => patch({ center: { ...centre, x } })}
            />
          )}
          {axis !== 'x' && (
            <RangeSlider
              label="Down"
              value={centre.y}
              range={{ min: 0, max: 1, step: 0.01, unit: '' }}
              reset={0.5}
              printed={pct(centre.y)}
              onChange={(y) => patch({ center: { ...centre, y } })}
            />
          )}
          {placing && (
            <span className="font-mono text-3xs text-faint">
              press or drag on the picture to move the {axis === 'both' ? 'centre' : 'band'}
            </span>
          )}
        </>
      )}
      <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
        <input type="checkbox" checked={mask.invert} onChange={(e) => patch({ invert: e.target.checked })} />
        invert — clear at the {anchorWord(mask.direction)}, full at the far end of the {round ? 'radius' : 'reach'}
      </label>
    </>
  );
}

/**
 * The three knobs over what the model found (`subject-refine.ts`), shown at
 * once under the subject's status — his answer to the brief's question 4.
 * Each one writes through `withSubjectRefine`, which leaves a default off
 * the record.
 */
function SubjectRefineControls({ mask, setMask }: { mask: SubjectMask; setMask: (mask: Mask) => void }) {
  const refine = subjectRefineOf(mask);
  return (
    <div className="flex flex-col gap-2 pt-1">
      <SectionLegend label="Refine what it found">
        <p>{REFINE_HINT}</p>
      </SectionLegend>
      <RangeSlider
        label="Tolerance"
        value={refine.tolerance}
        range={{ min: TOLERANCE_MIN, max: TOLERANCE_MAX, step: 0.01, unit: '' }}
        reset={DEFAULT_TOLERANCE}
        printed={`${Math.round(refine.tolerance * 100)} %`}
        onChange={(v) => setMask(withSubjectRefine(mask, { tolerance: v }))}
      />
      <RangeSlider
        label="Grow / Shrink"
        value={refine.grow}
        range={{ min: -GROW_LIMIT, max: GROW_LIMIT, step: 1, unit: '' }}
        reset={0}
        printed={`${refine.grow > 0 ? '+' : ''}${refine.grow} px`}
        onChange={(v) => setMask(withSubjectRefine(mask, { grow: v }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink">Edge</span>
        <Segmented
          size="sm"
          label="Edge"
          value={refine.edge}
          onChange={(v) => setMask(withSubjectRefine(mask, { edge: v }))}
          options={EDGE_OPTIONS}
        />
      </div>
      <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
        <input
          type="checkbox"
          checked={refine.islands}
          onChange={(e) => setMask(withSubjectRefine(mask, { islands: e.target.checked }))}
        />
        only what touches my + points
      </label>
    </div>
  );
}
