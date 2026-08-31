import { useEffect, useMemo, useRef } from 'react';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import {
  prepareOutro,
  withOutroLine,
  type OutroCard,
} from '../../shared/overlay/outro-card';

interface OutroPanelProps {
  outro: OutroCard;
  /** The project's destination ratio — what the preview composes for. */
  aspect: number;
  onChange: (outro: OutroCard) => void;
  onRemove: () => void;
}

const legend = 'font-mono text-[0.66rem] tracking-[0.12em] uppercase text-muted';
const input =
  'font-sans text-[0.8rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

/**
 * The outro — the closing card the export appends after the footage. The
 * stage cannot show it (the playhead cannot travel past the clip), so the
 * panel carries its own preview, painted by the very renderer the export
 * uses. Editing is by line for now: text, duration, ground and the QR link;
 * free placement on a stage of its own is the later, intro-parity step.
 */
export default function OutroPanel({ outro, aspect, onChange, onRemove }: OutroPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prepared = useMemo(() => prepareOutro(outro), [outro]);

  // Preview at the card's midpoint: an entrance has played, an exit has not —
  // the settled look, without inventing a second settle rule.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const w = 240;
    const h = Math.max(1, Math.round(w / aspect));
    void ensureOverlayFonts(outro.elements, null).then(() => {
      if (cancelled) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) prepared.draw(ctx, w, h, outro.seconds / 2);
    });
    return () => {
      cancelled = true;
    };
  }, [prepared, aspect, outro.elements, outro.seconds]);

  const lines = outro.elements.filter((el) => el.kind === 'text');

  function setLineText(id: string, text: string) {
    onChange({
      ...outro,
      elements: outro.elements.map((el) => (el.id === id ? { ...el, text } : el)),
    });
  }

  function removeLine(id: string) {
    onChange({ ...outro, elements: outro.elements.filter((el) => el.id !== id) });
  }

  function setQrUrl(url: string) {
    if (!url.trim()) {
      onChange({ ...outro, qr: null });
      return;
    }
    onChange({
      ...outro,
      qr: outro.qr
        ? { ...outro.qr, url }
        : // A fresh code: centred under the middle, at the closing slide's
          // proportions. Placement stays editable later, with the elements.
          {
            url,
            x: 0.5 - (0.3 * Math.min(1 / aspect, 1)) / 2,
            y: 0.55,
            sizeFrac: 0.3,
            dark: '#f4f0e7',
            light: outro.background,
          },
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <canvas
          ref={canvasRef}
          className="flex-none w-[7.5rem] h-auto rounded-[4px] border border-line bg-frame"
          aria-label="Outro card preview"
        />
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          <label className="flex items-center gap-2">
            <span className={`${legend} flex-1`}>Holds for</span>
            <input
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={outro.seconds}
              onChange={(e) =>
                onChange({ ...outro, seconds: Math.max(0.5, Number(e.target.value) || 0.5) })
              }
              className={`${input} w-[4.2rem] text-right tabular-nums`}
              aria-label="Outro duration in seconds"
            />
            <span className="font-mono text-[0.7rem] text-muted">s</span>
          </label>
          <label className="flex items-center gap-2">
            <span className={`${legend} flex-1`}>Ground</span>
            <input
              type="color"
              value={outro.background}
              onChange={(e) => onChange({ ...outro, background: e.target.value })}
              className="w-8 h-6 p-0 border border-line-strong rounded cursor-pointer bg-transparent"
              aria-label="Outro background colour"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {lines.map((el) => (
          <div key={el.id} className="flex items-center gap-1.5">
            <input
              value={el.text ?? ''}
              onChange={(e) => setLineText(el.id, e.target.value)}
              className={`${input} flex-1 min-w-0`}
              aria-label="Outro line"
            />
            <button
              type="button"
              onClick={() => removeLine(el.id)}
              className="flex-none w-6 h-6 grid place-items-center rounded-full border border-line bg-transparent text-faint cursor-pointer hover:text-[#9a3a23] hover:border-[#e3b8a9]"
              aria-label="Remove this line"
              title="Remove this line"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange(withOutroLine(outro))}
          className="self-start p-0 border-0 bg-transparent text-[0.75rem] text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] hover:text-accent"
        >
          + Add a line
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className={legend}>QR link</span>
        <input
          value={outro.qr?.url ?? ''}
          onChange={(e) => setQrUrl(e.target.value)}
          placeholder="https://… — empty means no QR"
          className={input}
        />
      </label>
      {prepared.qrProblem && (
        <p className="m-0 text-[0.72rem] text-[#9a3a23]">{prepared.qrProblem}</p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[0.72rem] text-faint">
          Appended after the footage on variants that carry the overlays; the
          card plays silent.
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex-none p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
