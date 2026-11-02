import { memo, useEffect, useState } from 'react';
import type { PlayClock } from '../../shared/media/play-clock';
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
    depth ? 'pl-10' : ''
  } ${on ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-2'}`;

/** What the list keeps folded on this device: a group's or a scene's key → folded. */
const FOLD_KEY = 'atelier.storytelling.folds';
function readFolds(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function writeFolds(folds: Record<string, boolean>): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    // A private window keeps the folds for the visit.
  }
}

/** The scene under the playhead, re-rendering only when it changes — never on every frame. */
function useSceneAt(clock: PlayClock | undefined, scenes: readonly StudioScene[]): string | null {
  const at = () => (clock ? (scenes.find((s) => clock.t >= s.a && clock.t < s.b)?.key ?? null) : null);
  const [key, setKey] = useState<string | null>(at);
  useEffect(() => {
    if (!clock) return;
    const update = () => setKey((was) => {
      const now = scenes.find((s) => clock.t >= s.a && clock.t < s.b)?.key ?? null;
      return now === was ? was : now;
    });
    update();
    return clock.subscribe(update);
  }, [clock, scenes]);
  return key;
}

/** A fold's chevron: ▸ folded, ▾ open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-flex w-3 justify-center text-3xs opacity-60 transition-transform ${open ? 'rotate-90' : ''}`}>
      ▶
    </span>
  );
}

const sameSel = (a: StudioSelection | null, b: StudioSelection) =>
  !!a && a.kind === b.kind && (a.kind === 'panel' ? a.id === (b as { id: string }).id : a.id === (b as { id: string }).id);

/**
 * The Studio's list (the lab's left column): the series' panels, the post's,
 * then the post's SCENES in order, each with the objects it draws — its
 * parts and its caption — and what sits over every scene (the hook and its
 * pieces, the HUD). A row selects; a scene's row also moves the playhead to
 * it. Every group FOLDS (Studio lab https://claude.ai/artifact/MpgJfZ6ZWw4MWXgLLx2R6P,
 * his « on devrait pouvoir les déplier »): what is folded is kept on this
 * device, and the scene under the playhead and the selected object's group
 * open themselves.
 */
function StudioTree({
  scenes,
  tracks,
  selected,
  onSelect,
  onSeek,
  clock,
}: {
  scenes: readonly StudioScene[];
  tracks: readonly ObjectTrack[];
  selected: StudioSelection | null;
  onSelect: (s: StudioSelection) => void;
  onSeek: (t: number) => void;
  /** The post's clock: the scene under the playhead opens itself. */
  clock?: PlayClock;
}) {
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds);
  const toggle = (key: string, open: boolean) =>
    setFolds((was) => {
      const next = { ...was, [key]: open };
      writeFolds(next);
      return next;
    });
  const playing = useSceneAt(clock, scenes);
  // Scenes start folded (a post holds a dozen); groups start open. The scene playing and the selection's own opens.
  const selKey = selected?.kind === 'object' ? selected.key : null;
  const selSlot = selected?.kind === 'object' ? selected.slot : null;
  const isOpen = (key: string, byDefault: boolean, forced = false) => forced || (folds[key] === undefined ? byDefault : !folds[key]);
  const over = tracks.filter((t) => t.slot === '');
  const pick = (t: ObjectTrack) => {
    onSelect({ kind: 'object', id: t.id, key: t.key, slot: t.slot });
    // Where the object is fully there: into its first stretch, past its entrance.
    const s = t.spans[0];
    if (s) onSeek(s[0] + Math.min(1.5, (s[1] - s[0]) * 0.6));
  };
  const heading = 'm-0 mt-3 mb-1 px-2 font-mono text-3xs uppercase tracking-[0.12em] text-muted';
  const groupButton = (key: string, label: string, open: boolean, first = false) => (
    <button type="button" aria-expanded={open} className={`${heading} ${first ? 'mt-0' : ''} flex items-center gap-1.5 text-left cursor-pointer hover:text-ink`} onClick={() => toggle(key, open)}>
      <Chevron open={open} />
      {label}
    </button>
  );
  const seriesOpen = isOpen('g:series', true);
  const postOpen = isOpen('g:post', true);
  const overOpen = isOpen('g:over', true, selSlot === '' && !!selKey);
  // The objects over every scene: a whole (`hook`, `hud`) and its parts (`hook.big`), the parts folded under it.
  const roots = over.filter((t) => !over.some((o) => t.key.startsWith(`${o.key}.`)));
  return (
    <nav aria-label="Objects" className="flex flex-col gap-0.5 p-2">
      {groupButton('g:series', 'Series', seriesOpen, true)}
      {seriesOpen
        ? SERIES_PANELS.map(([id, label]) => (
            <button key={id} type="button" className={rowClass(sameSel(selected, { kind: 'panel', id }))} onClick={() => onSelect({ kind: 'panel', id })}>
              {label}
            </button>
          ))
        : null}
      {groupButton('g:post', 'This post', postOpen)}
      {postOpen
        ? POST_PANELS.map(([id, label]) => (
            // The Hook row selects the Hook object while the post draws one (its settings live there).
            <button key={id} type="button" className={rowClass(sameSel(selected, { kind: 'panel', id }) || (id === 'hook' && selKey === 'hook' && selSlot === ''))} onClick={() => onSelect({ kind: 'panel', id })}>
              {label}
            </button>
          ))
        : null}
      <p className={heading}>Scenes</p>
      {scenes.map((s) => {
        const own = tracks.filter((t) => t.slot === s.key);
        const scene = own.find((t) => t.key === s.block);
        const parts = own.filter((t) => t.key !== s.block);
        const open = isOpen(`s:${s.key}`, false, s.key === playing || (selSlot === s.key && selKey !== s.block));
        return (
          <div key={s.key} className="flex flex-col gap-0.5">
            <div className="flex items-center">
              {parts.length ? (
                <button type="button" aria-expanded={open} aria-label={`${open ? 'Fold' : 'Unfold'} ${objectLabel(s.block)}`} className="shrink-0 w-5 h-6 inline-flex items-center justify-center text-ink-soft cursor-pointer" onClick={() => toggle(`s:${s.key}`, open)}>
                  <Chevron open={open} />
                </button>
              ) : (
                <span className="shrink-0 w-5" />
              )}
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
            </div>
            {open
              ? parts.map((t) => (
                  <button key={t.id} type="button" className={rowClass(sameSel(selected, { kind: 'object', id: t.id, key: t.key, slot: t.slot }), 1)} onClick={() => pick(t)}>
                    <span className="flex-1 min-w-0 truncate">{objectLabel(t.key)}</span>
                  </button>
                ))
              : null}
          </div>
        );
      })}
      {over.length ? groupButton('g:over', 'Over every scene', overOpen) : null}
      {overOpen
        ? roots.map((root) => {
            const kids = over.filter((t) => t.key.startsWith(`${root.key}.`));
            const open = isOpen(`o:${root.key}`, false, !!selKey && selKey.startsWith(`${root.key}.`));
            return (
              <div key={root.id} className="flex flex-col gap-0.5">
                <div className="flex items-center">
                  {kids.length ? (
                    <button type="button" aria-expanded={open} aria-label={`${open ? 'Fold' : 'Unfold'} ${objectLabel(root.key)}`} className="shrink-0 w-5 h-6 inline-flex items-center justify-center text-ink-soft cursor-pointer" onClick={() => toggle(`o:${root.key}`, open)}>
                      <Chevron open={open} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-5" />
                  )}
                  <button type="button" className={rowClass(sameSel(selected, { kind: 'object', id: root.id, key: root.key, slot: root.slot }))} onClick={() => pick(root)}>
                    <span className="flex-1 min-w-0 truncate">{objectLabel(root.key)}</span>
                  </button>
                </div>
                {open
                  ? kids.map((t) => (
                      <button key={t.id} type="button" className={rowClass(sameSel(selected, { kind: 'object', id: t.id, key: t.key, slot: t.slot }), 1)} onClick={() => pick(t)}>
                        <span className="flex-1 min-w-0 truncate">{objectLabel(t.key)}</span>
                      </button>
                    ))
                  : null}
              </div>
            );
          })
        : null}
    </nav>
  );
}

export default memo(StudioTree);
