import type { ReactNode } from 'react';
import { InspectorSection } from '../ui/Inspector';
import { Icons } from '../ui/icons';
import type { FoldSwitch } from './parked';

/**
 * A section of the Develop inspector — the suite's one foldable section
 * (`InspectorSection`, Trips' and the Studio's), with the Develop rules
 * (2026-09-23, the maintainer's ask once the Adjust tab had grown past a
 * dozen blocks):
 *
 * - **Folded or not is remembered for the SESSION**, never on the roll: it
 *   survives stepping from one picture to the next and a reload, and a new
 *   tab starts from the defaults. One id per block, so the Develop tool and
 *   the Trips / Studio sheet share it.
 * - **A folded section never hides an edit**: `marked` puts the accent dot
 *   after its title whenever something in it departs from as shot.
 * - What is folded by default is what a pass over a picture reaches for
 *   LAST — levels, the curve, the mixer, the wheels —; the light, the tone,
 *   the colour, presence and the look stay open.
 * - **A fold that holds work can be switched OFF** (`switched`, his pick of
 *   2026-10-24, `docs/slider-peek.md` §7): an eye takes the dot's place, a
 *   tap parks everything set in it (`parked.ts`), and the export follows.
 *   A fold of sliders greys bar by bar; a fold of one block (`dimOff`) fades
 *   its whole body.
 */
export default function DevelopFold({
  id,
  title,
  info,
  marked = false,
  defaultOpen = true,
  foldable = true,
  actions,
  switched,
  dimOff = false,
  children,
}: {
  id: string;
  title: string;
  info?: ReactNode;
  marked?: boolean;
  defaultOpen?: boolean;
  foldable?: boolean;
  actions?: ReactNode;
  /** The fold's on/off switch, drawn while something in it is set. */
  switched?: FoldSwitch;
  /** Fade the whole body while switched off — a fold that is ONE block (the curve, the wheels). */
  dimOff?: boolean;
  children: ReactNode;
}) {
  const off = switched?.state === 'off';
  return (
    <InspectorSection
      id={`develop.${id}`}
      title={title}
      info={info}
      marked={marked}
      mark={switched && <FoldEye title={title} switched={switched} />}
      dimmed={dimOff && off}
      defaultOpen={defaultOpen}
      foldable={foldable}
      remember="session"
      actions={actions}
    >
      {children}
    </InspectorSection>
  );
}

/**
 * The fold's eye: open while what it holds is applied (all of it, or some
 * — `mixed` reads open, and a tap switches all of it off), crossed out while
 * it waits switched off. The accent says the fold is set, as the dot did.
 */
function FoldEye({ title, switched }: { title: string; switched: FoldSwitch }) {
  const off = switched.state === 'off';
  const verb = off ? `Show ${title}` : switched.state === 'mixed' ? `Hide all of ${title}` : `Hide ${title}`;
  return (
    <button
      type="button"
      aria-pressed={!off}
      aria-label={verb}
      title={verb}
      onClick={switched.onSwitch}
      className={`touch-halo relative flex-none inline-grid place-items-center w-6 h-6 rounded-[6px] cursor-pointer hover:bg-accent-wash [&>svg]:w-3.5 [&>svg]:h-3.5 ${
        off ? 'text-muted' : switched.state === 'mixed' ? 'text-accent-ink/60' : 'text-accent-ink'
      }`}
    >
      {off ? Icons.eyeOff : Icons.eye}
    </button>
  );
}
