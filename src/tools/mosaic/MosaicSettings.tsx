import { MAX_CELL_PX, MIN_CELL_PX } from '../../shared/mosaic/match';
import type { Level, Space } from '../../shared/mosaic/measure';
import { sanitizeSettings, type MosaicSettings as Settings } from '../../shared/mosaic/mosaic-doc';
import { FieldRow, InspectorSection, SliderRow, SwitchRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { StageView } from './MosaicStage';
import type { SceneState } from './use-mosaic-scene';

interface MosaicSettingsProps {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  view: StageView;
  setView: (fn: (v: StageView) => StageView) => void;
  state: SceneState;
}

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
export default function MosaicSettings({ settings, update, view, setView, state }: MosaicSettingsProps) {
  const scene = state.status === 'ready' ? state.scene : null;
  return (
    <div className="flex flex-col gap-3">
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
        {scene && (
          <p className="m-0 font-mono text-2xs text-muted tabular-nums">
            {scene.shape.cols} × {scene.shape.rows} cells · matched in {Math.round(scene.matchMs)} ms {scene.on === 'worker' ? 'in the background' : 'here'}
          </p>
        )}
      </InspectorSection>
    </div>
  );
}

export { sanitizeSettings };
