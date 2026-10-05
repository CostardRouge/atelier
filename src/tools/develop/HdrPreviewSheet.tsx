import { useEffect, useState } from 'react';
import { hdrSupport } from '../../shared/hdr/hdr-display';
import type { HdrPreview } from '../../shared/hdr/hdr-preview';
import Segmented from '../../shared/ui/Segmented';
import useDialogKeys from '../../shared/ui/use-dialog-keys';

type View = 'base' | 'hdr';

/**
 * The HDR picture on this screen (`hdr-preview.ts`): the Ultra HDR file the
 * export would write, at stage size, handed to an `<img>` — which is the one
 * surface a browser lights with a gain map today — beside its SDR base, one
 * switch apart. The lines under it say what is MEASURED (the map's reach, how
 * far it read back) and what this display can show, never a lift it cannot.
 */
export default function HdrPreviewSheet({
  title,
  make,
  stops,
  onClose,
}: {
  title: string;
  /** Renders the preview — twice through the stage's grader, then the file — when the sheet opens. */
  make: () => Promise<HdrPreview | null>;
  /** The roll's reach, in stops, for the line. */
  stops: number;
  onClose: () => void;
}) {
  useDialogKeys({ onCancel: onClose });
  const [preview, setPreview] = useState<HdrPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('hdr');
  useEffect(() => {
    let alive = true;
    let made: HdrPreview | null = null;
    setPreview(null);
    setError(null);
    make()
      .then((p) => {
        if (!alive) {
          p?.release();
          return;
        }
        made = p;
        if (p) setPreview(p);
        else setError('Nothing is decoded yet.');
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      made?.release();
    };
  }, [make]);

  const support = hdrSupport();
  const shown = preview ? (view === 'hdr' && preview.ultra ? preview.url : preview.baseUrl) : null;
  const display = support.display
    ? 'This display shows HDR: in Chrome, Edge or Safari the HDR view is lifted by the map — the base is the same file without it.'
    : 'This display shows SDR: both views look the same here, and the lift shows on an HDR screen.';
  const measured = preview
    ? preview.ultra
      ? `Up to ${preview.headroom.toFixed(1)} stops above white${preview.checked !== null ? ` · read back within ${preview.checked.toFixed(2)} stops` : ''} · a ${preview.width} × ${preview.height} preview, the file itself is bigger and sharpened for its target`
      : `A plain JPEG: ${preview.reason ?? 'no gain map'}`
    : error
      ? `The preview could not be made: ${error}`
      : `Rendering twice — the picture, and the picture ${stops} stop${stops === 1 ? '' : 's'} darker…`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="HDR preview"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[64rem] max-h-[min(94dvh,52rem)] overflow-y-auto overscroll-contain flex flex-col gap-3 bg-surface border border-line rounded-paper-lg shadow-paper p-4 max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:max-h-none max-[820px]:rounded-none max-[820px]:border-0 max-[820px]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex-none flex items-center gap-2.5 min-w-0">
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">HDR · {title}</h2>
          <span className="flex-1" />
          <Segmented<View>
            size="sm"
            label="Base or HDR"
            value={preview && !preview.ultra ? 'base' : view}
            onChange={setView}
            options={[
              { id: 'base', label: 'Base' },
              { id: 'hdr', label: 'HDR', disabled: preview ? (preview.ultra ? false : preview.reason ?? 'no gain map') : false },
            ]}
          />
          <button
            type="button"
            onClick={onClose}
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>
        <div className="relative mx-auto w-full bg-frame rounded-paper overflow-hidden grid place-items-center min-h-[12rem] max-h-[calc(var(--app-h,100dvh)*0.7)]">
          {shown ? (
            <img
              src={shown}
              alt={view === 'hdr' ? 'The picture with its gain map' : 'The SDR base'}
              className="block max-w-full max-h-[calc(var(--app-h,100dvh)*0.7)] w-auto h-auto"
              data-view={view}
            />
          ) : (
            <p className="m-0 p-4 text-center font-mono text-2xs text-on-media/80">{measured}</p>
          )}
        </div>
        <p className="m-0 font-mono text-2xs leading-snug text-ink-soft" role="status">
          {measured}
        </p>
        <p className="m-0 font-mono text-2xs leading-snug text-muted">{display}</p>
      </div>
    </div>
  );
}
