/**
 * «&nbsp;Virée&nbsp;» — a little car drives the map from place to place,
 * stopping to show pictures.
 *
 * A paper map of the trip so far (no tiles, nothing fetched: the projection
 * is the route trace's own), the road as a curve through the stops, and a
 * cartoon Land Cruiser Prado — a miniature rendered by `mesh3d.ts`, wheels
 * turning — driving it. The stops are the legs' located places or the picked
 * pictures' own positions; at a stop with pictures the car halts and they pop
 * as prints beside it, or fill the frame; when it arrives the map can fade
 * and leave the piece's own picture under the badge. It ticks at every stop
 * on the shared kits, with a shutter as each print lands.
 *
 * The arithmetic is `drive-plan.ts`, the drawing `drive-paint.ts`, the car
 * `car-model.ts`; this file is the variant's face — what it needs, its
 * sketch, and its options.
 */

import Button from '../../ui/Button';
import Segmented from '../../ui/Segmented';
import {
  FieldRow,
  RangeField,
  SelectField,
  SwitchRow,
  ToggleField,
  swatchClass,
} from '../../ui/Inspector';
import {
  DRIVE_DEFAULTS,
  DRIVE_LIMITS,
  MAX_PICTURES_PER_STOP,
  drivePlan,
  driveOptions,
  driveRoute,
  driveScore,
  driveWants,
  type DriveOptions,
  type DriveRoute,
} from './drive-plan';
import { driveScratch, paintDrive } from './drive-paint';
import { EASINGS, EASING_IDS } from './easing';
import { formatDistance } from './geo';
import type { HookPanelProps, HookPictureStatus, HookVariant } from './hook-variant';
import { Group } from './panel-ui';
import { KIT_IDS, TICK_KITS } from './tick-kits';

export { DRIVE_DEFAULTS, driveOptions, type DriveOptions } from './drive-plan';

/** The picker card: a dotted road on paper and a car glyph travelling it (keyframes in `index.css`). */
function DriveSketch() {
  return (
    <span
      className="relative block w-[3.6rem] h-[1.4rem] rounded-[3px] overflow-hidden"
      style={{ background: '#e8e2d4' }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 58 22" width="58" height="22" className="absolute inset-0" fill="none">
        <path d="M5 16 C 14 4, 24 20, 34 10 S 48 4, 53 8" stroke="rgba(58,51,42,0.45)" strokeWidth="1.2" strokeDasharray="2 2.2" strokeLinecap="round" />
        <circle cx="5" cy="16" r="1.6" fill="#d9442a" />
        <circle cx="34" cy="10" r="1.6" fill="rgba(58,51,42,0.7)" />
        <circle cx="53" cy="8" r="1.6" fill="rgba(58,51,42,0.7)" />
      </svg>
      <span
        className="drive-sketch-car absolute left-0 top-0 block w-[9px] h-[5px] rounded-[1.5px] shadow-[0_1px_1px_rgba(20,16,12,0.5)]"
        style={{ background: '#1c1c1e' }}
      />
    </span>
  );
}

const resetLink =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';

/** How the shell is getting on with the pictures this drive shows. */
function pictureLine(keys: readonly string[], status: HookPictureStatus | undefined): { text: string; danger: boolean } | null {
  if (!status || keys.length === 0) return null;
  const failing = keys.filter((key) => status.problems.has(key));
  if (status.pending > 0) {
    return { text: `Loading ${status.pending} ${status.pending === 1 ? 'picture' : 'pictures'}…`, danger: false };
  }
  if (!failing.length) return null;
  const first = status.problems.get(failing[0]);
  return {
    text: failing.length === 1 ? `One picture cannot be shown: ${first}` : `${failing.length} pictures cannot be shown — ${first}`,
    danger: true,
  };
}

/** What the route leaves out, in one sentence, or null. */
function leftOutLine(route: DriveRoute, o: DriveOptions): string | null {
  const l = route.leftOut;
  const parts = [
    l.after > 0 && `${l.after} shot after this piece’s day`,
    l.outside > 0 && `${l.outside} shot outside the trip`,
    l.unlocated > 0 && `${l.unlocated} with no position and no stop to ride with`,
    l.homeless > 0 && `${l.homeless} with no position on a day no driven leg covers`,
    l.crowded > 0 && `${l.crowded} past the ${MAX_PICTURES_PER_STOP} a stop can show`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Left out: ${parts.join(', ')}${o.stopsOn === 'pictures' && l.unlocated > 0 ? ' — a picture needs a position in its EXIF to be a stop.' : '.'}`;
}

function DrivePanel({ options, onChange, ctx, host }: HookPanelProps) {
  const o = driveOptions(options);
  const set = (patch: Partial<DriveOptions>) => onChange({ ...o, ...patch });
  const stages = ctx.stages ?? [];
  const calendar = ctx.calendar ?? [];
  const route = driveRoute(stages, calendar, ctx.date, o);
  const plan = drivePlan(route, o);
  const wants = driveWants(route, o);
  const status = host?.pictureStatus;
  const line = pictureLine(wants.map((w) => w.key), status);
  const shown = route.stops.reduce((n, s) => n + s.pictures.length, 0);
  const located = stages.reduce((n, s) => n + s.places.length, 0);
  const pickedLocated = o.picked.filter((p) => p.coords).length;

  // What the drive WILL do for this piece — the counter modes' rule: the real
  // line, or the reason there is none.
  const summary = !route.stops.length
    ? o.stopsOn === 'pictures'
      ? o.picked.length
        ? 'None of the picked pictures carries a position, so there is nothing to drive between.'
        : 'No picture picked yet — choose them below; each one shot with a position becomes a stop.'
      : located === 0
        ? 'No leg of this trip has a place with coordinates, so there is no road to drive. Look the places up in the trip’s legs, or drive between picked pictures instead.'
        : 'No leg with a located place lies on or before this day.'
    : `${route.stops.length} ${route.stops.length === 1 ? 'stop' : 'stops'}${
        o.stopsOn === 'places'
          ? route.currentLeg === null
            ? ' across every leg'
            : `, arriving where leg ${route.currentLeg} ends${route.stops[route.stops.length - 1].name ? ` — ${route.stops[route.stops.length - 1].name}` : ''}`
          : ', in the order the pictures were shot'
      } · ${
        o.pictures === 'none' ? 'no picture shown' : shown === 0 ? 'no picture to show' : `${shown} ${shown === 1 ? 'picture' : 'pictures'} on the way`
      }${plan ? ` · ${plan.seconds.toFixed(1)}s` : ''}${
        plan && o.distance !== 'off' ? ` · ${formatDistance(plan.kmAtStop[plan.kmAtStop.length - 1], o.distance)}` : ''
      }`;
  const leftOut = leftOutLine(route, o);
  const cut = plan && ctx.screenSeconds !== undefined && plan.seconds > ctx.screenSeconds;
  const choose = host?.choosePictures
    ? async () => {
        const next = await host.choosePictures?.(o.picked);
        if (next) set({ picked: next });
      }
    : null;
  const coloursChanged = o.trailColor !== DRIVE_DEFAULTS.trailColor || o.aheadColor !== DRIVE_DEFAULTS.aheadColor;
  const paperChanged = o.paperColor !== DRIVE_DEFAULTS.paperColor || o.inkColor !== DRIVE_DEFAULTS.inkColor;

  return (
    <div className="flex flex-col gap-4 pl-3 border-l-2 border-line">
      <p className="m-0 text-xs text-ink-soft">{summary}</p>
      {leftOut && <p className="m-0 text-xs text-accent-ink">{leftOut}</p>}
      {cut && (
        <p className="m-0 text-xs text-accent-ink">
          The hook is on screen for {ctx.screenSeconds?.toFixed(1)}s, shorter than the drive — the
          export would cut it before the car arrives. Lengthen the hook in Export, or shorten the
          drive.
        </p>
      )}
      {line && (
        <p className={`m-0 text-xs ${line.danger ? 'text-danger' : 'text-muted'}`} role={line.danger ? 'alert' : undefined}>
          {line.text}
        </p>
      )}

      <Group title="Road">
        <FieldRow
          label="Stops"
          align="start"
          hint={
            o.stopsOn === 'places'
              ? 'The legs’ places with coordinates, the trip so far, arriving where this day’s leg ends. A place gets coordinates when you look it up in the trip’s legs.'
              : `Each picked picture shot with a position is a stop, in the order they were shot; one without rides with the stop before it.${pickedLocated ? ` ${pickedLocated} of ${o.picked.length} picked carry one.` : ''}`
          }
        >
          <Segmented
            size="sm"
            fill
            label="What the car drives between"
            value={o.stopsOn}
            onChange={(stopsOn) => set({ stopsOn })}
            options={[
              { id: 'places', label: 'Legs’ places' },
              { id: 'pictures', label: 'Picked pictures' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Path">
          <Segmented
            size="sm"
            fill
            label="The shape of the road"
            value={o.path}
            onChange={(path) => set({ path })}
            options={[
              { id: 'curved', label: 'Curved' },
              { id: 'straight', label: 'Straight' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Ahead" hint={o.ahead === 'hidden' ? 'The road ahead is not drawn: only the trail the car leaves.' : undefined}>
          <Segmented
            size="sm"
            fill
            label="How the road ahead is drawn"
            value={o.ahead}
            onChange={(ahead) => set({ ahead })}
            options={[
              { id: 'dashed', label: 'Dashed' },
              { id: 'faint', label: 'Faint' },
              { id: 'hidden', label: 'Hidden' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Trail">
          <ToggleField label="The trail behind the car" checked={o.trail} onChange={(trail) => set({ trail })}>
            A solid line behind the car
          </ToggleField>
        </FieldRow>
        <FieldRow label="Colours" hint="The trail, then the road ahead.">
          <input type="color" value={o.trailColor} onChange={(e) => set({ trailColor: e.target.value })} className={swatchClass} aria-label="Trail colour" />
          <input type="color" value={o.aheadColor} onChange={(e) => set({ aheadColor: e.target.value })} className={swatchClass} aria-label="Road ahead colour" />
          {coloursChanged && (
            <button type="button" onClick={() => set({ trailColor: DRIVE_DEFAULTS.trailColor, aheadColor: DRIVE_DEFAULTS.aheadColor })} className={resetLink}>
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow label="Width">
          <RangeField
            label="Line width"
            min={DRIVE_LIMITS.lineWidth.min}
            max={DRIVE_LIMITS.lineWidth.max}
            step={0.05}
            value={o.lineWidth}
            onChange={(lineWidth) => set({ lineWidth })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
      </Group>

      <Group title="Pictures">
        <FieldRow
          label="Shown as"
          hint={
            o.pictures === 'cards'
              ? 'Prints popping beside the car at each stop, piled like a stack on the map.'
              : o.pictures === 'fill'
                ? 'Each picture fills the frame while the car halts, then the map comes back.'
                : o.pictures === 'backdrop'
                  ? 'Each picture takes the paper’s place behind the road and the car while it halts.'
                  : 'The car drives without stopping for pictures.'
          }
        >
          <Segmented
            size="sm"
            fill
            label="How the pictures are shown"
            value={o.pictures}
            onChange={(pictures) => set({ pictures })}
            options={[
              { id: 'cards', label: 'Prints' },
              { id: 'fill', label: 'Fill' },
              { id: 'backdrop', label: 'Behind' },
              { id: 'none', label: 'None' },
            ]}
          />
        </FieldRow>
        {o.pictures !== 'none' && (
          <div className="flex flex-col gap-2">
            {choose ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant={o.picked.length ? 'default' : 'primary'} onClick={() => void choose()}>
                  {o.picked.length ? 'Change pictures…' : 'Choose pictures…'}
                </Button>
                {o.picked.length > 0 && <span className="text-xs text-muted">{o.picked.length} picked</span>}
              </div>
            ) : (
              <p className="m-0 text-xs text-muted">The picture chooser is not available here.</p>
            )}
          </div>
        )}
        {o.pictures !== 'none' && o.stopsOn === 'places' && (
          <SwitchRow
            label="Also the pictures of the days already told"
            name="Show the told days’ pictures"
            checked={o.includePieces}
            onChange={(includePieces) => set({ includePieces })}
            hint="The photo each piece is made from, shown where the leg of its day ends — the leg is dated, the place is not."
          />
        )}
        {o.pictures !== 'none' && (
          <FieldRow label="Per picture" hint="How long the car halts for each picture at a stop.">
            <RangeField
              label="Seconds per picture"
              min={DRIVE_LIMITS.secondsPerPicture.min}
              max={DRIVE_LIMITS.secondsPerPicture.max}
              step={0.1}
              value={o.secondsPerPicture}
              onChange={(secondsPerPicture) => set({ secondsPerPicture })}
              format={(v) => `${v.toFixed(1)}s`}
            />
          </FieldRow>
        )}
        {o.pictures === 'cards' && (
          <FieldRow label="Print size">
            <RangeField
              label="Print size"
              min={DRIVE_LIMITS.cardSize.min}
              max={DRIVE_LIMITS.cardSize.max}
              step={0.05}
              value={o.cardSize}
              onChange={(cardSize) => set({ cardSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.pictures === 'cards' && (
          <FieldRow label="Afterwards" hint={o.cardsStay ? 'The prints stay on the map once the car has gone: a collage by the end.' : 'The prints fade as the car leaves.'}>
            <ToggleField label="Leave the prints on the map" checked={o.cardsStay} onChange={(cardsStay) => set({ cardsStay })}>
              Leave them on the map
            </ToggleField>
          </FieldRow>
        )}
        <FieldRow label="Pauses" hint={o.pauseEverywhere ? 'The car pauses a beat at every stop, pictures or not.' : undefined}>
          <ToggleField label="Pause at every stop" checked={o.pauseEverywhere} onChange={(pauseEverywhere) => set({ pauseEverywhere })}>
            At every stop, pictures or not
          </ToggleField>
        </FieldRow>
      </Group>

      <Group title="Car">
        <FieldRow label="Colour">
          <input type="color" value={o.carColor} onChange={(e) => set({ carColor: e.target.value })} className={swatchClass} aria-label="Car colour" />
          {o.carColor !== DRIVE_DEFAULTS.carColor && (
            <button type="button" onClick={() => set({ carColor: DRIVE_DEFAULTS.carColor })} className={resetLink}>
              Reset
            </button>
          )}
        </FieldRow>
        <FieldRow label="Size">
          <RangeField
            label="Car size"
            min={DRIVE_LIMITS.carSize.min}
            max={DRIVE_LIMITS.carSize.max}
            step={0.05}
            value={o.carSize}
            onChange={(carSize) => set({ carSize })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Camera" hint="How steeply the camera looks down at the car: 90° is the map’s own view, lower shows its sides.">
          <RangeField
            label="Camera elevation"
            min={DRIVE_LIMITS.tilt.min}
            max={DRIVE_LIMITS.tilt.max}
            step={1}
            value={o.tilt}
            onChange={(tilt) => set({ tilt })}
            format={(v) => `${Math.round(v)}°`}
          />
        </FieldRow>
        <FieldRow label="Fittings" align="start">
          <div className="flex flex-col gap-1.5">
            <ToggleField label="Spare wheel on the tailgate" checked={o.spare} onChange={(spare) => set({ spare })}>
              Spare on the tailgate
            </ToggleField>
            <ToggleField label="Roof rack" checked={o.rack} onChange={(rack) => set({ rack })}>
              Roof rack
            </ToggleField>
            <ToggleField label="Door mirrors" checked={o.mirrors} onChange={(mirrors) => set({ mirrors })}>
              Door mirrors
            </ToggleField>
          </div>
        </FieldRow>
      </Group>

      <Group title="Map">
        <FieldRow
          label="Ground"
          hint={o.ground === 'paper' ? 'A paper map covers the picture while the car drives.' : 'The road and the car are drawn over the piece’s own picture.'}
        >
          <Segmented
            size="sm"
            fill
            label="What the car drives on"
            value={o.ground}
            onChange={(ground) => set({ ground })}
            options={[
              { id: 'paper', label: 'Paper map' },
              { id: 'picture', label: 'The picture' },
            ]}
          />
        </FieldRow>
        {o.ground === 'paper' && (
          <FieldRow label="Paper · ink">
            <input type="color" value={o.paperColor} onChange={(e) => set({ paperColor: e.target.value })} className={swatchClass} aria-label="Paper colour" />
            <input type="color" value={o.inkColor} onChange={(e) => set({ inkColor: e.target.value })} className={swatchClass} aria-label="Ink colour" />
            {paperChanged && (
              <button type="button" onClick={() => set({ paperColor: DRIVE_DEFAULTS.paperColor, inkColor: DRIVE_DEFAULTS.inkColor })} className={resetLink}>
                Reset
              </button>
            )}
          </FieldRow>
        )}
        {o.ground === 'paper' && (
          <FieldRow label="Paper" align="start">
            <div className="flex flex-col gap-1.5">
              <ToggleField label="Lines of latitude and longitude" checked={o.graticule} onChange={(graticule) => set({ graticule })}>
                Latitude and longitude lines
              </ToggleField>
              <ToggleField label="A vignette at the edges" checked={o.vignette} onChange={(vignette) => set({ vignette })}>
                Darkened edges
              </ToggleField>
            </div>
          </FieldRow>
        )}
        <FieldRow label="Where">
          <Segmented
            size="sm"
            fill
            label="Where the route sits in the frame"
            value={o.position}
            onChange={(position) => set({ position })}
            options={[
              { id: 'top', label: 'Top' },
              { id: 'middle', label: 'Middle' },
              { id: 'bottom', label: 'Bottom' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Size">
          <RangeField
            label="Route size"
            min={DRIVE_LIMITS.size.min}
            max={DRIVE_LIMITS.size.max}
            step={0.05}
            value={o.size}
            onChange={(size) => set({ size })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </FieldRow>
        <FieldRow label="Dots">
          <ToggleField label="A dot at every stop" checked={o.dots} onChange={(dots) => set({ dots })}>
            A dot at every stop
          </ToggleField>
        </FieldRow>
        <FieldRow
          label="Names"
          hint={
            o.labels === 'none'
              ? undefined
              : o.stopsOn === 'places'
                ? 'The places’ own names, as written in the legs. A name that would sit on another, or on a print, is left out.'
                : 'The day each stop was shot on. A name that would sit on another, or on a print, is left out.'
          }
        >
          <SelectField
            label="Which stops carry a name"
            value={o.labels}
            onChange={(labels) => set({ labels })}
            options={[
              { id: 'none', label: 'None' },
              { id: 'ends', label: 'The two ends' },
              { id: 'all', label: 'Every stop' },
            ]}
          />
        </FieldRow>
        {o.labels !== 'none' && (
          <FieldRow label="Name size">
            <RangeField
              label="Name size"
              min={DRIVE_LIMITS.labelSize.min}
              max={DRIVE_LIMITS.labelSize.max}
              step={0.1}
              value={o.labelSize}
              onChange={(labelSize) => set({ labelSize })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        <FieldRow label="Furniture" align="start">
          <div className="flex flex-col gap-1.5">
            <ToggleField label="A compass rose" checked={o.compass} onChange={(compass) => set({ compass })}>
              Compass rose
            </ToggleField>
            <ToggleField label="A scale bar" checked={o.scaleBar} onChange={(scaleBar) => set({ scaleBar })}>
              Scale bar
            </ToggleField>
          </div>
        </FieldRow>
        <FieldRow
          label="Distance"
          hint={o.distance === 'off' ? undefined : 'The straight-line sum between the stops the car has passed, counting up as it drives — never a road distance.'}
        >
          <Segmented
            size="sm"
            fill
            label="The distance so far"
            value={o.distance}
            onChange={(distance) => set({ distance })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'km', label: 'km' },
              { id: 'mi', label: 'mi' },
            ]}
          />
        </FieldRow>
      </Group>

      <Group title="Motion">
        <FieldRow label="Driving" hint="The time on the road, shared between the stops by distance; halts come on top.">
          <RangeField
            label="Driving length"
            min={DRIVE_LIMITS.driveSeconds.min}
            max={DRIVE_LIMITS.driveSeconds.max}
            step={0.5}
            value={o.driveSeconds}
            onChange={(driveSeconds) => set({ driveSeconds })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </FieldRow>
        <FieldRow label="Motion" hint={EASINGS[o.easing].hint}>
          <SelectField
            label="How the car pulls away and stops"
            value={o.easing}
            onChange={(easing) => set({ easing })}
            options={EASING_IDS.map((id) => ({ id, label: EASINGS[id].label }))}
          />
        </FieldRow>
        <FieldRow label="Hold first" hint={o.delaySeconds > 0 ? 'The car sits at the first stop this long before it moves.' : undefined}>
          <RangeField
            label="Hold on the first stop"
            min={DRIVE_LIMITS.delaySeconds.min}
            max={DRIVE_LIMITS.delaySeconds.max}
            step={0.1}
            value={o.delaySeconds}
            onChange={(delaySeconds) => set({ delaySeconds })}
            format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
          />
        </FieldRow>
        <FieldRow label="At the end" hint="A beat at rest once the car has arrived, after its last pictures.">
          <RangeField
            label="Rest on arrival"
            min={DRIVE_LIMITS.arriveSeconds.min}
            max={DRIVE_LIMITS.arriveSeconds.max}
            step={0.1}
            value={o.arriveSeconds}
            onChange={(arriveSeconds) => set({ arriveSeconds })}
            format={(v) => (v === 0 ? 'none' : `${v.toFixed(1)}s`)}
          />
        </FieldRow>
        <FieldRow
          label="Then"
          hint={o.end === 'reveal' ? 'The map fades away and the piece’s own picture is left under the badge.' : 'The map stays; the piece’s picture is never shown on this slide.'}
        >
          <Segmented
            size="sm"
            fill
            label="What happens once the car has arrived"
            value={o.end}
            onChange={(end) => set({ end })}
            options={[
              { id: 'reveal', label: 'Reveal the picture' },
              { id: 'stay', label: 'Stay on the map' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Camera" hint={o.camera === 'whole' ? 'The whole route fits the frame from the first frame; only the car moves.' : 'The map scrolls under a car held at the centre.'}>
          <Segmented
            size="sm"
            fill
            label="How the camera moves"
            value={o.camera}
            onChange={(camera) => set({ camera })}
            options={[
              { id: 'whole', label: 'Whole route' },
              { id: 'follow', label: 'Follow the car' },
            ]}
          />
        </FieldRow>
        {o.camera === 'follow' && (
          <FieldRow label="Zoom" hint="The share of the route the view spans while following.">
            <RangeField
              label="Follow zoom"
              min={DRIVE_LIMITS.followZoom.min}
              max={DRIVE_LIMITS.followZoom.max}
              step={0.05}
              value={o.followZoom}
              onChange={(followZoom) => set({ followZoom })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.stopsOn === 'places' && (
          <SwitchRow
            label="The badge’s place follows the car"
            name="Caption follows the car"
            checked={o.captionFollows}
            onChange={(captionFollows) => set({ captionFollows })}
            hint="While the car drives, the badge’s place reads the last stop it passed; once it arrives the badge says its own."
          />
        )}
      </Group>

      <Group title="Sound">
        <SwitchRow
          label="Tick at every stop the car reaches"
          name="Tick at every stop"
          checked={o.sound}
          onChange={(sound) => set({ sound })}
          hint="A deeper tick where a leg begins (or a new day), a low seat when the car arrives. A photo, or a clip recorded without sound, takes the ticks as its sound."
        />
        {o.sound && (
          <FieldRow label="Voice" hint={TICK_KITS[o.kit].hint}>
            <SelectField
              label="The voices the ticks play on"
              value={o.kit}
              onChange={(kit) => set({ kit })}
              options={KIT_IDS.map((id) => ({ id, label: TICK_KITS[id].label }))}
            />
          </FieldRow>
        )}
        {o.sound && o.pictures !== 'none' && (
          <FieldRow label="Shutter">
            <ToggleField label="A shutter click as each picture pops" checked={o.shutter} onChange={(shutter) => set({ shutter })}>
              A click as each picture lands
            </ToggleField>
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Pitch">
            <RangeField
              label="Ticks pitch"
              min={DRIVE_LIMITS.tickPitch.min}
              max={DRIVE_LIMITS.tickPitch.max}
              step={0.05}
              value={o.tickPitch}
              onChange={(tickPitch) => set({ tickPitch })}
              format={(v) => (v === 1 ? 'as designed' : `${v < 1 ? '' : '+'}${Math.round(12 * Math.log2(v))} st`)}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Volume" hint={o.tickVolume === 0 ? 'At 0% no sound track is written for the ticks at all.' : undefined}>
            <RangeField
              label="Ticks volume"
              min={DRIVE_LIMITS.tickVolume.min}
              max={DRIVE_LIMITS.tickVolume.max}
              step={0.05}
              value={o.tickVolume}
              onChange={(tickVolume) => set({ tickVolume })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
        )}
        {o.sound && (
          <FieldRow label="Mix in" hint="Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.">
            <ToggleField label="Mix the ticks into a clip’s own sound" checked={o.mixWithClip} onChange={(mixWithClip) => set({ mixWithClip })}>
              Into a clip’s own sound
            </ToggleField>
          </FieldRow>
        )}
      </Group>
    </div>
  );
}

export const driveVariant: HookVariant = {
  id: 'drive',
  name: 'Virée',
  tagline: 'A little car drives the map from stop to stop, showing pictures',
  defaults: { ...DRIVE_DEFAULTS },
  needs: { coverage: true, stages: true, places: true, media: 'day' },
  owns: 'frame',
  wantsPictures(options, ctx) {
    const o = driveOptions(options);
    return driveWants(driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o), o);
  },
  prepare(options, ctx) {
    const o = driveOptions(options);
    const route = driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o);
    const plan = drivePlan(route, o);
    if (!plan) return { seconds: 0 };
    const scratch = driveScratch(o);
    const follows = o.captionFollows && o.stopsOn === 'places' && route.stops.some((s) => s.name);
    return {
      seconds: plan.seconds,
      // The badge's place reads the last stop the car passed, while it drives;
      // once it arrives the badge says its own — the leg's label.
      content: follows
        ? (t) => {
            const m = plan.at(t);
            if (m.over || t >= plan.schedule.arrivedAt) return {};
            const name = route.stops[m.reached]?.name;
            return name ? { caption: name } : {};
          }
        : undefined,
      paint: (g, t, frame) => paintDrive(g, plan, o, ctx.pictures, scratch, t, frame),
      score: o.sound ? () => driveScore(plan, o) : undefined,
      mixWithSource: o.sound && o.mixWithClip,
    };
  },
  Sketch: DriveSketch,
  Panel: DrivePanel,
};
