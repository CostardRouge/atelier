import { sourceLabel } from '../sources/document-gallery';
import { Icons } from './icons';

const verb =
  'p-0 border-0 bg-transparent text-inherit font-semibold underline underline-offset-[3px] cursor-pointer';

/**
 * "Cloned as “X” · where — Open · Undo", pinned to the top of the gallery's
 * scroller because the new card may be a screen below. Undo is the gallery's
 * own delete, so a clone kept on an instance is removed there too.
 */
export default function ClonedNotice({
  name,
  sourceId,
  onOpen,
  onUndo,
}: {
  name: string;
  sourceId: string;
  onOpen: () => void;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className="sticky top-0 z-10 flex items-center gap-x-4 gap-y-1 flex-wrap px-3.5 py-2 bg-ink text-paper rounded-paper text-sm shadow-paper"
    >
      <span className="min-w-0 flex-1 basis-48">
        <span className="inline-flex align-[-2px] mr-1.5">{Icons.check}</span>
        Cloned as <strong className="font-semibold">“{name}”</strong>
        <span className="opacity-70 text-xs"> · {sourceLabel(sourceId)}</span>
      </span>
      <button type="button" onClick={onOpen} className={verb}>
        Open
      </button>
      <button type="button" onClick={onUndo} className={verb}>
        Undo
      </button>
    </div>
  );
}
