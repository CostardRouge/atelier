import { FIELD_KEYS, FIELD_SPECS, TIME_FIELDS } from './field-format';
import { BATTERY_KEYS } from './battery';
import { SPEED_UNITS } from '../telemetry/motion';
import type { DateStyle, TimeFormatOptions } from '../telemetry/time-format';
import {
  CURATED_FONTS,
  type Anchor,
  type BatterySource,
  type FontWeight,
  type HeadingGapMode,
  type LabelPlacement,
  type OverlayElement,
  type RotateDirection,
  type SpeedUnit,
  type TapeReticle,
  type TelemetryFieldKey,
} from './overlay-types';
import { resolveElementStyle, type StyleTheme, type ThemableKey } from './title-styles';
import Button from '../ui/Button';
import {
  FieldRow,
  NativeSelect,
  RangeField,
  SwitchRow,
  TextField,
  ToggleField,
  swatchClass,
} from '../ui/Inspector';
import { Icons } from '../ui/icons';

const SPEED_FIELDS: ReadonlySet<TelemetryFieldKey> = new Set(['gnd_speed', 'vert_speed']);

/** Fields rebuilt from motion, and therefore blank on the clip's first frames. */
const DERIVED_FIELDS: ReadonlySet<TelemetryFieldKey> = new Set([
  'gnd_speed',
  'vert_speed',
  'heading',
]);

interface ElementPanelProps {
  element: OverlayElement;
  onChange: (patch: Partial<OverlayElement>) => void;
  /**
   * The project's title-style theme, when the host has one (the studio).
   * With a theme, controls display the RESOLVED appearance, editing an
   * appearance control pins that property as an element override, and each
   * pinned property offers a "back to theme" reset. Without a theme the panel
   * behaves exactly as before themes existed.
   */
  theme?: StyleTheme | null;
}

const ANCHORS: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const WEIGHTS: { value: FontWeight; label: string }[] = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
];

/** Which element patch keys pin which themable property. */
const THEMABLE_OF: Record<string, ThemableKey> = {
  fontFamily: 'fontFamily',
  weight: 'weight',
  italic: 'italic',
  color: 'color',
  legibility: 'legibility',
  uppercase: 'uppercase',
  letterSpacingEm: 'letterSpacing',
  glowAmount: 'glow',
  glowWarmth: 'glow',
};

/** Parse an `rgba()`/hex colour into a `#rrggbb` hex and alpha (0..1). */
function splitColor(color: string): { hex: string; alpha: number } {
  const rgba = color.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const [r, g, b, a] = rgba[1].split(',').map((s) => s.trim());
    const hex =
      '#' +
      [r, g, b]
        .map((v) =>
          Math.max(0, Math.min(255, Number(v)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    return { hex, alpha: a !== undefined ? Number(a) : 1 };
  }
  return { hex: color.startsWith('#') ? color : '#000000', alpha: 1 };
}

function toRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Speed and heading are not read from the log, they are *measured* between two
 * positions a second apart — so the clip's opening second has nothing behind it
 * and the instrument reads `—`. This offers the mirror measurement, taken over
 * the second ahead. Shared by the two heading instruments and the derived
 * readouts, which is the whole set of elements that can start blank.
 */
function EarlyValues({
  element,
  change,
}: {
  element: OverlayElement;
  change: (patch: Partial<OverlayElement>) => void;
}) {
  return (
    <SwitchRow
      label="Value from the start"
      checked={element.earlyValues !== false}
      onChange={(on) => change({ earlyValues: on })}
      hint="Measured between two GPS fixes a second apart, the clip's first second has nothing behind it — the instrument would sit blank where a social cut begins. On, it shows the second ahead instead: measured, not invented. A drone that does not move still shows nothing."
    />
  );
}

/** Style controls for the selected overlay element. */
export default function ElementPanel({ element, onChange, theme }: ElementPanelProps) {
  const activeTheme = theme ?? null;
  // With a theme, controls show the effective (resolved) appearance; without
  // one this is exactly the element's own values.
  const st = resolveElementStyle(element, activeTheme);
  const leg = st.legibility;
  const legColor = splitColor(leg.color);
  const overrides = element.styleOverrides ?? [];

  /** Patch + pin any appearance keys the patch touches (only under a theme). */
  function change(patch: Partial<OverlayElement>) {
    if (activeTheme) {
      const pinned = new Set(overrides);
      let grew = false;
      for (const key of Object.keys(patch)) {
        const themable = THEMABLE_OF[key];
        if (themable && !pinned.has(themable)) {
          pinned.add(themable);
          grew = true;
        }
      }
      if (grew) {
        onChange({ ...patch, styleOverrides: [...pinned] });
        return;
      }
    }
    onChange(patch);
  }

  /** Time presentation lives in one nested object, like `legibility`. */
  const time: TimeFormatOptions = element.timeFormat ?? {};
  function patchTime(patch: Partial<TimeFormatOptions>) {
    change({ timeFormat: { ...time, ...patch } });
  }

  function resetOverride(key: ThemableKey) {
    onChange({ styleOverrides: overrides.filter((k) => k !== key) });
  }

  /** "Back to theme" affordance beside a control whose property is pinned. */
  function OverrideDot({ prop }: { prop: ThemableKey }) {
    if (!activeTheme || !overrides.includes(prop)) return null;
    return (
      <button
        type="button"
        className="inline-flex align-[-0.15em] p-0 border-0 bg-transparent text-accent cursor-pointer [&>svg]:w-3.5 [&>svg]:h-3.5"
        title="Overriding the project style — click to follow the theme again"
        aria-label={`Reset ${prop} to theme`}
        onClick={() => resetOverride(prop)}
      >
        {Icons.reset}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {activeTheme && (
        <div className="flex items-center gap-2 text-xs text-muted">
          {overrides.length === 0 ? (
            <span>Following the project style.</span>
          ) : (
            <>
              <span>
                {overrides.length} propert{overrides.length === 1 ? 'y' : 'ies'} overriding the
                style.
              </span>
              <Button size="sm" variant="ghost" onClick={() => onChange({ styleOverrides: [] })}>
                Reset all
              </Button>
            </>
          )}
        </div>
      )}

      {/* Content */}
      {element.kind === 'frame-corners' ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-xs text-muted">
            Viewfinder brackets in the frame's four corners. It spans the whole frame, so it isn't
            dragged — tune its geometry here.
          </p>
          <FieldRow label="Arm length">
            <RangeField
              label="Arm length"
              min={0.01}
              max={0.2}
              step={0.005}
              value={element.sizeFrac}
              onChange={(v) => change({ sizeFrac: v })}
              format={() => `${Math.round(element.sizeFrac * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Inset">
            <RangeField
              label="Inset"
              min={0}
              max={0.15}
              step={0.005}
              value={element.cornerInset ?? 0.03}
              onChange={(v) => change({ cornerInset: v })}
              format={() => `${Math.round((element.cornerInset ?? 0.03) * 100)}%`}
            />
          </FieldRow>
        </div>
      ) : element.kind === 'heading-arrow' ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-xs text-muted">
            Rotates to the current course-over-ground heading. Shows a dot while hovering (no
            direction data).
          </p>
          <SwitchRow
            label="Compass ring (N / E / S / W)"
            checked={element.showCompass ?? false}
            onChange={(on) => change({ showCompass: on })}
          />
          {element.showCompass && (
            <FieldRow label="Orientation">
              <NativeSelect
                label="Orientation"
                value={element.compassMode ?? 'absolute'}
                onChange={(e) =>
                  change({
                    compassMode: e.target.value as 'absolute' | 'relative',
                  })
                }
              >
                <option value="absolute">North-up — ring fixed, arrow rotates</option>
                <option value="relative">Track-up — arrow fixed up, ring rotates</option>
              </NativeSelect>
            </FieldRow>
          )}
          <div className="flex flex-col gap-2.5">
            <FieldRow
              label="Smoothing"
              hint={
                <>
                  The heading is rebuilt from GPS a few times a second, so it steps. Averaging a
                  window of readings eases it — and bridges the short gaps where there is nothing to
                  read.
                </>
              }
            >
              <RangeField
                label="Smoothing"
                min={0}
                max={3}
                step={0.1}
                value={element.headingSmoothing ?? 0.6}
                onChange={(v) => change({ headingSmoothing: v })}
                format={() =>
                  `${(element.headingSmoothing ?? 0.6) === 0 ? 'off' : `${(element.headingSmoothing ?? 0.6).toFixed(1)} s`}`
                }
              />
            </FieldRow>
            <FieldRow
              label="Heading lost"
              hint={
                <>
                  There is no compass in the log: the heading is course over ground, so it
                  disappears while hovering or yawing on the spot.
                </>
              }
            >
              <NativeSelect
                label="Heading lost"
                value={element.headingGap ?? 'dim'}
                onChange={(e) => change({ headingGap: e.target.value as HeadingGapMode })}
              >
                <option value="dim">Hold the last bearing, fading out</option>
                <option value="hold">Hold it plainly, then drop</option>
                <option value="hide">Drop to the no-data state at once</option>
              </NativeSelect>
            </FieldRow>
            {(element.headingGap ?? 'dim') !== 'hide' && (
              <FieldRow label="Hold for">
                <RangeField
                  label="Hold for"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={element.headingHoldSeconds ?? 2}
                  onChange={(v) => change({ headingHoldSeconds: v })}
                  format={() => `${(element.headingHoldSeconds ?? 2).toFixed(1)} s`}
                />
              </FieldRow>
            )}
            <EarlyValues element={element} change={change} />
          </div>
        </div>
      ) : element.kind === 'heading-tape' ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-xs text-muted">
            A slice of the compass sliding under a fixed sight. Ends fade into the image; the scale
            disappears when there is no heading (hovering, or a clip without telemetry).
          </p>
          <>
            <FieldRow label="Width">
              <RangeField
                label="Width"
                min={0.15}
                max={0.98}
                step={0.01}
                value={element.tapeWidthFrac ?? 0.5}
                onChange={(v) => change({ tapeWidthFrac: v })}
                format={() => `${Math.round((element.tapeWidthFrac ?? 0.5) * 100)}%`}
              />
            </FieldRow>
          </>
          <FieldRow label="Span">
            <RangeField
              label="Span"
              min={20}
              max={180}
              step={5}
              value={element.tapeSpanDeg ?? 90}
              onChange={(v) => change({ tapeSpanDeg: v })}
              format={() => `${Math.round(element.tapeSpanDeg ?? 90)}°`}
            />
          </FieldRow>
          <>
            <FieldRow label="Labels every">
              <NativeSelect
                label="Labels every"
                value={element.tapeMajorStep ?? 30}
                onChange={(e) => change({ tapeMajorStep: Number(e.target.value) })}
              >
                {[10, 15, 20, 30, 45, 90].map((d) => (
                  <option key={d} value={d}>
                    {d}°
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Tick every">
              <NativeSelect
                label="Tick every"
                value={element.tapeMinorStep ?? 10}
                onChange={(e) => change({ tapeMinorStep: Number(e.target.value) })}
              >
                {[1, 2, 5, 10, 15, 30].map((d) => (
                  <option key={d} value={d}>
                    {d}°
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
          </>
          <FieldRow label="Tick height">
            <RangeField
              label="Tick height"
              min={0.4}
              max={2.5}
              step={0.1}
              value={element.tapeTickScale ?? 1}
              onChange={(v) => change({ tapeTickScale: v })}
              format={() => `${Math.round((element.tapeTickScale ?? 1) * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Edge fade">
            <RangeField
              label="Edge fade"
              min={0}
              max={0.6}
              step={0.02}
              value={element.tapeFadeFrac ?? 0.22}
              onChange={(v) => change({ tapeFadeFrac: v })}
              format={() => `${Math.round((element.tapeFadeFrac ?? 0.22) * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Opacity">
            <RangeField
              label="Opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={element.tapeOpacity ?? 1}
              onChange={(v) => change({ tapeOpacity: v })}
              format={() => `${Math.round((element.tapeOpacity ?? 1) * 100)}%`}
            />
          </FieldRow>

          <>
            <FieldRow label="Sight">
              <input
                type="color"
                className={swatchClass}
                aria-label="Sight"
                value={
                  (element.tapeReticleColor ?? st.color).startsWith('#')
                    ? (element.tapeReticleColor ?? st.color)
                    : '#e2542f'
                }
                onChange={(e) => change({ tapeReticleColor: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Sight mark">
              <NativeSelect
                label="Sight mark"
                value={element.tapeReticle ?? 'both'}
                onChange={(e) => change({ tapeReticle: e.target.value as TapeReticle })}
              >
                <option value="both">Pointer + line</option>
                <option value="triangle">Pointer only</option>
                <option value="line">Line only</option>
                <option value="none">None</option>
              </NativeSelect>
            </FieldRow>
          </>

          <FieldRow label="Reading">
            <NativeSelect
              label="Reading"
              value={element.tapeLabel ?? 'above'}
              onChange={(e) => change({ tapeLabel: e.target.value as LabelPlacement })}
            >
              <option value="above">Above the tape</option>
              <option value="below">Below the tape</option>
              <option value="left">Left of the tape</option>
              <option value="right">Right of the tape</option>
              <option value="none">Hidden</option>
            </NativeSelect>
          </FieldRow>

          <SwitchRow
            label="Letters at N / E / S / W"
            checked={element.tapeCardinals ?? true}
            onChange={(on) => change({ tapeCardinals: on })}
          />
          <SwitchRow
            label="Baseline rule"
            checked={element.tapeRule ?? true}
            onChange={(on) => change({ tapeRule: on })}
          />
          <div className="flex flex-col gap-2.5">
            <FieldRow
              label="Smoothing"
              hint={
                <>
                  The heading is rebuilt from GPS a few times a second, so it steps. Averaging a
                  window of readings eases it — and bridges the short gaps where there is nothing to
                  read.
                </>
              }
            >
              <RangeField
                label="Smoothing"
                min={0}
                max={3}
                step={0.1}
                value={element.headingSmoothing ?? 0.6}
                onChange={(v) => change({ headingSmoothing: v })}
                format={() =>
                  `${(element.headingSmoothing ?? 0.6) === 0 ? 'off' : `${(element.headingSmoothing ?? 0.6).toFixed(1)} s`}`
                }
              />
            </FieldRow>
            <FieldRow
              label="Heading lost"
              hint={
                <>
                  There is no compass in the log: the heading is course over ground, so it
                  disappears while hovering or yawing on the spot.
                </>
              }
            >
              <NativeSelect
                label="Heading lost"
                value={element.headingGap ?? 'dim'}
                onChange={(e) => change({ headingGap: e.target.value as HeadingGapMode })}
              >
                <option value="dim">Hold the last bearing, fading out</option>
                <option value="hold">Hold it plainly, then drop</option>
                <option value="hide">Drop to the no-data state at once</option>
              </NativeSelect>
            </FieldRow>
            {(element.headingGap ?? 'dim') !== 'hide' && (
              <FieldRow label="Hold for">
                <RangeField
                  label="Hold for"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={element.headingHoldSeconds ?? 2}
                  onChange={(v) => change({ headingHoldSeconds: v })}
                  format={() => `${(element.headingHoldSeconds ?? 2).toFixed(1)} s`}
                />
              </FieldRow>
            )}
            <EarlyValues element={element} change={change} />
          </div>
        </div>
      ) : element.kind === 'battery' ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-xs text-muted">
            A charge gauge. DJI's per-frame <code>.srt</code> carries no battery level — the Mini 4
            Pro included — so this is an authored value by default. Point it at a telemetry key if
            your firmware writes one.
          </p>
          <FieldRow label="Level from">
            <NativeSelect
              label="Level from"
              value={element.batterySource ?? 'manual'}
              onChange={(e) => change({ batterySource: e.target.value as BatterySource })}
            >
              <option value="manual">A value I set</option>
              <option value="telemetry">A telemetry key</option>
            </NativeSelect>
          </FieldRow>
          {(element.batterySource ?? 'manual') === 'manual' ? (
            <FieldRow label="Level">
              <RangeField
                label="Level"
                min={0}
                max={100}
                step={1}
                value={element.batteryPercent ?? 100}
                onChange={(v) => change({ batteryPercent: v })}
                format={() => `${Math.round(element.batteryPercent ?? 100)}%`}
              />
            </FieldRow>
          ) : (
            <FieldRow
              label="Key"
              hint={
                <>
                  Blank probes the keys DJI firmwares are known to use. With nothing to read the
                  gauge draws empty — it never invents a level.
                </>
              }
            >
              <TextField
                label="Key"
                value={element.batteryKey ?? ''}
                onChange={(v) => change({ batteryKey: v })}
                placeholder={`(probe ${BATTERY_KEYS.slice(0, 3).join(', ')}…)`}
              />
            </FieldRow>
          )}
          <FieldRow label="Cell width">
            <RangeField
              label="Cell width"
              min={1.2}
              max={4}
              step={0.1}
              value={element.batteryAspect ?? 2.1}
              onChange={(v) => change({ batteryAspect: v })}
              format={() => `${(element.batteryAspect ?? 2.1).toFixed(1)}×`}
            />
          </FieldRow>
          <>
            <FieldRow label="Low">
              <input
                type="color"
                className={swatchClass}
                aria-label="Low"
                value={
                  (element.batteryLowColor ?? '#e2402a').startsWith('#')
                    ? (element.batteryLowColor ?? '#e2402a')
                    : '#e2402a'
                }
                onChange={(e) => change({ batteryLowColor: e.target.value })}
              />
            </FieldRow>
            <FieldRow label="Alarm under">
              <RangeField
                label="Alarm under"
                min={0}
                max={60}
                step={1}
                value={element.batteryLowPercent ?? 20}
                onChange={(v) => change({ batteryLowPercent: v })}
                format={() => `${Math.round(element.batteryLowPercent ?? 20)}%`}
              />
            </FieldRow>
          </>
          <FieldRow label="Reading">
            <NativeSelect
              label="Reading"
              value={
                element.batteryShowPercent === false ? 'none' : (element.batteryLabel ?? 'right')
              }
              onChange={(e) => {
                const v = e.target.value as LabelPlacement;
                change(
                  v === 'none'
                    ? { batteryShowPercent: false }
                    : { batteryShowPercent: true, batteryLabel: v },
                );
              }}
            >
              <option value="right">Right of the cell</option>
              <option value="left">Left of the cell</option>
              <option value="above">Above the cell</option>
              <option value="below">Below the cell</option>
              <option value="none">Hidden</option>
            </NativeSelect>
          </FieldRow>
        </div>
      ) : element.kind === 'rotate-device' ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-xs text-muted">
            A phone tipping a quarter turn, to invite the viewer to rotate their screen. It is drawn
            into the video like everything else — the export is a flat file, so the gesture is the
            whole message.
          </p>
          <FieldRow label="Caption">
            <TextField
              label="Caption"
              value={element.text ?? ''}
              onChange={(v) => change({ text: v })}
              placeholder="(none)"
            />
          </FieldRow>
          <FieldRow label="Turn">
            <NativeSelect
              label="Turn"
              value={element.rotateDirection ?? 'cw'}
              onChange={(e) => change({ rotateDirection: e.target.value as RotateDirection })}
            >
              <option value="cw">Clockwise — onto its right side</option>
              <option value="ccw">Anticlockwise — onto its left side</option>
            </NativeSelect>
          </FieldRow>
          <>
            <FieldRow label="Phone size">
              <RangeField
                label="Phone size"
                min={0.3}
                max={0.85}
                step={0.02}
                value={element.rotatePhoneScale ?? 0.66}
                onChange={(v) => change({ rotatePhoneScale: v })}
                format={() => `${Math.round((element.rotatePhoneScale ?? 0.66) * 100)}%`}
              />
            </FieldRow>
            <FieldRow label="Arrow size">
              <RangeField
                label="Arrow size"
                min={0.2}
                max={0.48}
                step={0.02}
                value={element.rotateArcScale ?? 0.44}
                onChange={(v) => change({ rotateArcScale: v })}
                format={() => `${Math.round((element.rotateArcScale ?? 0.44) * 100)}%`}
              />
            </FieldRow>
          </>
          <FieldRow label="Cycle">
            <RangeField
              label="Cycle"
              min={0.6}
              max={4}
              step={0.1}
              value={element.rotateCycleSeconds ?? 1.8}
              onChange={(v) => change({ rotateCycleSeconds: v })}
              format={() => `${(element.rotateCycleSeconds ?? 1.8).toFixed(1)} s`}
            />
          </FieldRow>
          <SwitchRow
            label="Tip back upright each cycle"
            checked={element.rotateReturn ?? true}
            onChange={(on) => change({ rotateReturn: on })}
          />
          <FieldRow label="Caption at">
            <NativeSelect
              label="Caption at"
              value={element.rotateLabel ?? 'below'}
              onChange={(e) => change({ rotateLabel: e.target.value as LabelPlacement })}
            >
              <option value="below">Below the phone</option>
              <option value="above">Above the phone</option>
              <option value="right">Right of the phone</option>
              <option value="left">Left of the phone</option>
            </NativeSelect>
          </FieldRow>
        </div>
      ) : element.kind === 'text' ? (
        <FieldRow label="Text">
          <TextField
            label="Text"
            value={element.text ?? ''}
            onChange={(v) => change({ text: v })}
          />
        </FieldRow>
      ) : (
        <>
          <FieldRow label="Field">
            <NativeSelect
              label="Field"
              value={element.field}
              onChange={(e) => change({ field: e.target.value as TelemetryFieldKey })}
            >
              {FIELD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {FIELD_SPECS[k].label}
                </option>
              ))}
            </NativeSelect>
          </FieldRow>
          <FieldRow label="Prefix">
            <TextField
              label="Prefix"
              value={element.label ?? ''}
              onChange={(v) => change({ label: v })}
              placeholder="(none)"
            />
          </FieldRow>
          {element.field && TIME_FIELDS.has(element.field) && (
            <div className="flex flex-col gap-2.5">
              {element.field !== 'date' && (
                <>
                  <FieldRow label="Clock">
                    <NativeSelect
                      label="Clock"
                      value={time.hour12 ? '12' : '24'}
                      onChange={(e) => patchTime({ hour12: e.target.value === '12' })}
                    >
                      <option value="24">24-hour</option>
                      <option value="12">12-hour</option>
                    </NativeSelect>
                  </FieldRow>
                  {time.hour12 && (
                    <SwitchRow
                      label="Show AM / PM"
                      checked={time.meridiem ?? true}
                      onChange={(on) => patchTime({ meridiem: on })}
                    />
                  )}
                  <SwitchRow
                    label="Seconds"
                    checked={time.seconds ?? true}
                    onChange={(on) => patchTime({ seconds: on })}
                  />
                  {element.field === 'timestamp' && (
                    <SwitchRow
                      label="Milliseconds"
                      checked={time.milliseconds ?? false}
                      onChange={(on) => patchTime({ milliseconds: on })}
                    />
                  )}
                </>
              )}
              {element.field !== 'clock' && (
                <FieldRow label="Date">
                  <NativeSelect
                    label="Date"
                    value={time.dateStyle ?? 'iso'}
                    onChange={(e) => patchTime({ dateStyle: e.target.value as DateStyle })}
                  >
                    <option value="iso">2026-05-30</option>
                    <option value="dmy">30/05/2026</option>
                    <option value="mdy">05/30/2026</option>
                    <option value="long-dmy">30 May 2026</option>
                    <option value="long-mdy">May 30, 2026</option>
                    <option value="weekday">Sat 30 May 2026</option>
                  </NativeSelect>
                </FieldRow>
              )}
              <p className="m-0 text-2xs text-faint leading-relaxed">
                The flight log records a bare wall-clock reading with no timezone. If this clip's
                clock was off, correct it once in the project settings — it applies to every time
                element at once.
              </p>
            </div>
          )}
          {element.field && SPEED_FIELDS.has(element.field) && (
            <FieldRow label="Unit">
              <NativeSelect
                label="Unit"
                value={element.speedUnit ?? 'm/s'}
                onChange={(e) => change({ speedUnit: e.target.value as SpeedUnit })}
              >
                {SPEED_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
          )}
          {element.field && DERIVED_FIELDS.has(element.field) && (
            <EarlyValues element={element} change={change} />
          )}
        </>
      )}

      {/* Font — not applicable to shape-only kinds */}
      {element.kind !== 'heading-arrow' && element.kind !== 'frame-corners' && (
        <FieldRow
          label={
            <>
              Font <OverrideDot prop="fontFamily" />
            </>
          }
        >
          <NativeSelect
            label="Font"
            value={st.fontFamily}
            onChange={(e) => change({ fontFamily: e.target.value as OverlayElement['fontFamily'] })}
          >
            {CURATED_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </FieldRow>
      )}

      {/* Size — geometry: always the element's own (themes only multiply it).
          Frame corners carry their own arm-length slider above. */}
      {element.kind !== 'frame-corners' && (
        <FieldRow label="Size">
          <RangeField
            label="Size"
            min={0.015}
            max={0.14}
            step={0.005}
            value={element.sizeFrac}
            onChange={(v) => change({ sizeFrac: v })}
            format={() => `${Math.round(element.sizeFrac * 100)}%`}
          />
        </FieldRow>
      )}

      {/* Colour + weight + italic (weight/italic not applicable to arrows) */}
      <>
        <FieldRow
          label={
            <>
              Colour <OverrideDot prop="color" />
            </>
          }
        >
          <input
            type="color"
            className={swatchClass}
            aria-label="Colour"
            value={st.color.startsWith('#') ? st.color : '#ffffff'}
            onChange={(e) => change({ color: e.target.value })}
          />
        </FieldRow>
        {element.kind !== 'heading-arrow' && element.kind !== 'frame-corners' && (
          <>
            <FieldRow
              label={
                <>
                  Weight <OverrideDot prop="weight" />
                </>
              }
            >
              <NativeSelect
                label="Weight"
                value={st.weight}
                onChange={(e) => change({ weight: Number(e.target.value) as FontWeight })}
              >
                {WEIGHTS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
            <FieldRow
              label={
                <>
                  Italic <OverrideDot prop="italic" />
                </>
              }
            >
              <ToggleField
                label="Italic"
                checked={st.italic}
                onChange={(italic) => change({ italic })}
              />
            </FieldRow>
          </>
        )}
      </>

      {/* Anchor — meaningless for a full-frame decoration */}
      {element.kind !== 'frame-corners' && (
        <FieldRow label="Anchor" align="start">
          <div className="grid grid-cols-3 gap-1 w-[5.4rem]">
            {ANCHORS.map((a) => (
              <button
                key={a}
                type="button"
                className={`w-full aspect-square rounded-[6px] border ${
                  element.anchor === a
                    ? 'border-accent bg-accent-wash'
                    : 'border-line-strong bg-paper hover:border-accent'
                }`}
                aria-pressed={element.anchor === a}
                onClick={() => change({ anchor: a })}
                title={a}
              >
                <span
                  className={`block w-1.5 h-1.5 rounded-full m-auto ${
                    element.anchor === a ? 'bg-accent' : 'bg-muted'
                  }`}
                />
              </button>
            ))}
          </div>
        </FieldRow>
      )}

      {/* Legibility */}
      <div className="flex flex-col gap-2.5">
        <FieldRow
          label={
            <>
              Legibility <OverrideDot prop="legibility" />
            </>
          }
        >
          <NativeSelect
            label="Legibility"
            value={leg.mode}
            onChange={(e) =>
              change({
                legibility: { ...leg, mode: e.target.value as typeof leg.mode },
              })
            }
          >
            <option value="none">None</option>
            <option value="shadow">Drop shadow</option>
            <option value="box">Background box</option>
          </NativeSelect>
        </FieldRow>
        {leg.mode !== 'none' && (
          <>
            <FieldRow label={<>{leg.mode === 'box' ? 'Box' : 'Shadow'}</>}>
              <input
                type="color"
                className={swatchClass}
                aria-label={leg.mode === 'box' ? 'Box colour' : 'Shadow colour'}
                value={legColor.hex}
                onChange={(e) =>
                  change({
                    legibility: { ...leg, color: toRgba(e.target.value, legColor.alpha) },
                  })
                }
              />
            </FieldRow>
            <FieldRow label="Opacity">
              <RangeField
                label="Opacity"
                min={0}
                max={1}
                step={0.05}
                value={legColor.alpha}
                onChange={(v) =>
                  change({
                    legibility: {
                      ...leg,
                      color: toRgba(legColor.hex, v),
                    },
                  })
                }
                format={() => `${Math.round(legColor.alpha * 100)}%`}
              />
            </FieldRow>
          </>
        )}
      </div>
    </div>
  );
}
