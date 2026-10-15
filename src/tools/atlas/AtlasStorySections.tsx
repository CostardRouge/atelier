import type { ReactNode } from 'react';
import { FieldRow, InspectorSection, SliderRow, SwitchRow, TextField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import AtlasMore from './AtlasMore';
import type { AtlasSettings } from './atlas-settings';
import { INTRO_LENGTH, type IntroBehind, type IntroInto, type IntroSettings, type IntroStyle, type OutroSettings, type OutroStyle } from './atlas-story';

type Update = (fn: (s: AtlasSettings) => AtlasSettings) => void;

const secs = (v: number) => `${v.toFixed(1)} s`;

/** A style as a small picture of what it does, pressed while chosen. */
function StyleTiles<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string; picture: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className="flex flex-col items-stretch gap-1 p-1 rounded-control border-2 border-transparent bg-paper hover:border-line-strong transition-colors aria-pressed:border-accent"
        >
          <svg viewBox="0 0 80 46" className="block w-full h-auto rounded-[6px]" aria-hidden="true">
            {o.picture}
          </svg>
          <span className="text-2xs text-ink-soft truncate text-center">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The pictures paint in the look's own colours, so a tile shows the frame it makes. */
function tones(s: AtlasSettings) {
  return { ground: s.map.background, land: s.map.landColour, trail: s.colour.trail, ink: s.hud.theme.style.color, accent: s.hud.accent };
}

const NONE = (trail: string, ground: string) => (
  <>
    <rect width="80" height="46" fill={ground} />
    <path d="M14 36 C24 20 40 18 56 10" fill="none" stroke={trail} strokeWidth="2" strokeLinecap="round" />
  </>
);

interface StoryProps {
  settings: AtlasSettings;
  update: Update;
  /** What the title says when the field is empty — the overlay's title or the place. */
  autoTitle: string;
  /** What the intro's second line says when its field is empty. */
  autoLine: string;
  /** Whether any shown flight names its drone — a sticker has something to say. */
  hasSticker: boolean;
}

/** Before the first flight: a title card, the map revealed, the world dived into, or nothing. */
export function IntroSection({ settings: s, update, autoTitle, autoLine, hasSticker }: StoryProps) {
  const intro = s.intro;
  const set = (patch: Partial<IntroSettings>) => update((cur) => ({ ...cur, intro: { ...cur.intro, ...patch } }));
  const c = tones(s);
  const on = intro.style !== 'none';
  return (
    <InspectorSection
      id="atlas.intro"
      title="Intro"
      marked={on}
      info="A few seconds before the first flight: the place, how many flights and when, the drone that flew. The flights keep their own length; the intro is added in front of them, and the video is that much longer. Empty fields write themselves from the flights."
    >
      <StyleTiles<IntroStyle>
        label="Intro"
        value={intro.style}
        onChange={(v) => set({ style: v })}
        options={[
          {
            id: 'title',
            label: 'Title card',
            picture: (
              <>
                <rect width="80" height="46" fill="#000" />
                <rect x="18" y="17" width="44" height="6" rx="2" fill={c.ink} />
                <rect x="26" y="27" width="28" height="3" rx="1.5" fill={c.ink} opacity="0.55" />
              </>
            ),
          },
          {
            id: 'reveal',
            label: 'Map reveal',
            picture: (
              <>
                <rect width="80" height="46" fill={c.ground} />
                <path d="M0 32 C16 30 30 38 46 46 L0 46 Z" fill={c.land} />
                <rect width="80" height="46" fill="#000" opacity="0.5" />
                <rect x="20" y="18" width="40" height="6" rx="2" fill={c.ink} />
              </>
            ),
          },
          {
            id: 'dive',
            label: 'World dive',
            picture: (
              <>
                <rect width="80" height="46" fill={c.ground} />
                <ellipse cx="22" cy="20" rx="12" ry="9" fill={c.land} />
                <ellipse cx="50" cy="16" rx="16" ry="8" fill={c.land} />
                <ellipse cx="58" cy="32" rx="9" ry="6" fill={c.land} />
                <circle cx="42" cy="15" r="7" fill="none" stroke={c.accent} strokeWidth="1.4" />
                <circle cx="42" cy="15" r="1.8" fill={c.accent} />
              </>
            ),
          },
          { id: 'none', label: 'None', picture: NONE(c.trail, c.ground) },
        ]}
      />
      {on && (
        <SliderRow label="Length" value={intro.length} min={INTRO_LENGTH.min} max={INTRO_LENGTH.max} step={0.5} format={secs} onChange={(v) => set({ length: v })} />
      )}
      {on && (
        <FieldRow label="Title">
          <TextField label="Intro title" value={intro.title} placeholder={autoTitle || 'The place the flights share'} onChange={(v) => set({ title: v })} />
        </FieldRow>
      )}
      {on && (
        <AtlasMore id="atlas.intro">
          {intro.style === 'title' && (
            <FieldRow label="Behind">
              <Segmented<IntroBehind>
                size="sm"
                fill
                label="Behind the title"
                value={intro.behind}
                onChange={(v) => set({ behind: v })}
                options={[
                  { id: 'black', label: 'Black' },
                  { id: 'ground', label: 'Map colour' },
                  { id: 'map', label: 'Map, dimmed' },
                ]}
              />
            </FieldRow>
          )}
          {intro.style === 'title' && (
            <FieldRow label="Into flights">
              <Segmented<IntroInto>
                size="sm"
                fill
                label="Into the flights"
                value={intro.into}
                onChange={(v) => set({ into: v })}
                options={[
                  { id: 'fade', label: 'Fade' },
                  { id: 'black', label: 'Through black' },
                  { id: 'cut', label: 'Cut' },
                ]}
              />
            </FieldRow>
          )}
          <FieldRow label="Line 2">
            <TextField label="Intro second line" value={intro.line} placeholder={autoLine} onChange={(v) => set({ line: v })} />
          </FieldRow>
          <SwitchRow
            label="The drone sticker under the title"
            checked={intro.sticker}
            onChange={(v) => set({ sticker: v })}
            hint={hasSticker ? 'Drawn as the Sticker layer sets it.' : 'No shown flight names its drone yet.'}
            hintShown={!hasSticker}
          />
        </AtlasMore>
      )}
    </InspectorSection>
  );
}

/** After the last landing: the totals counted up, the camera stepping back, a fade, or nothing. */
export function OutroSection({ settings: s, update, hasSticker }: Omit<StoryProps, 'autoTitle' | 'autoLine'>) {
  const outro = s.outro;
  const set = (patch: Partial<OutroSettings>) => update((cur) => ({ ...cur, outro: { ...cur.outro, ...patch } }));
  const c = tones(s);
  const on = outro.style !== 'none';
  return (
    <InspectorSection
      id="atlas.outro"
      title="Outro"
      marked={on}
      info="A few seconds after the last landing: the totals counted up over the darkened map, the camera stepping back over every route, or a fade to black. Added after the flights; the video is that much longer."
    >
      <StyleTiles<OutroStyle>
        label="Outro"
        value={outro.style}
        onChange={(v) => set({ style: v })}
        options={[
          {
            id: 'summary',
            label: 'Summary',
            picture: (
              <>
                <rect width="80" height="46" fill={c.ground} />
                <rect width="80" height="46" fill="#000" opacity="0.6" />
                <rect x="12" y="16" width="12" height="7" rx="1.5" fill={c.ink} />
                <rect x="28" y="16" width="12" height="7" rx="1.5" fill={c.ink} />
                <rect x="44" y="16" width="12" height="7" rx="1.5" fill={c.ink} />
                <rect x="60" y="16" width="9" height="7" rx="1.5" fill={c.ink} />
                <rect x="24" y="30" width="32" height="3" rx="1.5" fill={c.accent} />
              </>
            ),
          },
          {
            id: 'pull',
            label: 'Pull back',
            picture: (
              <>
                <rect width="80" height="46" fill={c.ground} />
                <g fill="none" strokeLinecap="round" strokeWidth="1.2" stroke={c.trail}>
                  <path d="M30 30 C34 22 40 22 44 16" />
                  <path d="M40 28 C44 26 48 24 52 22" />
                </g>
                <rect x="22" y="8" width="36" height="4" rx="1.5" fill={c.ink} />
              </>
            ),
          },
          {
            id: 'fade',
            label: 'Fade out',
            picture: (
              <>
                <rect width="80" height="46" fill="#000" />
                <rect x="24" y="21" width="32" height="3" rx="1.5" fill={c.ink} opacity="0.55" />
              </>
            ),
          },
          { id: 'none', label: 'None', picture: NONE(c.trail, c.ground) },
        ]}
      />
      {on && (
        <SliderRow label="Length" value={outro.length} min={INTRO_LENGTH.min} max={INTRO_LENGTH.max} step={0.5} format={secs} onChange={(v) => set({ length: v })} />
      )}
      {on && (
        <FieldRow label="Last line">
          <TextField label="The outro's last line" value={outro.line} placeholder="Nothing" onChange={(v) => set({ line: v })} />
        </FieldRow>
      )}
      {on && (
        <AtlasMore id="atlas.outro">
          {outro.style === 'summary' && (
            <SwitchRow label="Count the totals up" checked={outro.totals} onChange={(v) => set({ totals: v })} hint="Flights, distance, airtime, highest." />
          )}
          {outro.style !== 'fade' && (
            <SwitchRow
              label="The drone sticker"
              checked={outro.sticker}
              onChange={(v) => set({ sticker: v })}
              hint={hasSticker ? undefined : 'No shown flight names its drone yet.'}
              hintShown={!hasSticker}
            />
          )}
        </AtlasMore>
      )}
    </InspectorSection>
  );
}
