import type { ReactNode } from 'react';
import { InspectorSection } from '../ui/Inspector';

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
 */
export default function DevelopFold({
  id,
  title,
  info,
  marked = false,
  defaultOpen = true,
  foldable = true,
  actions,
  children,
}: {
  id: string;
  title: string;
  info?: ReactNode;
  marked?: boolean;
  defaultOpen?: boolean;
  foldable?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <InspectorSection
      id={`develop.${id}`}
      title={title}
      info={info}
      marked={marked}
      defaultOpen={defaultOpen}
      foldable={foldable}
      remember="session"
      actions={actions}
    >
      {children}
    </InspectorSection>
  );
}
