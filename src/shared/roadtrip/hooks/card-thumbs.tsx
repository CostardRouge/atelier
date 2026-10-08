/**
 * The card's two pickers as pictures (2026-10-08, his «des mini-miniatures
 * pour bien comprendre à quoi va ressembler la face … des mini-tuiles pour le
 * look»): each FACE drawn small by the card's own painter over this piece's
 * real road and numbers, and each LOOK a dark tile with a word set in it.
 * What the author picks from is what the card will be.
 */

import { useEffect, useRef } from 'react';
import { TITLE_STYLE_PRESETS, glowLayersFor, themeFromPreset, type StyleTheme, type TitleStyle } from '../../overlay/title-styles';
import { previewTextStyle } from '../../overlay/style-preview';
import { PRESS_LOOK } from '../../ui/press';
import type { DrivePlan } from './drive-plan';
import type { HookPicture } from './hook-variant';
import { loadLook } from './look-text';
import { CARD_FACE_NAMES, cardScene, type CardFace, type CardSceneInput } from './summary-card';
import { paintCard } from './summary-paint';

const TILE = 'rounded-[8px] border cursor-pointer select-none p-1 flex flex-col items-center gap-1 bg-paper-2';
const tileState = (on: boolean) =>
  on ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)] text-ink' : 'border-line text-ink-soft hover:border-line-strong';

const label = 'font-mono text-2xs tracking-[0.12em] uppercase text-muted';

interface FacesProps {
  faces: readonly CardFace[];
  value: CardFace;
  onChange: (face: CardFace) => void;
  /** The scene every thumbnail is drawn from, but its face. */
  input: Omit<CardSceneInput, 'plan'>;
  plan: DrivePlan | null;
  pictures?: ReadonlyMap<string, HookPicture>;
  aspect: number;
}

/** One face, drawn small: the card at rest, over this piece's road. */
function FaceThumb({ face, plan, input, pictures, aspect }: { face: CardFace } & Omit<FacesProps, 'faces' | 'value' | 'onChange'>) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const w = 52;
  const h = Math.round(Math.min(92, Math.max(40, w / Math.max(0.3, aspect))));
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    let alive = true;
    const paint = () => {
      if (!alive) return;
      const dpr = 3;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      // The slide's own picture stands in as a dusk under a card on its own.
      const sky = g.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, '#4d5a6e');
      sky.addColorStop(1, '#2a241d');
      g.fillStyle = sky;
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (!plan) return;
      // A Stamp sits on the map's paper: its picture says so.
      const scene = cardScene({ ...input, plan, o: { ...input.o, cardFace: face, ...(face === 'stamp' ? { cardGround: 'paper' } : {}) } });
      paintCard(g, scene, pictures, 60, { width: canvas.width, height: canvas.height }, 60);
    };
    paint();
    // Drawn again once the look's faces are in, so a thumbnail is never set in a fallback.
    void loadLook(input.theme ? cardThemeOf(input) : null).then(paint);
    return () => {
      alive = false;
    };
  }, [face, plan, input, pictures, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} className="block rounded-[4px]" aria-hidden="true" />;
}

function cardThemeOf(input: Omit<CardSceneInput, 'plan'>): StyleTheme | null {
  return input.o.cardLook === 'trip' ? (input.theme ?? null) : themeFromPreset(input.o.cardLook);
}

export function FacePicker({ faces, value, onChange, input, plan, pictures, aspect }: FacesProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={label}>Face</span>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="The card’s face">
        {faces.map((face) => (
          <button
            key={face}
            type="button"
            aria-pressed={face === value}
            title={CARD_FACE_NAMES[face]}
            onClick={() => onChange(face)}
            className={`${TILE} ${PRESS_LOOK} ${tileState(face === value)}`}
          >
            <FaceThumb face={face} input={input} plan={plan} pictures={pictures} aspect={aspect} />
            <span className="text-2xs leading-none pb-0.5 truncate max-w-full">{CARD_FACE_NAMES[face] === 'Contact sheet' ? 'Sheet' : CARD_FACE_NAMES[face]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function sample(style: TitleStyle) {
  return previewTextStyle({ ...style, glow: style.glowAmount > 0 ? glowLayersFor(style) : null }, '0.95rem');
}

interface LooksProps {
  value: string;
  onChange: (look: string) => void;
  /** The trip's own look — the first tile. */
  trip: StyleTheme | null | undefined;
}

/** The card's look as small tiles: the trip's own first, then the four presets. */
export function LookPicker({ value, onChange, trip }: LooksProps) {
  const tripStyle = (trip ?? themeFromPreset('neutral'))?.style;
  const tiles = [
    { id: 'trip', name: 'Trip’s', style: tripStyle },
    ...TITLE_STYLE_PRESETS.map((p) => ({ id: p.id, name: p.name === 'Rouge plein cadre' ? 'Rouge' : p.name, style: p.style })),
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className={label}>Look</span>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="The card’s look">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            aria-pressed={tile.id === value}
            title={tile.id === 'trip' ? 'The trip’s own look, the badge’s' : `${tile.name}, for the card alone`}
            onClick={() => onChange(tile.id)}
            className={`${TILE} ${PRESS_LOOK} ${tileState(tile.id === value)}`}
          >
            <span className="w-full h-7 grid place-items-center rounded-[4px] bg-frame overflow-hidden" aria-hidden="true">
              {tile.style && <span style={sample(tile.style)}>90</span>}
            </span>
            <span className="text-2xs leading-none pb-0.5 truncate max-w-full">{tile.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
