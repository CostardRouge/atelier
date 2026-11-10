import { useState } from 'react';
import type { RecapPage } from '../../shared/recap/recap-layout';
import { withMovedFlow } from '../../shared/recap/recap-selection';
import type { ResolvedRecap } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { InspectorSection } from '../../shared/ui/Inspector';
import PictureThumb from './PictureThumb';
import type { Change } from './RecapPanels';

/**
 * The pictures of the carousel slide on the stage (lab 17, part II): where
 * the calendar's tray stands when the stage shows a highlight, so the tab
 * says what the slide holds. A click holds a picture — the card and the day
 * chooser under it work for that one; a drag puts one before another.
 */
export default function SlideTray({
  page,
  index,
  resolved,
  held,
  onHold,
  change,
  thumbs,
}: {
  page: RecapPage;
  /** Its place in the layout, 0-based. */
  index: number;
  resolved: ResolvedRecap;
  held: string | null;
  onHold: (slot: string) => void;
  change: Change;
  thumbs: { client: WinnowClient | null; instance: string | null; files: ReadonlyMap<string, File> };
}) {
  const byId = new Map(resolved.slots.map((s) => [s.id, s]));
  const cells = page.parts.flatMap((p) => (p.kind === 'cell' && byId.get(p.id)?.picture ? [byId.get(p.id)!] : []));
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <InspectorSection id="recap-slide-tray" title={`Slide ${index + 1}`} summary={`${cells.length} picture${cells.length === 1 ? '' : 's'}`}>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-2xs text-muted">Click one to choose for it · drag one before another</span>
        <div role="list" aria-label={`The pictures of slide ${index + 1}`} className="grid grid-cols-6 gap-1.5">
          {cells.map((s) => {
            const pic = s.picture!;
            return (
              <button
                key={s.id}
                type="button"
                role="listitem"
                draggable
                aria-pressed={held === s.id}
                aria-label={`Hold ${pic.name}`}
                title={`${pic.name} — click to choose for it, drag it before another`}
                onClick={() => onHold(s.id)}
                onDragStart={(e) => {
                  setDragged(pic.key);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragged || dragged === pic.key) return;
                  e.preventDefault();
                  setOver(pic.key);
                }}
                onDragLeave={() => setOver((o) => (o === pic.key ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const k = dragged;
                  setDragged(null);
                  setOver(null);
                  if (k && k !== pic.key) change((d) => withMovedFlow(d, resolved, k, pic.key));
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
                className={`relative aspect-square rounded-[5px] overflow-hidden bg-frame p-0 border-0 cursor-pointer ${held === s.id ? 'outline outline-2 outline-accent outline-offset-1' : 'hover:opacity-85'} ${dragged === pic.key ? 'opacity-35' : ''}`}
              >
                <PictureThumb pic={pic} client={thumbs.client} instance={thumbs.instance} file={thumbs.files.get(pic.key) ?? null} className="w-full h-full" />
                {pic.day && <span className="absolute left-0.5 top-0.5 px-1 rounded-[3px] bg-[rgba(16,15,13,0.6)] text-on-media font-mono text-3xs tabular-nums pointer-events-none">{Number(pic.day.slice(8))}</span>}
                {over === pic.key && <span aria-hidden="true" className="absolute top-0 bottom-0 left-0 w-1 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-surface)]" />}
              </button>
            );
          })}
        </div>
      </div>
    </InspectorSection>
  );
}
