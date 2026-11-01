import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { objectLabel, type ObjectTrack, type SceneSpan } from '../../shared/story/studio';
import type { StudioSelection } from './StudioTree';

/** A drag in progress: a scene's end, or one edge of a caption's window, and where it is now (post seconds). */
type Drag = { kind: 'len'; index: number; scene: SceneSpan; at: number } | { kind: 'cap-a' | 'cap-b'; index: number; scene: SceneSpan; at: number };

const LABEL_W = 'w-[5.5rem] @min-[1000px]:w-24';
const ROW = 'relative h-6 pointer-coarse:h-9 flex-1 min-w-0';

/**
 * The post on one clock (the lab's timeline): a row of SCENES, one for the
 * hook, one for the CAPTIONS, one for the HUD, then a row for each part of
 * the selected scene. A bar selects its object and moves the playhead into
 * it; a click on a row's empty stretch moves the playhead there. A scene's
 * right edge is dragged to change its length, a caption's two edges to time
 * its window — this post's own (`withSceneTiming`), committed on release.
 */
export default function StudioTimeline({
  total,
  t,
  scenes,
  tracks,
  selected,
  onSelect,
  onSeek,
  onTiming,
}: {
  total: number;
  t: number;
  scenes: readonly SceneSpan[];
  tracks: readonly ObjectTrack[];
  selected: StudioSelection | null;
  onSelect: (s: StudioSelection) => void;
  onSeek: (t: number) => void;
  onTiming: (index: number, timing: { len?: number; cap?: { a: number; b: number } }) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const lane = useRef<HTMLDivElement>(null);
  const pct = (s: number) => `${(Math.max(0, Math.min(total, s)) / total) * 100}%`;
  const secAt = (clientX: number) => {
    const r = lane.current?.getBoundingClientRect();
    return r ? Math.max(0, Math.min(total, ((clientX - r.left) / r.width) * total)) : 0;
  };
  const selId = selected?.kind === 'object' ? selected.id : null;
  const selSlot = selected?.kind === 'object' ? selected.slot : null;
  const pick = (tr: ObjectTrack, at?: number) => {
    onSelect({ kind: 'object', id: tr.id, key: tr.key, slot: tr.slot });
    const s = tr.spans[0];
    if (at !== undefined) onSeek(at);
    else if (s) onSeek(s[0] + Math.min(1.5, (s[1] - s[0]) * 0.6));
  };

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag(d);
  };
  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, at: secAt(e.clientX) });
  };
  const endDrag = () => {
    if (!drag) return;
    const { scene, index, at } = drag;
    // Lengths and windows are in the scene's own seconds.
    if (drag.kind === 'len') onTiming(index, { len: Math.max(1, at - scene.a) });
    else if (scene.cap) {
      const local = at - scene.start;
      const len = scene.b - scene.a;
      onTiming(index, {
        cap:
          drag.kind === 'cap-a'
            ? { a: Math.max(0, Math.min(local, scene.cap.b - 0.2)), b: scene.cap.b }
            : { a: scene.cap.a, b: Math.min(len + 0.9, Math.max(local, scene.cap.a + 0.2)) },
      });
    }
    setDrag(null);
  };

  const handle = (side: 'left' | 'right', d: Drag, label: string) => (
    <span
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(d.at * 10) / 10}
      tabIndex={-1}
      onPointerDown={(e) => startDrag(e, d)}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={() => setDrag(null)}
      className={`absolute z-10 top-0 bottom-0 w-2 pointer-coarse:w-4 cursor-ew-resize touch-none ${side === 'left' ? 'left-0' : 'right-0'} after:absolute after:inset-y-1 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:rounded after:bg-current after:opacity-60`}
    />
  );

  const bar = (key: string, a: number, b: number, label: string, on: boolean, click: (e: ReactPointerEvent) => void, tone: string, extra?: ReactNode) => (
    <div
      key={key}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      title={`${label} · ${a.toFixed(1)}–${b.toFixed(1)} s`}
      onPointerDown={click}
      className={`absolute top-0.5 bottom-0.5 rounded-[5px] text-3xs leading-none px-1.5 flex items-center overflow-visible cursor-pointer select-none ${tone} ${on ? 'ring-2 ring-ink' : ''}`}
      style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
    >
      <span className="truncate">{label}</span>
      {extra}
    </div>
  );

  const rowLabel = (s: string) => <span className={`${LABEL_W} shrink-0 truncate font-mono text-3xs text-muted`}>{s}</span>;
  const seekRow = (e: ReactPointerEvent) => onSeek(secAt(e.clientX));

  const sceneTrack = (s: SceneSpan) => tracks.find((tr) => tr.slot === s.key && tr.key === s.block);
  const captions = scenes.filter((s) => s.cap && s.index !== null);
  const hook = tracks.find((tr) => tr.key === 'hook');
  const hud = tracks.find((tr) => tr.key === 'hud');
  const focusSlot = selSlot && selSlot !== '' ? selSlot : null;
  const parts = focusSlot ? tracks.filter((tr) => tr.slot === focusSlot && tr.key !== 'caption' && tr.key !== scenes.find((s) => s.key === focusSlot)?.block) : [];
  const live = (s: SceneSpan): SceneSpan => {
    if (!drag || drag.scene.key !== s.key) return s;
    if (drag.kind === 'len') return { ...s, b: Math.max(s.a + 1, drag.at) };
    if (!s.cap) return s;
    const local = drag.at - s.start;
    return { ...s, cap: drag.kind === 'cap-a' ? { a: Math.max(0, Math.min(local, s.cap.b - 0.2)), b: s.cap.b } : { a: s.cap.a, b: Math.max(local, s.cap.a + 0.2) } };
  };

  return (
    <div className="flex flex-col gap-1 select-none" aria-label="Timeline">
      <div className="flex items-center gap-2">
        {rowLabel('')}
        <div className="relative flex-1 h-4 font-mono text-3xs text-faint tabular-nums">
          {Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => (
            <span key={i} className="absolute -translate-x-1/2" style={{ left: pct(i * 5) }}>
              {i * 5}s
            </span>
          ))}
        </div>
      </div>
      <div className="relative flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {rowLabel('Scenes')}
          <div ref={lane} className={ROW} onPointerDown={seekRow}>
            {scenes.map((raw) => {
              const s = live(raw);
              const tr = sceneTrack(raw);
              const on = !!tr && tr.id === selId;
              return bar(
                s.key,
                s.a,
                s.b,
                objectLabel(s.block),
                on,
                (e) => {
                  e.stopPropagation();
                  if (tr) pick(tr, s.a + Math.min(1.2, (s.b - s.a) / 2));
                },
                on ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-soft border border-line',
                s.index !== null ? handle('right', { kind: 'len', index: s.index, scene: raw, at: s.b }, `${objectLabel(s.block)} length`) : null,
              );
            })}
          </div>
        </div>
        {hook ? (
          <div className="flex items-center gap-2">
            {rowLabel('Hook')}
            <div className={ROW} onPointerDown={seekRow}>
              {hook.spans.map(([a, b], i) =>
                bar(`h${i}`, a, b, 'Hook', hook.id === selId, (e) => {
                  e.stopPropagation();
                  pick(hook);
                }, hook.id === selId ? 'bg-accent text-paper' : 'bg-accent/25 text-ink'),
              )}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {rowLabel('Captions')}
          <div className={ROW} onPointerDown={seekRow}>
            {captions.map((raw) => {
              const s = live(raw);
              const tr = tracks.find((x) => x.slot === s.key && x.key === 'caption');
              const on = !!tr && tr.id === selId;
              const a = s.start + s.cap!.a;
              const b = s.start + s.cap!.b;
              return bar(
                `c${s.key}`,
                a,
                b,
                'Caption',
                on,
                (e) => {
                  e.stopPropagation();
                  if (tr) pick(tr, a + Math.min(1.5, (b - a) * 0.5));
                },
                on ? 'bg-ok text-paper' : 'bg-ok/25 text-ink',
                <>
                  {handle('left', { kind: 'cap-a', index: raw.index!, scene: raw, at: a }, 'Caption starts')}
                  {handle('right', { kind: 'cap-b', index: raw.index!, scene: raw, at: b }, 'Caption ends')}
                </>,
              );
            })}
          </div>
        </div>
        {hud ? (
          <div className="flex items-center gap-2">
            {rowLabel('HUD')}
            <div className={ROW} onPointerDown={seekRow}>
              {hud.spans.map(([a, b], i) =>
                bar(`u${i}`, a, b, 'HUD', hud.id === selId, (e) => {
                  e.stopPropagation();
                  pick(hud);
                }, hud.id === selId ? 'bg-ink text-paper' : 'bg-line text-ink-soft'),
              )}
            </div>
          </div>
        ) : null}
        {parts.map((tr) => (
          <div key={tr.id} className="flex items-center gap-2">
            {rowLabel(objectLabel(tr.key))}
            <div className={ROW} onPointerDown={seekRow}>
              {tr.spans.map(([a, b], i) =>
                bar(`${tr.id}${i}`, a, b, objectLabel(tr.key), tr.id === selId, (e) => {
                  e.stopPropagation();
                  pick(tr);
                }, tr.id === selId ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-soft border border-line'),
              )}
            </div>
          </div>
        ))}
        {/* The playhead, over every row. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex gap-2">
          <span className={`${LABEL_W} shrink-0`} />
          <span className="relative flex-1">
            <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-danger" style={{ left: pct(t) }} />
          </span>
        </div>
      </div>
    </div>
  );
}
