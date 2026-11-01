import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import { revealInScroller } from '../../shared/ui/reveal';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

/** How many tiles a page of the chooser draws; *Show more* adds as many. */
const PAGE = 240;

/**
 * The target CHOSEN explicitly (his ask, 2026-11-01): the mosaic's measured
 * pictures as a grid of the instance's thumbnails (`WinnowThumb`, which
 * loads near the screen and heals a broken one), the current target marked;
 * a click makes a picture the target. Paged, so a library of thousands
 * draws a few hundred tiles at a time.
 */
export default function TargetChooser({
  tiles,
  client,
  current,
  title = 'Choose the target',
  onChoose,
  onClose,
}: {
  tiles: readonly MosaicTile[];
  client: WinnowClient;
  current: number | undefined;
  /** What the pick is for — the target by default, else an entry of the chain. */
  title?: string;
  onChoose: (id: number) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(() => {
    // The page holding the current target is shown from the start.
    const at = current === undefined ? 0 : tiles.findIndex((t) => t.id === current);
    return Math.max(PAGE, Math.ceil((at + 1) / PAGE) * PAGE);
  });
  useDialogKeys({ onCancel: onClose });
  useEffect(() => {
    revealInScroller(document.querySelector<HTMLElement>(`[data-target-tile="${current}"]`), { block: 'center' });
  }, [current]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 max-[820px]:p-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex flex-col w-full max-w-5xl max-h-full bg-paper border border-line rounded-paper-lg shadow-paper max-[820px]:h-full max-[820px]:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <h2 className="m-0 font-serif text-xl">{title}</h2>
          <span className="font-mono text-2xs text-muted tabular-nums">{tiles.length.toLocaleString()} measured pictures</span>
          <span className="flex-1" />
          <IconButton label="Close" onClick={onClose}>
            {Icons.close}
          </IconButton>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {tiles.slice(0, shown).map((t) => (
              <button
                key={t.id}
                type="button"
                data-target-tile={t.id}
                onClick={() => onChoose(t.id)}
                className={`block rounded-control overflow-hidden border-2 ${t.id === current ? 'border-accent' : 'border-transparent hover:border-line-strong'} focus-visible:outline-2 focus-visible:outline-accent`}
                title={t.id === current ? 'The one now' : 'Choose this picture'}
              >
                <WinnowThumb client={client} id={t.id} label={t.kind} box="w-full h-[80px]" />
              </button>
            ))}
          </div>
          {shown < tiles.length && (
            <div className="flex justify-center pt-3">
              <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, tiles.length - shown).toLocaleString()} more
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
