import { TEXTURE } from '../../shared/story/charte';
import { factsOf, withLook } from '../../shared/story/sources';
import { MAX_TILES, type StoryScript } from '../../shared/story/story-script';
import { wallCells, wallGrid, WALL_DEFAULTS, WALL_LIMITS, type WallGrid, type WallOrder } from '../../shared/story/wall-grid';
import Button from '../../shared/ui/Button';
import { FieldRow, Readout, SelectField, SliderRow, SwitchRow, type SelectOption } from '../../shared/ui/Inspector';

const ORDERS: readonly SelectOption<WallOrder>[] = [
  { id: 'rows', label: 'Along the rows' },
  { id: 'columns', label: 'Down the columns' },
  { id: 'centre', label: 'Out from the centre' },
  { id: 'shuffle', label: 'Shuffled' },
];

interface LookPanelProps {
  postId: string;
  script: StoryScript | null;
  onScript: (script: StoryScript) => void;
}

/**
 * The series' look (`wall-grid.ts`): the wall's grid — columns, rows, gap,
 * corners, bigger pictures, their order, the camera's end — and the grain
 * and vignette over every post. One look for the series: counting thins the
 * pictures to the grid's places, so every post's wall is the same.
 */
export default function LookPanel({ postId, script, onScript }: LookPanelProps) {
  if (!script) return <Readout muted>Load a script to keep a look for the series.</Readout>;
  const look = script.look ?? {};
  const g = wallGrid(look.wall);
  const setWall = (wall: Partial<WallGrid>) => onScript(withLook(script, { wall }));
  const cells = wallCells(g);
  const tiles = factsOf(script, postId)?.tiles?.length ?? 0;
  const wants = Math.min(cells, MAX_TILES);
  const px = (v: number) => `${Math.round(v)} px`;
  const pct = (v: number) => `${Math.round(v)} %`;
  return (
    <div className="flex flex-col gap-2">
      <SliderRow label="Columns" value={g.cols} min={WALL_LIMITS.cols[0]} max={WALL_LIMITS.cols[1]} step={1} reset={WALL_DEFAULTS.cols} onChange={(cols) => setWall({ cols })} />
      <SwitchRow label="Square pictures" checked={g.rows === 0} onChange={(square) => setWall({ rows: square ? 0 : Math.round(1920 / (1080 / g.cols)) })} />
      {g.rows > 0 ? (
        <SliderRow label="Rows" value={g.rows} min={WALL_LIMITS.rows[0]} max={WALL_LIMITS.rows[1]} step={1} onChange={(rows) => setWall({ rows })} />
      ) : null}
      <SliderRow label="Gap" value={g.gap} min={WALL_LIMITS.gap[0]} max={WALL_LIMITS.gap[1]} step={1} reset={WALL_DEFAULTS.gap} format={px} onChange={(gap) => setWall({ gap })} />
      <SliderRow label="Corners" value={g.radius} min={WALL_LIMITS.radius[0]} max={WALL_LIMITS.radius[1]} step={1} reset={WALL_DEFAULTS.radius} format={px} onChange={(radius) => setWall({ radius })} />
      <SliderRow
        label="Bigger pictures"
        value={Math.round(g.big * 100)}
        min={0}
        max={WALL_LIMITS.big[1] * 100}
        step={1}
        reset={0}
        format={pct}
        onChange={(v) => setWall({ big: v / 100 })}
      />
      <SliderRow
        label="Camera ends at"
        value={g.zoom}
        min={WALL_LIMITS.zoom[0]}
        max={WALL_LIMITS.zoom[1]}
        step={0.05}
        reset={WALL_DEFAULTS.zoom}
        format={(v) => `×${v.toFixed(2)}`}
        onChange={(zoom) => setWall({ zoom })}
      />
      <FieldRow label="Order">
        <SelectField label="The order the pictures are laid in" value={g.order} options={ORDERS} onChange={(order) => setWall({ order })} />
      </FieldRow>
      <Readout muted>
        {`${cells} places on the wall.`}
        {tiles && tiles !== wants ? ` The last count chose ${tiles} pictures: Count again under Sources to give each place its own.` : ''}
      </Readout>
      <SliderRow
        label="Vignette"
        value={Math.round((look.vignette ?? TEXTURE.vignette) * 100)}
        min={0}
        max={80}
        step={1}
        reset={Math.round(TEXTURE.vignette * 100)}
        format={pct}
        onChange={(v) => onScript(withLook(script, { vignette: v / 100 }))}
      />
      <SliderRow
        label="Grain"
        value={Math.round((look.grain ?? TEXTURE.grain) * 1000) / 10}
        min={0}
        max={20}
        step={0.5}
        reset={Math.round(TEXTURE.grain * 1000) / 10}
        format={(v) => `${v.toFixed(1)} %`}
        onChange={(v) => onScript(withLook(script, { grain: v / 100 }))}
      />
      {script.look ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onScript(withLook(script, null))}>
            Back to the charte’s look
          </Button>
        </div>
      ) : null}
    </div>
  );
}
