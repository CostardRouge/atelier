/**
 * The line a gallery prints for a connected instance it draws no group for.
 *
 * An instance whose bucket does not keep this kind of document is left out of
 * the gallery on purpose (`document-gallery.ts`), and until 2026-09-21 it was
 * left out in silence — which is how a roll kept on a Winnow could exist on
 * one machine and be invisible on another with no sign that anything was
 * missing. The sheet is re-asked first (`winnow/refresh-capabilities.ts`); this
 * draws only what survives that, so the sentence is never a guess about a
 * stale answer.
 *
 * One component for the three galleries, like every other thing they share.
 */

import type { AbsentSource } from './document-gallery';

export default function AbsentSourceNotes({ absent }: { absent: readonly AbsentSource[] }) {
  const said = absent.filter((a) => a.text !== null);
  if (said.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 pb-2">
      {said.map((a) => (
        <p key={a.sourceId} className="m-0 text-xs text-faint">
          {a.text}
        </p>
      ))}
    </div>
  );
}
