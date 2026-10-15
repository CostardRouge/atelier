import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FieldRow, InspectorSection, SliderRow, TextField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import Button from '../../shared/ui/Button';
import IconButton from '../../shared/ui/IconButton';
import { Icons } from '../../shared/ui/icons';
import AtlasMore from './AtlasMore';
import { addLogo, forgetLogo, useAtlasLogos } from './atlas-logos';
import { STICKER_FONT } from './atlas-overlay';
import type { AtlasSettings, DroneLine, Spot } from './atlas-settings';
import { makerKey, stickerParts, type StickerBacking, type StickerInk, type StickerSettings, type StickerStyle } from './atlas-sticker';

interface AtlasStickerSectionProps {
  settings: AtlasSettings;
  update: (fn: (s: AtlasSettings) => AtlasSettings) => void;
  /** Every drone name the shown flights carry, as the atlas writes it. */
  names: readonly string[];
  /** Where a piece goes — the inspector's own six-spot row. */
  spotRow: (value: Spot, onChange: (v: Spot) => void) => ReactNode;
  /** Opens the flight list, where drones are named. */
  onNameDrones: () => void;
}

/**
 * The gear sticker's dials: which drones get one and where, the style
 * (two weights, or the maker's logo), its ink, backing and size, the maker
 * written in front of a bare model, where each name turns light, and the
 * makers' logos kept on this device.
 */
export default function AtlasStickerSection({ settings: s, update, names, spotRow, onNameDrones }: AtlasStickerSectionProps) {
  const sticker = s.hud.sticker;
  const set = (patch: Partial<StickerSettings>) => update((cur) => ({ ...cur, hud: { ...cur.hud, sticker: { ...cur.hud.sticker, ...patch } } }));
  const setWeight = (name: string, k: number | null) =>
    update((cur) => {
      const weights = { ...cur.aircraft.weights };
      if (k === null) delete weights[name];
      else weights[name] = k;
      return { ...cur, aircraft: { ...cur.aircraft, weights } };
    });
  const on = s.hud.drone !== 'off';
  const makers = useMemo(() => [...new Set(names.map((n) => stickerParts(n, sticker.maker).maker))], [names, sticker.maker]);

  return (
    <InspectorSection
      id="atlas.sticker"
      title="Drone sticker"
      marked={on}
      info="The drone that flew, written the way its maker does: «DJI MINI 5 PRO» with the model's body heavy and its qualifier light, or the maker's logo followed by the model in light. The name comes from the clip (the flights at the foot of the panel › Drone names), renamed or not."
    >
      <FieldRow label="Shows">
        <Segmented<DroneLine>
          size="sm"
          fill
          label="Which drones"
          value={s.hud.drone}
          onChange={(v) => update((cur) => ({ ...cur, hud: { ...cur.hud, drone: v } }))}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'all', label: 'All shown' },
            { id: 'flying', label: 'In the air' },
          ]}
        />
      </FieldRow>
      {on && (
        <>
          {names.length === 0 && (
            <div className="flex items-center justify-between gap-2 py-1">
              <p className="m-0 text-xs text-muted">No flight shown names its drone, so there is no sticker to draw.</p>
              <Button size="sm" variant="ghost" onClick={onNameDrones}>
                Name them
              </Button>
            </div>
          )}
          <FieldRow label="Style">
            <Segmented<StickerStyle>
              size="sm"
              fill
              label="Sticker style"
              value={sticker.style}
              onChange={(v) => set({ style: v })}
              options={[
                { id: 'type', label: 'Bold + light' },
                { id: 'logo', label: 'Logo + light' },
              ]}
            />
          </FieldRow>
          <SliderRow label="Size" value={sticker.size} min={12} max={80} step={1} format={(v) => `${Math.round(v)} px`} onChange={(v) => set({ size: v })} />
          {sticker.style === 'logo' &&
            makers.map((maker) => (
              <LogoRow key={makerKey(maker)} maker={maker} />
            ))}
          <AtlasMore id="atlas.sticker">
            {spotRow(s.hud.droneAt, (v) => update((cur) => ({ ...cur, hud: { ...cur.hud, droneAt: v } })))}
            <FieldRow label="Ink">
              <Segmented<StickerInk>
                size="sm"
                fill
                label="Sticker ink"
                value={sticker.ink}
                onChange={(v) => set({ ink: v })}
                options={[
                  { id: 'auto', label: 'Auto', title: 'White or black, whichever reads better on the ground under it' },
                  { id: 'text', label: 'Text', title: 'The overlay text colour' },
                  { id: 'accent', label: 'Accent' },
                  { id: 'white', label: 'White' },
                  { id: 'black', label: 'Black' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Backing">
              <Segmented<StickerBacking>
                size="sm"
                fill
                label="Sticker backing"
                value={sticker.backing}
                onChange={(v) => set({ backing: v })}
                options={[
                  { id: 'none', label: 'None' },
                  { id: 'shadow', label: 'Shadow' },
                  { id: 'plate', label: 'Plate' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Maker" hint="Written first when a name has no maker." hintShown={false}>
              <TextField label="Maker" value={sticker.maker} placeholder="DJI" onChange={(v) => set({ maker: v })} />
            </FieldRow>
            {sticker.style === 'type' &&
              names.map((name) => (
                <WeightRow key={name} name={name} maker={sticker.maker} weight={s.aircraft.weights[name]} onChange={(k) => setWeight(name, k)} />
              ))}
            {sticker.style === 'logo' && (
              <FieldRow label="Logo colour">
                <Segmented<'tint' | 'file'>
                  size="sm"
                  fill
                  label="Logo colour"
                  value={sticker.logoTint ? 'tint' : 'file'}
                  onChange={(v) => set({ logoTint: v === 'tint' })}
                  options={[
                    { id: 'tint', label: 'In the ink' },
                    { id: 'file', label: 'As it is' },
                  ]}
                />
              </FieldRow>
            )}
          </AtlasMore>
        </>
      )}
    </InspectorSection>
  );
}

/** One name's words as chips: a tap moves where the light weight starts; Auto gives the rule back. */
function WeightRow({ name, maker, weight, onChange }: { name: string; maker: string; weight: number | undefined; onChange: (k: number | null) => void }) {
  const parts = stickerParts(name, maker, weight);
  const k = parts.lightFrom;
  return (
    <FieldRow label={<span className="truncate">{name}</span>} align="start" hint="Tap a word: it and those after it turn light." hintShown={false}>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Weights of ${name}`}>
        <span className="h-7 px-2 inline-flex items-center rounded-control bg-paper-2 text-xs text-ink-soft" style={{ fontFamily: STICKER_FONT, fontWeight: 600 }}>
          {parts.maker}
        </span>
        {parts.words.map((w, i) => (
          <button
            key={`${w}-${i}`}
            type="button"
            aria-pressed={i >= k}
            title={i >= k ? 'Light — tap to change' : 'Heavy — tap to change'}
            onClick={() => onChange(i === k ? i + 1 : i)}
            className="h-7 px-2 inline-flex items-center rounded-control border border-line bg-paper text-xs text-ink aria-pressed:bg-paper-2 aria-pressed:text-ink-soft"
            style={{ fontFamily: STICKER_FONT, fontWeight: i >= k ? 300 : 600 }}
          >
            {w}
          </button>
        ))}
        {weight !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Auto
          </Button>
        )}
      </div>
    </FieldRow>
  );
}

/** A maker's logo: import one from this device's files, or forget it. */
function LogoRow({ maker }: { maker: string }) {
  const logos = useAtlasLogos();
  const logo = logos.get(makerKey(maker));
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const hint = error ?? (logo?.opaque ? 'This file has no transparency: in the ink it draws as a block — keep it «As it is», or use an SVG or a PNG.' : 'An SVG or a transparent PNG from your own files, kept on this device only. Without one, the maker is written in the heavy weight.');
  return (
    <FieldRow label={`${maker} logo`} hint={hint} hintShown={!!error || !!logo?.opaque}>
      <div className="flex items-center gap-1.5 min-w-0">
        {logo ? (
          <>
            <span className="h-8 px-2 inline-flex items-center rounded-control bg-frame border border-line min-w-0">
              <img src={logo.image.src} alt={`${maker} logo`} className="h-4 w-auto max-w-[7rem] object-contain" />
            </span>
            <IconButton size="sm" variant="ghost" label={`Forget the ${maker} logo`} onClick={() => void forgetLogo(maker)}>
              {Icons.trash}
            </IconButton>
          </>
        ) : null}
        <Button size="sm" variant={logo ? 'ghost' : 'default'} onClick={() => input.current?.click()}>
          {Icons.upload} {logo ? 'Replace' : 'Import'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".svg,.png,.webp,.jpg,.jpeg,image/svg+xml,image/png,image/webp,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            void addLogo(maker, file).then((r) => setError(r.ok ? null : r.reason));
          }}
        />
      </div>
    </FieldRow>
  );
}
