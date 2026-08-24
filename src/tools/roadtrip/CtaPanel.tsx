import { QR_MAX_BYTES } from '../../shared/lib/qr';
import type { CtaSlide } from '../../shared/roadtrip/cta-slide';

interface CtaPanelProps {
  cta: CtaSlide;
  onChange: (cta: CtaSlide) => void;
  /** Why the QR could not be drawn, when the author asked for one. */
  problem: string | null;
}

const legend = 'font-mono text-[0.62rem] tracking-[0.14em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.82rem] px-2.5 py-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent';

/**
 * The closing slide, edited once for the whole trip. Everything here is
 * published copy, so nothing is computed and nothing is fixed — including the
 * two colours, because a QR only scans when it contrasts with its own ground.
 */
export default function CtaPanel({ cta, onChange, problem }: CtaPanelProps) {
  const patch = (p: Partial<CtaSlide>) => onChange({ ...cta, ...p });
  const urlLength = new TextEncoder().encode(cta.url.trim()).length;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={legend}>Headline</span>
        <input
          value={cta.headline}
          onChange={(e) => patch({ headline: e.target.value })}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={legend}>Body</span>
        <textarea
          value={cta.body}
          rows={3}
          onChange={(e) => patch({ body: e.target.value })}
          className={`${inputClass} resize-y`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={legend}>Link</span>
        <input
          value={cta.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://…"
          className={inputClass}
        />
        <span
          className={`text-[0.68rem] ${urlLength > QR_MAX_BYTES ? 'text-[#9a3a23]' : 'text-faint'}`}
        >
          {urlLength}/{QR_MAX_BYTES} characters a QR code can hold
        </span>
      </label>

      <label className="flex items-center gap-2 text-[0.8rem] text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={cta.showQr}
          onChange={(e) => patch({ showQr: e.target.checked })}
          className="accent-accent"
        />
        Show a QR code for the link
      </label>

      {problem && (
        <p className="m-0 text-[0.76rem] text-[#9a3a23]" role="alert">
          {problem}
        </p>
      )}

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[0.78rem] text-ink-soft">
          Ground
          <input
            type="color"
            value={cta.background}
            onChange={(e) => patch({ background: e.target.value })}
            className="w-7 h-7 p-0 border border-line-strong rounded-[5px] bg-paper cursor-pointer"
            aria-label="Card background"
          />
        </label>
        <label className="flex items-center gap-2 text-[0.78rem] text-ink-soft">
          Ink
          <input
            type="color"
            value={cta.ink}
            onChange={(e) => patch({ ink: e.target.value })}
            className="w-7 h-7 p-0 border border-line-strong rounded-[5px] bg-paper cursor-pointer"
            aria-label="Card ink"
          />
        </label>
      </div>
      <p className="m-0 text-[0.68rem] text-faint">
        The QR is drawn in the ink on the ground — a code the same colour as its
        surround scans as nothing at all.
      </p>
    </div>
  );
}
