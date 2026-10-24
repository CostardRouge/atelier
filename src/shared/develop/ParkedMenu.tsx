import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnchoredMenu, type OverflowItem } from '../ui/OverflowMenu';
import type { AnchorRect } from '../ui/menu-anchor';
import type { DevelopSettings } from './develop';
import { applyParkedVerb, parkedMenu, restoreParked, type ParkTarget, type ParkedStep } from './parked';

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

  const value = useMemo(() => ({ develop, write, steps, back, open }), [develop, write, steps, back, open]);
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

/** The steps back and their verb, for the pill (P4). */
export function useParkedSteps(): Pick<ParkedControlsValue, 'steps' | 'back'> | null {
  const ctx = useContext(ParkedControls);
  return ctx ? { steps: ctx.steps, back: ctx.back } : null;
}

/** A point as the rect a menu hangs from — a right-click's. */
export function pointRect(x: number, y: number): AnchorRect {
  return { left: x, right: x, top: y, bottom: y };
}
