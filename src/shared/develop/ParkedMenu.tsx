import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnchoredMenu, type OverflowItem } from '../ui/OverflowMenu';
import type { AnchorRect } from '../ui/menu-anchor';
import {
  applyParkedVerb,
  hiddenChips,
  invertParked,
  parkedKeys,
  parkedMenu,
  restoreParked,
  stepStands,
  unpark,
  unparkAll,
  type ParkTarget,
  type ParkedStep,
} from './parked';
import type { DevelopSettings, ParkableKey } from './develop';

/**
 * The menu of a slider or a fold — Reset · Hide · Show only · Invert
 * (`docs/slider-peek.md` §6–§7, P3) — and the way back a Show only keeps.
 *
 * ONE provider per open develop (the Develop tool's picture, the Trips /
 * Studio sheet): it holds the steps back in memory for the visit — a picture
 * opened anew starts with none, as its workbench is keyed on it — and draws
 * the one menu, portalled, wherever a control asked for it. A control reads
 * `useParkedMenu` and gets an opener, or nothing outside a provider (a
 * layer's sliders, until P5): no menu is better than one writing elsewhere.
 */

interface ParkedControlsValue {
  develop: DevelopSettings;
  write: (next: DevelopSettings) => void;
  steps: readonly ParkedStep[];
  /** Carry out one step back — what the pill's ↩ presses (P4). */
  back: () => void;
  open: (target: ParkTarget, rect: AnchorRect) => void;
  /** The pill's verbs: one chip back on, everything swapped, everything on. */
  show: (keys: readonly ParkableKey[]) => void;
  invert: () => void;
  showAll: () => void;
}

const ParkedControls = createContext<ParkedControlsValue | null>(null);

export function ParkedProvider({
  develop,
  write,
  children,
}: {
  develop: DevelopSettings;
  /** Writes the WHOLE develop — the draft's `replace`. */
  write: (next: DevelopSettings) => void;
  children: ReactNode;
}) {
  const [steps, setSteps] = useState<ParkedStep[]>([]);
  const [menu, setMenu] = useState<{ target: ParkTarget; rect: AnchorRect } | null>(null);
  const top = steps[steps.length - 1];

  const run = useCallback(
    (target: ParkTarget, verb: Parameters<typeof applyParkedVerb>[2]) => {
      const out = applyParkedVerb(develop, target, verb, top);
      write(out.next);
      if (out.push) setSteps((s) => [...s, out.push!]);
      if (out.pop) setSteps((s) => s.slice(0, -1));
    },
    [develop, write, top],
  );
  const back = useCallback(() => {
    if (!top) return;
    write(restoreParked(develop, top.prior));
    setSteps((s) => s.slice(0, -1));
  }, [develop, write, top]);
  const open = useCallback((target: ParkTarget, rect: AnchorRect) => setMenu({ target, rect }), []);
  const close = useCallback(() => setMenu(null), []);
  const show = useCallback((keys: readonly ParkableKey[]) => write(unpark(develop, keys)), [develop, write]);
  const invert = useCallback(() => {
    const next = invertParked(develop);
    write(next);
    setSteps((s) => [...s, { label: 'Invert', target: null, prior: parkedKeys(develop), made: parkedKeys(next) }]);
  }, [develop, write]);
  // Everything on again: no way back is left to take.
  const showAll = useCallback(() => {
    write(unparkAll(develop));
    setSteps([]);
  }, [develop, write]);

  const value = useMemo(
    () => ({ develop, write, steps, back, open, show, invert, showAll }),
    [develop, write, steps, back, open, show, invert, showAll],
  );
  const items: OverflowItem[] = menu
    ? parkedMenu(develop, menu.target, top).map((it) => ({
        id: it.verb,
        label: it.label,
        disabled: it.disabled,
        rule: it.verb === 'invert',
        onSelect: () => run(menu.target, it.verb),
      }))
    : [];

  return (
    <ParkedControls.Provider value={value}>
      {children}
      {menu && (
        <AnchoredMenu
          anchorRect={() => menu.rect}
          items={items}
          onClose={close}
          align="start"
          label={`Actions for ${menu.target.name}`}
        />
      )}
    </ParkedControls.Provider>
  );
}

/** The opener of `target`'s menu, or undefined outside a provider or for no target. */
export function useParkedMenu(target: ParkTarget | null): ((rect: AnchorRect) => void) | undefined {
  const ctx = useContext(ParkedControls);
  const open = ctx?.open;
  return target && open ? (rect: AnchorRect) => open(target, rect) : undefined;
}

/** The provider's opener, for a column that builds many targets — undefined outside one. */
export function useParkedOpener(): ParkedControlsValue['open'] | undefined {
  return useContext(ParkedControls)?.open;
}

/**
 * The PILL over the picture (`docs/slider-peek.md` §6, P4): drawn only while
 * something is switched off — the edit the export follows is never out of
 * sight. One chip per thing off (a fold whose every set slider is off is ONE
 * chip, `hiddenChips`), a tap bringing it back; ↩ while the last Show only or
 * Invert still stands; ⇄ Invert; Show all. Nothing outside a provider.
 */
export function ParkedPill() {
  const ctx = useContext(ParkedControls);
  if (!ctx) return null;
  const chips = hiddenChips(ctx.develop);
  if (chips.length === 0) return null;
  const top = ctx.steps[ctx.steps.length - 1];
  const stands = stepStands(ctx.develop, top);
  const head = stands && top!.target ? top!.label : `${chips.length} hidden`;
  const verb =
    'inline-flex items-center gap-1 h-6 pointer-coarse:h-8 px-2 rounded-full text-xs cursor-pointer whitespace-nowrap touch-row relative';
  return (
    <div
      role="group"
      aria-label="Settings switched off"
      // Its own presses: never the stage's drag, swipe or hold.
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto flex flex-wrap items-center gap-1 p-1 rounded-[14px] bg-surface/92 backdrop-blur-sm border border-line-strong shadow-paper"
    >
      <span className="font-mono text-2xs text-muted px-1.5 whitespace-nowrap">{head}</span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => ctx.show(c.keys)}
          aria-label={`Show ${c.label} again`}
          title={`Show ${c.label} again`}
          className={`${verb} border border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink ${c.group ? 'font-semibold' : ''}`}
        >
          {c.label}
          <span aria-hidden="true" className="text-muted">
            ×
          </span>
        </button>
      ))}
      {stands && (
        <button
          type="button"
          onClick={ctx.back}
          aria-label={`Back to before “${top!.label}”`}
          title={`Back to before “${top!.label}”`}
          className={`${verb} border border-line-strong text-ink-soft hover:border-accent hover:text-accent-ink`}
        >
          ↩
        </button>
      )}
      <button
        type="button"
        onClick={ctx.invert}
        title="Show what is hidden, hide what is shown"
        className={`${verb} border border-line-strong text-ink-soft hover:border-accent hover:text-accent-ink`}
      >
        ⇄ Invert
      </button>
      <button type="button" onClick={ctx.showAll} className={`${verb} bg-accent-wash text-accent-ink hover:brightness-95`}>
        Show all
      </button>
    </div>
  );
}

/** A point as the rect a menu hangs from — a right-click's. */
export function pointRect(x: number, y: number): AnchorRect {
  return { left: x, right: x, top: y, bottom: y };
}
