/**
 * The camera's rows, as an opener's panel offers them — ONE face for Virée's
 * camera over the car and the Itinerary's over the pen (`map-camera.ts`):
 * the mode, the presets, the view width, the zoom, the orientation where the
 * opener has a heading, the wide shots, and the fine settings behind a link.
 */

import { useState } from 'react';
import Button from '../../ui/Button';
import { FieldRow, RangeField, ToggleField } from '../../ui/Inspector';
import Segmented from '../../ui/Segmented';
import {
  CAMERA_LIMITS,
  CAMERA_PRESETS,
  CAMERA_PRESET_IDS,
  cameraPresetOf,
  type CameraOptions,
  type CameraPresetId,
  type CameraPresetKey,
} from './map-camera';
import { resetLink } from './panel-ui';

/** A width in km rounded the way a slider should say it: whole below 100, tens below 1 000, fifties past. */
export function roundKm(km: number): number {
  const step = km < 100 ? 1 : km < 1000 ? 10 : 50;
  return Math.max(CAMERA_LIMITS.viewKm.min, Math.min(CAMERA_LIMITS.viewKm.max, Math.round(km / step) * step));
}

/** A preset's values, on the keys this opener keeps. */
export function presetValues(id: CameraPresetId, keys: readonly CameraPresetKey[]): Partial<CameraOptions> {
  const v = CAMERA_PRESETS[id].values;
  const out: Partial<CameraOptions> = {};
  for (const key of keys) Object.assign(out, { [key]: v[key] });
  return out;
}

/** Every key a preset sets. */
export const ALL_PRESET_KEYS = Object.keys(CAMERA_PRESETS.calm.values) as CameraPresetKey[];
/** The keys an opener without a heading keeps. */
export const NORTH_UP_PRESET_KEYS: readonly CameraPresetKey[] = ALL_PRESET_KEYS.filter(
  (k) => k !== 'orientation' && k !== 'turnSmoothing' && k !== 'maxTurn',
);

interface CameraRowsProps {
  o: CameraOptions;
  set: (patch: Partial<CameraOptions>) => void;
  /** The follow width the track really resolves to, in km — what the slider shows for a piece with no width of its own. */
  viewKm: number;
  /** Whether choosing Follow writes the Calm preset — a piece that never chose a width. */
  fresh: boolean;
  /** The opener's words: the whole view, the follow, and what is followed. */
  words: { whole: string; follow: string; subject: string };
  /** Whether the opener has a heading the map may turn to (a car's); a pen keeps north up. */
  heading: boolean;
}

export function CameraRows({ o, set, viewKm, fresh, words, heading }: CameraRowsProps) {
  const keys = heading ? ALL_PRESET_KEYS : NORTH_UP_PRESET_KEYS;
  const preset = cameraPresetOf(o, keys);
  const [fine, setFine] = useState(false);
  return (
    <>
      <FieldRow
        label="Camera"
        hint={o.camera === 'whole' ? `The ${words.whole.toLowerCase()} fits the frame from the first frame; only ${words.subject} moves.` : `The map moves under ${words.subject}, as the rows below say.`}
      >
        <Segmented
          size="sm"
          fill
          label="How the camera moves"
          value={o.camera}
          // A piece that never chose a width starts Follow on Calm; one
          // stored with a look keeps it.
          onChange={(camera) => set(camera === 'follow' && fresh ? { camera, ...presetValues('calm', keys) } : { camera })}
          options={[
            { id: 'whole', label: words.whole },
            { id: 'follow', label: words.follow },
          ]}
        />
      </FieldRow>
      {o.camera === 'follow' && (
        <>
          <FieldRow label="Preset" hint={preset ? CAMERA_PRESETS[preset].hint : 'Your own settings — a preset puts its values back.'}>
            <div className="flex items-center gap-1.5 flex-wrap">
              {CAMERA_PRESET_IDS.map((id) => (
                <Button key={id} size="sm" variant={preset === id ? 'primary' : 'default'} onClick={() => set(presetValues(id, keys))}>
                  {CAMERA_PRESETS[id].label}
                </Button>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="View width" hint={`Kilometres across the map while the camera follows ${words.subject}.`}>
            <RangeField
              label="View width"
              min={Math.log10(CAMERA_LIMITS.viewKm.min)}
              max={Math.log10(CAMERA_LIMITS.viewKm.max)}
              step={0.01}
              value={Math.log10(Math.max(CAMERA_LIMITS.viewKm.min, Math.min(CAMERA_LIMITS.viewKm.max, viewKm)))}
              onChange={(v) => set({ viewKm: roundKm(10 ** v) })}
              format={(v) => `${roundKm(10 ** v)} km`}
            />
          </FieldRow>
          <FieldRow
            label="Zoom"
            hint={
              o.zoom === 'fixed'
                ? 'The same width all along the road.'
                : `Over a long hop the camera pulls back just enough to see where ${words.subject} came from and where it goes — a map’s own fly-to curve — and comes back as it arrives.`
            }
          >
            <Segmented
              size="sm"
              fill
              label="How the zoom moves"
              value={o.zoom}
              onChange={(zoom) => set({ zoom })}
              options={[
                { id: 'fixed', label: 'Fixed' },
                { id: 'pull-back', label: 'Pull back on long hops' },
              ]}
            />
          </FieldRow>
          {o.zoom === 'pull-back' && (
            <FieldRow label="Pull back">
              <RangeField
                label="Pull-back strength"
                min={CAMERA_LIMITS.pullBack.min}
                max={CAMERA_LIMITS.pullBack.max}
                step={0.05}
                value={o.pullBack}
                onChange={(pullBack) => set({ pullBack })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </FieldRow>
          )}
          {heading && (
            <FieldRow
              label="Orientation"
              hint={
                o.orientation === 'north'
                  ? 'North stays up, as on the paper map.'
                  : `The map turns so ${words.subject} drives up the frame, sitting two thirds down with the road ahead; the car is seen from behind.`
              }
            >
              <Segmented
                size="sm"
                fill
                label="Which way is up"
                value={o.orientation}
                onChange={(orientation) => set({ orientation })}
                options={[
                  { id: 'north', label: 'North up' },
                  { id: 'heading', label: 'Heading up' },
                ]}
              />
            </FieldRow>
          )}
          <FieldRow label="Wide shots" align="start" hint={`The ${words.whole.toLowerCase()} first, then ${words.subject}; and the ${words.whole.toLowerCase()} again as it arrives.`}>
            <div className="flex flex-col gap-1.5">
              <ToggleField label={`Open on the ${words.whole.toLowerCase()}`} checked={o.openWide} onChange={(openWide) => set({ openWide })}>
                Open wide
              </ToggleField>
              <ToggleField label={`End on the ${words.whole.toLowerCase()}`} checked={o.endWide} onChange={(endWide) => set({ endWide })}>
                End wide
              </ToggleField>
            </div>
          </FieldRow>
          <button type="button" className={resetLink} onClick={() => setFine((f) => !f)} aria-expanded={fine}>
            {fine ? 'Hide the fine settings' : 'Fine settings…'}
          </button>
          {fine && (
            <>
              <FieldRow label="Smoothing" hint={`A window centred on ${words.subject} — the journey is known ahead, so the camera never trails it.`}>
                <RangeField
                  label="Camera smoothing"
                  min={CAMERA_LIMITS.smoothing.min}
                  max={CAMERA_LIMITS.smoothing.max}
                  step={0.1}
                  value={o.smoothing}
                  onChange={(smoothing) => set({ smoothing })}
                  format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
                />
              </FieldRow>
              <FieldRow label="Look ahead" hint={`The camera reads ${words.subject} this far ahead of now.`}>
                <RangeField
                  label="Look ahead"
                  min={CAMERA_LIMITS.lookAhead.min}
                  max={CAMERA_LIMITS.lookAhead.max}
                  step={0.1}
                  value={o.lookAhead}
                  onChange={(lookAhead) => set({ lookAhead })}
                  format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
                />
              </FieldRow>
              {heading && o.orientation === 'heading' && (
                <FieldRow label="Turning" hint={`The heading is weighed by how far ${words.subject} moves, so a halt never turns the map; then it turns no faster than the limit.`}>
                  <div className="flex flex-col gap-1.5">
                    <RangeField
                      label="Turn smoothing"
                      min={CAMERA_LIMITS.turnSmoothing.min}
                      max={CAMERA_LIMITS.turnSmoothing.max}
                      step={0.1}
                      value={o.turnSmoothing}
                      onChange={(turnSmoothing) => set({ turnSmoothing })}
                      format={(v) => (v === 0 ? 'sharp' : `${v.toFixed(1)}s`)}
                    />
                    <RangeField
                      label="Max turn speed"
                      min={CAMERA_LIMITS.maxTurn.min}
                      max={CAMERA_LIMITS.maxTurn.max}
                      step={5}
                      value={o.maxTurn}
                      onChange={(maxTurn) => set({ maxTurn })}
                      format={(v) => `${Math.round(v)}°/s`}
                    />
                  </div>
                </FieldRow>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
