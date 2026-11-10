import { useMemo, useState } from 'react';
import type { RecapPicture } from '../../shared/recap/recap-doc';
import type { HookPickedPicture } from '../../shared/roadtrip/hooks/hook-variant';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import PictureThumb from './PictureThumb';

const keyOf = (p: HookPickedPicture) => p.ref.assetId ?? '';

/**
 * Which of the recap's LOCATED pictures an opener stops at — what Trips'
 * panels ask their host for («Choose pictures…»). Trips opens its Library
 * there; a recap's pictures are its own, so this is a grid of them to tick.
 * «As the recap chooses» gives the choice back to the rule (its located
 * pictures, evenly thinned).
 */
export default function OpenerStopsModal({
  located,
  selected,
  auto,
  pictures,
  client,
  instance,
  files,
  onCancel,
  onDone,
}: {
  /** The recap's located pictures inside the trip, in time order. */
  located: readonly HookPickedPicture[];
  selected: readonly HookPickedPicture[];
  /** What the recap would choose by itself. */
  auto: readonly HookPickedPicture[];
  pictures: readonly RecapPicture[];
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
  onCancel: () => void;
  onDone: (picked: HookPickedPicture[]) => void;
}) {
  const [ticked, setTicked] = useState(() => new Set(selected.map(keyOf)));
  const byKey = useMemo(() => new Map(pictures.map((p) => [p.key, p])), [pictures]);
  const done = () => onDone(located.filter((p) => ticked.has(keyOf(p))));
  useDialogKeys({ onCancel, onConfirm: done });
  const toggle = (key: string) =>
    setTicked((old) => {
      const next = new Set(old);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 max-[820px]:p-0 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="The opener's stops"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[40rem] max-h-[min(40rem,calc(var(--app-h,100dvh)-2rem))] max-[820px]:h-[var(--app-h,100dvh)] max-[820px]:max-h-none max-[820px]:max-w-none max-[820px]:rounded-none flex flex-col bg-surface border border-line rounded-paper-lg shadow-paper">
        <header className="flex-none flex items-baseline gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="m-0 flex-1 min-w-0 font-serif text-2xl truncate">The opener's stops</h2>
          <span className="font-mono text-2xs text-muted tabular-nums">
            {ticked.size} of {located.length}
          </span>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
          {located.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2" role="listbox" aria-multiselectable="true" aria-label="Located pictures">
              {located.map((p) => {
                const key = keyOf(p);
                const pic = byKey.get(key);
                const on = ticked.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(key)}
                    title={`${pic?.place ?? pic?.name ?? key} · ${p.date}`}
                    className={`relative aspect-square overflow-hidden rounded-[6px] p-0 border-0 cursor-pointer ${on ? 'outline outline-2 outline-accent' : 'outline outline-1 outline-line opacity-70 hover:opacity-100'}`}
                  >
                    {pic && <PictureThumb pic={pic} client={client} instance={instance} file={files.get(key) ?? null} className="absolute inset-0 w-full h-full" />}
                    {on && (
                      <span className="absolute top-1 right-1 grid place-items-center w-[1.15rem] h-[1.15rem] rounded-full bg-accent text-on-media [&>svg]:w-3 [&>svg]:h-3" aria-hidden="true">
                        {Icons.check}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="m-0 text-sm text-muted">No picture of the recap knows where it was taken.</p>
          )}
        </div>
        <footer className="flex-none flex flex-wrap items-center gap-2 px-5 py-3 border-t border-line">
          <Button size="sm" variant="ghost" onClick={() => setTicked(new Set(auto.map(keyOf)))} title="The recap's located pictures, evenly thinned — and it follows them as they change">
            As the recap chooses
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={done}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
