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

export default function MosaicSettings({ settings, update, view, setView, state, perf, setPerf, workers, fps, chain = null, target, cropped, onWhole, onChoose }: MosaicSettingsProps) {
  const scene = state.status === 'ready' ? state.scene : null;
  return (
    <div className="flex flex-col gap-3 px-1.5">
      <InspectorSection id="mosaic-target" title="Target" remember="session">
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
        <p className="m-0 text-xs text-muted">Drag the frame to choose the part rebuilt, its sides and corners to resize it. The rest is never read.</p>
      </InspectorSection>
      <InspectorSection id="mosaic-cells" title="Cells" remember="session">
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
      </InspectorSection>
      <InspectorSection id="mosaic-look" title="Reading" remember="session">
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
      </InspectorSection>
      <InspectorSection id="mosaic-perf" title="Performance" remember="local" defaultOpen={false}>
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
        <FieldRow label="Zoom" hint={<p><b>Frames</b>: a zoom on the stage becomes the part rebuilt, with as many cells on it. <b>Looks</b>: a zoom only enlarges what is there, and <i>Frame this</i> on the stage writes it.</p>}>
          <Segmented<PerfPrefs['zoom']> size="sm" fill value={perf.zoom} options={[{ id: 'frame', label: 'Frames' }, { id: 'look', label: 'Looks' }]} onChange={(zoom) => setPerf({ zoom })} />
        </FieldRow>
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
      </InspectorSection>
    </div>
  );
}

export { sanitizeSettings };
