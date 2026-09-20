import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import Button from '../../shared/ui/Button';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import {
  DEFAULT_PATCH_FEATHER,
  DEFAULT_PATCH_RADIUS,
  MAX_PATCHES,
  PATCH_RADIUS_RANGE,
  describePatches,
  type Patch,
  type PatchKind,
} from '../../shared/render/repair';

const HINT =
  'A patch replaces a disc of the picture with another disc’s pixels, feathered at its edge. Heal copies the source’s TEXTURE and shifts it to the destination’s own tone — measured on the surroundings of each disc, never on the spot itself — so a sensor mark disappears into a sky that is not quite the same blue where it was borrowed from. Clone copies the source exactly, for a thing that must be moved rather than blended. With Repair on, a tap places a patch and takes its source from beside it; a DRAG places the patch where it starts and sets the source where it ends. Find dust looks over the picture for the small dark round spots a sensor leaves and heals each from its cleanest neighbour. Patches are numbers on the roll, never pixels: they follow a crop and a full-size export.';

export interface RepairTool {
  kind: PatchKind;
  radius: number;
  feather: number;
}

export const DEFAULT_REPAIR_TOOL: Readonly<RepairTool> = Object.freeze({
  kind: 'heal',
  radius: DEFAULT_PATCH_RADIUS,
  feather: DEFAULT_PATCH_FEATHER,
});

/**
 * Repair — heal, clone, dust — over the picture's patch list. The maths is
 * `shared/render/repair.ts`; the gesture is the picture's paint seam.
 */
export default function RepairPanel({
  patches,
  tool,
  onTool,
  repairing,
  onRepairing,
  onFindDust,
  finding,
  onRemoveLast,
  onClear,
}: {
  patches: readonly Patch[];
  /** What the NEXT patch is placed with. */
  tool: RepairTool;
  onTool: (patch: Partial<RepairTool>) => void;
  repairing: boolean;
  onRepairing: (on: boolean) => void;
  onFindDust: () => void;
  /** The last Find dust's answer, told for a moment. */
  finding: string | null;
  onRemoveLast: () => void;
  onClear: () => void;
}) {
  const full = patches.length >= MAX_PATCHES;
  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={`Repair${patches.length ? ` · ${describePatches(patches)}` : ''}`}>
        <p>{HINT}</p>
      </SectionLegend>
      <div className="flex items-center gap-2">
        <Button size="sm" variant={repairing ? 'primary' : 'default'} onClick={() => onRepairing(!repairing)} disabled={full && !repairing} aria-pressed={repairing}>
          {repairing ? 'Repairing…' : 'Repair'}
        </Button>
        <Button size="sm" onClick={onFindDust} disabled={full} title="Look over the picture for sensor spots and heal each one">
          Find dust
        </Button>
        {finding && (
          <span className="font-mono text-3xs text-accent-ink" role="status">
            {finding}
          </span>
        )}
      </div>
      <Segmented<PatchKind>
        fill
        size="sm"
        label="Patch"
        value={tool.kind}
        onChange={(kind) => onTool({ kind })}
        options={[
          { id: 'heal', label: 'Heal' },
          { id: 'clone', label: 'Clone' },
        ]}
      />
      <RangeSlider
        label="Size"
        value={tool.radius}
        range={{ min: PATCH_RADIUS_RANGE.min, max: PATCH_RADIUS_RANGE.max, step: 0.002, unit: '' }}
        reset={DEFAULT_PATCH_RADIUS}
        printed={`${(tool.radius * 100).toFixed(1)} %`}
        onChange={(v) => onTool({ radius: v })}
      />
      <RangeSlider
        label="Feather"
        value={tool.feather}
        range={{ min: 0, max: 1, step: 0.05, unit: '' }}
        reset={DEFAULT_PATCH_FEATHER}
        printed={`${Math.round(tool.feather * 100)} %`}
        onChange={(v) => onTool({ feather: v })}
      />
      {patches.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint">
            {full ? `${MAX_PATCHES} patches, the most a picture holds` : 'click a ring on the picture to take that patch off'}
          </span>
          <span className="flex-1" />
          <button type="button" className={developLinkClass} onClick={onRemoveLast}>
            Undo last
          </button>
          <button type="button" className={developLinkClass} onClick={onClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
