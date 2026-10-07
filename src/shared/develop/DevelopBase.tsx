import { useCallback, useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from '../ui/OverflowMenu';
import InfoDot from '../ui/InfoDot';
import Segmented from '../ui/Segmented';
import { formatBytes } from '../lib/format';
import { isClipName } from '../library/assets';
import type { Rendition, RenditionRole } from '../media/renditions';
import { BASE_LABELS, baseRung, signed, type DevelopBase } from './develop';
import { BASE_CURVE_ADDS, BASE_CURVE_LABELS, type BaseCurve, type BaseCurveKind } from './base-curve';
import { CHOICE_WORDS, type RollChoice } from './roll-choice';
import { fullPixels, groupRenditions, rowFigures } from './base-menu';

export type { DevelopBase } from './develop';

/**
 * What each rung ADDS to the one below — the whole point of a ladder, and the
 * line a person reads before climbing it.
 */
export const BASE_ADDS: Readonly<Record<DevelopBase, string>> = Object.freeze({
  proxy: 'the 8-bit picture every browser decodes — the render your camera wrote, or your source’s proxy. It clips at white.',
  gain: 'the sensor’s own data at sixteen bits, metered by its brightest tone. A real white balance, and the highlights above white are there to bring back.',
  gainMap: 'and the shading grid the body was calibrated for — up to 2.5 stops at the corners on a DJI, a different figure per channel.',
  gainMapWarp: 'and the rectilinear warp beside it: the magnification and the lateral colour fringe the same file states.',
});

/**
 * What a CLIP's proxy is (2026-09-30): a small re-encode a source made to
 * play, where the rush is the file itself. The develop and the look act on
 * whichever is on the stage, and the export takes the rush by itself where
 * the frame asks for it.
 */
const CLIP_PROXY_ADDS =
  'your source’s proxy of the clip — small and quick to play. The rush is the row under it: fetched once when chosen, held for this session, and what the export delivers from where the frame asks.';

/** What the roll's choice does to a picture with none of its own, under each word. */
const ROLL_ADDS: Readonly<Record<'proxy' | RollChoice, string>> = Object.freeze({
  proxy: 'each where it opens — quick, as every roll did until now',
  delivered: 'the camera’s own file — its JPEG, or the render inside its RAW — wherever it beats the proxy',
  sensor: 'developed from its RAW where it has one, its exposure metered on itself; numbers set on a render stay there',
});

/** The roll's choice of file, at the foot of the list — `DevelopBaseMenu`'s `roll`. */
export interface RollChoiceMenu {
  choice: RollChoice | null;
  onChoice: (choice: RollChoice | null) => void;
  /** This picture has no choice of its own and takes the roll's. */
  follows: boolean;
  /** Why the roll's choice did not land on this picture, where it follows; null when it did. */
  reason: string | null;
  /** How many pictures the roll holds, for the scope switch's word. */
  count?: number;
}

/** What a delivered row IS, in the words under its name once it is open. */
function describeDelivered(row: Rendition): string {
  if (row.blocked) return row.blocked;
  if (isClipName(row.name)) return 'the clip as recorded, every frame at its own size';
  if (row.reach === 'embedded') return 'the 8-bit render your camera wrote inside the RAW';
  return 'the file itself, 8-bit, drawn as it is';
}

/** The group's word, above its rows. */
const GROUP_WORDS: Readonly<Record<RenditionRole, string>> = Object.freeze({
  proxy: 'Quick',
  delivered: 'The camera’s file',
  sensor: 'The sensor',
});

/** A rung's word on the segmented control under the sensor — short, the full name in its tooltip. */
const RUNG_WORDS: Readonly<Record<DevelopBase, string>> = Object.freeze({
  proxy: 'Proxy',
  gain: 'Gain',
  gainMap: 'Gain map',
  gainMapWarp: '+ Warp',
});

/** The curves the menu offers, in its order — a word each, the full name in the tooltip. */
const CURVE_CHOICES: readonly { kind: BaseCurveKind; word: string }[] = [
  { kind: 'standard', word: 'Standard' },
  { kind: 'contrast', word: 'Contrast' },
  { kind: 'shadows', word: 'Shadows' },
  { kind: 'linear', word: 'Linear' },
];

/**
 * One row of the menu: a radio, the title, its megapixels in the right-hand
 * column, one line of facts under them, and — on the open row only — the
 * sentence saying what it is. A row that cannot be chosen says why and is
 * `aria-disabled`, never `disabled` (`frontend.md`, press feedback).
 */
function Choice({
  on,
  title,
  figure,
  facts,
  sentence,
  hint,
  blocked = false,
  onPick,
}: {
  on: boolean;
  title: string;
  figure: string | null;
  facts: ReactNode;
  sentence?: string | null;
  hint?: string;
  blocked?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={blocked || undefined}
      title={hint}
      onClick={() => {
        if (!blocked) onPick();
      }}
      className={`w-full grid grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-2.5 py-2 rounded-[8px] border-0 bg-transparent text-left ${
        blocked ? 'opacity-45 cursor-default' : 'cursor-pointer hover:bg-paper-2 data-pressed:bg-paper-2'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-3.5 h-3.5 rounded-full justify-self-center ${on ? 'border-[4.5px] border-accent' : 'border-[1.5px] border-line-strong'}`}
      />
      <span className="min-w-0 truncate font-sans text-sm font-medium text-ink">{title}</span>
      <span className="font-mono text-2xs tabular-nums text-ink-soft text-right">{figure}</span>
      <span className="col-start-2 col-span-2 min-w-0 font-mono text-3xs leading-relaxed text-muted">{facts}</span>
      {sentence && <span className="col-start-2 col-span-2 min-w-0 text-xs leading-snug text-ink-soft">{sentence}</span>}
    </button>
  );
}

/** `8064 × 4536 · 8-bit · 8.4× short · ↓ 72 MB · the roll’s`, the shortfall and the cost marked. */
function Facts({ parts, short, cost }: { parts: readonly (string | null)[]; short?: string | null; cost?: string | null }) {
  const plain = parts.filter(Boolean) as string[];
  const all: ReactNode[] = plain.map((p) => <span key={p}>{p}</span>);
  if (short) all.push(<span key="short" className="text-warn">{short}</span>);
  if (cost) all.push(<span key="cost" className="text-accent-ink">↓ {cost}</span>);
  return (
    <>
      {all.map((node, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {node}
        </span>
      ))}
    </>
  );
}

/**
 * THE CAPTURE'S FILES, under the picture's name (2026-09-21; drawn as GROUPS
 * since 2026-10-06 — face B of the Renditions Drawer lab, his pick, "with the
 * MP number").
 *
 * Three groups — Quick (the source's proxy), the camera's file (a JPEG, a
 * HEIF, the render inside a RAW), the sensor — each row a radio with its
 * megapixels on the right and one line of facts: its size, its bits, how far
 * it falls short of the capture's biggest picture, and what fetching it costs
 * (`↓ 72 MB`). The sentence about what a row IS is said once, on the open
 * row. The calibration rungs are a CONTROL of the sensor (a segmented row
 * under it), not rows of their own: the file and the amount of its
 * calibration are two questions. In a roll a switch at the top answers for
 * THIS picture or the WHOLE roll, with the same rows' roles, replacing the
 * second list the menu used to end on.
 *
 * It hangs off the NAME of the file (2026-09-22, variant B2 of the stage-bar
 * study): the name and the chip answer the same question — which bytes are on
 * screen — so they are one control, at the left of the bar. It costs no pill
 * of its own, which is what lets it be drawn at every width.
 */
export function DevelopBaseMenu({
  name,
  chip,
  rows,
  current,
  base,
  rungs,
  onRendition,
  onBase,
  onRemeter = null,
  status,
  gain,
  baseCurve = null,
  onBaseCurve = null,
  calibration,
  roll = null,
  className = '',
}: {
  /** The open file's name — the trigger's first words, truncated before the chip. */
  name: string;
  /** The fidelity chip's own words, as the name's suffix; null before anything is measured. */
  chip: string | null;
  /** Every rendition of the capture, in the order `renditionsOf` gives them. */
  rows: readonly Rendition[];
  /** The rendition on screen, when the develop is below the sensor. */
  current: string | null;
  /** The rung the develop stands on; `proxy` while a rendition is on screen. */
  base: DevelopBase;
  /** Which rungs the RAW can honestly offer, lowest first (`rungsFor`). */
  rungs: readonly DevelopBase[];
  onRendition: (id: string) => void;
  onBase: (base: DevelopBase) => void;
  /**
   * Meter the sensor's exposure again: the stored gain is dropped and the
   * next decode measures anew. Offered on the sensor once a gain is stored —
   * a develop metered before 2026-09-25 was measured over a decoder that
   * quietly scaled some pictures by their brightest pixel, and may open a
   * touch dark until it is metered again.
   */
  onRemeter?: (() => void) | null;
  /** What is happening to get the chosen bytes on screen — fetching, decoding — or null. */
  status: string | null;
  /** The metered exposure once the sensor is decoded, as `rawGain`; null before. */
  gain: number | null;
  /**
   * The sensor's BASE curve (`base-curve.ts`) as stored — null is Linear —
   * and the verb that sets it; absent outside a host that develops a RAW.
   * Picked while below the sensor, it takes the picture there.
   */
  baseCurve?: BaseCurve | null;
  onBaseCurve?: ((next: BaseCurve) => void) | null;
  /** What the RAW's own calibration asks for, once read; null when it carries none. */
  calibration?: string | null;
  /**
   * The ROLL's choice (`roll-choice.ts`): which file every picture with no
   * choice of its own opens on. The question is this menu's — which bytes —
   * asked once for all of them. Absent outside a roll.
   */
  roll?: RollChoiceMenu | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'picture' | 'roll'>('picture');
  const rootRef = useRef<HTMLSpanElement>(null);
  const anchorRect = useCallback(() => rootRef.current?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => setOpen(false), []);
  const pick = (act: () => void) => {
    setOpen(false);
    act();
  };

  const onSensor = baseRung(base) > 0;
  const ev = gain ? Math.log2(gain) : 0;
  const sensor = rows.find((r) => r.role === 'sensor') ?? null;
  const steps = sensor ? rungs.filter((r) => r !== 'proxy') : [];
  const full = fullPixels(rows);
  const clipped = isClipName(name);
  // The row on screen says when it is there by the roll's choice — only
  // where that choice LANDED: a picture the roll could not move says why in
  // the roll's own list, and its proxy is then where it opens, not the roll's.
  const byRoll = (marked: boolean) => (marked && roll?.follows && roll.choice && !roll.reason ? 'the roll’s' : null);

  // Nothing to choose — one file, no rung, no roll: the name stays TEXT. A
  // chevron over a menu that cannot change anything is an invitation to a
  // dead end.
  const choices =
    rows.filter((r) => r.role !== 'sensor' && !r.blocked).length +
    steps.length +
    (roll ? 3 : 0) +
    (onSensor && gain && onRemeter ? 1 : 0) +
    (steps.length > 0 && onBaseCurve ? CURVE_CHOICES.length : 0);
  const curveKind: BaseCurveKind = baseCurve?.kind ?? 'linear';

  const words = (
    <>
      <span className="min-w-0 truncate font-mono text-xs text-ink-soft group-hover:text-accent-ink">{name}</span>
      {chip && (
        <span className="min-w-0 truncate font-mono text-3xs tracking-[0.12em] uppercase text-faint group-hover:text-accent-ink">
          {chip}
        </span>
      )}
    </>
  );

  if (choices <= 1) {
    return (
      <span className={`min-w-0 flex items-baseline gap-2 ${className}`} title={name}>
        {words}
      </span>
    );
  }

  const fileRow = (row: Rendition) => {
    const marked = !onSensor && row.id === current;
    const figures = rowFigures(row, full);
    const sentence = marked
      ? (status ?? (row.role === 'proxy' ? (clipped || isClipName(row.name) ? CLIP_PROXY_ADDS : BASE_ADDS.proxy) : describeDelivered(row)))
      : null;
    const sub = row.reach === 'embedded' ? 'render inside the RAW' : null;
    return (
      <Choice
        key={row.id}
        on={marked}
        title={row.role === 'proxy' ? 'Proxy' : row.name}
        figure={figures.megapixels}
        blocked={Boolean(row.blocked)}
        hint={row.blocked ?? (row.here ? undefined : 'fetched from its instance once, and held for this session')}
        facts={
          row.blocked ? (
            row.blocked
          ) : (
            <Facts
              parts={[figures.size, sub, figures.depth, byRoll(marked)]}
              short={figures.short}
              cost={!row.here && row.bytes != null ? formatBytes(row.bytes) : null}
            />
          )
        }
        sentence={sentence}
        onPick={() => pick(() => onRendition(row.id))}
      />
    );
  };

  const sensorGroup = sensor && steps.length > 0 && (
    <>
      <Choice
        on={onSensor}
        title={sensor.name}
        figure={rowFigures(sensor, full).megapixels}
        hint={sensor.here ? undefined : 'fetched from its instance once, and held for this session'}
        facts={
          <Facts
            parts={[rowFigures(sensor, full).size, rowFigures(sensor, full).depth, byRoll(onSensor)]}
            cost={!onSensor && !sensor.here && sensor.bytes != null ? formatBytes(sensor.bytes) : null}
          />
        }
        sentence={
          onSensor
            ? gain
              ? `Metered ${ev ? `${signed(ev, 1)} EV` : 'at its white'}.`
              : (status ?? 'Decoding the sensor’s data…')
            : null
        }
        onPick={() => {
          if (!onSensor) pick(() => onBase(steps[0]));
        }}
      />
      {steps.length > 1 && (
        <div className="pl-[2.125rem] pr-2.5 pb-1.5">
          <Segmented<DevelopBase | 'none'>
            size="sm"
            fill
            label="How much of the camera’s calibration"
            value={onSensor ? base : 'none'}
            onChange={(next) => {
              if (next !== 'none') pick(() => onBase(next));
            }}
            options={steps.map((r) => ({ id: r, label: RUNG_WORDS[r], title: `${BASE_LABELS[r]} — ${BASE_ADDS[r]}` }))}
          />
        </div>
      )}
      {onBaseCurve && (
        <div className="pl-[2.125rem] pr-2.5 pb-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">Base curve</span>
            <InfoDot about="the base curve">
              The tone curve the sensor’s light gets before any slider — what a camera puts in its JPEG and a RAW
              decoded linear lacks. Standard, Contrast and Shadows are curves made here, not Capture One’s; Linear is
              the sensor as it is. It acts only on the sensor, on brightness alone, so no colour turns.
            </InfoDot>
          </div>
          <Segmented<BaseCurveKind>
            size="sm"
            columns={CURVE_CHOICES.length}
            label="The sensor’s base curve"
            value={curveKind}
            onChange={(next) =>
              pick(() => {
                if (!onSensor) onBase(steps[0]);
                onBaseCurve({ kind: next });
              })
            }
            options={CURVE_CHOICES.map((c) => ({ id: c.kind, label: c.word, title: `${BASE_CURVE_LABELS[c.kind]} — ${BASE_CURVE_ADDS[c.kind]}` }))}
          />
          {onSensor && <span className="font-mono text-3xs leading-relaxed text-muted">{BASE_CURVE_ADDS[curveKind]}</span>}
        </div>
      )}
      {onSensor && gain && onRemeter && (
        <button
          type="button"
          onClick={() => pick(onRemeter)}
          title="measures the sensor’s exposure anew and stores the number — for a picture metered by an earlier decoder, or one that opens a touch dark"
          className="self-start ml-[2.125rem] mb-1 px-0 py-1 border-0 bg-transparent font-mono text-3xs text-muted underline underline-offset-2 decoration-line-strong cursor-pointer hover:text-accent-ink"
        >
          Meter the exposure again
        </button>
      )}
    </>
  );

  const groups = groupRenditions(rows);
  const pictureScope = groups.map((group, i) => {
    if (group.role === 'sensor' && !sensorGroup) return null;
    return (
      <div key={group.role} role="radiogroup" aria-label={GROUP_WORDS[group.role]} className={`flex flex-col ${i > 0 ? 'mt-1 pt-1 border-t border-line' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-1.5 px-2.5 pt-1.5 pb-0.5">
          <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">{GROUP_WORDS[group.role]}</span>
          {group.role === 'sensor' && calibration && <InfoDot about="the camera’s calibration">This file asks for {calibration}.</InfoDot>}
        </div>
        {group.role === 'sensor' ? sensorGroup : group.rows.map(fileRow)}
      </div>
    );
  });

  const rollScope = roll && (
    <div role="radiogroup" aria-label="The whole roll opens on" className="flex flex-col">
      {(['proxy', 'delivered', 'sensor'] as const).map((role) => {
        const value = role === 'proxy' ? null : role;
        const marked = roll.choice === value;
        // Where the roll's choice did not land on THIS picture, its row says why.
        const line = marked && roll.follows && roll.reason ? `not this picture: ${roll.reason}` : ROLL_ADDS[role];
        return (
          <Choice
            key={role}
            on={marked}
            title={CHOICE_WORDS[role]}
            figure={null}
            facts={line}
            onPick={() => pick(() => roll.onChoice(value))}
          />
        );
      })}
      <p className="m-0 px-2.5 pt-1 pb-1.5 font-mono text-3xs text-muted">A picture you set yourself keeps its file.</p>
    </div>
  );

  return (
    <span ref={rootRef} className={`min-w-0 inline-flex ${className}`}>
      <button
        type="button"
        title={name}
        aria-label="What this picture is developed from"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) setScope('picture');
          setOpen((o) => !o);
        }}
        className="group min-w-0 flex items-baseline gap-2 p-0 border-0 bg-transparent text-left cursor-pointer"
      >
        {words}
        <span className="flex-none font-mono text-3xs text-faint group-hover:text-accent-ink" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <AnchoredPopover
          anchorRect={anchorRect}
          onClose={close}
          align="start"
          within={rootRef}
          role="dialog"
          label="What this picture is developed from"
          className="w-[22rem] max-w-[calc(100vw-1rem)] p-1.5"
        >
          {roll && (
            <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-2 mb-1 border-b border-line">
              <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">Developed from</span>
              <Segmented<'picture' | 'roll'>
                size="sm"
                label="For this picture or the whole roll"
                value={scope}
                onChange={setScope}
                options={[
                  { id: 'picture', label: 'This picture' },
                  { id: 'roll', label: roll.count ? `Whole roll · ${roll.count}` : 'Whole roll' },
                ]}
              />
            </div>
          )}
          {scope === 'roll' && roll ? rollScope : pictureScope}
        </AnchoredPopover>
      )}
    </span>
  );
}
