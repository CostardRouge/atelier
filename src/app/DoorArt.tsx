import { useId, type ReactNode } from 'react';

/**
 * What a home door shows before this browser holds a document of its tool:
 * a drawing of the tool's own world, not an icon alone on an empty tile.
 * The real thumbnail replaces it the moment a document exists. Drawn in SVG
 * from the theme's tokens (ink lines on paper, one vermilion touch), so it
 * follows light and dark and ships no image file. Picked by the maintainer
 * from a lab: https://claude.ai/artifact/41yHf93r3Fe29QefeLZPUw
 */
export default function DoorArt({ toolId }: { toolId: string }): ReactNode {
  const Art = ART[toolId];
  return Art ? <Art /> : null;
}

/** Ink line, a soft fill, the accent: the three marks every drawing uses. */
const line = 'fill-none stroke-faint [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]';
const soft = 'fill-line';
const solid = 'fill-faint';
const accent = 'fill-none stroke-accent [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round]';
const label = 'fill-faint font-mono tracking-[0.06em]';

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 320 96" preserveAspectRatio="xMidYMid meet" className="block w-full h-full" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A frame with a readout on it, tracks under a playhead, a LUT strip. */
function StudioArt() {
  const lut = useId();
  return (
    <Frame>
      <defs>
        <linearGradient id={lut}>
          <stop offset="0" style={{ stopColor: 'var(--color-info)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--color-warn-bright)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-accent)' }} />
        </linearGradient>
      </defs>
      <rect className={line} x="62" y="12" width="122" height="72" rx="4" />
      <polyline className={line} points="62,70 92,46 108,58 132,34 160,60 184,48" />
      <circle className="fill-accent" cx="160" cy="28" r="5" />
      <rect className={soft} x="68" y="18" width="46" height="13" rx="3" />
      <text className={label} fontSize={8} x="71" y="27.5">
        ALT 120 m
      </text>
      <rect className={soft} x="200" y="22" width="56" height="9" rx="2" />
      <rect className={soft} x="200" y="40" width="80" height="9" rx="2" />
      <rect className={soft} x="200" y="58" width="38" height="9" rx="2" />
      <line className={accent} x1="232" y1="16" x2="232" y2="74" />
      <rect x="200" y="76" width="80" height="6" rx="2" fill={`url(#${lut})`} />
    </Frame>
  );
}

const TOLD = [1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1];

/** A route to a pin over a row of days, told days in the accent — the door's own strip. */
function TripsArt() {
  return (
    <Frame>
      <path className={line} strokeDasharray="2 5" d="M49,44 C70,18 96,52 121,34 S168,16 193,38 S238,26 265,22" />
      <circle className={solid} cx="49" cy="44" r="3" />
      <circle className={solid} cx="121" cy="34" r="3" />
      <circle className={solid} cx="193" cy="38" r="3" />
      <path className="fill-accent" d="M265,8 c-6,0 -9,4.5 -9,9 c0,6 9,14 9,14 s9,-8 9,-14 c0,-4.5 -3,-9 -9,-9z" />
      <circle className="fill-paper-2" cx="265" cy="17" r="3" />
      {TOLD.map((on, i) => (
        <rect key={i} className={on ? 'fill-accent' : soft} x={40 + i * 24} y="66" width="18" height="16" rx="2" />
      ))}
    </Frame>
  );
}

const HISTOGRAM = [8, 14, 22, 30, 26, 34, 40, 30, 22, 16, 12, 8, 6];

/** A picture beside its tone curve over a histogram. */
function DevelopArt() {
  return (
    <Frame>
      <rect className={soft} x="50" y="12" width="100" height="72" rx="3" />
      <rect className={line} x="50" y="12" width="100" height="72" rx="3" />
      <polyline className={line} points="50,66 78,44 96,56 118,36 150,62" />
      <circle className={solid} cx="126" cy="26" r="5" />
      {HISTOGRAM.map((h, i) => (
        <rect key={i} className={soft} x={172 + i * 7} y={82 - h} width="5" height={h} rx="1" />
      ))}
      <line className="stroke-line [stroke-width:1.5]" x1="168" y1="47" x2="268" y2="47" />
      <line className="stroke-line [stroke-width:1.5]" x1="218" y1="12" x2="218" y2="84" />
      <rect className={line} x="168" y="12" width="100" height="72" rx="3" />
      <path className={accent} d="M168,84 C196,82 204,60 218,48 S244,14 268,12" />
      <circle className="fill-accent" cx="193" cy="72" r="3.5" />
      <circle className="fill-accent" cx="243" cy="24" r="3.5" />
    </Frame>
  );
}

/** Flights over a coast, one comet in the air, the clock in the corner. */
function AtlasArt() {
  return (
    <Frame>
      <path
        className={soft}
        d="M0,96 L0,62 C30,58 44,70 70,64 S110,40 140,48 S170,74 200,70 S250,52 280,58 S310,66 320,62 L320,96 Z"
      />
      <path className={line} d="M74,40 C100,14 128,60 164,30" />
      <path className={line} d="M90,70 C120,40 170,58 196,22" />
      <path className={line} d="M150,82 C180,60 220,74 250,40" />
      <path className="fill-none stroke-line [stroke-width:1.5] [stroke-linecap:round]" d="M206,30 C230,14 250,26 262,16" />
      <path className={accent} opacity="0.35" d="M70,52 C110,28 150,64 190,40 S238,30 252,26" />
      <path className={accent} d="M190,40 C210,30 238,30 252,26" />
      <circle className="fill-accent" cx="252" cy="26" r="4" />
      <circle className="fill-accent" opacity="0.18" cx="252" cy="26" r="9" />
      <text className={label} fontSize={8} x="20" y="20">
        14:32
      </text>
    </Frame>
  );
}

const WAVE = [6, 14, 24, 10, 30, 18, 8, 22, 34, 16, 10, 20, 6];

/** A voice, then one vertical episode between its neighbours, on to the next. */
function StorytellingArt() {
  return (
    <Frame>
      {WAVE.map((h, i) => (
        <rect key={i} className={solid} x={36 + i * 6} y={48 - h / 2} width="3" height={h} rx="1.5" />
      ))}
      <rect className={line} opacity="0.6" x="128" y="22" width="30" height="54" rx="4" />
      <rect className={soft} x="166" y="8" width="44" height="80" rx="5" />
      <rect className={line} x="166" y="8" width="44" height="80" rx="5" />
      <path className={line} d="M172,44 C182,30 192,52 204,36" />
      <circle className="fill-accent" cx="204" cy="36" r="2.5" />
      <rect className={solid} x="172" y="64" width="32" height="4" rx="2" />
      <rect className={solid} opacity="0.6" x="176" y="71" width="24" height="3" rx="1.5" />
      <text className={label} fontSize={8} x="171" y="20">
        EP.00
      </text>
      <rect className={line} opacity="0.6" x="218" y="22" width="30" height="54" rx="4" />
      <path className={accent} d="M252,49 L270,49 M264,43 L270,49 L264,55" />
    </Frame>
  );
}

const ART: Record<string, () => ReactNode> = {
  studio: StudioArt,
  roadtrip: TripsArt,
  develop: DevelopArt,
  atlas: AtlasArt,
  storytelling: StorytellingArt,
};
