import { useEffect, useState, type ReactNode } from 'react';
import { cleanMosaicTitle, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import { pictureCountLine } from './MosaicGallery';

/** Where the editor's save stands, as its bar says it. */
export type SaveState = 'saved' | 'saving' | 'failed';

const SAVE_WORDS: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' };

interface MosaicEditorProps {
  doc: MosaicDoc;
  /** Every edit, through one funnel — the shell saves it. */
  change: (fn: (doc: MosaicDoc) => MosaicDoc) => void;
  saveState: SaveState;
  onBack: () => void;
  /** Drawn under the bar: another tab edits this mosaic. */
  band?: ReactNode;
}

/**
 * Mosaic — WORK IN PROGRESS. One MOSAIC (`shared/mosaic/mosaic-doc.ts`): its
 * library of pictures from one Winnow, each measured once, and the picture
 * rebuilt out of them. This is the editor's frame (`docs/mosaic.md` M3): its
 * title, its library's count and the save word. The door to the instance's
 * pictures (M4), the stage (M5) and the animated modes (M6) follow.
 */
export default function MosaicEditor({ doc, change, saveState, onBack, band }: MosaicEditorProps) {
  useSurface('darkroom');
  const compact = useIsCompact();
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);

  const commitTitle = () => {
    const clean = cleanMosaicTitle(title);
    if (clean && clean !== doc.title) change((d) => ({ ...d, title: clean, updatedAt: Date.now() }));
    else setTitle(doc.title);
  };

  const failed = doc.tiles.filter((t) => t.failed).length;

  return (
    <section className="@container flex-1 min-h-0 flex flex-col gap-3" aria-label="Mosaic">
      <PageBar
        back={{ label: 'Mosaics', onClick: onBack, iconOnly: compact }}
        trailing={
          <span
            className={`font-mono text-2xs ${saveState === 'failed' ? 'text-danger' : 'text-muted'}`}
            role="status"
            title={
              saveState === 'failed'
                ? 'The browser refused to store this mosaic (a private window, or the disk is full) — your edits are still on screen.'
                : 'Every change is kept on this device as you go.'
            }
          >
            {SAVE_WORDS[saveState]}
          </span>
        }
      >
        <input
          aria-label="Mosaic title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(doc.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`min-w-0 flex-1 h-9 px-2 rounded-control border border-transparent bg-transparent font-serif text-ink hover:border-line focus:border-line-strong focus:bg-paper focus:outline-none ${compact ? 'text-lg' : 'text-2xl'}`}
        />
      </PageBar>
      {band}
      <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        <span className="font-mono text-2xs text-muted tabular-nums">
          {pictureCountLine(doc)}
          {failed ? ` · ${failed} skipped` : ''}
        </span>
      </div>
      {doc.tiles.length === 0 && (
        <EmptyState title="No pictures yet">
          A mosaic starts with pictures from your Winnow — a span of days, hundreds or thousands of them. The door to them is the next
          piece of this tool, still being built.
        </EmptyState>
      )}
    </section>
  );
}
