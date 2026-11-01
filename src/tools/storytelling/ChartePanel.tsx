import { FONT_ROLES, ROLE_LABEL, STORY_FONTS, type StoryFontId } from '../../shared/story/fonts';
import { PALETTE_KEYS, PALETTE_LABEL, type PaletteKey } from '../../shared/story/objects';
import { withCharte } from '../../shared/story/studio-edit';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { FieldRow, Readout, SelectField, swatchClass, type SelectOption } from '../../shared/ui/Inspector';

/** The charte « lin » of the labs — what every token is until the series says otherwise. */
const LIN: Record<PaletteKey, string> = { bg: '#f1eee8', ink: '#18191c', acc: '#2f4fbf', dim: '#9b9890', soft: '#e2ded5', deep: '#d9d4c9' };

/** Whole palettes, one click each; the series can still change any token after. */
const PRESETS: readonly { id: string; label: string; palette: Record<PaletteKey, string> }[] = [
  { id: 'lin', label: 'Linen (the charte)', palette: LIN },
  { id: 'night', label: 'Night', palette: { bg: '#18191c', ink: '#f1eee8', acc: '#8aa4ff', dim: '#7d7b75', soft: '#26272b', deep: '#303135' } },
  { id: 'kraft', label: 'Kraft', palette: { bg: '#e6d8bd', ink: '#2b2118', acc: '#b5452b', dim: '#8c7b62', soft: '#d8c8a8', deep: '#cab894' } },
  { id: 'paper', label: 'White paper', palette: { bg: '#fdfcf9', ink: '#111111', acc: '#e0412b', dim: '#a3a09a', soft: '#eeece6', deep: '#e2dfd8' } },
  { id: 'sea', label: 'Sea', palette: { bg: '#e9f0f1', ink: '#10262e', acc: '#0f7c8c', dim: '#86999d', soft: '#d6e2e4', deep: '#c6d6d9' } },
];

const FACES: readonly SelectOption<StoryFontId>[] = Object.entries(STORY_FONTS).map(([id, f]) => ({ id: id as StoryFontId, label: f.label }));
const WEIGHTS: readonly SelectOption<string>[] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ id: String(w), label: String(w) }));
const DEFAULT_FACE: Record<(typeof FONT_ROLES)[number], StoryFontId> = { title: 'geist', text: 'geist', num: 'mono', hand: 'caveat' };

/**
 * The series' charte (`objects.ts`): its six colours — every block draws
 * with them, an object's colour may name one — its four font roles (titles,
 * text, numbers, hand) and its two weights. A palette is one click from a
 * preset and each colour can then be set alone.
 */
export default function ChartePanel({ script, onScript }: { script: StoryScript | null; onScript: (s: StoryScript) => void }) {
  if (!script) return <Readout muted>Load your script first: the charte is kept in it.</Readout>;
  const charte = script.look?.charte ?? {};
  const palette = { ...LIN, ...(charte.palette ?? {}) };
  const preset = PRESETS.find((p) => PALETTE_KEYS.every((k) => p.palette[k] === palette[k]))?.id ?? '';
  return (
    <div className="flex flex-col gap-2.5">
      <FieldRow label="Palette">
        <SelectField
          label="A whole palette"
          value={preset}
          options={[...(preset ? [] : [{ id: '', label: 'Your own' }]), ...PRESETS.map((p) => ({ id: p.id, label: p.label }))]}
          onChange={(id) => {
            const p = PRESETS.find((x) => x.id === id);
            if (!p) return;
            // The charte's own palette is no setting at all.
            onScript(withCharte(script, { palette: Object.fromEntries(PALETTE_KEYS.map((k) => [k, p.palette[k] === LIN[k] ? undefined : p.palette[k]])) }));
          }}
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {PALETTE_KEYS.map((k) => (
          <label key={k} className="flex items-center gap-2 min-w-0 text-sm text-ink-soft">
            <input
              type="color"
              className={swatchClass}
              aria-label={`${PALETTE_LABEL[k]} colour`}
              value={palette[k]}
              onChange={(e) => onScript(withCharte(script, { palette: { [k]: e.target.value === LIN[k] ? undefined : e.target.value } }))}
            />
            <span className="flex flex-col min-w-0">
              <span className="truncate">{PALETTE_LABEL[k]}</span>
              <span className="font-mono text-3xs text-muted">{palette[k]}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Faces</p>
      {FONT_ROLES.map((role) => (
        <FieldRow key={role} label={ROLE_LABEL[role]}>
          <SelectField
            label={`${ROLE_LABEL[role]} face`}
            value={charte.fonts?.[role] ?? DEFAULT_FACE[role]}
            options={FACES}
            onChange={(id) => onScript(withCharte(script, { fonts: { [role]: id === DEFAULT_FACE[role] ? undefined : id } }))}
          />
        </FieldRow>
      ))}
      <FieldRow label="Title weight">
        <SelectField
          label="Title weight"
          value={String(charte.titleWeight ?? 600)}
          options={WEIGHTS}
          onChange={(w) => onScript(withCharte(script, { titleWeight: w === '600' ? undefined : Number(w) }))}
        />
      </FieldRow>
      <FieldRow label="Light weight">
        <SelectField
          label="Light text weight"
          value={String(charte.lightWeight ?? 300)}
          options={WEIGHTS}
          onChange={(w) => onScript(withCharte(script, { lightWeight: w === '300' ? undefined : Number(w) }))}
        />
      </FieldRow>
      {script.look?.charte ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onScript(withCharte(script, null))}>
            Back to the charte « lin »
          </Button>
        </div>
      ) : null}
    </div>
  );
}
