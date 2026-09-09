import type { MediaAction, MediaActions } from '../sources/media-scope';

interface MediaActionRowProps {
  /** What the active tool published, or null when it offers nothing. */
  offer: MediaActions | null;
  /**
   * Run one verb. The caller is what makes the media ready first — activating
   * a pool asset, fetching an instance's row — and what closes the sheet
   * afterwards: only it knows where the picture lives.
   */
  onRun: (action: MediaAction) => void;
  /** Something is already in flight: the row waits rather than queueing. */
  busy?: boolean;
}

/**
 * The one row that turns a picture you are looking at into work.
 *
 * A sheet that shows a media large is where the decision "this one is worth a
 * piece" is actually taken, and until now it could only be carried out three
 * screens away: close, find the day, pick a kind, press Add. The verbs come
 * from the active tool (`media-scope.tsx`), so the shell offers them without
 * knowing what a reel is, and a tool that publishes none draws nothing at all.
 */
export default function MediaActionRow({ offer, onRun, busy }: MediaActionRowProps) {
  if (!offer || offer.actions.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[0.62rem] tracking-[0.12em] uppercase text-muted">
        {offer.heading}
      </span>
      {offer.actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onRun(action)}
          disabled={busy}
          title={action.hint}
          className="px-3 py-1.5 rounded-full border border-line-strong bg-paper text-ink text-[0.78rem] cursor-pointer transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:cursor-wait"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
