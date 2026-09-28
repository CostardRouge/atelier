import { useEffect, useMemo, useRef } from 'react';
import {
  CAMERA_FIELDS,
  cameraFacts,
  factsLine,
  type CameraFacts,
  type CameraField,
} from '../../../shared/exif/camera-facts';
import type { ExifData } from '../../../shared/exif/exif-parser';
import {
  MAX_PLATE_SIZE,
  MIN_PLATE_SIZE,
  PLATE_LAYOUTS,
  cameraWordsOf,
  gridOrigin,
  plateElements,
  plateRuns,
  plateSpan,
  readPlateSpec,
  type CameraPlateSpec,
  type CameraWords,
  type PlateLayout,
  type PlatePlace,
} from '../../../shared/overlay/camera-plate';
import { drawOverlays } from '../../../shared/overlay/draw-overlays';
import { ensureOverlayFonts } from '../../../shared/overlay/fonts';
import type { Anchor } from '../../../shared/overlay/overlay-types';
import type { StyleTheme } from '../../../shared/overlay/title-styles';
import { MAX_SHADES, createShade } from '../../../shared/roadtrip/shades';
import type { PostBadge, TripDoc, TripPost } from '../../../shared/roadtrip/trip-types';
import Button from '../../../shared/ui/Button';
import IconButton from '../../../shared/ui/IconButton';
import { FieldRow, RangeField, ToggleField } from '../../../shared/ui/Inspector';
import { Icons } from '../../../shared/ui/icons';
import { inputClass } from './ui';

const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** The layouts bound to an edge, which decide their own side. */
const EDGE_LAYOUTS = new Set<PlateLayout>(['bar', 'margin']);

const TILE_W = 240;
const TILE_H = 150;

/**
 * One layout drawn with the picture's REAL facts, through the very elements
 * and the very renderer the badge uses — a layout you cannot see before
 * adopting it is one you adopt by trial, and an example set in made-up numbers
 * would be a fabricated value. Where the picture records nothing the tile is
 * empty and says so.
 */
function LayoutTile({
  layout,
  label,
  hint,
  facts,
  fields,
  words,
  theme,
  pressed,
  onPick,
}: {
  layout: PlateLayout;
  label: string;
  hint: string;
  facts: CameraFacts;
  fields: CameraField[];
  words: CameraWords;
  theme: StyleTheme | null;
  pressed: boolean;
  onPick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const elements = useMemo(() => {
    // Centred in the tile, as large as it holds: a tile shows the layout's
    // type, not where the piece will put it — the stage says that.
    const spec: CameraPlateSpec = {
      fields,
      layout,
      place: EDGE_LAYOUTS.has(layout) ? 'badge' : 'center-left',
      size: 1,
    };
    const aspect = TILE_W / TILE_H;
    const probe = plateRuns(facts, spec, words, 'left');
    if (!probe) return [];
    // As large as the tile holds, both ways: its short side is its height,
    // and it is `aspect` of those wide.
    const unit = Math.min(
      0.1,
      0.74 / Math.max(1, probe.height),
      (0.84 * aspect) / Math.max(1, plateSpan(probe)),
    );
    const runs = plateRuns(facts, spec, words, 'left', aspect / unit) ?? probe;
    return plateElements(runs, gridOrigin(runs, unit, aspect), unit, aspect, `tile:${layout}`);
  }, [facts, fields, words, layout]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    void ensureOverlayFonts(elements, theme).then(() => {
      const ctx = canvas.getContext('2d');
      if (!alive || !ctx) return;
      const g = ctx.createLinearGradient(0, 0, 0, TILE_H);
      g.addColorStop(0, '#3a3a40');
      g.addColorStop(1, '#141210');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TILE_W, TILE_H);
      if (elements.length === 0) {
        // The reason, not a blank: nothing ticked is recorded by this picture.
        ctx.fillStyle = 'rgba(244,240,231,0.55)';
        ctx.font = "500 15px 'JetBrains Mono', ui-monospace, monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('nothing recorded', TILE_W / 2, TILE_H / 2);
        return;
      }
      drawOverlays(ctx, elements, null, TILE_W, TILE_H, { theme });
    });
    return () => {
      alive = false;
    };
  }, [elements, theme]);

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={pressed}
      title={hint}
      className={`flex flex-col gap-1 p-1 rounded-[9px] border bg-paper text-left cursor-pointer transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        pressed
          ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]'
          : 'border-line-strong hover:border-muted'
      }`}
    >
      <canvas
        ref={ref}
        width={TILE_W}
        height={TILE_H}
        aria-hidden="true"
        className="w-full h-auto rounded-[6px] bg-frame"
      />
      <span className="px-0.5 text-xs font-medium text-ink">{label}</span>
    </button>
  );
}

interface CameraPanelProps {
  trip: TripDoc;
  post: TripPost;
  /** The hook picture's effective EXIF, read in the editor; null says nothing. */
  exif: ExifData | null;
  patchBadge: (patch: Partial<PostBadge>) => void;
  onChangeTrip: (trip: TripDoc) => void;
}

/**
 * The camera credit, composed à la carte: which facts, in what order, in
 * which layout, where — over a picture whose own EXIF supplies every value.
 * A piece that never opens these rows keeps the plain line it always drew;
 * the first control touched writes the choice onto the piece.
 */
export default function CameraPanel({ trip, post, exif, patchBadge, onChangeTrip }: CameraPanelProps) {
  const spec = readPlateSpec(post.badge.camera ?? null);
  const setSpec = (patch: Partial<CameraPlateSpec>) => patchBadge({ camera: { ...spec, ...patch } });
  const names = trip.cameraNames;
  const facts = useMemo(() => cameraFacts(exif, names), [exif, names]);
  const words = useMemo(() => cameraWordsOf(trip.badgeWords.camera), [trip.badgeWords.camera]);
  const line = factsLine(facts, spec.fields);
  const on = post.badge.showExif;
  const override = post.badge.textOverrides.exif?.trim();

  // The chosen facts in their order, then the rest in the list's own.
  const chosen = spec.fields;
  const rows = [
    ...chosen.map((id) => CAMERA_FIELDS.find((f) => f.id === id)!).filter(Boolean),
    ...CAMERA_FIELDS.filter((f) => !chosen.includes(f.id)),
  ];
  const toggleField = (id: CameraField, want: boolean) =>
    setSpec({ fields: want ? [...chosen, id] : chosen.filter((f) => f !== id) });
  const move = (id: CameraField, by: -1 | 1) => {
    const i = chosen.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    setSpec({ fields: next });
  };

  const valueOf = (id: CameraField): string => {
    const fact = facts.facts[id];
    if (fact) return fact.value;
    if (id === 'ev' && facts.evStops !== null) return '±0 — the camera’s own reading, not drawn in a line';
    return 'not recorded by this picture';
  };

  // The name the file gives the body, and what this trip calls it.
  const rawBody = facts.rawBody;
  const alias = rawBody
    ? (Object.entries(names ?? {}).find(([k]) => k.trim().toLowerCase() === rawBody.toLowerCase())?.[1] ?? '')
    : '';
  const setAlias = (value: string) => {
    if (!rawBody) return;
    const next = Object.fromEntries(
      Object.entries(names ?? {}).filter(([k]) => k.trim().toLowerCase() !== rawBody.toLowerCase()),
    );
    if (value.trim()) next[rawBody] = value;
    onChangeTrip({ ...trip, cameraNames: next });
  };

  const barEdge = spec.place !== 'badge' && spec.place.startsWith('top-') ? 'top' : 'bottom';
  const addShade = () => {
    if (post.badge.shades.length >= MAX_SHADES) return;
    patchBadge({
      shades: [
        ...post.badge.shades,
        createShade({ direction: barEdge, reach: 0.24, strength: 0.7, core: 0.4, falloff: 'in-out' }),
      ],
    });
  };

  const placeHint = (() => {
    if (spec.layout === 'bar') return 'An edge bar runs along the bottom — or the top, from a top cell.';
    if (spec.layout === 'margin') return 'A margin runs down the right — or the left, from a left cell.';
    if (spec.place === 'badge') return 'Hung under the badge, and moves with it.';
    return post.badge.layout.anchor === spec.place
      ? 'The badge is anchored in this cell too — they will overlap.'
      : 'In a cell of its own, where the badge is not.';
  })();

  return (
    <>
      <FieldRow
        label="Credit"
        hint={
          override ? (
            <>Written by hand on the Camera piece: “{override}”. Clear it there to compose the credit here.</>
          ) : line ? (
            <span className="font-mono text-ink">“{line}”</span>
          ) : exif ? (
            'This picture records none of the facts ticked below — nothing to credit.'
          ) : (
            'This picture records no camera, lens or exposure — nothing to credit. Write the line yourself on the Camera piece if you want one.'
          )
        }
      >
        <ToggleField
          label="Credit the camera"
          checked={on}
          onChange={(showExif) => patchBadge({ showExif })}
        >
          On the picture
        </ToggleField>
      </FieldRow>

      {on && (
        <>
          <FieldRow label="Layout" align="start" hint={PLATE_LAYOUTS.find((l) => l.id === spec.layout)?.hint}>
            <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0" role="group" aria-label="Camera layout">
              {PLATE_LAYOUTS.map((l) => (
                <LayoutTile
                  key={l.id}
                  layout={l.id}
                  label={l.label}
                  hint={l.hint}
                  facts={facts}
                  fields={chosen}
                  words={words}
                  theme={trip.theme}
                  pressed={spec.layout === l.id}
                  onPick={() => setSpec({ layout: l.id })}
                />
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Facts" align="start">
            <ul className="m-0 p-0 list-none flex flex-col gap-1 flex-1 min-w-0" aria-label="Facts credited">
              {rows.map((f) => {
                const picked = chosen.includes(f.id);
                const recorded = Boolean(facts.facts[f.id]);
                const i = chosen.indexOf(f.id);
                return (
                  <li
                    key={f.id}
                    className={`flex items-center gap-2 min-w-0 pl-2 pr-1 py-1 rounded-[8px] border border-line bg-paper ${
                      picked ? '' : 'opacity-65'
                    }`}
                  >
                    <input
                      type="checkbox"
                      id={`camera-field-${f.id}`}
                      checked={picked}
                      onChange={(e) => toggleField(f.id, e.target.checked)}
                      className="flex-none accent-[var(--color-accent)]"
                    />
                    <label htmlFor={`camera-field-${f.id}`} className="flex flex-col min-w-0 flex-1 cursor-pointer">
                      <span className="text-xs text-ink leading-tight">{f.label}</span>
                      <span
                        className={`font-mono text-2xs truncate ${recorded ? 'text-ink-soft' : 'text-faint'}`}
                      >
                        {valueOf(f.id)}
                      </span>
                    </label>
                    {picked && (
                      <span className="flex-none flex gap-0.5">
                        <IconButton
                          size="sm"
                          variant="ghost"
                          label={`Move ${f.label} up`}
                          disabled={i === 0}
                          onClick={() => move(f.id, -1)}
                        >
                          {Icons.arrowUp}
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          label={`Move ${f.label} down`}
                          disabled={i === chosen.length - 1}
                          onClick={() => move(f.id, 1)}
                        >
                          {Icons.arrowDown}
                        </IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </FieldRow>

          <FieldRow label="Place" align="start" hint={placeHint}>
            <div className="flex items-start gap-2.5 flex-wrap">
              <Button
                size="sm"
                variant={spec.place === 'badge' ? 'primary' : 'default'}
                aria-pressed={spec.place === 'badge'}
                onClick={() => setSpec({ place: 'badge' })}
              >
                Under the badge
              </Button>
              <div className="grid grid-cols-3 gap-1 w-[5.5rem]" role="group" aria-label="Camera cell">
                {ANCHORS.map((anchor) => (
                  <button
                    key={anchor}
                    type="button"
                    onClick={() => setSpec({ place: anchor as PlatePlace })}
                    aria-label={`Camera in the ${anchor.replace('-', ' ')} cell`}
                    aria-pressed={spec.place === anchor}
                    className={`h-6 rounded-[5px] border cursor-pointer transition-colors ${
                      spec.place === anchor
                        ? 'border-accent bg-accent'
                        : anchor === post.badge.layout.anchor
                          ? 'border-line-strong bg-paper-2'
                          : 'border-line-strong bg-paper hover:border-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Size">
            <RangeField
              label="Camera credit size"
              min={MIN_PLATE_SIZE}
              max={MAX_PLATE_SIZE}
              step={0.05}
              value={spec.size}
              onChange={(size) => setSpec({ size })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>

          {rawBody && (
            <FieldRow
              label="Body"
              htmlFor="camera-body-name"
              hint={`What this trip calls “${rawBody}” — written once, used on every piece.`}
            >
              <input
                id="camera-body-name"
                value={alias}
                placeholder={rawBody}
                onChange={(e) => setAlias(e.target.value)}
                className={`${inputClass} flex-1 min-w-0`}
              />
            </FieldRow>
          )}

          {spec.layout === 'bar' && post.badge.shades.length < MAX_SHADES && (
            <FieldRow label="" hint="A soft dark band along that edge, so the bar reads over any sky.">
              <Button size="sm" icon={Icons.plus} onClick={addShade}>
                Shade under the bar
              </Button>
            </FieldRow>
          )}
        </>
      )}
    </>
  );
}
