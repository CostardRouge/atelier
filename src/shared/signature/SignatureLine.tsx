import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnchoredPopover } from '../ui/OverflowMenu';
import Segmented from '../ui/Segmented';
import { Icons } from '../ui/icons';
import { PRESS_LOOK } from '../ui/press';
import { revealInScroller } from '../ui/reveal';
import { useIsCompact } from '../ui/use-layout-mode';
import {
  SIGN_CORNERS,
  SIGN_CORNER_LABEL,
  SIGN_FACES,
  SIGN_FACE_LABEL,
  SIGN_SLIDES,
  SIGN_SLIDES_LABEL,
  SIGN_WORDS,
  SIGN_WORDS_LABEL,
  signatureLine,
  type DocSignature,
  type SignCorner,
  type SignFace,
  type SignSlides,
  type SignWords,
} from './signature';
import { signatureFonts } from './signature-fonts';
import { paintSignature } from './signature-paint';
import { useSignatureStyle } from './signature-pref';

/** How much bigger than on a real frame each face is drawn on its tile, so it reads at a glance. */
const TILE_SCALE: Record<SignFace, number> = { line: 2.3, sticker: 3.1, stamp: 2.7, corner: 3.4 };

/** A face shown as what it draws: the real painter over a dusk, small. */
function FaceTile({ face, tool, on, onPick }: { face: SignFace; tool: string; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void signatureFonts().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const W = c.width;
    const H = c.height;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1c2540');
    sky.addColorStop(0.5, '#6b4a63');
    sky.addColorStop(0.78, '#e08a52');
    sky.addColorStop(1, '#2a2030');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    paintSignature(g, W, H, { face, words: 'made', tool, corner: face === 'corner' ? 'br' : 'bl', scale: TILE_SCALE[face] });
  }, [face, tool, ready]);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={`flex flex-col gap-1 p-[3px] rounded-control border text-2xs font-medium cursor-pointer transition-[background-color,border-color,translate] ${PRESS_LOOK} ${
        on ? 'border-accent bg-accent-wash text-ink' : 'border-line text-ink-soft hover:border-line-strong data-pressed:bg-paper-2'
      }`}
    >
      <canvas ref={ref} width={240} height={180} className="block w-full aspect-[4/3] rounded-[6px]" aria-hidden="true" />
      {SIGN_FACE_LABEL[face]}
    </button>
  );
}

/** Whose choice a row is — every tool's, or this document's. */
function Scope({ doc, children }: { doc?: boolean; children: ReactNode }) {
  return <span className={`ml-auto px-1.5 rounded-full border font-mono text-3xs normal-case tracking-normal whitespace-nowrap ${doc ? 'border-accent text-accent-ink' : 'border-line-strong text-ink-soft'}`}>{children}</span>;
}

function Row({ label, scope, children }: { label: string; scope: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="flex items-center gap-2 font-mono text-3xs uppercase tracking-[0.1em] text-muted">
        {label}
        {scope}
      </span>
      {children}
    </div>
  );
}

/**
 * Where a document's signature is set (lab 2 of the signature, his pick): ONE
 * line at the foot of an Export, just above the verb that writes the file.
 * The tick turns the mark on or off for this document; the line opens a small
 * popover — the face and the words (every tool's, kept on this device), the
 * corner and, for a carousel, which slides (this document's). The stage is
 * the preview: nothing of the mark is drawn twice.
 *
 * Beside the stage the popover hangs over the line; on a phone it opens
 * INSIDE the drawer, above the line, so it never covers the picture.
 */
export default function SignatureLine({
  tool,
  noun,
  value,
  onChange,
  carousel = false,
  onOpen,
}: {
  /** The tool as the signature names it — «Recap». */
  tool: string;
  /** The document's word — «recap», «mosaic», «atlas». */
  noun: string;
  value: DocSignature;
  onChange: (next: DocSignature) => void;
  /** The document delivers several slides: which of them wear it is a choice. */
  carousel?: boolean;
  /** The popover opened or closed — a host brings a signed page to its stage. */
  onOpen?: (open: boolean) => void;
}) {
  const [style, setStyle] = useSignatureStyle();
  const [open, setOpenState] = useState(false);
  const compact = useIsCompact();
  const lineRef = useRef<HTMLDivElement>(null);
  // A phone: the panel opens in the drawer's flow, which may leave it under the fold — bring it, and its line, into sight.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && compact) revealInScroller(lineRef.current, { behavior: 'smooth' });
  }, [open, compact]);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpen?.(next);
  };
  // Choosing how it looks means wanting it: a pick turns the mark on.
  const set = (patch: Partial<DocSignature>) => onChange({ ...value, on: true, ...patch });

  const panel = (
    <>
      <div className="flex items-center gap-2">
        <h3 className="m-0 flex-1 font-serif text-xl font-normal">Signature</h3>
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className={`touch-halo w-7 h-7 inline-flex items-center justify-center rounded-full border border-line text-muted cursor-pointer hover:text-ink [&>svg]:w-3.5 [&>svg]:h-3.5 ${PRESS_LOOK}`}>
          {Icons.close}
        </button>
      </div>
      <Row label="Face" scope={<Scope>every tool</Scope>}>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Face">
          {SIGN_FACES.map((face) => (
            <FaceTile
              key={face}
              face={face}
              tool={tool}
              on={style.face === face}
              onPick={() => {
                setStyle({ ...style, face });
                if (!value.on) onChange({ ...value, on: true });
              }}
            />
          ))}
        </div>
      </Row>
      <Row label="Words" scope={<Scope>every tool</Scope>}>
        <Segmented<SignWords> size="sm" fill label="Words" value={style.words} onChange={(words) => setStyle({ ...style, words })} options={SIGN_WORDS.map((id) => ({ id, label: SIGN_WORDS_LABEL[id] }))} className="[&>button]:px-1" />
      </Row>
      <div className={`grid gap-3.5 items-start ${carousel ? 'grid-cols-[max-content_minmax(0,1fr)]' : ''}`}>
        <Row label="Corner" scope={<Scope doc>this {noun}</Scope>}>
          <div className="inline-grid grid-cols-3 grid-rows-2 gap-0.5 p-[3px] w-max rounded-control border border-line bg-paper-2" role="group" aria-label="Corner">
            {(['tl', null, 'tr', 'bl', 'bc', 'br'] as (SignCorner | null)[]).map((c, i) =>
              c && SIGN_CORNERS.includes(c) ? (
                <button
                  key={c}
                  type="button"
                  aria-label={SIGN_CORNER_LABEL[c]}
                  title={SIGN_CORNER_LABEL[c]}
                  aria-pressed={value.corner === c}
                  onClick={() => set({ corner: c })}
                  className={`w-[34px] h-7 pointer-coarse:h-[34px] grid place-items-center rounded-[7px] cursor-pointer ${PRESS_LOOK} ${value.corner === c ? 'bg-surface border border-line-strong' : 'border border-transparent data-pressed:bg-line'}`}
                >
                  <span aria-hidden="true" className={`rounded-full ${value.corner === c ? 'w-2.5 h-2.5 bg-accent' : 'w-2 h-2 bg-line-strong'}`} />
                </button>
              ) : (
                <span key={i} aria-hidden="true" />
              ),
            )}
          </div>
        </Row>
        {carousel && (
          <Row label="Slides" scope={<Scope doc>this {noun}</Scope>}>
            <Segmented<SignSlides> size="sm" columns={1} label="Slides" value={value.slides} onChange={(slides) => set({ slides })} options={SIGN_SLIDES.map((id) => ({ id, label: SIGN_SLIDES_LABEL[id] }))} />
          </Row>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* A phone: the panel opens in the drawer's own flow, above its line. */}
      {open && compact && (
        <div ref={panelRef} role="group" aria-label="Signature" className="flex flex-col gap-2.5 p-3 border border-line-strong rounded-paper bg-surface">
          {panel}
        </div>
      )}
      <div ref={lineRef} className="flex items-stretch gap-1 min-w-0">
        <button
          type="button"
          aria-pressed={value.on}
          aria-label={`Sign this ${noun}'s exports`}
          title={value.on ? 'Signed — what this export says about where it was made. Click to leave it out.' : 'Not signed. Click to sign this export.'}
          onClick={() => onChange({ ...value, on: !value.on })}
          className={`touch-row flex-none w-7 h-7 pointer-coarse:w-[2.125rem] pointer-coarse:h-[2.125rem] inline-flex items-center justify-center rounded-[8px] border cursor-pointer transition-[background-color,border-color,translate] [&>svg]:w-3.5 [&>svg]:h-3.5 ${PRESS_LOOK} ${
            value.on ? 'border-accent bg-accent-wash text-accent-ink' : 'border-line-strong text-transparent hover:border-muted'
          }`}
        >
          {Icons.check}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
          className={`touch-row flex-1 min-w-0 h-7 pointer-coarse:h-[2.125rem] inline-flex items-center gap-2 px-2 rounded-[8px] border text-xs text-left cursor-pointer transition-[background-color,border-color,translate] ${PRESS_LOOK} ${
            open ? 'border-line-strong bg-paper-2' : 'border-transparent hover:border-line-strong hover:bg-paper-2 data-pressed:bg-paper-2'
          }`}
        >
          <span className={`flex-1 min-w-0 truncate ${value.on ? 'text-ink' : 'text-muted'}`}>{value.on ? `Signed · ${signatureLine(style.words, tool)}` : 'Not signed'}</span>
          <span aria-hidden="true" className={`flex-none text-muted transition-transform [&>svg]:w-3.5 [&>svg]:h-3.5 ${open ? '-rotate-90' : ''}`}>
            {Icons.chevronRight}
          </span>
        </button>
      </div>
      {open && !compact && (
        <AnchoredPopover
          anchorRect={() => lineRef.current?.getBoundingClientRect() ?? null}
          onClose={() => setOpen(false)}
          side="above"
          align="start"
          within={lineRef}
          role="dialog"
          label="Signature"
          className="w-[21.5rem] max-w-[calc(100vw-1rem)] gap-2.5 p-3"
        >
          {panel}
        </AnchoredPopover>
      )}
    </>
  );
}
