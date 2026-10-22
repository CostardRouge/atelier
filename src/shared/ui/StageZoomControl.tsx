import SettingsMenu, { type SettingsSection } from './SettingsMenu';
import type { ZoomControls } from './stage-zoom';

/**
 * The − 100% + pill that drives a zoom: Road Trip's day grid and stage ruler,
 * and the lightbox's viewer.
 *
 * Never over a media PREVIEW, whatever the surface — the two editor stages
 * carried one and it fought the picture's own framing gestures. A preview fits
 * the room it is given (`stage-zoom.ts`).
 *
 * The percentage is a button — pressing it returns to the fitted size — and it
 * is the only place that says a zoom is on, so it stays visible at 100% too:
 * a control that appears only once you are lost is not a way out.
 *
 * `hint` is the gesture the surface really offers: a zone that wants the wheel
 * for something else zooms on a modifier only, the lightbox on a bare wheel
 * too.
 *
 * `sections` turns that percentage into a PANEL (2026-09-22 a menu, variant
 * D1 of the stage-bar study; 2026-10-20 a `SettingsMenu`, his pick A of the
 * zoom-menu lab https://claude.ai/artifact/9b8tZLpQQd7xDkgwFdbQWa), for a
 * surface with more to say about how it draws than `+` and `−` can carry —
 * the Develop stage's smooth ↔ pixels. Whatever it holds, the pill keeps ONE
 * width and `+` and `−` keep their place: the thing this replaces was a
 * second button INSERTED past 1:1, which slid the whole bar sideways and put
 * `pixels` under a finger that had pressed `+` twice.
 *
 * `folded` draws the panel ALONE, without the pill's `−` and `+`, and the
 * caller puts the two steps in the panel. First a phone's (2026-10-06: its
 * stage bar could not hold the pill and the Develop well side by side), then
 * the Develop stage's at every width (2026-10-20, his ask: one design on a
 * computer and a phone, the steps beside Fit and 1:1).
 *
 * `bare` drops the folded pill's box too (2026-10-22, his ask): the
 * percentage is then the row's own TEXT, the way the camera render's menu
 * is above the picture — no ground, no border, so it can no longer stand
 * taller than the well of verbs beside it. Only on paper: a row floating
 * over the photograph keeps the box, or the figure is lost on a bright sky.
 */
export default function StageZoomControl({
  zoom,
  hint = '⌘/ctrl + wheel, or pinch',
  className = '',
  sections,
  menuLabel = 'Zoom, and how the picture is drawn',
  folded = false,
  bare = false,
}: {
  zoom: ZoomControls;
  hint?: string;
  className?: string;
  sections?: readonly SettingsSection[];
  menuLabel?: string;
  /** The pill one control wide, the ± left to the panel — needs `sections`. */
  folded?: boolean;
  /** Folded, and drawn as plain text with no box — for a row on paper, never over a picture. */
  bare?: boolean;
}) {
  const button =
    'w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink ' +
    'font-mono text-xs leading-none cursor-pointer transition-colors ' +
    'hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default ' +
    'disabled:hover:border-line-strong disabled:hover:text-ink';

  const hasPanel = Boolean(sections && sections.length > 0);
  const panel = (box: string) =>
    sections && (
      <SettingsMenu
        label={`${menuLabel} — ${zoom.label}`}
        sections={sections}
        align="start"
        trigger={{
          bare: true,
          className:
            `min-w-[3.9rem] ${box} inline-flex items-center justify-center gap-1 font-mono text-2xs ` +
            'tracking-[0.06em] text-muted cursor-pointer bg-transparent border-0 hover:text-accent-ink',
          text: (
            <>
              {zoom.label}
              <span className="text-faint" aria-hidden="true">
                ▾
              </span>
            </>
          ),
        }}
      />
    );

  if (folded && hasPanel && bare && sections) {
    // The camera render menu's recipe (`DevelopBase.tsx`): the words in
    // `ink-soft`, a faint ▾, both turning accent under the pointer. The box
    // is the well's height but draws nothing — a target, not a pill — and
    // the minimum width keeps `100%` → `400%` from sliding the well.
    return (
      <SettingsMenu
        label={`${menuLabel} — ${zoom.label}`}
        sections={sections}
        align="start"
        className={className}
        trigger={{
          bare: true,
          className:
            'group min-w-[3.9rem] h-[2.125rem] px-1.5 inline-flex items-center justify-center gap-1.5 ' +
            'bg-transparent border-0 rounded-control cursor-pointer',
          text: (
            <>
              <span className="font-mono text-xs tabular-nums text-ink-soft group-hover:text-accent-ink">{zoom.label}</span>
              <span className="font-mono text-3xs text-faint group-hover:text-accent-ink" aria-hidden="true">
                ▾
              </span>
            </>
          ),
        }}
      />
    );
  }

  if (folded && hasPanel) {
    return (
      // The well's own box beside it (`DevelopSections`: 2px inside a 34px
      // verb, the control radius), so the pill and the well read as one row
      // of the same blocks rather than a capsule beside a card.
      <div className={`flex items-center rounded-control border border-line bg-surface/86 backdrop-blur-[2px] p-0.5 ${className}`}>
        {panel('h-[2.125rem] px-2')}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-line bg-surface/86 backdrop-blur-[2px] px-1 py-1 ${className}`}
    >
      <button
        type="button"
        className={button}
        onClick={zoom.zoomOut}
        disabled={!zoom.canZoomOut}
        title={`Zoom out (${hint})`}
        aria-label="Zoom out"
      >
        −
      </button>
      {hasPanel ? (
        panel('px-1')
      ) : (
        <button
          type="button"
          onClick={zoom.reset}
          disabled={zoom.scale === 1}
          title="Back to the fitted size"
          aria-label={`Zoom: ${zoom.label}. Back to the fitted size`}
          className="min-w-[3.1rem] px-1 font-mono text-2xs tracking-[0.06em] text-muted cursor-pointer bg-transparent border-0 hover:text-accent-ink disabled:cursor-default disabled:hover:text-muted"
        >
          {zoom.label}
        </button>
      )}
      <button
        type="button"
        className={button}
        onClick={zoom.zoomIn}
        disabled={!zoom.canZoomIn}
        title={`Zoom in (${hint})`}
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
