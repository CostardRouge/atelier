import { useMemo, useState } from 'react';
import {
  CELL_ENTRANCES,
  CELL_ORDERS,
  FORMATS,
  FORMAT_IDS,
  GRID_SHAPES,
  TITLE_ENTRANCES,
  VIDEO_PLAYS,
  aboutLine,
  defaultTitle,
  withAnchor,
  withCaption,
  withCleared,
  withPick,
  withPicture,
  withRecap,
  type BackgroundKind,
  type CellEntrance,
  type CellOrder,
  type GridShape,
  type RecapDoc,
  type RecapFormat,
  type RecapPicture,
  type TitleEntrance,
  type VideoPlay,
} from '../../shared/recap/recap-doc';
import { agoKey, agoLabel, parseAgo, shortDate, weekStartOf } from '../../shared/recap/recap-days';
import WhenCalendar, { type When } from './WhenCalendar';
import { deviceLabel, poolDevices, type DeviceAliases, type RecapSlot } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import Button from '../../shared/ui/Button';
import { InspectorSection, SliderRow, TextField, ToggleField, fieldClass } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import PictureThumb from './PictureThumb';
import FrameBox from './FrameBox';
import LoopTrimmer from './LoopTrimmer';
import { DEFAULT_FRAME, MAX_ROTATE, isDefaultFrame, rotateFrame, type Frame } from '../../shared/recap/recap-frame';
import { ARRANGES, EXIF_LABEL, EXIF_PARTS, type Arrange, type ExifPart } from '../../shared/recap/recap-cellwords';
import type { Drawable } from '../../shared/recap/recap-paint';

export type Change = (fn: (doc: RecapDoc) => RecapDoc) => void;

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const row = 'flex flex-col gap-2';

const TITLE_LABEL: Record<TitleEntrance, string> = { none: 'None', fade: 'Fade', rise: 'Rise', type: 'Type on', mask: 'Mask' };
const ORDER_LABEL: Record<CellOrder, string> = { inOrder: 'In order', random: 'Random', wave: 'Wave', columns: 'Columns', spiral: 'Spiral' };
const ENTRANCE_LABEL: Record<CellEntrance, string> = { none: 'None', fade: 'Fade', slide: 'Slide', pop: 'Pop', drop: 'Drop', develop: 'Develop', flicker: 'Flicker' };
const VIDEO_LABEL: Record<VideoPlay, string> = { turn: 'In turn', zoom: 'Zoom', together: 'Together', poster: 'Poster' };
const BG_LABEL: Record<BackgroundKind, string> = { paper: 'Paper', ink: 'Ink', colour: 'Colour', blur: 'Blurred', video: 'Video loop' };

// ---- what the recap is about ---------------------------------------------------------

/**
 * The day, week, month or period a recap reads: its words on a button that
 * opens the suite's month calendar (`WhenCalendar`) under it — a click on the
 * month, as he asked. Moving it drops the choices made for the old days, and
 * the editor fills the new ones from the Winnow by itself.
 */
export function AboutSection({ doc, change, client }: { doc: RecapDoc; change: Change; client: WinnowClient | null }) {
  const t = doc.template;
  const [open, setOpen] = useState(false);
  const when: When = { anchor: doc.anchor, range: doc.range };
  return (
    <InspectorSection id="recap-about" title={t === 'month' ? 'Month' : t === 'week' ? 'Week' : t === 'onThisDay' ? 'Day' : 'Period'}>
      <div className={row}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="w-full min-h-11 flex items-center gap-2 px-3 rounded-control border border-line-strong bg-surface text-left hover:border-accent aria-expanded:border-accent"
        >
          <span className="text-muted [&>svg]:w-4 [&>svg]:h-4">{Icons.calendar}</span>
          <span className="flex-1 min-w-0 truncate text-sm font-semibold">{aboutLine(doc)}</span>
          <span className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>{Icons.down}</span>
        </button>
        {open && (
          <div className="rounded-paper border border-line bg-surface p-2.5 shadow-paper-soft">
            <WhenCalendar
              template={t}
              when={when}
              client={client}
              weekStart={doc.cells.weekStart}
              onChange={(w, done) => {
                change((d) => {
                  let next = withAnchor(d, w.anchor);
                  if (w.range) next = withRecap(next, { range: w.range, picks: {}, cleared: [], captions: {} });
                  // A title still the default follows the days it names; one the author wrote stays.
                  if (next !== d && d.title === defaultTitle(d)) next = { ...next, title: defaultTitle(next) };
                  return next;
                });
                if (done) setOpen(false);
              }}
            />
          </div>
        )}
        {t === 'onThisDay' && <RungsField doc={doc} change={change} />}
        {t === 'week' && (
          <ToggleField checked={doc.cells.weekStart === 0} onChange={(on) => change((d) => withRecap(d, { cells: { ...d.cells, weekStart: on ? 0 : 1 }, anchor: weekStartOf(d.anchor, on ? 0 : 1) ?? d.anchor }))} label="Weeks start on Sunday">
            Weeks start on Sunday
          </ToggleField>
        )}
      </div>
    </InspectorSection>
  );
}

const RUNGS = ['10y', '5y', '2y', '1y', '6m', '3m', '1m', '1w', '0d'];

function RungsField({ doc, change }: { doc: RecapDoc; change: Change }) {
  const on = new Set(doc.rungs);
  return (
    <div className="flex flex-col gap-1.5">
      <span className={legend}>The steps back</span>
      <div className="flex flex-wrap gap-1.5">
        {RUNGS.map((r) => {
          const ago = parseAgo(r)!;
          const active = on.has(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() =>
                change((d) => {
                  const next = active ? d.rungs.filter((x) => x !== r) : [...d.rungs, r];
                  if (!next.length || next.length > 6) return d;
                  // Kept furthest first: a ladder reads from the oldest down to today.
                  const order = (k: string) => {
                    const a = parseAgo(k)!;
                    return a.n * { d: 1, w: 7, m: 30.4, y: 365.25 }[a.unit];
                  };
                  return withRecap(d, { rungs: [...new Set(next.map((k) => agoKey(parseAgo(k)!)))].sort((a, b) => order(b) - order(a)) });
                })
              }
              className={`h-8 pointer-coarse:h-11 px-2.5 rounded-full border text-xs ${active ? 'bg-ink text-paper border-ink' : 'border-line text-ink-soft hover:border-line-strong'}`}
            >
              {agoLabel(ago)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- pictures ------------------------------------------------------------------------

export function SourcesSection({
  doc,
  connected,
  filling,
  onFill,
  onPick,
  onAddFiles,
  missing,
  aliases,
  change,
  onAlias,
}: {
  doc: RecapDoc;
  connected: string | null;
  filling: boolean;
  onFill: () => void;
  onPick: () => void;
  onAddFiles: () => void;
  missing: number;
  aliases: DeviceAliases;
  change: Change;
  onAlias: (model: string, name: string) => void;
}) {
  const devices = useMemo(() => poolDevices(doc.pictures), [doc.pictures]);
  const [naming, setNaming] = useState(false);
  const filtered = new Set(doc.filter.devices);
  return (
    <InspectorSection id="recap-sources" title="Pictures" badge={doc.pictures.length ? doc.pictures.length.toLocaleString() : undefined}>
      <div className={row}>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button size="sm" variant="primary" icon={Icons.refresh} disabled={filling} onClick={onFill} title={`Bring every picture of the recap's days from ${connected} — references only; a picture is fetched when a cell shows it`}>
                {filling ? 'Filling…' : `Fill from ${connected}`}
              </Button>
              <Button size="sm" variant="ghost" icon={Icons.plus} onClick={onPick} title={`Tick pictures on ${connected} by hand`}>
                Pick…
              </Button>
            </>
          ) : null}
          <Button size="sm" variant={connected ? 'ghost' : 'primary'} icon={Icons.import} onClick={onAddFiles} title="Photos and clips from this device — read here, never uploaded">
            Add files…
          </Button>
        </div>
        {missing > 0 && (
          <p className="m-0 text-xs text-warn" role="status">
            {missing} picture{missing === 1 ? '' : 's'} not on this device — add {missing === 1 ? 'its file' : 'their files'} again{connected ? '' : ', or connect the Winnow they come from'}.
          </p>
        )}
        {devices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <span className={legend}>Devices</span>
              <button type="button" onClick={() => setNaming((v) => !v)} className="text-2xs text-muted underline-offset-2 hover:underline">
                {naming ? 'done' : 'name them'}
              </button>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {devices.map(({ device, count }) => {
                const active = filtered.has(device);
                return naming ? (
                  <label key={device} className="flex items-center gap-1.5 w-full">
                    <span className="flex-none w-28 truncate font-mono text-2xs text-muted" title={device}>
                      {device}
                    </span>
                    <input defaultValue={aliases[device] ?? ''} placeholder="Its name" aria-label={`Name for ${device}`} onBlur={(e) => onAlias(device, e.target.value)} className={fieldClass} />
                  </label>
                ) : (
                  <button
                    key={device}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      change((d) => withRecap(d, { filter: { ...d.filter, devices: active ? d.filter.devices.filter((x) => x !== device) : [...d.filter.devices, device] } }))
                    }
                    title={active ? 'Shown alone with the other devices ticked — press to take it out' : 'Show only the pictures of the ticked devices'}
                    className={`h-8 pointer-coarse:h-11 px-2.5 rounded-full border text-xs ${active ? 'bg-ink text-paper border-ink' : 'border-line text-ink-soft hover:border-line-strong'}`}
                  >
                    {deviceLabel(device, aliases)} <span className="font-mono text-faint">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <Segmented
          size="sm"
          label="Photos or clips"
          value={doc.filter.kinds}
          onChange={(kinds) => change((d) => withRecap(d, { filter: { ...d.filter, kinds } }))}
          options={[
            { id: 'all', label: 'All' },
            { id: 'photo', label: 'Photos' },
            { id: 'video', label: 'Clips' },
          ]}
        />
      </div>
    </InspectorSection>
  );
}

export function SlotSection({
  doc,
  slot,
  client,
  instance,
  files,
  change,
  onDevelop,
  onFrameStage,
}: {
  doc: RecapDoc;
  slot: RecapSlot;
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
  change: Change;
  onDevelop: (key: string) => void;
  /** Frame this cell's picture on the stage (the same as a double-click there). */
  onFrameStage: () => void;
}) {
  const pic = slot.picture;
  const zoom = pic?.frame?.zoom ?? 1;
  const setFrame = (frame: Frame | undefined) => pic && change((d) => withPicture(d, pic.key, { frame: frame && !isDefaultFrame(frame) ? frame : undefined }));
  const shown = slot.candidates.slice(0, 60);
  return (
    <InspectorSection id="recap-slot" title={slot.label} foldable={false}>
      <div className={row}>
        <div className="flex gap-3">
          {pic ? (
            <PictureThumb pic={pic} client={client} instance={instance} file={files.get(pic.key) ?? null} className="flex-none w-28 h-20 rounded-[6px]" />
          ) : (
            <span className="flex-none w-28 h-20 rounded-[6px] border border-dashed border-line-strong flex items-center justify-center text-2xs text-muted text-center px-1">
              {slot.cleared ? 'emptied by hand' : 'no picture that day'}
            </span>
          )}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {pic && (
              <>
                <p className="m-0 font-mono text-2xs text-muted truncate" title={pic.name}>
                  {pic.name}
                  {pic.day ? ` · ${shortDate(pic.day)}` : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {pic.kind === 'photo' && (
                    <Button size="sm" variant="primary" onClick={() => onDevelop(pic.key)} title="Its own correction and the recap's look — Develop's sheet">
                      {pic.develop ? 'Developed · edit…' : 'Develop…'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => change((d) => withCleared(d, slot.id))} title="Leave this place empty">
                    Empty
                  </Button>
                </div>
              </>
            )}
            {(slot.pinned || slot.cleared) && (
              <button type="button" onClick={() => change((d) => withPick(d, slot.id, null))} className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline">
                Give it back to the rule
              </button>
            )}
          </div>
        </div>
        {pic && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className={legend}>Its frame</span>
              <span className="inline-flex gap-1">
                <Button size="sm" variant="ghost" onClick={onFrameStage} title="Drag it in its cell on the stage — or double-click the cell">
                  Frame on the stage
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFrame(undefined)} disabled={isDefaultFrame(pic.frame)} title="Centred, the cell just covered">
                  Centre
                </Button>
              </span>
            </div>
            <SliderRow label="Zoom" value={Math.round(zoom * 100)} min={100} max={400} step={1} reset={100} format={(v) => `${v} %`} onChange={(v) => setFrame({ ...(pic.frame ?? DEFAULT_FRAME), zoom: v / 100 })} />
            <SliderRow label="Straighten" value={pic.frame?.rotate ?? 0} min={-MAX_ROTATE} max={MAX_ROTATE} step={0.1} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`} onChange={(v) => setFrame(rotateFrame(pic.frame ?? DEFAULT_FRAME, v))} />
          </div>
        )}
        {pic && doc.cells.exif && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className={legend}>Its camera line</span>
              <ToggleField
                checked={pic.exifParts === undefined}
                onChange={(same) => change((d) => withPicture(d, pic.key, { exifParts: same ? undefined : [...d.cells.exifParts] }))}
                label="As every cell"
              >
                As every cell
              </ToggleField>
            </div>
            {pic.exifParts !== undefined && <ExifChips parts={pic.exifParts} onParts={(exifParts) => change((d) => withPicture(d, pic.key, { exifParts }))} label="The camera's settings this picture says" />}
          </div>
        )}
        {shown.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className={legend}>
              {slot.day ? `${slot.candidates.length} that day` : `${slot.candidates.length} in the period`} · a tap pins one here
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {shown.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={`Use ${c.name}`}
                  aria-pressed={pic?.key === c.key}
                  onClick={() => change((d) => withPick(d, slot.id, c.key))}
                  className={`aspect-square rounded-[5px] overflow-hidden ${pic?.key === c.key ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'hover:opacity-80'}`}
                >
                  <PictureThumb pic={c} client={client} instance={instance} file={files.get(c.key) ?? null} className="w-full h-full" />
                </button>
              ))}
            </div>
          </div>
        )}
        {doc.cells.caption && (
          <label className="flex flex-col gap-1.5">
            <span className={legend}>Its caption</span>
            <TextField value={doc.captions[slot.id] ?? ''} onChange={(v) => change((d) => withCaption(d, slot.id, v))} label="Caption" placeholder="A word for this day" />
          </label>
        )}
      </div>
    </InspectorSection>
  );
}

// ---- the camera's words -------------------------------------------------------------

/** Which of the camera's settings a line says — toggles, in the line's own order. */
function ExifChips({ parts, onParts, label }: { parts: readonly ExifPart[]; onParts: (parts: ExifPart[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {EXIF_PARTS.map((part) => {
        const on = parts.includes(part);
        return (
          <button
            key={part}
            type="button"
            aria-pressed={on}
            onClick={() => onParts(EXIF_PARTS.filter((x) => (x === part ? !on : parts.includes(x))))}
            className={`h-8 pointer-coarse:h-11 px-2.5 rounded-full border text-2xs font-mono cursor-pointer ${on ? 'border-accent bg-accent-wash text-ink' : 'border-line text-muted hover:border-line-strong'}`}
          >
            {EXIF_LABEL[part]}
          </button>
        );
      })}
    </div>
  );
}

const ARRANGE_LABEL: Record<Arrange, string> = { auto: 'Auto', line: 'One line', stack: 'Stacked' };

// ---- layout --------------------------------------------------------------------------

export function LayoutSection({ doc, change }: { doc: RecapDoc; change: Change }) {
  const c = doc.cells;
  const set = (patch: Partial<RecapDoc['cells']>) => change((d) => withRecap(d, { cells: { ...d.cells, ...patch } }));
  const dayTemplate = doc.template === 'month' || doc.template === 'week' || doc.template === 'onThisDay';
  return (
    <>
      <InspectorSection id="recap-format" title="Format">
        <div className={row}>
          <Segmented<RecapFormat>
            size="sm"
            fill
            label="Format"
            value={doc.format}
            onChange={(format) => change((d) => withRecap(d, { format }))}
            options={FORMAT_IDS.map((f) => ({ id: f, label: `${FORMATS[f].ratio} · ${FORMATS[f].label}` }))}
          />
          {doc.template === 'grid' && (
            <Segmented<GridShape>
              size="sm"
              fill
              label="Grid"
              value={doc.grid}
              onChange={(grid) => change((d) => withRecap(d, { grid }))}
              options={(Object.keys(GRID_SHAPES) as GridShape[]).map((g) => ({ id: g, label: GRID_SHAPES[g].label }))}
            />
          )}
          {doc.template === 'dump' && <SliderRow label="Pictures" value={doc.count} min={2} max={60} step={1} reset={12} onChange={(count) => change((d) => withRecap(d, { count }))} />}
          {doc.template === 'month' && (
            <ToggleField checked={c.weekStart === 0} onChange={(on) => set({ weekStart: on ? 0 : 1 })} label="Weeks start on Sunday">
              Weeks start on Sunday
            </ToggleField>
          )}
        </div>
      </InspectorSection>
      <InspectorSection id="recap-cells" title="On every cell">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <ToggleField checked={c.number} onChange={(number) => set({ number })} label="Number">
            {dayTemplate ? 'Day number' : 'Number'}
          </ToggleField>
          <ToggleField checked={c.count} onChange={(count) => set({ count })} label="Shots that day">
            Shots that day
          </ToggleField>
          <ToggleField checked={c.exif} onChange={(exif) => set({ exif })} label="Camera settings">
            Camera settings
          </ToggleField>
          <ToggleField checked={c.device} onChange={(device) => set({ device })} label="Device">
            Device
          </ToggleField>
          <ToggleField checked={c.caption} onChange={(caption) => set({ caption })} label="A word per day">
            A word per day
          </ToggleField>
          <ToggleField checked={c.videoBadge} onChange={(videoBadge) => set({ videoBadge })} label="Clip badge">
            Clip badge
          </ToggleField>
          {dayTemplate && (
            <ToggleField checked={c.today} onChange={(today) => set({ today })} label="Ring today">
              Ring today
            </ToggleField>
          )}
          {doc.template === 'month' && (
            <ToggleField checked={c.headers} onChange={(headers) => set({ headers })} label="Weekdays">
              Weekdays
            </ToggleField>
          )}
          <ToggleField checked={doc.clipSlides} onChange={(clipSlides) => change((d) => withRecap(d, { clipSlides }))} label="Clips as slides">
            Clips as slides
          </ToggleField>
        </div>
        {(c.exif || c.device || c.caption) && (
          <div className="mt-2 flex flex-col gap-2">
            {c.exif && (
              <div className="flex flex-col gap-1">
                <span className={legend}>The camera says</span>
                <ExifChips parts={c.exifParts} onParts={(exifParts) => set({ exifParts })} label="The camera's settings every cell says" />
              </div>
            )}
            <div title="Words never pass their cell: a long line shrinks, then ends in “…”. Auto packs them into lines that fit, and stacks them in a tall cell.">
              <Segmented<Arrange>
                size="sm"
                fill
                label="How a cell's words lie"
                value={c.arrange}
                onChange={(arrange) => set({ arrange })}
                options={ARRANGES.map((a) => ({ id: a, label: ARRANGE_LABEL[a] }))}
              />
            </div>
          </div>
        )}
        {(doc.template === 'month' || doc.template === 'week') && (
          <div className="mt-2">
            <Segmented
              size="sm"
              fill
              label="A day with no picture"
              value={c.empty}
              onChange={(empty) => set({ empty })}
              options={[
                { id: 'number', label: 'Its number' },
                { id: 'dashed', label: 'Dashed' },
                { id: 'hidden', label: 'Hidden' },
              ]}
            />
          </div>
        )}
        <div className="mt-2 flex flex-col gap-1">
          <SliderRow label="Gap" value={Math.round(c.gap * 1000)} min={0} max={40} step={1} reset={8} onChange={(v) => set({ gap: v / 1000 })} />
          <SliderRow label="Corners" value={Math.round(c.radius * 100)} min={0} max={25} step={1} reset={0} format={(v) => `${v} %`} onChange={(v) => set({ radius: v / 100 })} />
        </div>
      </InspectorSection>
      <InspectorSection id="recap-shadow" title="Shadow" marked={c.shadow > 0} mark={<ToggleField checked={c.shadow > 0} onChange={(on) => set({ shadow: on ? 0.35 : 0 })} label="Shadow under the pictures" />}>
        <div className={`flex flex-col gap-1 ${c.shadow > 0 ? '' : 'opacity-45'}`}>
          <SliderRow label="Darkness" value={Math.round(c.shadow * 100)} min={0} max={100} step={1} reset={35} format={(v) => (v ? `${v} %` : 'none')} onChange={(v) => set({ shadow: v / 100 })} />
          <SliderRow label="Softness" value={Math.round(c.shadowBlur * 100)} min={0} max={50} step={1} reset={12} format={(v) => `${v} %`} onChange={(v) => set({ shadowBlur: v / 100 })} disabled={c.shadow === 0} />
          <SliderRow label="Drop" value={Math.round(c.shadowY * 100)} min={0} max={25} step={1} reset={4} format={(v) => `${v} %`} onChange={(v) => set({ shadowY: v / 100 })} disabled={c.shadow === 0} />
        </div>
      </InspectorSection>
    </>
  );
}

// ---- background ----------------------------------------------------------------------

export function BackgroundSection({
  doc,
  change,
  clip,
  clipLength,
  clipUnplayable,
  clipCount,
  onOpenClips,
  thumbClient,
  thumbInstance,
  frameSource,
  frameVersion,
  onLayout,
}: {
  doc: RecapDoc;
  change: Change;
  /** The looping clip as it stands, its length once read, and how many the drawer offers. */
  clip: RecapPicture | null;
  clipLength: number;
  /** The chosen clip cannot be played here (an HEVC `.MOV` with no light copy). */
  clipUnplayable: boolean;
  clipCount: number;
  onOpenClips: () => void;
  thumbClient: WinnowClient | null;
  thumbInstance: string | null;
  /** What the frame is set on — the clip's frame or the blurred picture — or null when the ground is flat. */
  frameSource: () => Drawable | null;
  frameVersion: number;
  /** The format is the Layout tab's: the chip goes there. */
  onLayout: () => void;
}) {
  const bg = doc.background;
  const set = (patch: Partial<RecapDoc['background']>) => change((d) => withRecap(d, { background: { ...d.background, ...patch } }));
  const framed = bg.kind === 'video' || bg.kind === 'blur';
  const fmt = FORMATS[doc.format];
  return (
    <>
    <InspectorSection id="recap-background" title="Background">
      <div className={row}>
        <Segmented<BackgroundKind> size="sm" columns={3} label="Background" value={bg.kind} onChange={(kind) => set({ kind })} options={(Object.keys(BG_LABEL) as BackgroundKind[]).map((k) => ({ id: k, label: BG_LABEL[k] }))} />
        {bg.kind === 'colour' && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="color" value={bg.colour} onChange={(e) => set({ colour: e.target.value })} className="w-11 h-9 p-0 border border-line rounded-control bg-transparent" aria-label="Colour" />
            <span className="font-mono text-xs">{bg.colour}</span>
          </label>
        )}
        {bg.kind === 'video' && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenClips}
              className="flex items-center gap-3 p-1.5 pr-3 rounded-control border border-line bg-paper text-left hover:border-line-strong cursor-pointer"
              title="Choose the looping clip — the recap's days first"
            >
              {clip ? (
                <PictureThumb pic={clip} client={thumbClient} instance={thumbInstance} file={null} className="flex-none w-20 h-12 rounded-[5px]" />
              ) : (
                <span className="flex-none w-20 h-12 rounded-[5px] border border-dashed border-line-strong" />
              )}
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="text-sm font-semibold truncate">{clip ? clip.name : 'Choose a clip…'}</span>
                <span className="font-mono text-2xs text-muted">{clip ? `${clip.day ?? 'no day'}${clipLength ? ` · ${clipLength.toFixed(1)} s` : ''} · change…` : `${clipCount} to choose from`}</span>
              </span>
            </button>
            {clip && clipLength > 0 && <LoopTrimmer clipKey={clip.key} length={clipLength} bg={bg} onLoop={(loop) => set(loop)} />}
            {clip && clipUnplayable && (
              <p className="m-0 text-2xs text-warn">
                This browser cannot play this clip, so the stage shows none. The video export can convert it: Export · Painted from Originals · Convert what this browser cannot play.
              </p>
            )}
            <SliderRow label="Speed" value={bg.speed} min={0.25} max={2} step={0.05} reset={1} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ speed })} />
          </div>
        )}
        {bg.kind === 'blur' && <SliderRow label="Blur" value={bg.blur} min={0} max={160} step={1} reset={48} onChange={(blur) => set({ blur })} />}
        {bg.kind !== 'paper' && bg.kind !== 'ink' && <SliderRow label="Veil" value={Math.round(bg.veil * 100)} min={0} max={80} step={1} reset={20} format={(v) => `${v} %`} onChange={(v) => set({ veil: v / 100 })} />}
      </div>
    </InspectorSection>
    {framed && (
      <InspectorSection
        id="recap-background-frame"
        title="Frame"
        marked={!isDefaultFrame(bg.frame)}
        mark={
          <button type="button" onClick={onLayout} title="The page's format is set in Layout" className="font-mono text-2xs text-accent-ink hover:underline underline-offset-2">
            {fmt.ratio} · change in Layout ›
          </button>
        }
      >
        <div className={row}>
          <FrameBox source={frameSource} boxW={fmt.width} boxH={fmt.height} frame={bg.frame} onFrame={(frame) => set({ frame: isDefaultFrame(frame) ? undefined : frame })} version={frameVersion} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-muted">Double-click the background on the stage to frame it there.</span>
            <Button size="sm" variant="ghost" onClick={() => set({ frame: undefined })} disabled={isDefaultFrame(bg.frame)} title="Centred, the page just covered">
              Centre
            </Button>
          </div>
        </div>
      </InspectorSection>
    )}
    </>
  );
}

// ---- motion --------------------------------------------------------------------------

export function MotionSection({ doc, change }: { doc: RecapDoc; change: Change }) {
  const m = doc.motion;
  const set = (patch: Partial<RecapDoc['motion']>) => change((d) => withRecap(d, { motion: { ...d.motion, ...patch } }));
  return (
    <InspectorSection id="recap-motion" title="Motion">
      <div className={row}>
        <span className={legend}>The heading appears with</span>
        <Segmented<TitleEntrance> size="sm" columns={3} label="Heading entrance" value={m.title} onChange={(title) => set({ title })} options={TITLE_ENTRANCES.map((k) => ({ id: k, label: TITLE_LABEL[k] }))} />
        <span className={legend}>The cells appear</span>
        <Segmented<CellOrder> size="sm" columns={3} label="Cell order" value={m.order} onChange={(order) => set({ order })} options={CELL_ORDERS.map((k) => ({ id: k, label: ORDER_LABEL[k] }))} />
        <Segmented<CellEntrance> size="sm" columns={4} label="Cell entrance" value={m.entrance} onChange={(entrance) => set({ entrance })} options={CELL_ENTRANCES.map((k) => ({ id: k, label: ENTRANCE_LABEL[k] }))} />
        {m.order === 'random' && (
          <Button size="sm" variant="ghost" icon={Icons.refresh} onClick={() => set({ seed: (m.seed % 2147483645) + 7919 })} title="Another random order">
            Shuffle again
          </Button>
        )}
        <SliderRow label="One every" value={m.stagger} min={0} max={0.6} step={0.01} reset={0.09} format={(v) => `${v.toFixed(2)} s`} onChange={(stagger) => set({ stagger })} />
        <SliderRow label="Hold" value={m.hold} min={0.5} max={15} step={0.5} reset={3} format={(v) => `${v} s`} onChange={(hold) => set({ hold })} />
        <span className={legend}>Clips play</span>
        <Segmented<VideoPlay> size="sm" fill label="Clips play" value={m.videos} onChange={(videos) => set({ videos })} options={VIDEO_PLAYS.map((k) => ({ id: k, label: VIDEO_LABEL[k] }))} />
      </div>
    </InspectorSection>
  );
}
