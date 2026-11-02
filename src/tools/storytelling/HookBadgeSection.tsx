import { useEffect, useState } from 'react';
import StylePanel from '../../shared/overlay/StylePanel';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { defaultHookCascade, HOOK_COMPOSITIONS, HOOK_PIECES, HOOK_SIZE_MAX, HOOK_SIZE_MIN, hookBadgeOf, hookLayoutOf, hookThemeOf, type HookBadge, type HookComposition, type HookLong, type HookPieceKey } from '../../shared/story/hook-badge';
import { withLook } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import { SelectField, SliderRow, SwitchRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { ANCHORS, type Anchor } from '../../shared/overlay/overlay-types';
import { PAL } from '../../shared/story/charte';
import ShadesPanel from '../../shared/shades/ShadesPanel';
import type { BadgeCascade } from '../../shared/roadtrip/badge-layout';
import type { AnimStep } from '../../shared/overlay/animation';
import { CURVES, EASING_IDS, type EasingId } from '../../shared/motion/easing';
import { newStaggerSeed, STAGGER_ORDERS, type StaggerOrder } from '../../shared/overlay/stagger';
import Button from '../../shared/ui/Button';

/**
 * The hook's look for the whole series (hook lab B3–B4, his picks): Trips'
 * badge — the very title-style panel Trips' Look tab shows (Or ciné, Pixel
 * CRT, Rouge plein cadre, Neutral, every dial, Export / Import of the
 * `.badge.json` the three tools share), or the charte's colours; where it sits
 * (the stack, the centre, top and bottom, a band); how big; which pieces show;
 * a trip's own badge taken as it is. « As before » keeps the typed lines and
 * the sticker.
 */
export default function HookBadgeSection({ script, onScript }: { script: StoryScript; onScript: (s: StoryScript) => void }) {
  const raw = script.look?.hook;
  const b = hookBadgeOf(raw);
  const write = (patch: Partial<HookBadge>) => {
    const next: HookBadge = { ...(raw ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof HookBadge)[]) if (next[k] === undefined) delete next[k];
    onScript(withLook(script, { hook: next }));
  };
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../../shared/roadtrip/trip-store').then((m) => m.listTrips()).then((all) => alive && setTrips(all.filter((t) => t.theme)));
    return () => {
      alive = false;
    };
  }, []);
  const takeTrip = (id: string) => {
    const trip = trips?.find((t) => t.id === id);
    if (!trip?.theme) return;
    const kinds = Object.values(trip.hookDefaults ?? {});
    const styles = kinds.find((d) => d && Object.keys(d.pieceStyles ?? {}).length)?.pieceStyles;
    write({ theme: structuredClone(trip.theme), look: undefined, ...(styles ? { styles: structuredClone(styles) } : {}) });
  };
  const charte = b.look === 'charte' && !b.theme;
  return (
    <div className="flex flex-col gap-2.5">
      <Segmented<'badge' | 'classic'>
        options={[
          { id: 'badge', label: 'Badge' },
          { id: 'classic', label: 'As before', title: 'The typed lines and the sticker' },
        ]}
        value={b.mode}
        onChange={(mode) => write({ mode: mode === 'badge' ? undefined : mode })}
        size="sm"
        fill
        label="How the hook is drawn"
      />
      {b.mode === 'badge' ? (
        <>
          <StylePanel
            theme={charte ? null : hookThemeOf(raw)}
            onChange={(theme) => write({ theme: theme ?? undefined, look: theme ? undefined : 'neutral' })}
            heading={<span className="text-xs text-muted">Title style · Trips’ own</span>}
            pieceStyles={b.styles}
            onPieceStyles={(styles) => write({ styles })}
          />
          <button
            type="button"
            aria-pressed={charte}
            onClick={() => write({ look: 'charte', theme: undefined })}
            className={`min-h-9 rounded-control border px-3 text-left text-xs cursor-pointer ${charte ? 'border-ink' : 'border-line'}`}
            style={{ background: PAL.bg }}
          >
            The charte — the series’ colours, the second line on the accent
          </button>
          {trips?.length ? (
            <SelectField<string>
              label="Take a trip's badge style"
              value=""
              options={[{ id: '', label: 'Use a trip’s badge…' }, ...trips.map((t) => ({ id: t.id, label: t.name || 'Untitled trip' }))]}
              onChange={takeTrip}
            />
          ) : null}
          <Segmented<HookComposition>
            options={HOOK_COMPOSITIONS.map((c) => ({ id: c.id, label: c.label }))}
            value={b.composition}
            onChange={(composition) => write({ composition, anchor: undefined, x: undefined, y: undefined })}
            size="sm"
            fill
            label="Where the badge sits"
          />
          <AnchorGrid value={hookLayoutOf(b).anchor} onChange={(anchor) => write({ anchor, x: undefined, y: undefined })} />
          <p className="m-0 text-2xs text-muted leading-snug">The grid places the badge{b.composition === 'split' ? '’s title (the card stays at the foot)' : ''}; drag any of its pieces on the stage to move it whole.</p>
          <SliderRow
            label="Numeral"
            value={Math.round(b.size * 1000) / 10}
            min={HOOK_SIZE_MIN * 100}
            max={HOOK_SIZE_MAX * 100}
            step={0.5}
            reset={10}
            format={(v) => `${v} %`}
            onChange={(v) => write({ size: v / 100 })}
          />
          <p className="m-0 text-2xs text-muted leading-snug">The big text&apos;s size, a share of the frame&apos;s width: every other piece keeps its ratio to it, so the whole badge grows at once.</p>
          <SliderRow label="Column" value={Math.round(b.column * 100)} min={30} max={95} step={1} reset={86} format={(v) => `${v} %`} onChange={(v) => write({ column: v === 86 ? undefined : v / 100 })} />
          <Segmented<HookLong>
            options={[
              { id: 'wrap', label: 'Wrap', title: 'Broken at words inside the column; past three lines it shrinks' },
              { id: 'fit', label: 'Shrink to fit', title: 'Kept on one line, shrunk to the column' },
            ]}
            value={b.long}
            onChange={(long) => write({ long: long === 'wrap' ? undefined : long })}
            size="sm"
            fill
            label="A big text longer than the column"
          />
          <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Shades</p>
          <ShadesPanel shades={[...(b.shades ?? [])]} onChange={(shades) => write({ shades: shades.length ? shades : undefined })} followBadge anchor={hookLayoutOf(b).anchor} />
          <p className="m-0 text-2xs text-muted leading-snug">Trips&apos; shades: one that follows the badge&apos;s edge lands its reach on the block, one that follows its anchor sits in the badge&apos;s cell and moves with it. The veil a post sets under Hook still darkens the whole picture; set it to 0 to keep the shades alone.</p>
          <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Cascade</p>
          <CascadeRows cascade={b.cascade} keepEntry={b.keepEntry} onCascade={(cascade) => write({ cascade })} onKeep={(keepEntry) => write({ keepEntry: keepEntry ? undefined : false })} />
          <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Pieces</p>
          <div className="flex flex-col gap-1">
            {HOOK_PIECES.map((p) => (
              <SwitchRow key={p.id} label={p.label} checked={b.pieces[p.id]} onChange={(on) => write({ pieces: { ...(raw?.pieces ?? {}), [p.id]: on } as Partial<Record<HookPieceKey, boolean>> })} />
            ))}
          </div>
          <p className="m-0 text-2xs text-muted leading-snug">The big text and the second line are each post’s hook; the header, the place and why now come from the series, the camera from the post. Each post can write its own under Hook.</p>
        </>
      ) : null}
    </div>
  );
}

/** The nine anchors as the 3×3 grid Trips places its badge on. */
export function AnchorGrid({ value, onChange }: { value: Anchor; onChange: (a: Anchor) => void }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm text-ink-soft w-16 pt-1">Anchor</span>
      <div className="grid grid-cols-3 gap-1.5 w-[6.5rem]" role="group" aria-label="Anchor">
        {ANCHORS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            aria-label={a}
            aria-pressed={a === value}
            className={`h-7 rounded-[6px] border cursor-pointer transition-colors ${a === value ? 'border-accent bg-accent' : 'border-line-strong bg-paper hover:border-muted'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** The cascade's entrances: at once, blinking, or Trips' four — each its own step. */
type Entrance = 'cut' | 'flicker' | 'fade' | 'rise' | 'pop' | 'wipe';
const ENTRANCES: { id: Entrance; label: string; title: string }[] = [
  { id: 'cut', label: 'Cut', title: 'Each piece shown at once, on or off, in the order chosen' },
  { id: 'flicker', label: 'Flicker', title: 'Each piece blinks on and off, then stays' },
  { id: 'fade', label: 'Fade', title: 'Each piece fades in' },
  { id: 'rise', label: 'Rise', title: 'Each piece rises into place' },
  { id: 'pop', label: 'Pop', title: 'Each piece grows into place' },
  { id: 'wipe', label: 'Wipe', title: 'Each piece wiped in, left to right' },
];
const entranceOf = (step: AnimStep): Entrance =>
  step.preset === 'none' ? 'cut' : step.preset === 'flicker' ? 'flicker' : step.preset === 'slide' ? 'rise' : step.preset === 'scale' ? 'pop' : step.preset === 'wipe' ? 'wipe' : 'fade';
function stepFor(entrance: Entrance, was: AnimStep): AnimStep {
  const duration = was.preset === 'none' ? 0.5 : was.duration;
  const easing = was.easing;
  switch (entrance) {
    case 'cut':
      return { preset: 'none', duration: 0, easing };
    case 'flicker':
      return { preset: 'flicker', duration, easing };
    case 'rise':
      return { preset: 'slide', duration, easing, direction: 'up', distanceFrac: 0.03 };
    case 'pop':
      return { preset: 'scale', duration, easing, scaleFrom: 0.7 };
    case 'wipe':
      return { preset: 'wipe', duration, easing };
    default:
      return { preset: 'fade', duration, easing };
  }
}

/**
 * Trips' cascade over the hook's pieces (hook lab 2): one entrance for every
 * piece, a rank apart in the order chosen, in the curve chosen — Cut and
 * Flicker his own additions, « tac tac tac ». The two typed lines keep the
 * hook's own entry unless told otherwise.
 */
function CascadeRows({ cascade, keepEntry, onCascade, onKeep }: { cascade: BadgeCascade | null; keepEntry: boolean; onCascade: (c: BadgeCascade | null | undefined) => void; onKeep: (on: boolean) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <SwitchRow label="Cascade the pieces" checked={Boolean(cascade)} onChange={(on) => onCascade(on ? undefined : null)} />
      {cascade ? (
        <>
          <Segmented<Entrance>
            options={ENTRANCES}
            value={entranceOf(cascade.step)}
            onChange={(e) => onCascade({ ...cascade, step: stepFor(e, cascade.step) })}
            size="sm"
            fill
            label="How each piece arrives"
          />
          <SelectField<StaggerOrder>
            label="Cascade order"
            value={cascade.stagger.order}
            options={STAGGER_ORDERS.map((o) => ({ id: o.id, label: `${o.label} — ${o.hint}` }))}
            onChange={(order) => onCascade({ ...cascade, stagger: { ...cascade.stagger, order, ...(order === 'random' && cascade.stagger.seed === undefined ? { seed: newStaggerSeed() } : {}) } })}
          />
          {cascade.stagger.order === 'random' ? (
            <Button size="sm" variant="ghost" onClick={() => onCascade({ ...cascade, stagger: { ...cascade.stagger, seed: newStaggerSeed() } })}>
              Shuffle again
            </Button>
          ) : null}
          <SliderRow label="Each" value={cascade.stagger.each} min={0} max={0.5} step={0.01} reset={0.14} format={(v) => `${v.toFixed(2)} s`} onChange={(each) => onCascade({ ...cascade, stagger: { ...cascade.stagger, each } })} />
          {cascade.step.preset !== 'none' ? (
            <>
              <SliderRow label="Duration" value={cascade.step.duration} min={0.1} max={1.5} step={0.05} reset={0.5} format={(v) => `${v.toFixed(2)} s`} onChange={(duration) => onCascade({ ...cascade, step: { ...cascade.step, duration } })} />
              <SelectField<EasingId>
                label="The curve of each entrance"
                value={cascade.step.easing}
                options={EASING_IDS.map((id) => ({ id, label: `Easing · ${CURVES[id].label}` }))}
                onChange={(easing) => onCascade({ ...cascade, step: { ...cascade.step, easing } })}
              />
            </>
          ) : null}
          <SwitchRow label="Typed lines keep their own entry" checked={keepEntry} onChange={onKeep} />
          <button type="button" className="self-start text-2xs text-muted underline cursor-pointer" onClick={() => onCascade(defaultHookCascade())}>
            Back to the default — Rise, top to bottom
          </button>
        </>
      ) : (
        <p className="m-0 text-2xs text-muted leading-snug">Each piece arrives on its own moment of the hook: the header ahead of the words, the place and why now after them.</p>
      )}
    </div>
  );
}

