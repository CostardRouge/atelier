import SectionLegend from '../../shared/ui/SectionLegend';
import Segmented from '../../shared/ui/Segmented';
import Button from '../../shared/ui/Button';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import {
  DEFAULT_DUST_SENSITIVITY,
  DEFAULT_PATCH_FEATHER,
  DEFAULT_PATCH_RADIUS,
  MAX_PATCHES,
  PATCH_RADIUS_RANGE,
  describePatches,
  type Patch,
  type PatchKind,
} from '../../shared/render/repair';

const HINT =
  'A patch replaces a disc of the picture with another disc’s pixels, feathered at its edge. Heal copies the source’s TEXTURE and shifts it to the destination’s own tone — measured on the surroundings of each disc, never on the spot itself — so a sensor mark disappears into a sky that is not quite the same blue where it was borrowed from. Clone copies the source exactly, for a thing that must be moved rather than blended. With Repair on, a tap places a patch and takes its source from beside it; a DRAG from the spot points at where to borrow from, at any distance — the source turns round the spot as the hand does. Every ring on the picture stays alive: drag a solid ring to move its patch, drag its dashed ring to change where it borrows from, click either to select it and the sliders below edit that patch; ⌫ takes the selected one off. Find spots draws the picture as a map of what falls below its surroundings — the marks a monitor hides at the fit read as bright discs — and proposes the small round ones as dotted rings: tap one to heal it, or heal them all. Patches are numbers on the roll, never pixels: they follow a crop and a full-size export.';

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

/** The dust scan's controls — session state, never on the roll. */
export interface DustState {
  /** The scan is on: the map may be shown and the spots are proposed. */
  on: boolean;
  /** 0..1, gentle to keen (`dustThreshold`). */
  sensitivity: number;
  /** Draw the map over the picture, or only the proposed rings. */
  map: boolean;
}

export const DEFAULT_DUST: Readonly<DustState> = Object.freeze({
  on: false,
  sensitivity: DEFAULT_DUST_SENSITIVITY,
  map: true,
});

/**
 * Repair — heal, clone, dust — over the picture's patch list. The maths is
 * `shared/render/repair.ts`; the gestures are the viewport's rings and the
 * picture's paint seam. The sliders edit the SELECTED patch when there is
 * one, else what the next patch is placed with.
 */
export default function RepairPanel({
  patches,
  tool,
  onTool,
  selected,
  onSelectedChange,
  onRemoveSelected,
  onDeselect,
  repairing,
  onRepairing,
  dust,
  onDust,
  spotsFound,
  onHealAll,
  onRemoveLast,
  onClear,
}: {
  patches: readonly Patch[];
  /** What the NEXT patch is placed with. */
  tool: RepairTool;
  onTool: (patch: Partial<RepairTool>) => void;
  /** The patch a ring was clicked on, whose numbers the sliders now edit. */
  selected: Patch | null;
  onSelectedChange: (change: Partial<Pick<Patch, 'kind' | 'radius' | 'feather'>>) => void;
  onRemoveSelected: () => void;
  onDeselect: () => void;
  repairing: boolean;
  onRepairing: (on: boolean) => void;
  dust: DustState;
  onDust: (change: Partial<DustState>) => void;
  /** How many spots the scan proposes right now; null while the picture is not decoded. */
  spotsFound: number | null;
  onHealAll: () => void;
  onRemoveLast: () => void;
  onClear: () => void;
}) {
  const full = patches.length >= MAX_PATCHES;
  const edited = selected ?? tool;
  const at = selected ? patches.findIndex((p) => p.id === selected.id) + 1 : 0;
  const setKind = (kind: PatchKind) => (selected ? onSelectedChange({ kind }) : onTool({ kind }));
  const setRadius = (radius: number) => (selected ? onSelectedChange({ radius }) : onTool({ radius }));
  const setFeather = (feather: number) => (selected ? onSelectedChange({ feather }) : onTool({ feather }));
  const suffix = selected ? ' · this patch' : '';
  return (
    <div className="flex flex-col gap-2">
      <SectionLegend label={`Repair${patches.length ? ` · ${describePatches(patches)}` : ''}`}>
        <p>{HINT}</p>
      </SectionLegend>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={repairing ? 'primary' : 'default'}
          onClick={() => onRepairing(!repairing)}
          disabled={full && !repairing}
          aria-pressed={repairing}
          title="Tap the picture to place a patch, drag from a spot to say where it borrows from"
        >
          {repairing ? 'Repairing…' : 'Repair'}
        </Button>
        <Segmented<PatchKind>
          fill
          size="sm"
          label="Patch"
          value={edited.kind}
          onChange={setKind}
          options={[
            { id: 'heal', label: 'Heal' },
            { id: 'clone', label: 'Clone' },
          ]}
          className="flex-1"
        />
      </div>
      <RangeSlider
        label={`Size${suffix}`}
        value={edited.radius}
        range={{ min: PATCH_RADIUS_RANGE.min, max: PATCH_RADIUS_RANGE.max, step: 0.002, unit: '' }}
        reset={DEFAULT_PATCH_RADIUS}
        printed={`${(edited.radius * 100).toFixed(1)} %`}
        onChange={setRadius}
      />
      <RangeSlider
        label={`Feather${suffix}`}
        value={edited.feather}
        range={{ min: 0, max: 1, step: 0.05, unit: '' }}
        reset={DEFAULT_PATCH_FEATHER}
        printed={`${Math.round(edited.feather * 100)} %`}
        onChange={setFeather}
      />
      {selected ? (
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-faint min-w-0">
            patch {at} of {patches.length} · drag its ring to move it, the dashed one to change its source
          </span>
          <span className="flex-1" />
          <button type="button" className={developLinkClass} onClick={onDeselect} title="Let go of this patch (Esc)">
            Done
          </button>
          <button type="button" className={developLinkClass} onClick={onRemoveSelected} title="Take this patch off (⌫)">
            Remove
          </button>
        </div>
      ) : (
        patches.length > 0 && (
          <span className="font-mono text-3xs text-faint">
            {full ? `${MAX_PATCHES} patches, the most a picture holds` : 'drag a ring on the picture to move it · click one to edit it'}
          </span>
        )
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant={dust.on ? 'primary' : 'default'}
          onClick={() => onDust({ on: !dust.on })}
          aria-pressed={dust.on}
          title="Look over the picture for sensor spots: a map of what falls below its surroundings, and the small round marks proposed as rings"
        >
          {dust.on ? 'Finding spots…' : 'Find spots'}
        </Button>
        {dust.on && (
          <>
            <span className="font-mono text-3xs text-faint min-w-0 truncate" role="status">
              {spotsFound === null
                ? 'the picture is not decoded yet'
                : spotsFound === 0
                  ? 'no spot proposed'
                  : `${spotsFound} spot${spotsFound === 1 ? '' : 's'} proposed`}
            </span>
            <span className="flex-1" />
            {spotsFound !== null && spotsFound > 0 && (
              <button
                type="button"
                className={developLinkClass}
                onClick={onHealAll}
                disabled={full}
                title={full ? `${MAX_PATCHES} patches, the most a picture holds` : 'Heal every proposed spot from its cleanest neighbour'}
              >
                Heal all
              </button>
            )}
          </>
        )}
      </div>
      {dust.on && (
        <>
          <RangeSlider
            label="Sensitivity"
            value={dust.sensitivity}
            range={{ min: 0, max: 1, step: 0.02, unit: '' }}
            reset={DEFAULT_DUST_SENSITIVITY}
            printed={`${Math.round(dust.sensitivity * 100)} %`}
            onChange={(v) => onDust({ sensitivity: v })}
          />
          <label className="flex items-center gap-1.5 font-mono text-3xs text-faint">
            <input type="checkbox" checked={dust.map} onChange={(e) => onDust({ map: e.target.checked })} />
            show the map — the picture as what falls below its surroundings
          </label>
          <span className="font-mono text-3xs text-faint">tap a dotted ring to heal that spot · a proposal is never a patch until it is taken</span>
        </>
      )}

      {patches.length > 0 && (
        <div className="flex items-center gap-2">
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
