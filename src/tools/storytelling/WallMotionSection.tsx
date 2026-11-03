import { useState } from 'react';
import type { StoryScript } from '../../shared/story/story-script';
import { MAX_TILES } from '../../shared/story/story-script';
import { wallCells, wallGrid, wallLayout } from '../../shared/story/wall-grid';
import {
  LANE_GLYPH,
  motionIn,
  moves,
  nextLane,
  presetMotion,
  QUEUE_LAPS,
  spelled,
  SPEED_LIMITS,
  wallCapacity,
  WALL_MOTION_LABEL,
  WALL_MOTION_PRESETS,
  withWallMotion,
  type Lane,
  type WallAxis,
  type WallMotion,
  type WallMotionPreset,
} from '../../shared/story/wall-motion';
import { FieldRow, Readout, SelectField, SliderRow, SwitchRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';

const LANE_WORD: Record<Lane['mode'], string> = { still: 'still', slide: 'slides', shuffle: 'shuffles', flip: 'flips', breathe: 'breathes' };

/**
 * The living wall's motion (`wall-motion.ts`): a preset, the lanes (rows or
 * columns), each lane's mode as a chip a click turns to the next, the speed,
 * smart motion and the queue — for every post, or this post alone. The
 * lanes drawn are the ones the frame shows; a lane set by hand makes the
 * motion « Your own ».
 */
export default function WallMotionSection({ script, postId, onScript }: { script: StoryScript; postId: string; onScript: (s: StoryScript) => void }) {
  const own = script.posts[postId]?.wallMotion;
  const [where, setWhere] = useState<'series' | 'post'>(own ? 'post' : 'series');
  const m = motionIn(script, postId);
  const level = where === 'series' ? script.look?.wallMotion : own;
  const set = (patch: Partial<WallMotion>) => onScript(withWallMotion(script, where, postId, { ...(level ?? {}), ...patch }));
  const grid = wallGrid(script.look?.wall);
  const layout = wallLayout(grid);
  // The lanes the frame shows: rows (or columns) with a place inside 0–1920 (0–1080).
  const lanesShown = (axis: WallAxis) => {
    const seen = new Set<number>();
    for (const r of layout.rects) {
      const inside = axis === 'rows' ? r.y + r.h > 0 && r.y < 1920 : r.x + r.w > 0 && r.x < 1080;
      if (inside) seen.add(axis === 'rows' ? r.row : r.col);
    }
    return [...seen].sort((a, b) => a - b);
  };
  const shown = lanesShown(m.axis);
  // Under smart motion the hero's lane holds (`wall-motion.ts`): drawn as the wall's spine, not a chip to turn.
  const heroRect = layout.rects.find((r) => r.centre);
  const heroLane = m.smart && heroRect ? (m.axis === 'rows' ? heroRect.row : heroRect.col) : -1;
  const lanes = spelled(m, Math.max(...shown, 0) + 1);
  const cells = wallCells(grid);
  const capacity = wallCapacity(cells, script.look?.wallMotion, MAX_TILES);
  const preset = (p: WallMotionPreset) => {
    const base = presetMotion(p);
    onScript(withWallMotion(script, where, postId, p === 'none' && where === 'series' ? null : { preset: p, ...(level?.speed !== undefined && p !== 'none' ? { speed: level.speed } : {}), lanes: base.lanes }));
  };
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label="Motion">
        <SelectField<WallMotionPreset | 'custom'>
          label="How the wall moves"
          value={m.preset}
          options={[...(Object.keys(WALL_MOTION_PRESETS) as WallMotionPreset[]), ...(m.preset === 'custom' ? (['custom'] as const) : [])].map((id) => ({ id, label: WALL_MOTION_LABEL[id] }))}
          onChange={(p) => p !== 'custom' && preset(p)}
        />
      </FieldRow>
      <FieldRow label="For">
        <Segmented<'series' | 'post'>
          size="sm"
          fill
          value={where}
          onChange={setWhere}
          options={[
            { id: 'series', label: 'Every post' },
            { id: 'post', label: own ? 'This post ●' : 'This post' },
          ]}
        />
      </FieldRow>
      {where === 'post' && own ? (
        <button type="button" className="self-start text-2xs text-accent cursor-pointer hover:underline" onClick={() => onScript(withWallMotion(script, 'post', postId, null))}>
          Follow the series again
        </button>
      ) : null}
      {moves(m) ? (
        <>
          <FieldRow label="Lanes">
            <Segmented<WallAxis>
              size="sm"
              fill
              value={m.axis}
              onChange={(axis) => set({ axis })}
              options={[
                { id: 'rows', label: 'Rows' },
                { id: 'columns', label: 'Columns' },
              ]}
            />
          </FieldRow>
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted">Each {m.axis === 'rows' ? 'row, top to bottom' : 'column, left to right'} — a click turns it to the next mode</span>
            <div className="flex flex-row flex-wrap gap-1" role="group" aria-label="Each lane's motion">
              {shown.map((lane) => {
                const l = lanes[lane];
                if (lane === heroLane)
                  return (
                    <span
                      key={lane}
                      title={`${m.axis === 'rows' ? 'Row' : 'Column'} ${lane + 1} holds the first picture while Smart is on`}
                      className="min-w-11 min-h-8 px-1.5 inline-flex items-center justify-center gap-1 rounded-control border border-dashed border-line font-mono text-xs text-muted"
                    >
                      <span className="text-3xs">{lane + 1}</span>◆
                    </span>
                  );
                return (
                  <button
                    key={lane}
                    type="button"
                    title={`${m.axis === 'rows' ? 'Row' : 'Column'} ${lane + 1}: ${LANE_WORD[l.mode]}`}
                    aria-label={`${m.axis === 'rows' ? 'Row' : 'Column'} ${lane + 1}: ${LANE_WORD[l.mode]}${l.mode === 'slide' ? (l.dir < 0 ? ' back' : ' on') : ''}`}
                    className={`min-w-11 min-h-8 px-1.5 inline-flex items-center justify-center gap-1 rounded-control border border-line bg-paper font-mono text-xs cursor-pointer hover:border-line-strong ${l.mode === 'still' ? 'text-muted' : 'text-ink'}`}
                    onClick={() => {
                      const next = lanes.map((x, i) => (i === lane ? nextLane(x) : x));
                      set({ preset: 'custom', lanes: next });
                    }}
                  >
                    <span className="text-3xs text-muted">{lane + 1}</span>
                    {LANE_GLYPH[l.mode](l.dir, m.axis)}
                  </button>
                );
              })}
            </div>
          </div>
          <SliderRow label="Speed" value={m.speed} min={SPEED_LIMITS[0]} max={SPEED_LIMITS[1]} step={0.05} reset={presetMotion(m.preset === 'custom' ? 'marquee' : m.preset).speed} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ speed })} />
          <SwitchRow
            label="Smart"
            checked={m.smart}
            onChange={(smart) => set({ smart })}
            hint="Holds the first picture, moves a stage’s band as one, slows under your voice, steps on your music’s beats, ends aligned."
          />
          <SwitchRow
            label="More pictures"
            checked={m.queue}
            onChange={(queue) => set({ queue })}
            hint={`A lane that turns brings in pictures from off the frame: counting keeps up to ${QUEUE_LAPS} pictures a place (${Math.min(MAX_TILES, cells * QUEUE_LAPS)} here). Count again under Sources after switching it on.`}
          />
          {m.queue && capacity <= cells ? <Readout muted>Set it for every post to count more pictures: counting is the series’.</Readout> : null}
        </>
      ) : null}
    </div>
  );
}
