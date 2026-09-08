import type { ZoomControls } from './stage-zoom';

/**
 * The − 100% + pill that sits in the corner of an editor stage.
 *
 * It floats over the picture rather than joining the transport row: the zoom
 * belongs to the thing you are looking at, and both stages that carry one
 * (the Studio's, Road Trip's badge) have a different row underneath.
 *
 * The percentage is a button — pressing it returns to the fitted size — and it
 * is the only place that says a zoom is on, so it stays visible at 100% too:
 * a control that appears only once you are lost is not a way out.
 *
 * `hint` is the gesture the surface really offers: the stages zoom on a
 * modifier only, the lightbox on a bare wheel too.
 */
export default function StageZoomControl({
  zoom,
  hint = '⌘/ctrl + wheel, or pinch',
  className = '',
}: {
  zoom: ZoomControls;
  hint?: string;
  className?: string;
}) {
  const button =
    'w-6 h-6 grid place-items-center rounded-full border border-line-strong bg-paper text-ink ' +
    'font-mono text-[0.8rem] leading-none cursor-pointer transition-colors ' +
    'hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default ' +
    'disabled:hover:border-line-strong disabled:hover:text-ink';

  return (
    <div
      className={`flex items-center gap-1 rounded-full border border-line bg-[rgba(250,247,242,0.86)] backdrop-blur-[2px] px-1 py-1 ${className}`}
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
      <button
        type="button"
        onClick={zoom.reset}
        disabled={zoom.scale === 1}
        title="Back to the fitted size"
        aria-label={`Zoom: ${zoom.label}. Back to the fitted size`}
        className="min-w-[3.1rem] px-1 font-mono text-[0.68rem] tracking-[0.06em] text-muted cursor-pointer bg-transparent border-0 hover:text-accent-ink disabled:cursor-default disabled:hover:text-muted"
      >
        {zoom.label}
      </button>
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
