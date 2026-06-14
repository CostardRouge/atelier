import { FIELD_KEYS, FIELD_SPECS } from './field-format';
import {
  CURATED_FONTS,
  type Anchor,
  type FontWeight,
  type OverlayElement,
  type SpeedUnit,
  type TelemetryFieldKey,
} from './overlay-types';

const SPEED_FIELDS: ReadonlySet<TelemetryFieldKey> = new Set(['gnd_speed', 'vert_speed']);

interface ElementPanelProps {
  element: OverlayElement;
  onChange: (patch: Partial<OverlayElement>) => void;
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

/** Style controls for the selected overlay element. */
export default function ElementPanel({ element, onChange }: ElementPanelProps) {
  const leg = element.legibility;
  const legColor = splitColor(leg.color);

  return (
    <div className="flex flex-col gap-[0.85rem]">
      {/* Content */}
      {element.kind === 'heading-arrow' ? (
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
              onChange={(e) => onChange({ showCompass: e.target.checked })}
            />
            <span className={labelClass}>Compass ring (N / E / S / W)</span>
          </label>
        </div>
      ) : element.kind === 'text' ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Text</span>
          <input
            type="text"
            className={inputClass}
            value={element.text ?? ''}
            onChange={(e) => onChange({ text: e.target.value })}
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
                onChange({ field: e.target.value as TelemetryFieldKey })
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
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </label>
          {element.field && SPEED_FIELDS.has(element.field) && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Unit</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.speedUnit ?? 'm/s'}
                onChange={(e) => onChange({ speedUnit: e.target.value as SpeedUnit })}
              >
                <option value="m/s">m/s</option>
                <option value="km/h">km/h</option>
              </select>
            </label>
          )}
        </>
      )}

      {/* Font — not applicable to heading arrows */}
      {element.kind !== 'heading-arrow' && (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Font</span>
          <select
            className={`${inputClass} cursor-pointer`}
            value={element.fontFamily}
            onChange={(e) =>
              onChange({ fontFamily: e.target.value as OverlayElement['fontFamily'] })
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

      {/* Size */}
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
          onChange={(e) => onChange({ sizeFrac: Number(e.target.value) })}
        />
      </label>

      {/* Colour + weight + italic (weight/italic not applicable to arrows) */}
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Colour</span>
          <input
            type="color"
            className="w-12 h-9 p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
            value={element.color.startsWith('#') ? element.color : '#ffffff'}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </label>
        {element.kind !== 'heading-arrow' && (
          <>
            <label className="flex flex-col gap-1 flex-1">
              <span className={labelClass}>Weight</span>
              <select
                className={`${inputClass} cursor-pointer`}
                value={element.weight}
                onChange={(e) =>
                  onChange({ weight: Number(e.target.value) as FontWeight })
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
              aria-pressed={element.italic}
              onClick={() => onChange({ italic: !element.italic })}
              title="Italic"
            >
              I
            </button>
          </>
        )}
      </div>

      {/* Anchor */}
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
              onClick={() => onChange({ anchor: a })}
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

      {/* Legibility */}
      <div className="flex flex-col gap-2 pt-1 border-t border-line">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Legibility</span>
          <select
            className={`${inputClass} cursor-pointer`}
            value={leg.mode}
            onChange={(e) =>
              onChange({
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
                  onChange({
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
                  onChange({
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
