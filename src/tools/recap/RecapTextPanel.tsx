import { withRecap, withTextStyle, NUMBER_PLACES, type NumberAt, type RecapDoc, type RecapFont } from '../../shared/recap/recap-doc';
import { TEXT_WORDS } from '../../shared/recap/recap-slots';
import { PIN } from '../../shared/recap/recap-places';
import { DEFAULT_TEXT_STYLE, TEXT_PRESETS, TEXT_ROLE_LABEL, presetStyle, rolesOf, textStyleOf, type TextRole, type TextStyle } from '../../shared/recap/recap-text';
import { STORY_FONTS, storyFaceChoices } from '../../shared/story/fonts';
import type { FontChoice } from '../../shared/ui/font-picker';
import FontPicker from '../../shared/ui/FontPicker';
import { InspectorSection, SliderRow, TextField, ToggleField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import type { Change } from './RecapPanels';

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** `auto` in the face list: the recap's own typeface, or the face each place draws by default. */
const AUTO: FontChoice = { id: '', label: 'Auto', family: 'inherit', weights: [400], group: 'This recap', note: 'its typeface', system: true };
const FACES = [AUTO, ...storyFaceChoices()];

const NUMBER_LABEL: Record<NumberAt, string> = { topLeft: 'Top left', topRight: 'Top right', centre: 'Centre', bottomLeft: 'Bottom left', foot: 'Under the picture' };

/** A preset's name written in its own dress — the tile shows what it does (Jakob: the suite's own styles). */
function PresetTile({ id, name, tagline, style, on, onPick }: { id: string; name: string; tagline: string; style: Omit<TextStyle, 'preset'>; on: boolean; onPick: () => void }) {
  const face = style.font === 'auto' ? 'inherit' : STORY_FONTS[style.font].family;
  const glow = style.glow > 0 ? `0 0 ${Math.round(4 + style.glow * 10)}px ${style.colour ?? '#f4f0e7'}` : '';
  const shadow = style.shadow > 0 ? `0 2px ${Math.round(style.shadowBlur * 10)}px rgba(0,0,0,${style.shadow})` : '';
  return (
    <button
      type="button"
      aria-pressed={on}
      title={tagline}
      onClick={onPick}
      data-preset={id}
      className={`min-h-11 px-2 py-1.5 rounded-control border bg-frame text-center truncate transition-colors ${on ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-line-strong'}`}
      style={{
        fontFamily: face,
        fontWeight: style.weight,
        color: style.colour ?? '#f4f0e7',
        textTransform: style.upper ? 'uppercase' : 'none',
        letterSpacing: style.tracking ? `${style.tracking}em` : undefined,
        WebkitTextStroke: style.outline > 0 ? `${Math.max(1, style.outline * 12)}px ${style.outlineColour}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: [glow, shadow].filter(Boolean).join(', ') || undefined,
        fontSize: 15,
      }}
    >
      {name}
    </button>
  );
}

/**
 * The Text tab: one TEXT at a time — the one clicked on the stage, or picked
 * here — with its words (heading, subheading, call to action), a style preset
 * (the suite's title styles and Recap's own), then its face (Storytelling's
 * picker: hover a face and the stage wears it), size, weight, colour, case,
 * spacing, outline, shadow and glow. Every text keeps its own; *Apply to every
 * text* dresses them all alike; *Reset* gives it back its place's defaults.
 */
export default function RecapTextPanel({
  doc,
  change,
  vars: counted,
  role,
  onRole,
  onPreview,
}: {
  doc: RecapDoc;
  change: Change;
  vars: Readonly<Record<string, string>>;
  role: TextRole;
  onRole: (role: TextRole) => void;
  /** A face being tried on the stage, or null. */
  onPreview: (role: TextRole, font: string | null) => void;
}) {
  // The pin the stage draws for `{place}` reads as 📍 in the panel's own words.
  const vars = Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, v.split(PIN).join('📍')]));
  const roles = rolesOf(doc.template);
  const current = roles.includes(role) ? role : roles[0];
  const st = textStyleOf(doc.texts, current);
  const owned = Boolean(doc.texts[current]);
  const set = (patch: Partial<TextStyle>) => change((d) => withTextStyle(d, current, patch));
  const words = current === 'heading' || current === 'subheading' || current === 'cta' ? current : null;

  return (
    <>
      <InspectorSection id="recap-text-which" title="Text" foldable={false}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Which text">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === current}
              onClick={() => onRole(r)}
              className={`h-8 pointer-coarse:h-11 px-2.5 rounded-full border text-xs ${r === current ? 'bg-ink text-paper border-ink' : 'border-line text-ink-soft hover:border-line-strong'}`}
            >
              {TEXT_ROLE_LABEL[r]}
              {doc.texts[r] && <span className="ml-1 text-accent" aria-hidden="true">•</span>}
            </button>
          ))}
        </div>
        {words && (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="flex items-center justify-between">
              <span className={legend}>Its words</span>
              <ToggleField checked={doc[words].show} onChange={(show) => change((d) => withRecap(d, { [words]: { ...d[words], show } }))} label={`Show the ${TEXT_ROLE_LABEL[words].toLowerCase()}`} />
            </span>
            <TextField value={doc[words].text} onChange={(text) => change((d) => withRecap(d, { [words]: { ...d[words], text } }))} label={TEXT_ROLE_LABEL[words]} />
            <p className="m-0 text-2xs text-muted leading-relaxed">
              Counted for you:{' '}
              {TEXT_WORDS.map((w) => (
                <span key={w} className="inline-block mr-1.5 font-mono" title={vars[w]}>
                  {`{${w}}`}
                </span>
              ))}
            </p>
          </div>
        )}
      </InspectorSection>

      <InspectorSection id="recap-text-style" title="Style" marked={owned}>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1.5">
            {TEXT_PRESETS.map((p) => (
              <PresetTile key={p.id} id={p.id} name={p.name} tagline={p.tagline} style={p.style} on={st.preset === p.id} onPick={() => change((d) => withTextStyle(d, current, presetStyle(p.id)))} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => change((d) => rolesOf(d.template).reduce((acc, r) => withTextStyle(acc, r, owned ? { ...st } : null), d))}
              className="text-2xs text-accent-ink underline-offset-2 hover:underline"
              title="Every text of this recap in this one's style"
            >
              Apply to every text
            </button>
            {owned && (
              <button type="button" onClick={() => change((d) => withTextStyle(d, current, null))} className="text-2xs text-muted underline-offset-2 hover:underline">
                Reset this text
              </button>
            )}
          </div>
        </div>
      </InspectorSection>

      <InspectorSection id="recap-text-face" title="Face">
        <div className="flex flex-col gap-2">
          <FontPicker
            label={`${TEXT_ROLE_LABEL[current]} face`}
            value={st.font === 'auto' ? '' : st.font}
            options={FACES}
            weight={st.weight}
            sample={words ? doc[words].text.replace(/\{(\w+)\}/g, (_, w: string) => vars[w] ?? w) : TEXT_ROLE_LABEL[current]}
            emptyLabel="Auto"
            onChange={(id) => {
              onPreview(current, null);
              set({ font: (id || 'auto') as TextStyle['font'] });
            }}
            onPreview={(id) => onPreview(current, id)}
          />
          <SliderRow label="Size" value={Math.round(st.size * 100)} min={40} max={300} step={5} reset={100} format={(v) => `${v} %`} onChange={(v) => set({ size: v / 100 })} />
          <SliderRow label="Weight" value={st.weight} min={300} max={900} step={100} reset={DEFAULT_TEXT_STYLE.weight} onChange={(weight) => set({ weight })} />
          <SliderRow label="Spacing" value={Math.round((st.tracking ?? 0) * 100)} min={-10} max={50} step={1} reset={0} format={(v) => `${v / 100} em`} onChange={(v) => set({ tracking: v / 100 })} />
          <Segmented
            size="sm"
            fill
            label="Capitals"
            value={st.upper === null ? 'auto' : st.upper ? 'upper' : 'lower'}
            onChange={(v) => set({ upper: v === 'auto' ? null : v === 'upper' })}
            options={[
              { id: 'auto', label: 'As placed' },
              { id: 'lower', label: 'Aa' },
              { id: 'upper', label: 'AA' },
            ]}
          />
          <div className="flex items-center gap-2">
            <ToggleField checked={st.colour !== null} onChange={(on) => set({ colour: on ? (st.colour ?? '#f4f0e7') : null })} label="Its own colour">
              Its own colour
            </ToggleField>
            {st.colour !== null && <input type="color" value={st.colour} onChange={(e) => set({ colour: e.target.value })} aria-label="Colour" className="w-11 h-9 p-0 border border-line rounded-control bg-transparent" />}
          </div>
          {current === 'dayNumber' && (
            <Segmented<NumberAt> size="sm" columns={2} label="Where the number sits" value={doc.cells.numberAt} onChange={(numberAt) => change((d) => withRecap(d, { cells: { ...d.cells, numberAt } }))} options={NUMBER_PLACES.map((n) => ({ id: n, label: NUMBER_LABEL[n] }))} />
          )}
        </div>
      </InspectorSection>

      <InspectorSection id="recap-text-outline" title="Outline" marked={st.outline > 0}>
        <div className="flex flex-col gap-1">
          <SliderRow label="Width" value={Math.round(st.outline * 100)} min={0} max={25} step={1} reset={0} format={(v) => (v ? `${v} %` : 'none')} onChange={(v) => set({ outline: v / 100 })} />
          {st.outline > 0 && (
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="color" value={st.outlineColour} onChange={(e) => set({ outlineColour: e.target.value })} aria-label="Outline colour" className="w-11 h-9 p-0 border border-line rounded-control bg-transparent" />
              Outline colour
            </label>
          )}
        </div>
      </InspectorSection>

      <InspectorSection id="recap-text-shadow" title="Shadow" marked={st.shadow > 0}>
        <div className="flex flex-col gap-1">
          <SliderRow label="Darkness" value={Math.round(st.shadow * 100)} min={0} max={100} step={1} reset={0} format={(v) => (v ? `${v} %` : 'none')} onChange={(v) => set({ shadow: v / 100 })} />
          <SliderRow label="Softness" value={Math.round(st.shadowBlur * 100)} min={0} max={150} step={1} reset={35} format={(v) => `${v} %`} onChange={(v) => set({ shadowBlur: v / 100 })} disabled={st.shadow === 0} />
          <SliderRow label="Drop" value={Math.round(st.shadowY * 100)} min={-50} max={50} step={1} reset={6} format={(v) => `${v} %`} onChange={(v) => set({ shadowY: v / 100 })} disabled={st.shadow === 0} />
        </div>
      </InspectorSection>

      <InspectorSection id="recap-text-glow" title="Glow" marked={st.glow > 0}>
        <div className="flex flex-col gap-1">
          <SliderRow label="Glow" value={Math.round(st.glow * 100)} min={0} max={100} step={1} reset={0} format={(v) => (v ? `${v} %` : 'none')} onChange={(v) => set({ glow: v / 100 })} />
          <SliderRow label="Warmth" value={Math.round(st.glowWarmth * 100)} min={0} max={100} step={1} reset={50} format={(v) => `${v} %`} onChange={(v) => set({ glowWarmth: v / 100 })} disabled={st.glow === 0} />
        </div>
      </InspectorSection>

      <InspectorSection id="recap-typeface" title="The recap's typeface">
        <div className="flex flex-col gap-1.5">
          <Segmented<RecapFont>
            size="sm"
            fill
            label="Typeface"
            value={doc.font}
            onChange={(font) => change((d) => withRecap(d, { font }))}
            options={[
              { id: 'sans', label: 'Sans' },
              { id: 'serif', label: 'Serif' },
              { id: 'mono', label: 'Mono' },
            ]}
          />
          <p className="m-0 text-2xs text-muted">What every text on Auto is set in.</p>
          {(doc.headingOffset.x !== 0 || doc.headingOffset.y !== 0) && (
            <button type="button" onClick={() => change((d) => withRecap(d, { headingOffset: { x: 0, y: 0 } }))} className="self-start text-2xs text-accent-ink underline-offset-2 hover:underline">
              Put the heading back in its place
            </button>
          )}
        </div>
      </InspectorSection>
    </>
  );
}
