import { memo } from 'react';
import type { ObjectTrack } from '../../shared/story/studio';
import { objectLabel } from '../../shared/story/studio';

/** What the inspector shows: one of the series' or the post's panels, or an object of the post. */
export type StudioSelection =
  | { kind: 'panel'; id: StudioPanel }
  | { kind: 'object'; id: string; key: string; slot: string };

export type StudioPanel = 'charte' | 'script' | 'sources' | 'hook' | 'sound' | 'export';

/** How each panel is named: in the list, a phone's bottom bar, a drawer's title. */
export const PANEL_LABEL: Record<StudioPanel, string> = {
  charte: 'Charte & look',
  script: 'Script',
  sources: 'Sources',
  hook: 'Hook',
  sound: 'Sound & effects',
  export: 'Export & archive',
};

const SERIES_PANELS: readonly [StudioPanel, string][] = [
  ['charte', 'Charte & look'],
  ['script', 'Script'],
  ['sources', 'Sources'],
];
const POST_PANELS: readonly [StudioPanel, string][] = [
  ['hook', 'Hook'],
  ['sound', 'Sound & effects'],
  ['export', 'Export & archive'],
];

export interface StudioScene {
  key: string;
  block: string;
  a: number;
  b: number;
}

const rowClass = (on: boolean, depth = 0) =>
  `w-full flex items-center gap-2 text-left rounded-control px-2 py-1 pointer-coarse:py-2 text-sm cursor-pointer transition-colors ${
    depth ? 'pl-6' : ''
  } ${on ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-2'}`;

const sameSel = (a: StudioSelection | null, b: StudioSelection) =>
  !!a && a.kind === b.kind && (a.kind === 'panel' ? a.id === (b as { id: string }).id : a.id === (b as { id: string }).id);

/**
 * The Studio's list (the lab's left column): the series' panels, the post's,
 * then the post's SCENES in order, each with the objects it draws — its
 * parts and its caption — and what sits over every scene (the hook, the
 * HUD). A row selects; a scene's row also moves the playhead to it.
 */
function StudioTree({
  scenes,
  tracks,
  selected,
  onSelect,
  onSeek,
}: {
  scenes: readonly StudioScene[];
  tracks: readonly ObjectTrack[];
  selected: StudioSelection | null;
  onSelect: (s: StudioSelection) => void;
  onSeek: (t: number) => void;
}) {
  const over = tracks.filter((t) => t.slot === '');
  const pick = (t: ObjectTrack) => {
    onSelect({ kind: 'object', id: t.id, key: t.key, slot: t.slot });
    // Where the object is fully there: into its first stretch, past its entrance.
    const s = t.spans[0];
    if (s) onSeek(s[0] + Math.min(1.5, (s[1] - s[0]) * 0.6));
  };
  const heading = 'm-0 mt-3 mb-1 px-2 font-mono text-3xs uppercase tracking-[0.12em] text-muted';
  return (
    <nav aria-label="Objects" className="flex flex-col gap-0.5 p-2">
      <p className={`${heading} mt-0`}>Series</p>
      {SERIES_PANELS.map(([id, label]) => (
        <button key={id} type="button" className={rowClass(sameSel(selected, { kind: 'panel', id }))} onClick={() => onSelect({ kind: 'panel', id })}>
          {label}
        </button>
      ))}
      <p className={heading}>This post</p>
      {POST_PANELS.map(([id, label]) => (
        <button key={id} type="button" className={rowClass(sameSel(selected, { kind: 'panel', id }))} onClick={() => onSelect({ kind: 'panel', id })}>
          {label}
        </button>
      ))}
      <p className={heading}>Scenes</p>
      {scenes.map((s) => {
        const own = tracks.filter((t) => t.slot === s.key);
        const scene = own.find((t) => t.key === s.block);
        const parts = own.filter((t) => t.key !== s.block);
        return (
          <div key={s.key} className="flex flex-col gap-0.5">
            <button
              type="button"
              className={rowClass(!!scene && sameSel(selected, { kind: 'object', id: scene.id, key: scene.key, slot: scene.slot }))}
              onClick={() => {
                if (scene) onSelect({ kind: 'object', id: scene.id, key: scene.key, slot: scene.slot });
                onSeek(s.a + Math.min(1.2, (s.b - s.a) / 2));
              }}
            >
              <span className="flex-1 min-w-0 truncate">{objectLabel(s.block)}</span>
              <span className="font-mono text-3xs opacity-70 tabular-nums">{(s.b - s.a).toFixed(1)} s</span>
            </button>
            {parts.map((t) => (
              <button key={t.id} type="button" className={rowClass(sameSel(selected, { kind: 'object', id: t.id, key: t.key, slot: t.slot }), 1)} onClick={() => pick(t)}>
                <span className="flex-1 min-w-0 truncate">{objectLabel(t.key)}</span>
              </button>
            ))}
          </div>
        );
      })}
      {over.length ? <p className={heading}>Over every scene</p> : null}
      {over.map((t) => (
        // A part of what sits over every scene (`hud.number`) is drawn under its whole (`hud`).
        <button
          key={t.id}
          type="button"
          className={rowClass(sameSel(selected, { kind: 'object', id: t.id, key: t.key, slot: t.slot }), over.some((o) => t.key.startsWith(`${o.key}.`)) ? 1 : 0)}
          onClick={() => pick(t)}
        >
          {objectLabel(t.key)}
        </button>
      ))}
    </nav>
  );
}

export default memo(StudioTree);
