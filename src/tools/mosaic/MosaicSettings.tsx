import type { ReactNode } from 'react';
import { ASPECTS, type AspectId } from '../../shared/mosaic/frame';
import { MAX_CELL_PX, MIN_CELL_PX } from '../../shared/mosaic/match';
import type { Level, Space } from '../../shared/mosaic/measure';
import { sanitizeSettings, type MosaicSettings as Settings } from '../../shared/mosaic/mosaic-doc';
import { FieldRow, InspectorSection, SelectField, SliderRow, SwitchRow } from '../../shared/ui/Inspector';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import { CELL_ANIMATIONS, LOT_SIZES, PROPAGATIONS, type CellAnimation, type LotSize, type PerfPrefs, type Propagation } from '../../shared/mosaic/perf';
import {
  AIMS,
  ARRIVALS,
  DEPARTURES,
  MOTION_BOUNDS,
  REVEAL_DIRECTIONS,
  SHARPNESSES,
  recipeOf,
  sanitizeMotion,
  type Aim,
  type Arrival,
  type Departure,
  type Motion,
  type RevealDirection,
  type Sharpness,
} from '../../shared/mosaic/motion';
import type { StageView } from './MosaicStage';
import type { SceneState } from './use-mosaic-scene';

interface MosaicSettingsProps {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  view: StageView;
  setView: (fn: (v: StageView) => StageView) => void;
  state: SceneState;
  /** The Performance panel's choices, this device's, and what they resolve to here. */
  perf: PerfPrefs;
  setPerf: (patch: Partial<PerfPrefs>) => void;
  workers: number;
  /** The frames a second the last propagation drew, or null until one did. */
  fps: number | null;
  /** The chain's own measure: how long the last step took to be ready, how often a turn came before its step was. */
  chain?: { prepMs: number | null; waits: number; waitMs: number; done: number } | null;
  /** The target's card (`TargetFrame`) and its verbs, drawn first. */
  target: ReactNode;
  /** The target's crop is not the whole frame: *Whole picture* gives it back. */
  cropped: boolean;
  onWhole: () => void;
  onChoose: () => void;
  /** On a phone: the one part of the panel its drawer shows. */
  only?: SettingsTab;
}

const ASPECT_TITLES: Record<AspectId, string> = {
  original: 'The picture’s own shape — the largest frame it holds',
  '16:9': 'Wide, as a screen',
  '3:2': 'A camera’s frame',
  '4:3': 'A phone’s photo, or a compact’s',
  '1:1': 'Square',
  '4:5': 'A portrait post',
  '9:16': 'A phone held upright — a story',
};

const LEVELS: readonly { id: `${Level}`; label: string; title: string }[] = [
  { id: '1', label: 'Mean', title: 'One colour a picture — the fastest, and the tint does the reading' },
  { id: '2', label: 'Quarters', title: 'Four colours a picture: edges and gradients of the target come through' },
  { id: '3', label: 'Zones', title: 'Nine colours a picture: the finest reading, the slowest matching' },
];
const SPACES: readonly { id: Space; label: string; title: string }[] = [
  { id: 'oklab', label: 'OKLab', title: 'Distances the eye agrees with — better in the shadows' },
  { id: 'rgb', label: 'RGB', title: 'Plain channel distances' },
];

/**
 * The mosaic's dials (`docs/mosaic.md` §5, the lab's panel): what the
 * matching compares and how the picture reads, each a setting of the
 * document; the grid and the ghost are this screen's, never saved.
 */
const PROPAGATION_LABELS: Record<Propagation, string> = { rows: 'Top down', point: 'From the point', spiral: 'Spiral', random: 'Random', none: 'All at once' };
const ANIMATION_LABELS: Record<CellAnimation, string> = { appear: 'Appear', fade: 'Fade', flip: 'Flip', none: 'None' };
const LOT_LABELS: Record<LotSize, string> = { 0: 'A row', 64: '64 cells', 256: '256 cells', 1024: '1 024 cells' };

/** The parts of the panel a phone's bottom bar opens one at a time (`MosaicEditor`). */
export const SETTINGS_TABS = [
  { id: 'target', label: 'Target' },
  { id: 'cells', label: 'Cells' },
  { id: 'motion', label: 'Motion' },
  { id: 'perf', label: 'Performance' },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
const FIRST_OF_TAB: Record<SettingsTab, string> = { target: 'mosaic-target', cells: 'mosaic-cells', motion: 'mosaic-motion', perf: 'mosaic-perf' };

const DEPART_LABELS: Record<Departure, string> = { dive: 'Dive in', pull: 'Pull back', alternate: 'Dive, then pull back', wave: 'Wave', fade: 'Fade', cut: 'Cut' };
const ARRIVAL_LABELS: Record<Arrival, string> = { mosaic: 'Mosaic', photo: 'Photo', reveal: 'Reveal' };
const REVEAL_LABELS: Record<RevealDirection, string> = { toPhoto: 'To the photo', toMosaic: 'To the mosaic', roundTrip: 'There and back' };
const SHARPNESS_LABELS: Record<Sharpness, string> = { early: 'Early', late: 'Late', never: 'Never' };
const AIM_LABELS: Record<Aim, string> = { queue: 'The chain’s', best: 'Best match', random: 'Any' };

export default function MosaicSettings({ settings, update, view, setView, state, perf, setPerf, workers, fps, chain = null, target, cropped, onWhole, onChoose, only }: MosaicSettingsProps) {
  const scene = state.status === 'ready' ? state.scene : null;
  // A part set by hand: the motion bounded, the mode the recipe it still is — or custom.
  const setMotion = (patch: Partial<Motion>) =>
    update((s) => {
      const motion = sanitizeMotion({ ...s.motion, ...patch }, s.motion);
      return { ...s, motion, mode: s.mode === 'single' ? 'single' : recipeOf(motion, s.mode) };
    });
  /**
   * A section in place: folded and remembered beside the stage; on a phone, where each tab of the bottom bar opens
   * ONE part in a drawer titled by it, the tab's first section is drawn bare and a second keeps its header, unfolded.
   */
  const section = (tab: SettingsTab, id: string, title: string, props: { remember: 'local' | 'session'; defaultOpen?: boolean }, body: ReactNode) => {
    if (only && only !== tab) return null;
    if (only) return id === FIRST_OF_TAB[tab] ? <div className="flex flex-col gap-3">{body}</div> : <InspectorSection id={id} title={title} foldable={false}>{body}</InspectorSection>;
    return (
      <InspectorSection id={id} title={title} {...props}>
        {body}
      </InspectorSection>
    );
  };
  return (
    <div className="flex flex-col gap-3 px-1.5">
      {section('target', 'mosaic-target', 'Target', { remember: 'session' }, <>
        {target}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={Icons.image} onClick={onChoose} title="Pick the picture the mosaic rebuilds">
            Choose…
          </Button>
          {cropped && (
            <Button size="sm" variant="ghost" icon={Icons.zoomFit} onClick={onWhole} title="Rebuild the whole picture, the largest frame of this shape it holds">
              Whole picture
            </Button>
          )}
        </div>
        <FieldRow label="Shape">
          <Segmented<AspectId>
            size="sm"
            columns={4}
            value={settings.aspect}
            options={ASPECTS.map((id) => ({ id, label: id === 'original' ? 'Own' : id, title: ASPECT_TITLES[id] }))}
            onChange={(id) => update((s) => ({ ...s, aspect: id }))}
          />
        </FieldRow>
        <SwitchRow
          label="Auto-frame on zoom"
          checked={perf.zoom === 'frame'}
          onChange={(on) => setPerf({ zoom: on ? 'frame' : 'look' })}
          hint={<p>On, a zoom on the stage becomes the part rebuilt the moment your hand rests, with as many cells on it. Off, a zoom only enlarges what is there, and <i>Frame this</i> on the stage writes it. This device’s choice.</p>}
        />
        <p className="m-0 text-xs text-muted">Drag the frame to choose the part rebuilt, its sides and corners to resize it. The rest is never read.</p>
      </>)}
      {section('cells', 'mosaic-cells', 'Cells', { remember: 'session' }, <>
        <SliderRow
          label="Cell"
          name="cell"
          value={settings.cellPx}
          min={MIN_CELL_PX}
          max={MAX_CELL_PX}
          step={1}
          reset={40}
          format={(v) => `${v} px`}
          onChange={(v) => update((s) => ({ ...s, cellPx: v }))}
          hint={<p>The width of a cell on this screen: a bigger screen gets more cells, not bigger ones.</p>}
        />
        <FieldRow label="Compare">
          <Segmented<`${Level}`> size="sm" fill value={`${settings.level}`} options={LEVELS} onChange={(id) => update((s) => ({ ...s, level: Number(id) as Level }))} />
        </FieldRow>
        <FieldRow label="Distance">
          <Segmented<Space> size="sm" fill value={settings.space} options={SPACES} onChange={(id) => update((s) => ({ ...s, space: id }))} />
        </FieldRow>
        <SwitchRow
          label="No picture twice side by side"
          checked={settings.distinctNeighbours}
          onChange={(v) => update((s) => ({ ...s, distinctNeighbours: v }))}
          hint={<p>A plain sky would otherwise be thirty copies of one photo: the second or third best stands in beside its twin.</p>}
        />
      </>)}
      {section('cells', 'mosaic-look', 'Reading', { remember: 'session' }, <>
        <SliderRow
          label="Tint"
          name="tint"
          value={Math.round(settings.tint * 100)}
          min={0}
          max={70}
          step={1}
          reset={25}
          format={(v) => `${v} %`}
          onChange={(v) => update((s) => ({ ...s, tint: v / 100 }))}
          hint={<p>A veil of each cell’s own colour over its picture: what lets the target read from afar, whatever the library holds. A purist sets it to 0.</p>}
        />
        <SliderRow label="Ghost" name="ghost" value={Math.round(view.ghost * 100)} min={0} max={100} step={1} reset={0} format={(v) => `${v} %`} onChange={(v) => setView((x) => ({ ...x, ghost: v / 100 }))} />
        <SwitchRow label="Show the cells" checked={view.grid} onChange={(v) => setView((x) => ({ ...x, grid: v }))} />
        <SliderRow
          label="Speed"
          name="speed"
          value={Math.round(settings.speed * 10)}
          min={4}
          max={25}
          step={1}
          reset={10}
          format={(v) => `×${(v / 10).toFixed(1)}`}
          onChange={(v) => update((s) => ({ ...s, speed: v / 10 }))}
          hint={<p>How fast the animated modes move: a dive lasts 3.8 s at ×1.</p>}
        />
        {scene && (
          <p className="m-0 font-mono text-2xs text-muted tabular-nums">
            {scene.shape.cols} × {scene.shape.rows} cells · matched in {Math.round(scene.matchMs)} ms {scene.on === 'worker' ? 'in the background' : 'here'}
          </p>
        )}
      </>)}
      {section('motion', 'mosaic-motion', 'Motion', { remember: 'session', defaultOpen: false }, <>
        <FieldRow label="Departure">
          <SelectField<Departure> label="Departure" value={settings.motion.depart} options={DEPARTURES.map((id) => ({ id, label: DEPART_LABELS[id] }))} onChange={(depart) => setMotion({ depart })} />
        </FieldRow>
        <FieldRow label="Arrival" hint={<p><b>Mosaic</b>: land on the next picture’s mosaic. <b>Photo</b>: its picture fades in, holds, dissolves. <b>Reveal</b>: its cells flip to the picture.</p>}>
          <Segmented<Arrival> size="sm" fill value={settings.motion.arrival} options={ARRIVALS.map((id) => ({ id, label: ARRIVAL_LABELS[id] }))} onChange={(arrival) => setMotion({ arrival })} />
        </FieldRow>
        {settings.motion.arrival === 'reveal' && (
          <FieldRow label="Reveal">
            <Segmented<RevealDirection> size="sm" fill value={settings.motion.reveal} options={REVEAL_DIRECTIONS.map((id) => ({ id, label: REVEAL_LABELS[id] }))} onChange={(reveal) => setMotion({ reveal })} />
          </FieldRow>
        )}
        <FieldRow label="Sharpen" hint={<p>When a growing cell shows what it really is over its tile: from ×1.6, from ×3.2, or never — the next mosaic then lands over the tile at the end.</p>}>
          <Segmented<Sharpness> size="sm" fill value={settings.motion.sharpness} options={SHARPNESSES.map((id) => ({ id, label: SHARPNESS_LABELS[id] }))} onChange={(sharpness) => setMotion({ sharpness })} />
        </FieldRow>
        <FieldRow label="Aim" hint={<p>Which cell a dive enters: the chain’s next picture, the best match near the centre, or any. A picture you picked in the band always wins, and so does a click on the held mosaic.</p>}>
          <Segmented<Aim> size="sm" fill value={settings.motion.aim} options={AIMS.map((id) => ({ id, label: AIM_LABELS[id] }))} onChange={(aim) => setMotion({ aim })} />
        </FieldRow>
        <SliderRow label="Move" name="move" value={Math.round(settings.motion.moveMs / 100)} min={MOTION_BOUNDS.moveMs[0] / 100} max={MOTION_BOUNDS.moveMs[1] / 100} step={1} reset={38} format={(v) => `${(v / 10).toFixed(1)} s`} onChange={(v) => setMotion({ moveMs: v * 100 })} />
        <SliderRow label="Hold" name="hold" value={Math.round(settings.motion.holdMs / 100)} min={0} max={MOTION_BOUNDS.holdMs[1] / 100} step={1} reset={11} format={(v) => `${(v / 10).toFixed(1)} s`} onChange={(v) => setMotion({ holdMs: v * 100 })} />
        <SliderRow
          label="Cadence"
          name="cadence"
          value={Math.round(settings.motion.cadenceMs / 1000)}
          min={0}
          max={MOTION_BOUNDS.cadenceMs[1] / 1000}
          step={1}
          reset={0}
          format={(v) => (v ? `every ${v} s` : 'none')}
          onChange={(v) => setMotion({ cadenceMs: v * 1000 })}
          hint={<p>A step at a steady beat whatever its parts take: the hold absorbs what the move leaves of it.</p>}
        />
        <SwitchRow label="Drift while the mosaic is held" checked={settings.motion.drift} onChange={(drift) => setMotion({ drift })} />
        <p className="m-0 font-mono text-2xs text-muted">{settings.mode === 'single' ? 'played by the modes under the stage' : settings.mode === 'custom' ? 'custom · the recipes are presets of these parts' : `recipe · ${settings.mode}`}</p>
      </>)}
      {section('perf', 'mosaic-perf', 'Performance', { remember: 'local', defaultOpen: false }, <>
        <SelectField<string>
          label="Workers"
          value={String(perf.workers)}
          options={[{ id: '0', label: `Auto · ${workers} here` }, ...[1, 2, 3, 4, 6, 8].map((n) => ({ id: String(n), label: String(n) }))]}
          onChange={(v) => setPerf({ workers: Number(v) })}
        />
        <FieldRow label="Measure" hint={<p>Where a picture’s colours are read: the pool, one worker, or this thread — which stalls the page, to compare.</p>}>
          <Segmented<PerfPrefs['measure']> size="sm" fill value={perf.measure} options={[{ id: 'pool', label: 'Pool' }, { id: 'one', label: '1 worker' }, { id: 'main', label: 'This thread' }]} onChange={(measure) => setPerf({ measure })} />
        </FieldRow>
        <SelectField<string>
          label="Matching"
          value={String(perf.lot)}
          options={LOT_SIZES.map((n) => ({ id: String(n), label: LOT_LABELS[n] }))}
          onChange={(v) => setPerf({ lot: Number(v) as LotSize })}
        />
        <SelectField<Propagation>
          label="Propagation"
          value={perf.propagation}
          options={PROPAGATIONS.map((id) => ({ id, label: PROPAGATION_LABELS[id] }))}
          onChange={(propagation) => setPerf({ propagation })}
        />
        <SwitchRow
          label="Show each lot as it lands"
          checked={perf.showAsItComes}
          onChange={(showAsItComes) => setPerf({ showAsItComes })}
          hint={<p>Off, the mosaic appears whole once every lot is in. With several workers the lots in flight do not see each other, so the no-twins rule may differ at their edges from a single block — top down with one worker is exact.</p>}
        />
        <FieldRow label="A cell">
          <Segmented<CellAnimation> size="sm" fill value={perf.cellAnimation} options={CELL_ANIMATIONS.map((id) => ({ id, label: ANIMATION_LABELS[id] }))} onChange={(cellAnimation) => setPerf({ cellAnimation })} />
        </FieldRow>
        <SliderRow label="Animation" name="animation" value={perf.animationMs} min={0} max={600} step={20} reset={160} format={(v) => `${v} ms`} onChange={(animationMs) => setPerf({ animationMs })} />
        <SelectField<string> label="Tiles in memory" value={String(perf.tileCache)} options={[600, 2000, 4000].map((n) => ({ id: String(n), label: n.toLocaleString() }))} onChange={(v) => setPerf({ tileCache: Number(v) as PerfPrefs['tileCache'] })} />
        <SelectField<string> label="Scenes ahead" value={String(perf.ahead)} options={[1, 2, 3].map((n) => ({ id: String(n), label: String(n) }))} onChange={(v) => setPerf({ ahead: Number(v) as PerfPrefs['ahead'] })} />
        <FieldRow label="Motion">
          <Segmented<PerfPrefs['motion']> size="sm" fill value={perf.motion} options={[{ id: 'system', label: 'System' }, { id: 'reduced', label: 'Reduced' }, { id: 'full', label: 'Full' }]} onChange={(motion) => setPerf({ motion })} />
        </FieldRow>
        {scene && (
          <p className="m-0 font-mono text-2xs text-muted tabular-nums">
            last matching · {scene.lots} lot{scene.lots === 1 ? '' : 's'} · {Math.round(scene.matchMs / Math.max(1, scene.lots))} ms a lot · {scene.on === 'worker' ? 'in the background' : 'here'}
            {fps !== null ? ` · ${fps} fps while it came in` : ''}
          </p>
        )}
        {chain && chain.prepMs !== null && (
          <p className="m-0 font-mono text-2xs text-muted tabular-nums" title="How long the last step of the chain took to be ready (its picture fetched, its mosaic matched), and how many steps this run had to hold their picture because the next was not ready">
            chain · a step ready in {Math.round(chain.prepMs / 100) / 10} s · {chain.done} played
            {chain.waits ? ` · held ${chain.waits}× for ${Math.round(chain.waitMs / 100) / 10} s` : ' · never held'}
          </p>
        )}
      </>)}
    </div>
  );
}

export { sanitizeSettings };
