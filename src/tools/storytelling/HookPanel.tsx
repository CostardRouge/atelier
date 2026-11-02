import type { ChangeEvent } from 'react';
import { VOICE_NAMES } from '../../shared/audio/voices';
import { HOOK_DEFAULTS, hookSoundFor, type Hook, type HookEntry, type HookExit, type HookInk, type HookPlace } from '../../shared/story/hook';
import { withPostHooks } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import Button, { buttonClass } from '../../shared/ui/Button';
import { FieldRow, SelectField, SliderRow, SwitchRow, TextAreaField, TextField, type SelectOption } from '../../shared/ui/Inspector';
import { hookBadgeOf, hookLayoutOf, withPostBadge } from '../../shared/story/hook-badge';
import ShadesPanel from '../../shared/shades/ShadesPanel';
import { AnchorGrid } from './HookBadgeSection';

export type HookSoundKind = 'keys' | 'impact' | 'whoosh';
/** The author's own files for the hook's sounds, held for the visit like the voice and the music. */
export type HookFiles = Partial<Record<HookSoundKind, { name: string; buffer: AudioBuffer }>>;

const ENTRIES: readonly SelectOption<HookEntry>[] = [
  { id: 'type', label: 'Typed, letter by letter' },
  { id: 'rise', label: 'Rises' },
  { id: 'word', label: 'Word by word' },
  { id: 'fade', label: 'Fades in' },
  { id: 'wipe', label: 'Wiped in (badge)' },
  { id: 'slam', label: 'Slammed in (badge)' },
];
const EXITS: readonly SelectOption<HookExit>[] = [
  { id: 'fade', label: 'Fades out' },
  { id: 'erase', label: 'Erased backwards' },
  { id: 'fly', label: 'Flies off' },
  { id: 'cut', label: 'Cut' },
];
const PLACES: readonly SelectOption<HookPlace>[] = [
  { id: 'top', label: 'Top' },
  { id: 'center', label: 'Centre' },
  { id: 'bottom', label: 'Bottom' },
];
const INKS: readonly SelectOption<HookInk>[] = [
  { id: 'paper', label: 'Light on a dark veil' },
  { id: 'ink', label: 'Ink on a light veil' },
  { id: 'accent', label: 'Accent on a light veil' },
];
const SOUNDS: readonly SelectOption<string>[] = [
  { id: 'none', label: 'None' },
  { id: 'file', label: 'Your own file' },
  ...VOICE_NAMES.map((v) => ({ id: v, label: `Built-in · ${v}` })),
];
const SOUND_LABEL: Record<HookSoundKind, string> = { keys: 'Key sound', impact: 'Impact', whoosh: 'Exit sound' };
const LETTERS = 'ABCDE';
const PIECE_LABEL = { header: 'Header', place: 'Place', camera: 'Camera', why: 'Why now' } as const;
const PIECE_HINT = { header: 'Le tri d’Australie · EP.04', place: '◆ Perth → Cairns', camera: 'Sony A7C II · DJI Mini 4 Pro', why: 'Il y a un an, jour pour jour' } as const;

/**
 * The post's hook, edited where it plays (`hook.ts`): its words, how they
 * arrive and leave, when, where, in what ink, and its three sounds — each a
 * built-in voice or a file of the author's own. Variants A, B, C… keep two or
 * three hooks for one post; the one selected plays and exports, so each can
 * be exported in turn and tested. The promise sits beside them, so a hook
 * never promises more than the post pays.
 */
export default function HookPanel({
  postId,
  script,
  onScript,
  title,
  files,
  onFile,
  onUnreadable,
}: {
  postId: string;
  script: StoryScript | null;
  onScript: (script: StoryScript) => void;
  /** What a new hook starts from: the post's title. */
  title: string;
  files: HookFiles;
  onFile: (kind: HookSoundKind, file: { name: string; buffer: AudioBuffer } | null) => void;
  /** A file this browser cannot decode: the editor says so where it says it for the other sounds. */
  onUnreadable: (name: string) => void;
}) {
  if (!script) return <p className="m-0 text-xs text-muted leading-relaxed">Load your script first: the hook&apos;s words are kept in it.</p>;
  const post = script.posts[postId] ?? {};
  const hooks = post.hooks ?? [];
  const active = Math.min(hooks.length - 1, Math.max(0, post.hookActive ?? 0));
  const hook = hooks[active];
  const save = (change: Parameters<typeof withPostHooks>[2]) => onScript(withPostHooks(script, postId, change));
  const edit = (patch: Partial<Hook>) => save({ hooks: hooks.map((h, i) => (i === active ? { ...h, ...patch } : h)) });

  if (!hook) {
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-xs text-muted leading-relaxed">This post opens on its title. A hook puts your words on its first picture instead.</p>
        <div>
          <Button size="sm" onClick={() => save({ hooks: [{ lines: [title] }], hookActive: 0 })}>
            Add a hook
          </Button>
        </div>
      </div>
    );
  }

  const lines = [hook.lines[0] ?? '', hook.lines[1] ?? ''];
  const setLine = (i: number, v: string) => {
    const next = [...lines];
    next[i] = v;
    edit({ lines: next[1] ? next : [next[0]] });
  };
  const stickerAt = hook.sticker === undefined ? (hook.lines.length > 1 ? hook.lines.length - 1 : null) : hook.sticker;
  const onSound = (kind: HookSoundKind) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { decodeSoundFile } = await import('../../shared/audio/sound-clip');
    const buffer = await decodeSoundFile(file);
    onFile(kind, buffer ? { name: file.name, buffer } : null);
    if (!buffer) onUnreadable(file.name);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Hook variants">
        {hooks.map((_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === active}
            onClick={() => save({ hookActive: i })}
            className={`h-8 min-w-8 px-2 rounded-control border font-mono text-xs cursor-pointer ${
              i === active ? 'border-accent bg-accent-wash text-accent-ink' : 'border-line-strong bg-surface text-ink-soft'
            }`}
          >
            {LETTERS[i] ?? i + 1}
          </button>
        ))}
        {hooks.length < LETTERS.length ? (
          <Button size="sm" variant="ghost" onClick={() => save({ hooks: [...hooks, { ...hook }], hookActive: hooks.length })}>
            + Variant
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const next = hooks.filter((_, i) => i !== active);
            save({ hooks: next, hookActive: Math.max(0, active - 1) });
          }}
        >
          {hooks.length > 1 ? 'Remove this one' : 'Remove the hook'}
        </Button>
      </div>

      <FieldRow label="Line 1" align="start">
        <TextAreaField label="Hook, first line" value={lines[0]} onChange={(v) => setLine(0, v)} placeholder="100 000 photos." rows={2} />
      </FieldRow>
      <FieldRow label="Line 2" align="start">
        <TextAreaField label="Hook, second line" value={lines[1]} onChange={(v) => setLine(1, v)} placeholder="Aucune triée." rows={2} />
      </FieldRow>
      <FieldRow label="Sticker">
        <SelectField
          label="Which line lands as a sticker"
          value={stickerAt === null ? 'none' : String(stickerAt)}
          options={[
            { id: 'none', label: 'No sticker' },
            { id: '0', label: 'Line 1' },
            ...(hook.lines.length > 1 ? [{ id: '1', label: 'Line 2' }] : []),
          ]}
          onChange={(v) => edit({ sticker: v === 'none' ? null : Number(v) })}
        />
      </FieldRow>
      <FieldRow label="Arrives">
        <SelectField label="How the words arrive" value={hook.entry ?? HOOK_DEFAULTS.entry} options={ENTRIES} onChange={(entry) => edit({ entry })} />
      </FieldRow>
      <FieldRow label="Leaves">
        <SelectField label="How the words leave" value={hook.exit ?? HOOK_DEFAULTS.exit} options={EXITS} onChange={(exit) => edit({ exit })} />
      </FieldRow>

      {(['keys', 'impact', 'whoosh'] as const).map((kind) => {
        const sound = hookSoundFor(hook, kind);
        const file = files[kind];
        return (
          <FieldRow key={kind} label={SOUND_LABEL[kind]}>
            <SelectField
              label={`Hook sound: ${SOUND_LABEL[kind].toLowerCase()}`}
              value={sound}
              options={SOUNDS}
              onChange={(v) => edit({ sounds: { ...hook.sounds, [kind]: v } })}
            />
            {sound === 'file' ? (
              <label className={buttonClass('default', 'sm')} title={file ? file.name : 'Choose a sound file'}>
                {file ? '✓' : 'Add…'}
                <input type="file" accept="audio/*" className="sr-only" onChange={onSound(kind)} />
              </label>
            ) : null}
          </FieldRow>
        );
      })}

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted select-none">Timing, place and ink</summary>
        <div className="flex flex-col gap-2 pt-2">
          <SliderRow label="Starts at" value={hook.at ?? HOOK_DEFAULTS.at} min={0} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(at) => edit({ at })} />
          <SliderRow label="Typing speed" value={hook.cps ?? HOOK_DEFAULTS.cps} min={4} max={40} step={1} format={(v) => `${v} letters/s`} onChange={(cps) => edit({ cps })} />
          <SliderRow label="Pause before line 2" value={hook.gap ?? HOOK_DEFAULTS.gap} min={0} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(gap) => edit({ gap })} />
          <SliderRow label="Holds for" value={hook.hold ?? HOOK_DEFAULTS.hold} min={0} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(hold) => edit({ hold })} />
          <SliderRow label="Veil" value={Math.round((hook.scrim ?? HOOK_DEFAULTS.scrim) * 100)} min={0} max={90} step={1} format={(v) => `${v} %`} onChange={(v) => edit({ scrim: v / 100 })} />
          <FieldRow label="Place">
            <SelectField label="Where the hook sits" value={hook.place ?? HOOK_DEFAULTS.place} options={PLACES} onChange={(place) => edit({ place })} />
          </FieldRow>
          <FieldRow label="Ink">
            <SelectField label="The hook's ink" value={hook.ink ?? HOOK_DEFAULTS.ink} options={INKS} onChange={(ink) => edit({ ink })} />
          </FieldRow>
        </div>
      </details>

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted select-none">This post’s badge pieces</summary>
        <div className="flex flex-col gap-2 pt-2">
          {(['header', 'place', 'camera', 'why'] as const).map((k) => (
            <FieldRow key={k} label={PIECE_LABEL[k]}>
              <TextField
                label={`The badge's ${PIECE_LABEL[k].toLowerCase()}, this post`}
                value={hook.pieces?.[k] ?? ''}
                placeholder={PIECE_HINT[k]}
                onChange={(v) => {
                  const pieces = { ...(hook.pieces ?? {}), [k]: v || undefined };
                  for (const key of Object.keys(pieces) as (keyof typeof pieces)[]) if (!pieces[key]) delete pieces[key];
                  edit({ pieces: Object.keys(pieces).length ? pieces : undefined });
                }}
              />
            </FieldRow>
          ))}
          <p className="m-0 text-2xs text-muted leading-snug">Empty, a piece says what the series knows: its name and this post’s number, the map’s first and last stop, how long ago the trip was.</p>
        </div>
      </details>

      <PostBadgeRows script={script} hook={hook} edit={edit} />

      <FieldRow label="Said" align="start">
        <TextAreaField label="What you say over the hook" value={hook.spoken ?? ''} onChange={(spoken) => edit({ spoken: spoken || undefined })} placeholder="J'ai ramené cent mille photos d'Australie…" />
      </FieldRow>
      <FieldRow label="Promise" align="start" hint="What this post pays off. A hook never promises more." hintShown>
        <TextAreaField label="What the post pays off" value={post.promise ?? ''} onChange={(promise) => save({ promise })} placeholder="La méthode, épisode par épisode." />
      </FieldRow>
    </div>
  );
}

/**
 * This post's own place and shades for the badge, over the series' (hook lab
 * 2): its picture is its own — a bright sky, a face on the left — so where the
 * badge sits and what lifts it may be too. Off, the series' hold.
 */
function PostBadgeRows({ script, hook, edit }: { script: StoryScript; hook: Hook; edit: (patch: Partial<Hook>) => void }) {
  const series = hookBadgeOf(script.look?.hook);
  if (series.mode !== 'badge') return null;
  const own = hook.badge ?? {};
  const setOwn = (patch: Partial<NonNullable<Hook['badge']>>) => {
    const next: NonNullable<Hook['badge']> = { ...own, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    edit({ badge: Object.keys(next).length ? next : undefined });
  };
  const place = hookLayoutOf(hookBadgeOf(withPostBadge(script.look?.hook, hook)));
  return (
    <details className="group" open={Boolean(hook.badge)}>
      <summary className="cursor-pointer text-xs text-muted select-none">This post’s badge place and shades</summary>
      <div className="flex flex-col gap-2 pt-2">
        <SwitchRow
          label="Its own place"
          checked={Boolean(own.anchor)}
          onChange={(on) => setOwn(on ? { anchor: hookLayoutOf(series).anchor } : { anchor: undefined, x: undefined, y: undefined })}
        />
        {own.anchor ? <AnchorGrid value={place.anchor} onChange={(anchor) => setOwn({ anchor, x: undefined, y: undefined })} /> : null}
        <SwitchRow label="Its own shades" checked={Boolean(own.shades)} onChange={(on) => setOwn({ shades: on ? [...(series.shades ?? [])] : undefined })} />
        {own.shades ? <ShadesPanel shades={[...own.shades]} onChange={(shades) => setOwn({ shades })} followBadge anchor={place.anchor} /> : null}
        <p className="m-0 text-2xs text-muted leading-snug">Off, the series’ place and shades (Badge · the series). The badge moved on the stage for this post alone: set the Studio to This post.</p>
      </div>
    </details>
  );
}

