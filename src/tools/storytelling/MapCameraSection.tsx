import { withLook } from '../../shared/story/sources';
import { cameraValues, STORY_CAMERA_LIMITS, STORY_CAMERA_PRESETS, type StoryCamera, type StoryCameraPreset } from '../../shared/story/story-camera';
import type { StoryScript } from '../../shared/story/story-script';
import Segmented from '../../shared/ui/Segmented';
import { SelectField, SwitchRow } from '../../shared/ui/Inspector';

const PRESETS: { id: StoryCameraPreset; label: string; title: string }[] = [
  { id: 'before', label: 'As before', title: '×2.3 on the head of the route, pulled back at the end' },
  ...(Object.keys(STORY_CAMERA_PRESETS) as (keyof typeof STORY_CAMERA_PRESETS)[]).map((id) => ({ id, label: STORY_CAMERA_PRESETS[id].label, title: STORY_CAMERA_PRESETS[id].hint })),
];

const sec = (v: number) => `${String(v).replace('.', ',')} s`;
const km = (v: number) => `${v.toLocaleString('en-GB')} km`;

/**
 * The camera over the series' maps (road lab C3): Trips' presets at the
 * story's scale, or « As before » for the posts already made, and — any step
 * moved — the series' own: the view's width, the smoothing, the look-ahead,
 * north up or the heading, and whether the shot opens and closes on the whole
 * map. The engine is Virée's (`story-camera.ts`).
 */
export default function MapCameraSection({ script, onScript }: { script: StoryScript; onScript: (s: StoryScript) => void }) {
  const cam: StoryCamera = script.look?.camera ?? { preset: 'before' };
  const preset = cam.preset ?? 'before';
  const v = cameraValues(cam);
  const write = (camera: StoryCamera | null) => onScript(withLook(script, { camera }));
  // A step moved: the series' own camera, from the values on screen.
  const tune = (patch: Partial<StoryCamera>) => v && write({ ...v, ...patch, preset: 'own' });
  return (
    <div className="flex flex-col gap-2">
      <Segmented<StoryCameraPreset>
        options={[...PRESETS, ...(preset === 'own' ? [{ id: 'own' as const, label: 'Yours', title: 'Your own steps' }] : [])]}
        value={preset}
        onChange={(id) => write(id === 'own' ? cam : { preset: id })}
        size="sm"
        fill
        label="How the camera follows the route"
      />
      {v ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft w-16">View</span>
            <SelectField<string> label="Kilometres across the frame" value={String(v.viewKm)} options={STORY_CAMERA_LIMITS.viewKm.map((n) => ({ id: String(n), label: km(n) }))} onChange={(n) => tune({ viewKm: Number(n) })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft w-16">Smooth</span>
            <SelectField<string> label="Seconds the camera smooths the route over" value={String(v.smoothing)} options={STORY_CAMERA_LIMITS.smoothing.map((n) => ({ id: String(n), label: n ? sec(n) : 'exact' }))} onChange={(n) => tune({ smoothing: Number(n) })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft w-16">Ahead</span>
            <SelectField<string> label="Seconds the camera looks ahead" value={String(v.lookAhead)} options={STORY_CAMERA_LIMITS.lookAhead.map((n) => ({ id: String(n), label: n ? sec(n) : 'none' }))} onChange={(n) => tune({ lookAhead: Number(n) })} />
          </div>
          <Segmented<'north' | 'heading'>
            options={[
              { id: 'north', label: 'North up' },
              { id: 'heading', label: 'Road up', title: 'The map turns so the route runs up the frame' },
            ]}
            value={v.orientation}
            onChange={(orientation) => tune({ orientation })}
            size="sm"
            fill
            label="Which way the map faces"
          />
          <SwitchRow label="Opens on the whole map" checked={v.openWide} onChange={(openWide) => tune({ openWide })} />
          <SwitchRow label="Ends on the whole map" checked={v.endWide} onChange={(endWide) => tune({ endWide })} />
        </>
      ) : (
        <p className="m-0 text-2xs text-muted leading-snug">The camera of the posts already made: close on the head of the route, then the whole map.</p>
      )}
    </div>
  );
}
