import type { ReactNode } from 'react';
import { PAL } from '../../shared/story/charte';
import { storyFaceChoices, storyRoleChoices } from '../../shared/story/fonts';
import FontPicker from '../../shared/ui/FontPicker';
import type { FontChoice } from '../../shared/ui/font-picker';
import { followsWhat, geometryKey, PALETTE_KEYS, PALETTE_LABEL, type ObjectStyle } from '../../shared/story/objects';
import { styleIn, withSceneTiming, withStyle, withoutStyle, type StyleScope } from '../../shared/story/studio-edit';
import type { StoryScript } from '../../shared/story/story-script';
import Button from '../../shared/ui/Button';
import { FieldRow, Readout, SelectField, SliderRow, swatchClass, SwitchRow, type SelectOption } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';

const SCOPES = [
  { id: 'series' as const, label: 'Every post', title: 'Set it for this object in every post of the series' },
  { id: 'post' as const, label: 'This post', title: 'Set it for this post alone, over the series' },
];

/** « As drawn »: the face the block asks for — no setting of its own. */
const AS_DRAWN: FontChoice = { id: '', label: 'As drawn', family: 'Geist, "Helvetica Neue", Arial, sans-serif', weights: [300, 400, 600], group: 'The block’s own', note: 'block', system: true };
const FACES = storyFaceChoices();
const WEIGHTS: readonly SelectOption<string>[] = [{ id: '', label: 'As drawn' }, ...[300, 400, 500, 600, 700, 800, 900].map((w) => ({ id: String(w), label: String(w) }))];
const CASES: readonly SelectOption<string>[] = [
  { id: '', label: 'As written' },
  { id: 'upper', label: 'CAPITALS' },
  { id: 'lower', label: 'lower case' },
];
const COLOR_TOKENS: readonly SelectOption<string>[] = [
  { id: '', label: 'As drawn' },
  ...PALETTE_KEYS.map((k) => ({ id: `@${k}`, label: `Charte · ${PALETTE_LABEL[k]}` })),
  { id: 'hex', label: 'Custom…' },
];

/** A colour: a palette token, or a hex of its own beside the swatch. */
function ColorRow({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const token = value === undefined ? '' : value.startsWith('@') ? value : 'hex';
  const hex = value && !value.startsWith('@') ? value : value?.startsWith('@') ? (PAL[value.slice(1) as keyof typeof PAL] ?? '#000000') : '#000000';
  return (
    <FieldRow label={label}>
      <div className="flex items-center gap-2 min-w-0 w-full">
        <SelectField label={label} value={token} options={COLOR_TOKENS} onChange={(id) => onChange(id === '' ? undefined : id === 'hex' ? hex : id)} />
        <input type="color" aria-label={`${label}, any colour`} className={swatchClass} value={hex} onChange={(e) => onChange(e.target.value)} />
      </div>
    </FieldRow>
  );
}

interface ObjectPanelProps {
  script: StoryScript | null;
  onScript: (script: StoryScript) => void;
  postId: string;
  /** The object's key (`counter.number`) and whether it draws text. */
  objKey: string;
  text: boolean;
  /** For a scene: its index among the post's blocks and its timing as drawn, so it can be timed anew. */
  scene?: { index: number; len: number; cap: { a: number; b: number } | null; set: { len?: number; cap?: { a: number; b: number } } } | null;
  /** Where the settings are written: every post of the series, or this post alone (shared with a drag on the stage). */
  scope: StyleScope;
  onScope: (scope: StyleScope) => void;
  /** The object's own words, which its font picker writes its rows in. */
  sample?: string;
  /** A style being tried while a face list is browsed (the stage draws it), null when it closes. */
  onPreview?: (s: StoryScript | null) => void;
  /** What the object says and where its words come from (`ObjectContent`), shown first. */
  content?: ReactNode;
}

/**
 * One object of the post, set (`objects.ts`): first what it says and where
 * its words come from (Studio lab, his « cliquer sur le texte … pouvoir le
 * changer »), then its typography when it draws text, where it sits, its
 * size, rotation and opacity, its shadow and delay —
 * for every post of the series or this post alone, the post's winning. A
 * scene also takes its length and its caption's window, this post's own.
 */
export default function ObjectPanel({ script, onScript, postId, objKey, text, scene, scope, onScope: setScope, sample, onPreview, content }: ObjectPanelProps) {
  if (!script) return <p className="m-0 text-xs text-muted leading-relaxed">Load your script first: the settings are kept in it.</p>;
  const series = styleIn(script, postId, objKey, 'series');
  const own = styleIn(script, postId, objKey, 'post');
  const shown: ObjectStyle = scope === 'series' ? series : { ...series, ...own };
  const here = scope === 'series' ? series : own;
  const set = (patch: Partial<Record<keyof ObjectStyle, unknown>>) => onScript(withStyle(script, postId, objKey, patch, scope));
  const num = (v: number | undefined, d: number) => v ?? d;
  // A part of a map takes the map's place, size and turn: its Place rows set the map's (`geometryKey`).
  const gk = geometryKey(objKey);
  const geo: ObjectStyle = gk === objKey ? shown : scope === 'series' ? styleIn(script, postId, gk, 'series') : { ...styleIn(script, postId, gk, 'series'), ...styleIn(script, postId, gk, 'post') };
  const setGeo = (patch: Partial<Record<keyof ObjectStyle, unknown>>) => onScript(withStyle(script, postId, gk, patch, scope));

  return (
    <div className="flex flex-col gap-2.5">
      {content ? (
        <>
          <p className="m-0 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Content</p>
          {content}
        </>
      ) : null}
      <Segmented options={SCOPES} value={scope} onChange={setScope} size="sm" fill label="Where these settings apply" />
      {scope === 'post' && Object.keys(series).length ? <Readout muted>The series&apos; settings show through; what you set here wins in this post.</Readout> : null}

      <SwitchRow label="Shown" checked={!shown.hidden} onChange={(on) => set({ hidden: on ? undefined : true })} />

      {text ? (
        <>
          <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Text</p>
          <FieldRow label="Font">
            <FontPicker
              label="Font"
              value={shown.font ?? ''}
              options={[AS_DRAWN, ...storyRoleChoices(script.look?.charte?.fonts), ...FACES]}
              sample={sample}
              weight={shown.weight ?? 600}
              onChange={(id) => set({ font: id || undefined })}
              onPreview={onPreview ? (id) => onPreview(id === null ? null : withStyle(script, postId, objKey, { font: id || undefined }, scope)) : undefined}
            />
          </FieldRow>
          <FieldRow label="Weight">
            <SelectField label="Weight" value={shown.weight ? String(shown.weight) : ''} options={WEIGHTS} onChange={(id) => set({ weight: id ? Number(id) : undefined })} />
          </FieldRow>
          {followsWhat(objKey) === 'badge' ? <Readout muted>Text size is its share of the badge: the others make room.</Readout> : null}
          <SliderRow label="Text size" value={num(shown.size, 100)} min={20} max={300} step={1} reset={100} format={(v) => `${v} %`} onChange={(v) => set({ size: v === 100 ? undefined : v })} />
          <SliderRow label="Spacing" value={num(shown.tracking, 0)} min={-5} max={40} step={0.5} reset={0} format={(v) => `${v} px`} onChange={(v) => set({ tracking: v || undefined })} />
          <ColorRow label="Colour" value={shown.color} onChange={(color) => set({ color })} />
          <FieldRow label="Case">
            <SelectField label="Case" value={shown.textCase ?? ''} options={CASES} onChange={(id) => set({ textCase: id || undefined })} />
          </FieldRow>
          <SliderRow label="Outline" value={num(shown.outline, 0)} min={0} max={20} step={0.5} reset={0} format={(v) => `${v} px`} onChange={(v) => set({ outline: v || undefined })} />
          {shown.outline ? <ColorRow label="Outline colour" value={shown.outlineColor} onChange={(outlineColor) => set({ outlineColor })} /> : null}
        </>
      ) : null}

      <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Place</p>
      {gk !== objKey ? (
        <Readout muted>
          {followsWhat(objKey) === 'badge'
            ? 'Part of the badge: these move and size it whole.'
            : 'Drawn on the map, it moves, grows and turns with it: these set the map.'}
        </Readout>
      ) : null}
      <SliderRow label="Across" value={num(geo.dx, 0)} min={-540} max={540} step={1} reset={0} format={(v) => `${Math.round(v)} px`} onChange={(v) => setGeo({ dx: v || undefined })} />
      <SliderRow label="Down" value={num(geo.dy, 0)} min={-960} max={960} step={1} reset={0} format={(v) => `${Math.round(v)} px`} onChange={(v) => setGeo({ dy: v || undefined })} />
      <SliderRow
        label="Size"
        value={Math.round(num(geo.scale, 1) * 100)}
        min={10}
        max={300}
        step={1}
        reset={100}
        format={(v) => `${v} %`}
        onChange={(v) => setGeo({ scale: v === 100 ? undefined : v / 100 })}
      />
      <SliderRow label="Rotation" value={num(geo.rotate, 0)} min={-180} max={180} step={0.5} reset={0} format={(v) => `${v}°`} onChange={(v) => setGeo({ rotate: v || undefined })} />
      <SliderRow
        label="Opacity"
        value={Math.round(num(shown.opacity, 1) * 100)}
        min={0}
        max={100}
        step={1}
        reset={100}
        format={(v) => `${v} %`}
        onChange={(v) => set({ opacity: v === 100 ? undefined : v / 100 })}
      />

      <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Shadow</p>
      <SliderRow label="Blur" value={num(shown.shadow, 0)} min={0} max={60} step={1} reset={0} format={(v) => (v ? `${v} px` : 'none')} onChange={(v) => set({ shadow: v || undefined })} />
      {shown.shadow ? (
        <>
          <SliderRow label="Drop" value={num(shown.shadowY, 8)} min={-30} max={40} step={1} reset={8} format={(v) => `${v} px`} onChange={(v) => set({ shadowY: v === 8 ? undefined : v })} />
          <SliderRow
            label="Strength"
            value={Math.round(num(shown.shadowOpacity, 0.3) * 100)}
            min={0}
            max={100}
            step={1}
            reset={30}
            format={(v) => `${v} %`}
            onChange={(v) => set({ shadowOpacity: v === 30 ? undefined : v / 100 })}
          />
          <ColorRow label="Shadow colour" value={shown.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
        </>
      ) : null}

      <p className="m-0 mt-1 font-mono text-3xs uppercase tracking-[0.12em] text-muted">Time</p>
      <SliderRow label="Delay" value={num(shown.delay, 0)} min={-2} max={4} step={0.05} reset={0} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ delay: v || undefined })} />
      {scene ? (
        <>
          <SliderRow
            label="Scene length"
            value={scene.len}
            min={1}
            max={20}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => onScript(withSceneTiming(script, postId, scene.index, { len: v }))}
          />
          {scene.cap ? (
            <>
              <SliderRow
                label="Caption from"
                value={scene.cap.a}
                min={0}
                max={Math.max(0.5, scene.len - 0.3)}
                step={0.05}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(a) => onScript(withSceneTiming(script, postId, scene.index, { cap: { a, b: Math.max(a + 0.2, scene.cap!.b) } }))}
              />
              <SliderRow
                label="Caption to"
                value={scene.cap.b}
                min={0.2}
                max={scene.len}
                step={0.05}
                format={(v) => `${v.toFixed(2)} s`}
                onChange={(b) => onScript(withSceneTiming(script, postId, scene.index, { cap: { a: Math.min(scene.cap!.a, b - 0.2), b } }))}
              />
            </>
          ) : null}
          {scene.set.len !== undefined || scene.set.cap ? (
            <div>
              <Button size="sm" variant="ghost" onClick={() => onScript(withSceneTiming(script, postId, scene.index, { len: null, cap: null }))}>
                Back to the post&apos;s timing
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {Object.keys(here).length ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => onScript(withoutStyle(script, postId, objKey, scope))}>
            {scope === 'series' ? 'Reset this object in every post' : 'Reset this object in this post'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
