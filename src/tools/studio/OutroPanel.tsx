import { useEffect, useMemo, useRef } from 'react';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import {
  prepareOutro,
  withOutroLine,
  type OutroCard,
} from '../../shared/overlay/outro-card';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { FieldRow, NumberField, Readout, TextField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';

interface OutroPanelProps {
  outro: OutroCard;
  /** The project's destination ratio — what the preview composes for. */
  aspect: number;
  onChange: (outro: OutroCard) => void;
  onRemove: () => void;
}

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
      <FieldRow label="Preview" align="start">
        <canvas
          ref={canvasRef}
          className="flex-none w-[7.5rem] h-auto rounded-[6px] border border-line bg-frame"
          aria-label="Outro card preview"
        />
      </FieldRow>
      <FieldRow label="Holds for">
        <NumberField
          label="Outro duration in seconds"
          min={1}
          max={15}
          step={0.5}
          unit="s"
          value={outro.seconds}
          onChange={(v) => onChange({ ...outro, seconds: Math.max(0.5, v || 0.5) })}
        />
      </FieldRow>
      <FieldRow label="Ground">
        <input
          type="color"
          value={outro.background}
          onChange={(e) => onChange({ ...outro, background: e.target.value })}
          className="flex-none w-8 h-8 p-0 border border-line-strong rounded-[7px] cursor-pointer bg-transparent"
          aria-label="Outro background colour"
        />
        <Readout muted>{outro.background}</Readout>
      </FieldRow>

      {lines.map((el, i) => (
        <FieldRow key={el.id} label={`Line ${i + 1}`}>
          <TextField label={`Outro line ${i + 1}`} value={el.text ?? ''} onChange={(text) => setLineText(el.id, text)} />
          <IconButton size="sm" variant="ghost" label="Remove this line" onClick={() => removeLine(el.id)}>
            {Icons.close}
          </IconButton>
        </FieldRow>
      ))}
      <FieldRow label="">
        <Button size="sm" variant="ghost" icon={Icons.plus} onClick={() => onChange(withOutroLine(outro))}>
          Line
        </Button>
      </FieldRow>

      <FieldRow
        label="QR link"
        hint={prepared.qrProblem ? <span className="text-danger">{prepared.qrProblem}</span> : undefined}
      >
        <TextField
          label="QR link"
          value={outro.qr?.url ?? ''}
          onChange={setQrUrl}
          placeholder="https://… — empty means no QR"
        />
      </FieldRow>

      <FieldRow label="Card" hint="Appended after the footage on variants that carry the overlays; the card plays silent.">
        <Button size="sm" variant="danger" onClick={onRemove}>
          Remove the outro
        </Button>
      </FieldRow>
    </div>
  );
}
