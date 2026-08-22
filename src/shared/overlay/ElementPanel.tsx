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
  type SpeedUnit,
  type TapeReticle,
  type TelemetryFieldKey,
} from './overlay-types';
import {
  resolveElementStyle,
  type StyleTheme,
  type ThemableKey,
} from './title-styles';

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

const labelClass =
  'font-mono text-[0.62rem] tracking-[0.12em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.82rem] text-ink bg-surface border border-line-strong rounded-paper px-[0.6rem] py-[0.4rem] w-full';

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
        .map((v) => Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, '0'))
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
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-accent cursor-pointer"
          checked={element.earlyValues !== false}
          onChange={(e) => change({ earlyValues: e.target.checked })}
        />
        <span className={labelClass}>Value from the start</span>
      </label>
      <span className="text-[0.7rem] text-faint leading-relaxed">
        This value is measured between two GPS fixes a second apart, so the
        clip's first second has nothing behind it to measure — the instrument
        would sit blank exactly where a social cut begins. On, it shows the
        second *ahead* instead: the reading it is about to have, measured, not
        invented. A drone that does not move still shows nothing.
      </span>
    </div>
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
        className="p-0 border-0 bg-transparent text-accent cursor-pointer leading-none text-[0.72rem]"
        title="Overriding the project style — click to follow the theme again"
        aria-label={`Reset ${prop} to theme`}
        onClick={() => resetOverride(prop)}
      >
        ↺
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-[0.85rem]">
      {activeTheme && (
        <div className="flex items-center gap-2 text-[0.72rem] text-muted">
          {overrides.length === 0 ? (
            <span>Following the project style.</span>
          ) : (
            <>
              <span>
                {overrides.length} propert{overrides.length === 1 ? 'y' : 'ies'}{' '}
                overriding the style.
              </span>
              <button
                type="button"
                className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[2px]"
                onClick={() => onChange({ styleOverrides: [] })}
              >
                Reset all
              </button>
            </>
          )}
        </div>
      )}

      {/* Content */}
      {element.kind === 'frame-corners' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[0.78rem] text-muted">
            Viewfinder brackets in the frame's four corners. It spans the whole
            frame, so it isn't dragged — tune its geometry here.
          </p>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Arm length · {Math.round(element.sizeFrac * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0.01}
              max={0.2}
              step={0.005}
              value={element.sizeFrac}
              onChange={(e) => change({ sizeFrac: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Inset · {Math.round((element.cornerInset ?? 0.03) * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={0.15}
              step={0.005}
              value={element.cornerInset ?? 0.03}
              onChange={(e) => change({ cornerInset: Number(e.target.value) })}
            />
          </label>
        </div>
      ) : element.kind === 'heading-arrow' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[0.78rem] text-muted">
            Rotates to the current course-over-ground heading. Shows a dot
            while hovering (no direction data).
          </p>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-accent cursor-pointer"
              checked={element.showCompass ?? false}
              onChange={(e) => change({ showCompass: e.target.checked })}
            />
            <span className={labelClass}>Compass ring (N / E / S / W)</span>
          </label>
          {element.showCompass && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Orientation mode</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.compassMode ?? 'absolute'}
                onChange={(e) =>
                  change({
                    compassMode: e.target.value as 'absolute' | 'relative',
                  })
                }
              >
                <option value="absolute">North-up — ring fixed, arrow rotates</option>
                <option value="relative">Track-up — arrow fixed up, ring rotates</option>
              </select>
            </label>
          )}
          <div className="flex flex-col gap-2 pt-2 border-t border-line">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                Smoothing ·{' '}
                {(element.headingSmoothing ?? 0.6) === 0
                  ? 'off'
                  : `${(element.headingSmoothing ?? 0.6).toFixed(1)} s`}
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={3}
                step={0.1}
                value={element.headingSmoothing ?? 0.6}
                onChange={(e) =>
                  change({ headingSmoothing: Number(e.target.value) })
                }
              />
              <span className="text-[0.7rem] text-faint leading-relaxed">
                The heading is rebuilt from GPS a few times a second, so it
                steps. Averaging a window of readings eases it — and bridges
                the short gaps where there is nothing to read.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>When the heading is lost</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.headingGap ?? 'dim'}
                onChange={(e) =>
                  change({ headingGap: e.target.value as HeadingGapMode })
                }
              >
                <option value="dim">Hold the last bearing, fading out</option>
                <option value="hold">Hold it plainly, then drop</option>
                <option value="hide">Drop to the no-data state at once</option>
              </select>
              <span className="text-[0.7rem] text-faint leading-relaxed">
                There is no compass in the log: the heading is course over
                ground, so it disappears while hovering or yawing on the spot.
              </span>
            </label>
            {(element.headingGap ?? 'dim') !== 'hide' && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Hold for · {(element.headingHoldSeconds ?? 2).toFixed(1)} s
                </span>
                <input
                  type="range"
                  className="w-full accent-accent cursor-pointer"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={element.headingHoldSeconds ?? 2}
                  onChange={(e) =>
                    change({ headingHoldSeconds: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <EarlyValues element={element} change={change} />
          </div>
        </div>
      ) : element.kind === 'heading-tape' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[0.78rem] text-muted">
            A slice of the compass sliding under a fixed sight. Ends fade into
            the image; the scale disappears when there is no heading (hovering,
            or a clip without telemetry).
          </p>
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>
                Width · {Math.round((element.tapeWidthFrac ?? 0.5) * 100)}% of frame
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0.15}
                max={0.98}
                step={0.01}
                value={element.tapeWidthFrac ?? 0.5}
                onChange={(e) => change({ tapeWidthFrac: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Span · {Math.round(element.tapeSpanDeg ?? 90)}° visible
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={20}
              max={180}
              step={5}
              value={element.tapeSpanDeg ?? 90}
              onChange={(e) => change({ tapeSpanDeg: Number(e.target.value) })}
            />
          </label>
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Labelled every</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.tapeMajorStep ?? 30}
                onChange={(e) => change({ tapeMajorStep: Number(e.target.value) })}
              >
                {[10, 15, 20, 30, 45, 90].map((d) => (
                  <option key={d} value={d}>{d}°</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Tick every</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.tapeMinorStep ?? 10}
                onChange={(e) => change({ tapeMinorStep: Number(e.target.value) })}
              >
                {[1, 2, 5, 10, 15, 30].map((d) => (
                  <option key={d} value={d}>{d}°</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Tick height · {Math.round((element.tapeTickScale ?? 1) * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0.4}
              max={2.5}
              step={0.1}
              value={element.tapeTickScale ?? 1}
              onChange={(e) => change({ tapeTickScale: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Edge fade · {Math.round((element.tapeFadeFrac ?? 0.22) * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={0.6}
              step={0.02}
              value={element.tapeFadeFrac ?? 0.22}
              onChange={(e) => change({ tapeFadeFrac: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Opacity · {Math.round((element.tapeOpacity ?? 1) * 100)}%
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0.1}
              max={1}
              step={0.05}
              value={element.tapeOpacity ?? 1}
              onChange={(e) => change({ tapeOpacity: Number(e.target.value) })}
            />
          </label>

          <div className="flex items-end gap-3 pt-1 border-t border-line">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Sight</span>
              <input
                type="color"
                className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
                value={
                  (element.tapeReticleColor ?? st.color).startsWith('#')
                    ? (element.tapeReticleColor ?? st.color)
                    : '#e2542f'
                }
                onChange={(e) => change({ tapeReticleColor: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Sight mark</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.tapeReticle ?? 'both'}
                onChange={(e) =>
                  change({ tapeReticle: e.target.value as TapeReticle })
                }
              >
                <option value="both">Pointer + line</option>
                <option value="triangle">Pointer only</option>
                <option value="line">Line only</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Reading</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={element.tapeLabel ?? 'above'}
              onChange={(e) =>
                change({ tapeLabel: e.target.value as LabelPlacement })
              }
            >
              <option value="above">Above the tape</option>
              <option value="below">Below the tape</option>
              <option value="left">Left of the tape</option>
              <option value="right">Right of the tape</option>
              <option value="none">Hidden</option>
            </select>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-accent cursor-pointer"
              checked={element.tapeCardinals ?? true}
              onChange={(e) => change({ tapeCardinals: e.target.checked })}
            />
            <span className={labelClass}>Letters at N / E / S / W</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-accent cursor-pointer"
              checked={element.tapeRule ?? true}
              onChange={(e) => change({ tapeRule: e.target.checked })}
            />
            <span className={labelClass}>Baseline rule</span>
          </label>
          <div className="flex flex-col gap-2 pt-2 border-t border-line">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                Smoothing ·{' '}
                {(element.headingSmoothing ?? 0.6) === 0
                  ? 'off'
                  : `${(element.headingSmoothing ?? 0.6).toFixed(1)} s`}
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={3}
                step={0.1}
                value={element.headingSmoothing ?? 0.6}
                onChange={(e) =>
                  change({ headingSmoothing: Number(e.target.value) })
                }
              />
              <span className="text-[0.7rem] text-faint leading-relaxed">
                The heading is rebuilt from GPS a few times a second, so it
                steps. Averaging a window of readings eases it — and bridges
                the short gaps where there is nothing to read.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>When the heading is lost</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.headingGap ?? 'dim'}
                onChange={(e) =>
                  change({ headingGap: e.target.value as HeadingGapMode })
                }
              >
                <option value="dim">Hold the last bearing, fading out</option>
                <option value="hold">Hold it plainly, then drop</option>
                <option value="hide">Drop to the no-data state at once</option>
              </select>
              <span className="text-[0.7rem] text-faint leading-relaxed">
                There is no compass in the log: the heading is course over
                ground, so it disappears while hovering or yawing on the spot.
              </span>
            </label>
            {(element.headingGap ?? 'dim') !== 'hide' && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>
                  Hold for · {(element.headingHoldSeconds ?? 2).toFixed(1)} s
                </span>
                <input
                  type="range"
                  className="w-full accent-accent cursor-pointer"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={element.headingHoldSeconds ?? 2}
                  onChange={(e) =>
                    change({ headingHoldSeconds: Number(e.target.value) })
                  }
                />
              </label>
            )}
            <EarlyValues element={element} change={change} />
          </div>
        </div>
      ) : element.kind === 'battery' ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[0.78rem] text-muted">
            A charge gauge. DJI's per-frame <code>.srt</code> carries no battery
            level — the Mini 4 Pro included — so this is an authored value by
            default. Point it at a telemetry key if your firmware writes one.
          </p>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Level from</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={element.batterySource ?? 'manual'}
              onChange={(e) =>
                change({ batterySource: e.target.value as BatterySource })
              }
            >
              <option value="manual">A value I set</option>
              <option value="telemetry">A telemetry key</option>
            </select>
          </label>
          {(element.batterySource ?? 'manual') === 'manual' ? (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                Level · {Math.round(element.batteryPercent ?? 100)}%
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={100}
                step={1}
                value={element.batteryPercent ?? 100}
                onChange={(e) => change({ batteryPercent: Number(e.target.value) })}
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Key</span>
              <input
                type="text"
                className={inputClass}
                placeholder={`(probe ${BATTERY_KEYS.slice(0, 3).join(', ')}…)`}
                value={element.batteryKey ?? ''}
                onChange={(e) => change({ batteryKey: e.target.value })}
              />
              <span className="text-[0.7rem] text-faint leading-relaxed">
                Blank probes the keys DJI firmwares are known to use. With
                nothing to read the gauge draws empty — it never invents a level.
              </span>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Cell width · {(element.batteryAspect ?? 2.1).toFixed(1)}× its height
            </span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={1.2}
              max={4}
              step={0.1}
              value={element.batteryAspect ?? 2.1}
              onChange={(e) => change({ batteryAspect: Number(e.target.value) })}
            />
          </label>
          <div className="flex items-end gap-3 pt-1 border-t border-line">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Low</span>
              <input
                type="color"
                className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
                value={
                  (element.batteryLowColor ?? '#e2402a').startsWith('#')
                    ? (element.batteryLowColor ?? '#e2402a')
                    : '#e2402a'
                }
                onChange={(e) => change({ batteryLowColor: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>
                Alarm below · {Math.round(element.batteryLowPercent ?? 20)}%
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={60}
                step={1}
                value={element.batteryLowPercent ?? 20}
                onChange={(e) =>
                  change({ batteryLowPercent: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Reading</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={
                element.batteryShowPercent === false
                  ? 'none'
                  : (element.batteryLabel ?? 'right')
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
            </select>
          </label>
        </div>
      ) : element.kind === 'text' ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Text</span>
          <input
            type="text"
            className={inputClass}
            value={element.text ?? ''}
            onChange={(e) => change({ text: e.target.value })}
          />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Field</span>
            <select
              className={`${inputClass} cursor-pointer`}
              value={element.field}
              onChange={(e) =>
                change({ field: e.target.value as TelemetryFieldKey })
              }
            >
              {FIELD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {FIELD_SPECS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Label prefix</span>
            <input
              type="text"
              className={inputClass}
              placeholder="(none)"
              value={element.label ?? ''}
              onChange={(e) => change({ label: e.target.value })}
            />
          </label>
          {element.field && TIME_FIELDS.has(element.field) && (
            <div className="flex flex-col gap-2">
              {element.field !== 'date' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Clock</span>
                    <select
                      className={`${inputClass} cursor-pointer`}
                      value={time.hour12 ? '12' : '24'}
                      onChange={(e) =>
                        patchTime({ hour12: e.target.value === '12' })
                      }
                    >
                      <option value="24">24-hour</option>
                      <option value="12">12-hour</option>
                    </select>
                  </label>
                  {time.hour12 && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                        checked={time.meridiem ?? true}
                        onChange={(e) => patchTime({ meridiem: e.target.checked })}
                      />
                      <span className={labelClass}>Show AM / PM</span>
                    </label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      checked={time.seconds ?? true}
                      onChange={(e) => patchTime({ seconds: e.target.checked })}
                    />
                    <span className={labelClass}>Seconds</span>
                  </label>
                  {element.field === 'timestamp' && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                        checked={time.milliseconds ?? false}
                        onChange={(e) =>
                          patchTime({ milliseconds: e.target.checked })
                        }
                      />
                      <span className={labelClass}>Milliseconds</span>
                    </label>
                  )}
                </>
              )}
              {element.field !== 'clock' && (
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Date</span>
                  <select
                    className={`${inputClass} cursor-pointer`}
                    value={time.dateStyle ?? 'iso'}
                    onChange={(e) =>
                      patchTime({ dateStyle: e.target.value as DateStyle })
                    }
                  >
                    <option value="iso">2026-05-30</option>
                    <option value="dmy">30/05/2026</option>
                    <option value="mdy">05/30/2026</option>
                    <option value="long-dmy">30 May 2026</option>
                    <option value="long-mdy">May 30, 2026</option>
                    <option value="weekday">Sat 30 May 2026</option>
                  </select>
                </label>
              )}
              <p className="m-0 text-[0.7rem] text-faint leading-relaxed">
                The flight log records a bare wall-clock reading with no
                timezone. If this clip's clock was off, correct it once in the
                project settings — it applies to every time element at once.
              </p>
            </div>
          )}
          {element.field && SPEED_FIELDS.has(element.field) && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Unit</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.speedUnit ?? 'm/s'}
                onChange={(e) => change({ speedUnit: e.target.value as SpeedUnit })}
              >
                {SPEED_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          )}
          {element.field && DERIVED_FIELDS.has(element.field) && (
            <EarlyValues element={element} change={change} />
          )}
        </>
      )}

      {/* Font — not applicable to shape-only kinds */}
      {element.kind !== 'heading-arrow' && element.kind !== 'frame-corners' && (
        <label className="flex flex-col gap-1">
          <span className={`${labelClass} flex items-center gap-1.5`}>
            Font <OverrideDot prop="fontFamily" />
          </span>
          <select
            className={`${inputClass} cursor-pointer`}
            value={st.fontFamily}
            onChange={(e) =>
              change({ fontFamily: e.target.value as OverlayElement['fontFamily'] })
            }
          >
            {CURATED_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Size — geometry: always the element's own (themes only multiply it).
          Frame corners carry their own arm-length slider above. */}
      {element.kind !== 'frame-corners' && (
      <label className="flex flex-col gap-1">
        <span className={labelClass}>
          Size · {Math.round(element.sizeFrac * 100)}% of shorter side
        </span>
        <input
          type="range"
          className="w-full accent-accent cursor-pointer"
          min={0.015}
          max={0.14}
          step={0.005}
          value={element.sizeFrac}
          onChange={(e) => change({ sizeFrac: Number(e.target.value) })}
        />
      </label>
      )}

      {/* Colour + weight + italic (weight/italic not applicable to arrows) */}
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={`${labelClass} flex items-center gap-1.5`}>
            Colour <OverrideDot prop="color" />
          </span>
          <input
            type="color"
            className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
            value={st.color.startsWith('#') ? st.color : '#ffffff'}
            onChange={(e) => change({ color: e.target.value })}
          />
        </label>
        {element.kind !== 'heading-arrow' && element.kind !== 'frame-corners' && (
          <>
            <label className="flex flex-col gap-1 flex-1">
              <span className={`${labelClass} flex items-center gap-1.5`}>
                Weight <OverrideDot prop="weight" />
              </span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={st.weight}
                onChange={(e) =>
                  change({ weight: Number(e.target.value) as FontWeight })
                }
              >
                {WEIGHTS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="flex-none h-9 px-3 border border-line-strong rounded-paper bg-paper text-ink-soft cursor-pointer italic font-serif text-[0.95rem] aria-pressed:border-accent aria-pressed:text-accent-ink"
              aria-pressed={st.italic}
              onClick={() => change({ italic: !st.italic })}
              title="Italic"
            >
              I
            </button>
          </>
        )}
      </div>

      {/* Anchor — meaningless for a full-frame decoration */}
      {element.kind !== 'frame-corners' && (
      <div className="flex flex-col gap-1">
        <span className={labelClass}>Anchor</span>
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
      </div>
      )}

      {/* Legibility */}
      <div className="flex flex-col gap-2 pt-1 border-t border-line">
        <label className="flex flex-col gap-1">
          <span className={`${labelClass} flex items-center gap-1.5`}>
            Legibility <OverrideDot prop="legibility" />
          </span>
          <select
            className={`${inputClass} cursor-pointer`}
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
          </select>
        </label>
        {leg.mode !== 'none' && (
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{leg.mode === 'box' ? 'Box' : 'Shadow'}</span>
              <input
                type="color"
                className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
                value={legColor.hex}
                onChange={(e) =>
                  change({
                    legibility: { ...leg, color: toRgba(e.target.value, legColor.alpha) },
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>
                Opacity · {Math.round(legColor.alpha * 100)}%
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0}
                max={1}
                step={0.05}
                value={legColor.alpha}
                onChange={(e) =>
                  change({
                    legibility: {
                      ...leg,
                      color: toRgba(legColor.hex, Number(e.target.value)),
                    },
                  })
                }
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
