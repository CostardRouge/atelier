import type { CSSProperties } from 'react';
import type { Cue } from '../telemetry/srt-parser';
import type { TimeShift } from '../telemetry/time-format';
import { FIELD_SPECS, formatField, MISSING, renderElementText } from './field-format';
import {
  createBatteryElement,
  createFrameCornersElement,
  createHeadingArrowElement,
  createHeadingTapeElement,
  createTelemetryElement,
  createTextElement,
  type OverlayElement,
} from './overlay-types';
import { PALETTE_GROUPS, type PaletteItem } from './palette-groups';
import { resolveElementStyle, type StyleTheme } from './title-styles';
import {
  previewGlowFilter,
  previewTextStyle,
  type PreviewAppearance,
} from './style-preview';

interface ElementPaletteProps {
  /** What is already on the frame — each cell shows it, never blocks on it. */
  elements: OverlayElement[];
  /** The cue at the playhead, so a cell previews the value it will really show. */
  cue: Cue | null;
  /** The project theme, so a cell previews the look it will really wear. */
  theme: StyleTheme | null;
  /** The project's capture-time correction, so a Clock cell previews it too. */
  timeShift?: TimeShift | null;
  onAdd: (el: OverlayElement) => void;
  /**
   * Fold state, owned by the caller: the inspector unmounts its tabs, and a
   * palette that re-collapsed on every trip to Style would be maddening.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STAGE_FADE =
  'linear-gradient(to right, transparent 0, #000 7%, #000 93%, transparent 100%)';

/** A fresh element for a palette cell — the cell IS its constructor. */
function elementFor(item: PaletteItem): OverlayElement {
  switch (item.kind) {
    case 'telemetry-field':
      return createTelemetryElement(item.field);
    case 'text':
      return createTextElement();
    case 'heading-arrow':
      return createHeadingArrowElement();
    case 'heading-tape':
      return createHeadingTapeElement();
    case 'frame-corners':
      return createFrameCornersElement();
    case 'battery':
      return createBatteryElement();
  }
}

function nameOf(item: PaletteItem): string {
  switch (item.kind) {
    case 'telemetry-field':
      // The dropdown's parentheticals ("Clock (HH:MM:SS)") only truncate here —
      // the cell shows the real value underneath, which says it better.
      return FIELD_SPECS[item.field].label.replace(/\s*\([^)]*\)\s*$/, '');
    case 'text':
      return 'Text';
    case 'heading-arrow':
      return 'Arrow';
    case 'heading-tape':
      return 'Heading tape';
    case 'frame-corners':
      return 'Corners';
    case 'battery':
      return 'Battery';
  }
}

/** How many of this component are already placed. */
function countPlaced(elements: OverlayElement[], item: PaletteItem): number {
  return elements.filter((e) =>
    item.kind === 'telemetry-field'
      ? e.kind === 'telemetry-field' && e.field === item.field
      : e.kind === item.kind,
  ).length;
}

/**
 * What the cell shows in its little dark stage.
 *
 * For a telemetry field this is the **live value at the playhead** — the point
 * of the palette is that you pick what you can read. When the clip carries no
 * telemetry (or the field is empty in this cue) the cell falls back to the
 * label alone: a fabricated "87 m" would be a lie about the footage.
 */
function previewText(
  item: PaletteItem,
  el: OverlayElement,
  cue: Cue | null,
  timeShift?: TimeShift | null,
): string {
  if (item.kind === 'text') return el.text ?? 'Text';
  if (item.kind !== 'telemetry-field') return '';
  const value = formatField(item.field, cue, el.speedUnit, {
    format: el.timeFormat,
    shift: timeShift,
  });
  if (value === MISSING) {
    return el.label?.trim() || FIELD_SPECS[item.field].label;
  }
  return renderElementText(el, cue, timeShift);
}

/** Shape kinds draw no text, so their cells preview the glyph itself. */
function ArrowGlyph({ style }: { style: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[1.15rem] h-[1.15rem]"
      style={style}
      aria-hidden="true"
    >
      <path d="M12 3 L19 20 L12 15.5 L5 20 Z" fill="currentColor" />
    </svg>
  );
}

function TapeGlyph({ style, sight }: { style: CSSProperties; sight: string }) {
  // Ticks thinning toward both ends, the way the real ribbon dissolves.
  const ticks = [-13, -9, -5, 0, 5, 9, 13];
  return (
    <svg
      viewBox="0 0 32 14"
      className="w-[1.9rem] h-[1.1rem]"
      style={style}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.1">
        {ticks.map((t) => (
          <line
            key={t}
            x1={16 + t}
            y1="4"
            x2={16 + t}
            y2={t % 10 === 0 ? 10 : 7.5}
            opacity={1 - Math.abs(t) / 16}
          />
        ))}
        <line x1="2" y1="4" x2="30" y2="4" opacity="0.35" />
      </g>
      <path d="M16 3.4 L13.4 0.6 L18.6 0.6 Z" fill={sight} />
    </svg>
  );
}

function BatteryGlyph({ style }: { style: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 32 16"
      className="w-[1.75rem] h-[0.95rem]"
      style={style}
      aria-hidden="true"
    >
      <rect
        x="1"
        y="2"
        width="26"
        height="12"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect x="3.4" y="4.4" width="16" height="7.2" rx="1.4" fill="currentColor" />
      <rect x="28.4" y="5.6" width="2.6" height="4.8" rx="1" fill="currentColor" />
    </svg>
  );
}

function CornersGlyph({ style }: { style: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 32 20"
      className="w-[1.7rem] h-[1.1rem]"
      style={style}
      aria-hidden="true"
    >
      <path
        d="M2 6 V2 H7 M25 2 H30 V6 M30 14 V18 H25 M7 18 H2 V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * The component palette: a grid of what can be dropped on the frame, each cell
 * previewing what it will actually add — the current value in the current
 * style, on a dark stage that stands in for the footage.
 *
 * It replaces the old dropdown + "+ Field" pair, which asked you to pick a
 * field blind and then press a second button. The whole thing folds away
 * because in a 340px column eighteen readouts would otherwise push the element
 * list and its style panel off-screen; the caller opens it on an empty deck,
 * when adding is the only thing left to do.
 */
export default function ElementPalette({
  elements,
  cue,
  theme,
  timeShift,
  onAdd,
  open,
  onOpenChange,
}: ElementPaletteProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="self-start flex items-center gap-1.5 p-0 border-0 bg-transparent text-accent-ink font-semibold text-[0.82rem] cursor-pointer hover:text-accent"
      >
        <span aria-hidden="true" className="text-[0.7rem]">
          {open ? '▾' : '▸'}
        </span>
        Add an element
      </button>

      {open &&
        PALETTE_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-muted">
              {group.label}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {group.items.map((item) => {
                const el = elementFor(item);
                const resolved = resolveElementStyle(el, theme);
                const appearance: PreviewAppearance = resolved;
                const placed = countPlaced(elements, item);
                const name = nameOf(item);
                const glyphStyle: CSSProperties = {
                  color: resolved.color,
                  filter: previewGlowFilter(appearance),
                };
                return (
                  <button
                    key={item.kind === 'telemetry-field' ? item.field : item.kind}
                    type="button"
                    onClick={() => onAdd(elementFor(item))}
                    title={
                      placed
                        ? `Add another ${name} (${placed} already on the frame)`
                        : `Add ${name}`
                    }
                    className="flex flex-col gap-1 p-1.5 rounded-paper border border-line bg-paper cursor-pointer text-left transition-colors hover:border-accent"
                  >
                    <span className="flex items-center gap-1 w-full min-w-0">
                      <span className="flex-1 min-w-0 truncate font-mono text-[0.53rem] uppercase tracking-[0.08em] text-muted leading-none">
                        {name}
                      </span>
                      {placed > 0 && (
                        <span
                          className="flex-none font-mono text-[0.53rem] text-accent leading-none"
                          aria-label={`${placed} already placed`}
                        >
                          {placed > 1 ? placed : '•'}
                        </span>
                      )}
                    </span>
                    <span
                      className="h-[2rem] w-full grid place-items-center rounded-[3px] bg-[#141210] overflow-hidden px-1"
                      // A long readout ("TIME 2026-05-30 05:49:34") cannot fit
                      // a third of 340px; fading the edges says "there is more"
                      // instead of chopping a glyph in half.
                      style={{ maskImage: STAGE_FADE, WebkitMaskImage: STAGE_FADE }}
                    >
                      {item.kind === 'heading-arrow' ? (
                        <ArrowGlyph style={glyphStyle} />
                      ) : item.kind === 'heading-tape' ? (
                        <TapeGlyph
                          style={glyphStyle}
                          sight={el.tapeReticleColor ?? resolved.color}
                        />
                      ) : item.kind === 'battery' ? (
                        <BatteryGlyph style={glyphStyle} />
                      ) : item.kind === 'frame-corners' ? (
                        <CornersGlyph style={glyphStyle} />
                      ) : (
                        <span
                          className="whitespace-nowrap leading-none"
                          style={previewTextStyle(appearance, '0.62rem')}
                        >
                          {previewText(item, el, cue, timeShift)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
