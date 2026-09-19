import { developLegendClass } from './develop-classes';
import useDialogKeys from '../ui/use-dialog-keys';

interface Shortcut {
  /** What to press, as the key caps read on the machine. */
  keys: string;
  what: string;
}

interface Group {
  title: string;
  rows: readonly Shortcut[];
}

/**
 * Every key and gesture the develop editor answers.
 *
 * It USED to be a legend along the bottom of the roll editor, under the
 * photograph — six shortcuts as one grey sentence that wrapped to three lines
 * on a narrow screen and was read exactly once. A legend nobody reads still
 * costs the picture its room, so it moved behind `H` (or `?`, or the `?` verb
 * in the stage bar), where it can say MORE than it ever did as a sentence: the
 * gestures belong here too.
 */
const GROUPS: readonly Group[] = [
  {
    title: 'Moving about',
    rows: [
      { keys: '← / →', what: 'the picture before or after this one' },
      { keys: 'Z', what: 'closer, or back to the fit' },
      { keys: 'wheel · pinch', what: 'zoom about the pointer, to 4000 %' },
      { keys: 'drag', what: 'pan, once the picture is zoomed' },
    ],
  },
  {
    title: 'Judging it',
    rows: [
      { keys: '\\', what: 'hold to see the picture as shot' },
      { keys: 'drag', what: 'at the fit, wipe between before and after' },
      { keys: 'the divider’s handle', what: 'wipe at any zoom' },
      { keys: 'the compare pill', what: 'the divider on or off — a mask tool suspends it on its own' },
      { keys: 'I', what: 'the facts, over the picture' },
    ],
  },
  {
    title: 'Working',
    rows: [
      { keys: 'D', what: 'the Develop tab' },
      { keys: 'R', what: 'the Crop tab' },
      { keys: '⌘/Ctrl C · V', what: 'copy this develop, paste it onto another' },
      { keys: '⌘/Ctrl Z', what: 'undo — and ⇧ to put it back' },
      { keys: 'tap', what: 'with Pick on, add a point to the subject — the + cursor' },
      { keys: 'tap a marker', what: 'take that point off again — it shows −' },
      { keys: '⇧ / ⌘-click', what: 'choose pictures along the filmstrip' },
    ],
  },
];

/**
 * The shortcuts, as a sheet over the editor. Closed by Escape, by its button,
 * or by the same `H` that opened it (the host's key handler).
 */
export default function DevelopShortcuts({ onClose }: { onClose: () => void }) {
  useDialogKeys({ onCancel: onClose, onConfirm: onClose });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Keys and gestures"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[min(90dvh,44rem)] overflow-y-auto overscroll-contain flex flex-col gap-4 bg-surface border border-line rounded-paper-lg shadow-paper p-4 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">Keys and gestures</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>
        {GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-1.5">
            <h3 className={`${developLegendClass} m-0`}>{group.title}</h3>
            <dl className="m-0 grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1 items-baseline">
              {group.rows.map((row) => (
                <div key={row.keys + row.what} className="contents">
                  <dt className="m-0 font-mono text-2xs text-ink-soft text-right">{row.keys}</dt>
                  <dd className="m-0 font-mono text-2xs text-faint leading-relaxed">{row.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="m-0 font-mono text-2xs text-faint leading-relaxed">
          A field or a slider keeps every key it could use, so nothing here fires while you are typing a name or
          dragging a value.
        </p>
      </div>
    </div>
  );
}
