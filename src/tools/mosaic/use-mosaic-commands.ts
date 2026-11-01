/**
 * The open mosaic's agent commands (M9, `docs/memory/mosaic-remote.md`),
 * registered by the screens that can do them: the EDITOR's (`mosaic.get`,
 * `.add`, `.measure`, `.target`, `.frame`, `.set`, `.motion`) while a mosaic
 * is open, the STAGE's (`mosaic.stage`, `.play`, `.stop`, `.snapshot`,
 * `.export`) once it has pictures to draw. The shell registers the rest
 * (`mosaic.list`, `.create`, `.open`, `.keep`, `.undo`, `.redo`).
 *
 * Every write goes through the editor's own funnel — the one a gesture uses —
 * so it is saved, synced and one undo step; the checks only a mosaic can make
 * are in `shared/mosaic/mosaic-commands.ts` (pure, tested), the bounds are
 * the params' and refused, never clamped.
 */

import { useRef } from 'react';
import { CommandError, type CommandSpec } from '../../shared/commands/registry';
import { imageResult } from '../../shared/commands/image-result';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { ASPECTS } from '../../shared/mosaic/frame';
import { MAX_CELL_PX, MIN_CELL_PX } from '../../shared/mosaic/match';
import { EXPORT_SHORTS, MAX_MOSAIC_TILES, cleanMosaicTitle, withCrop, type MosaicDoc, type MosaicMode, type MosaicSettings as Settings, type MosaicTile } from '../../shared/mosaic/mosaic-doc';
import { MOSAIC_MODES, checkTarget, cropAsked, mosaicOutline, withMotionAsked } from '../../shared/mosaic/mosaic-commands';
import { AIMS, ARRIVALS, DEPARTURES, MOTION_BOUNDS, REVEAL_DIRECTIONS, SHARPNESSES, type Motion } from '../../shared/mosaic/motion';
import { cullingFromRow } from '../../shared/sources/winnow/culling';
import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { ASSET_QUERY_PARAMS, askFromParams, keepAsk } from '../../shared/sources/winnow/winnow-commands';
import { spanOfRows, tileOfRow } from './mosaic-rows';
import type { MosaicExport as Exporter } from './use-mosaic-export';
import type { PlayerStatus } from './mosaic-player';
import type { SceneState } from './use-mosaic-scene';

/** How many rows one `mosaic.add` lists at most — the picker's span cap; a bigger library is two adds. */
const ADD_CAP = 20000;

const MOTION_PARTS = ['depart', 'arrival', 'reveal', 'sharpness', 'aim', 'moveMs', 'holdMs', 'cadenceMs', 'drift'] as const;

export interface EditorCommandsContext {
  /** The mosaic as it is NOW — written the moment an edit is applied, before React renders. */
  latest: { current: MosaicDoc };
  /** The editor's funnel: saved, synced, one undo step. */
  change: (fn: (doc: MosaicDoc) => MosaicDoc) => void;
  connection: WinnowConnection | null;
  client: WinnowClient | null;
  /** Add pictures by reference; the measuring follows by itself. */
  add: (tiles: MosaicTile[], instance: string, span: { from: string; to: string } | undefined) => void;
  /** Measure what is not yet (or, `again`, what failed too), after any run going; resolves when every run asked so far has ended. */
  measure: (again: boolean) => Promise<void>;
  measuring: () => boolean;
  /** The target as the editor sets it (`withTarget`: the crop goes with the old one, the queue keeps its picks). */
  setTarget: (id: number) => void;
  drawTarget: () => number | undefined;
}

export function useMosaicEditorCommands(ctx: EditorCommandsContext): void {
  const c = useRef(ctx);
  c.current = ctx;
  const doc = () => c.current.latest.current;
  const set = (fn: (s: Settings) => Settings) => c.current.change((d) => ({ ...d, settings: fn(d.settings), updatedAt: Date.now() }));
  const counts = () => {
    const o = mosaicOutline(doc());
    return { pictures: o.pictures, measured: o.measured, failed: o.failed, toMeasure: o.toMeasure };
  };
  const sameInstance = () => {
    const { connection, client } = c.current;
    if (!connection || !client) return 'no Winnow is connected — connect one on #/sources';
    const from = doc().instance;
    return from && from !== connection.id ? `this mosaic’s pictures come from ${from}; connect that instance to add or measure` : true;
  };

  const specs: CommandSpec[] = [
    {
      id: 'mosaic.get',
      title: 'Read the open mosaic',
      description:
        'The open mosaic: its title, where it is kept and where its pictures come from, how many pictures (photos, measured, failed, still to measure), the target and its frame (crop), the dials (aspect, cellPx, level, space, tint, distinctNeighbours, speed, seed), the mode and the motion’s parts, the export settings, and the chain’s next pictures.',
      run: () => mosaicOutline(doc()),
    },
    {
      id: 'mosaic.add',
      title: 'Add Winnow pictures to the mosaic',
      description: `Add the connected Winnow’s photographs and clips (a clip counts as its poster) to the mosaic BY REFERENCE: chosen ones by ids, or a day, a span, a folder or a person, narrowed by Winnow’s culling, faces, kind, place… as winnow.assets reads them. Rejects are left out unless a verdict is asked, as the picker does. A picture already in the mosaic is skipped. Their colours are measured next, by themselves; wait: true answers once that run ends. At most ${ADD_CAP.toLocaleString()} rows a call. Answers what was listed, added and measured.`,
      params: {
        ids: { type: 'numbers', description: 'Winnow asset ids — instead of a date or a folder.', integer: true, maxItems: ADD_CAP, optional: true },
        ...ASSET_QUERY_PARAMS,
        wait: { type: 'boolean', description: 'Answer once the pictures added are measured (default false: at once).', optional: true },
      },
      available: sameInstance,
      run: async (p) => {
        const { client, connection } = c.current;
        if (!client || !connection) throw new CommandError('unavailable', 'no Winnow is connected');
        let rows: WinnowAssetRow[];
        let kept: WinnowAssetRow[];
        if (Array.isArray(p.ids)) {
          rows = await client.assetsByIds(p.ids as number[]);
          kept = rows;
        } else {
          const ask = await askFromParams(client, p);
          rows = await client.allAssets(ask.query, ADD_CAP);
          kept = (await keepAsk(client, connection.id, rows, ask)).kept;
          if (typeof p.verdict !== 'string') kept = kept.filter((r) => cullingFromRow(r)?.verdict !== 'reject');
        }
        kept = kept.filter((r) => r.media_type === 'photo' || r.media_type === 'video');
        const before = doc();
        const held = new Set(before.tiles.map((t) => t.id));
        const fresh = kept.filter((r) => !held.has(r.id));
        const room = MAX_MOSAIC_TILES - before.tiles.length;
        if (fresh.length > room) throw new CommandError('invalid', `the mosaic holds ${before.tiles.length.toLocaleString()} pictures and takes ${MAX_MOSAIC_TILES.toLocaleString()} at most — ${fresh.length.toLocaleString()} would not fit`);
        if (fresh.length) c.current.add(fresh.map(tileOfRow), connection.id, spanOfRows(fresh));
        // The add queued its run; this one follows it and ends when every run asked so far has.
        if (p.wait === true && fresh.length) await c.current.measure(false);
        return {
          listed: rows.length,
          matched: kept.length,
          added: fresh.length,
          alreadyIn: kept.length - fresh.length,
          ...(Array.isArray(p.ids) && rows.length < (p.ids as number[]).length ? { notFound: (p.ids as number[]).filter((id) => !rows.some((r) => r.id === id)) } : {}),
          ...counts(),
        };
      },
    },
    {
      id: 'mosaic.measure',
      title: 'Measure the pictures’ colours',
      description:
        'Measure the colours of the pictures not measured yet — again: true tries the ones that failed too — off the main thread, as the editor’s Measure does. wait: true answers once the run ends (default: at once). Answers the counts.',
      params: {
        again: { type: 'boolean', description: 'Try the pictures that could not be read once more.', optional: true },
        wait: { type: 'boolean', description: 'Answer once the run ends.', optional: true },
      },
      available: sameInstance,
      run: async (p) => {
        const run = c.current.measure(p.again === true);
        if (p.wait === true) await run;
        return { running: c.current.measuring(), ...counts() };
      },
    },
    {
      id: 'mosaic.target',
      title: 'Choose the picture rebuilt',
      description: 'Make one of the mosaic’s measured pictures the target — the picture its cells rebuild — by its Winnow id, or draw one at random from the seed (no id), as Draw a target does. A new target is framed whole. Answers the target.',
      params: { id: { type: 'number', description: 'A Winnow asset id in this mosaic (mosaic.get counts them).', integer: true, min: 0, optional: true } },
      available: () => (doc().tiles.some((t) => t.grid) ? true : 'no picture is measured yet — mosaic.add, then mosaic.measure'),
      run: (p) => {
        if (typeof p.id === 'number') {
          const ok = checkTarget(doc(), p.id);
          if (!ok.ok) throw new CommandError('invalid', ok.reason);
          c.current.setTarget(ok.value);
          return { target: doc().target ?? null };
        }
        const drawn = c.current.drawTarget();
        if (drawn === undefined) throw new CommandError('failed', 'no picture could be drawn');
        return { target: drawn };
      },
    },
    {
      id: 'mosaic.frame',
      title: 'Frame the target',
      description:
        'The shape of the mosaic (aspect: original — the picture’s own — 16:9, 3:2, 4:3, 1:1, 4:5, 9:16) and the part of the target it rebuilds: its centre (cx, cy, 0..1 of the picture) and scale (1 = the largest frame of that shape, down to 0.1); whole: true gives the whole frame back. A frame that would overhang is pushed back onto the picture, as a drag is.',
      params: {
        aspect: { type: 'string', description: 'The shape.', enum: ASPECTS, optional: true },
        cx: { type: 'number', description: 'The frame’s centre across, 0..1.', min: 0, max: 1, optional: true },
        cy: { type: 'number', description: 'The frame’s centre down, 0..1.', min: 0, max: 1, optional: true },
        scale: { type: 'number', description: 'Its size, 0.1..1.', min: 0.1, max: 1, optional: true },
        whole: { type: 'boolean', description: 'The whole frame of the shape.', optional: true },
      },
      available: () => (doc().target !== undefined ? true : 'the mosaic has no target yet — mosaic.target'),
      run: (p) => {
        const parts = ['cx', 'cy', 'scale'].filter((k) => typeof p[k] === 'number');
        if (p.whole === true && parts.length) throw new CommandError('invalid', 'whole and a crop (cx, cy, scale) cannot be asked together');
        if (typeof p.aspect === 'string') set((s) => ({ ...s, aspect: p.aspect as Settings['aspect'] }));
        if (p.whole === true) c.current.change((d) => withCrop(d, undefined));
        else if (parts.length) {
          const cur = doc().crop ?? { cx: 0.5, cy: 0.5, scale: 1 };
          const crop = cropAsked((p.cx as number | undefined) ?? cur.cx, (p.cy as number | undefined) ?? cur.cy, (p.scale as number | undefined) ?? cur.scale);
          c.current.change((d) => withCrop(d, crop));
        }
        const d = doc();
        return { aspect: d.settings.aspect, crop: d.crop ?? null };
      },
    },
    {
      id: 'mosaic.set',
      title: 'Set the mosaic’s dials',
      description:
        'The dials the Cells and Reading sections turn, and the title: cellPx (a cell’s width on the screen, the stage’s cell count follows), level (1 mean, 2 quarters, 3 zones), space (oklab or rgb), tint (0..0.7, the veil of each cell’s colour), distinctNeighbours (no picture twice side by side), speed (×0.4..2.5 of the motion), seed (the chain’s draws), title. One undo step; out of range is refused.',
      params: {
        title: { type: 'string', description: 'The mosaic’s title.', optional: true },
        cellPx: { type: 'number', description: `A cell’s width in screen pixels, ${MIN_CELL_PX}..${MAX_CELL_PX}.`, min: MIN_CELL_PX, max: MAX_CELL_PX, integer: true, optional: true },
        level: { type: 'number', description: 'What is compared: 1 the mean colour, 2 quarters, 3 nine zones.', min: 1, max: 3, integer: true, optional: true },
        space: { type: 'string', description: 'The distance: oklab or rgb.', enum: ['oklab', 'rgb'], optional: true },
        tint: { type: 'number', description: 'The veil of each cell’s colour, 0..0.7.', min: 0, max: 0.7, optional: true },
        distinctNeighbours: { type: 'boolean', description: 'No picture twice side by side.', optional: true },
        speed: { type: 'number', description: 'How fast the motion plays, ×0.4..2.5.', min: 0.4, max: 2.5, optional: true },
        seed: { type: 'number', description: 'The seed of the chain’s draws, 1..2147483647.', min: 1, max: 2147483647, integer: true, optional: true },
      },
      run: (p) => {
        if (typeof p.title === 'string') {
          const title = cleanMosaicTitle(p.title);
          if (!title) throw new CommandError('invalid', 'a mosaic needs a title');
          c.current.change((d) => ({ ...d, title, updatedAt: Date.now() }));
        }
        const dials = ['cellPx', 'level', 'space', 'tint', 'distinctNeighbours', 'speed', 'seed'] as const;
        const patch: Partial<Settings> = {};
        for (const k of dials) if (p[k] !== undefined) (patch as Record<string, unknown>)[k] = p[k];
        if (Object.keys(patch).length) set((s) => ({ ...s, ...patch }));
        const o = mosaicOutline(doc());
        return { title: o.title, dials: o.dials };
      },
    },
    {
      id: 'mosaic.motion',
      title: 'Set the mode and the motion',
      description: `The mode under the stage (${MOSAIC_MODES.join(', ')} — single is Still) and the parts of the step the Motion section opens: depart (${DEPARTURES.join(', ')}), arrival (${ARRIVALS.join(', ')}), reveal (${REVEAL_DIRECTIONS.join(', ')}), sharpness (${SHARPNESSES.join(', ')}), aim (${AIMS.join(', ')}), moveMs, holdMs, cadenceMs, drift. A recipe puts its parts back; a part set by hand makes the mode the recipe it still is, or custom. A running play stops. One undo step.`,
      params: {
        mode: { type: 'string', description: 'The mode.', enum: MOSAIC_MODES, optional: true },
        depart: { type: 'string', description: 'How a step leaves the mosaic held.', enum: DEPARTURES, optional: true },
        arrival: { type: 'string', description: 'What it lands on.', enum: ARRIVALS, optional: true },
        reveal: { type: 'string', description: 'A reveal’s direction.', enum: REVEAL_DIRECTIONS, optional: true },
        sharpness: { type: 'string', description: 'When a growing cell sharpens over its tile.', enum: SHARPNESSES, optional: true },
        aim: { type: 'string', description: 'Which cell a dive enters.', enum: AIMS, optional: true },
        moveMs: { type: 'number', description: `The move, ms at ×1, ${MOTION_BOUNDS.moveMs[0]}..${MOTION_BOUNDS.moveMs[1]}.`, min: MOTION_BOUNDS.moveMs[0], max: MOTION_BOUNDS.moveMs[1], integer: true, optional: true },
        holdMs: { type: 'number', description: `The hold, ms at ×1, ${MOTION_BOUNDS.holdMs[0]}..${MOTION_BOUNDS.holdMs[1]}.`, min: MOTION_BOUNDS.holdMs[0], max: MOTION_BOUNDS.holdMs[1], integer: true, optional: true },
        cadenceMs: { type: 'number', description: `A steady beat, ms (0 none), up to ${MOTION_BOUNDS.cadenceMs[1]}.`, min: MOTION_BOUNDS.cadenceMs[0], max: MOTION_BOUNDS.cadenceMs[1], integer: true, optional: true },
        drift: { type: 'boolean', description: 'Drift while the mosaic is held.', optional: true },
      },
      run: (p) => {
        const parts: Partial<Motion> = {};
        for (const k of MOTION_PARTS) if (p[k] !== undefined) (parts as Record<string, unknown>)[k] = p[k];
        set((s) => withMotionAsked(s, p.mode as MosaicMode | undefined, parts));
        const s = doc().settings;
        return { mode: s.mode, motion: s.motion };
      },
    },
  ];
  useRegisterCommands('mosaic-editor', specs);
}

export interface StageCommandsContext {
  latest: { current: MosaicDoc };
  /** The mosaic this render drew — what `play` and the exporter close over. */
  rendered: MosaicDoc;
  state: SceneState;
  status: PlayerStatus;
  play: () => void;
  stop: () => void;
  /** The canvas the player paints while a mode plays. */
  canvas: () => HTMLCanvasElement | null;
  exporter: Exporter;
  update: (fn: (s: Settings) => Settings) => void;
}

/** The stage's commands: what it shows, Play and Stop, a look at it, and the exports. */
export function useMosaicStageCommands(ctx: StageCommandsContext): void {
  const c = useRef(ctx);
  c.current = ctx;
  const scene = () => (c.current.state.status === 'ready' ? c.current.state.scene : null);
  // A command after a write (mosaic.motion, then mosaic.play) runs before React has drawn the write: the player and
  // the exporter close over the render's mosaic, so wait for the render to have caught up (a second at most).
  const settle = async () => {
    for (let i = 0; i < 40 && c.current.rendered !== c.current.latest.current; i++) await new Promise((r) => setTimeout(r, 25));
  };
  const specs: CommandSpec[] = [
    {
      id: 'mosaic.stage',
      title: 'What the stage shows',
      description: 'The stage now: whether its mosaic is built (cols × rows, painted 0..1 as its lots land, how long the matching took, where it ran), and the player — playing, the picture on screen, steps played, the phase, whether a step waits on its picture, the last step’s readiness.',
      run: () => {
        const st = c.current.state;
        const sc = scene();
        const pl = c.current.status;
        return {
          scene: sc ? { cols: sc.shape.cols, rows: sc.shape.rows, painted: Math.round(sc.progress * 100) / 100, matchMs: Math.round(sc.matchMs), on: sc.on, target: sc.targetId } : null,
          building: st.status === 'building',
          ...(st.status === 'failed' ? { error: st.error } : {}),
          ...(st.status === 'idle' ? { idle: st.why } : {}),
          player: { playing: pl.playing, current: pl.current >= 0 ? pl.current : null, done: pl.done, phase: pl.phase || null, waiting: pl.waiting, note: pl.note, error: pl.error, stepReadyMs: pl.prepMs },
        };
      },
    },
    {
      id: 'mosaic.play',
      title: 'Play',
      description: 'Play the mode under the stage (mosaic.motion sets it) — what Space does. mosaic.stage says how it goes; mosaic.stop stops, and whatever is on screen then is the target.',
      available: () => {
        if (c.current.status.playing) return 'already playing';
        if (c.current.latest.current.settings.mode === 'single') return 'the mode is Still — mosaic.motion sets one that plays';
        return scene() ? true : 'the mosaic is not built yet — mosaic.stage says why';
      },
      run: async () => {
        await settle();
        c.current.play();
        return { playing: true, mode: c.current.latest.current.settings.mode };
      },
    },
    {
      id: 'mosaic.stop',
      title: 'Stop',
      description: 'Stop the play — what Escape does. The picture on screen becomes the target and the steps played leave the chain.',
      available: () => (c.current.status.playing ? true : 'nothing is playing'),
      run: () => {
        c.current.stop();
        return { playing: false };
      },
    },
    {
      id: 'mosaic.snapshot',
      title: 'Look at the stage',
      description: 'The stage as a JPEG to look at: the built mosaic while still — once every lot has landed (30 s at most) — or the frame on screen while a mode plays.',
      params: { longEdge: { type: 'number', description: 'Pixels on the long edge, 160..1920 (default 960).', min: 160, max: 1920, integer: true, optional: true } },
      available: () => (scene() || (c.current.status.playing && c.current.canvas()) ? true : 'the mosaic is not built yet — mosaic.stage says why'),
      run: async (p) => {
        await settle();
        // Still: the whole mosaic, not a scene half painted as its lots land.
        for (let i = 0; i < 300 && !c.current.status.playing && (c.current.state.status === 'building' || (scene()?.progress ?? 1) < 1); i++) await new Promise((r) => setTimeout(r, 100));
        const source = c.current.status.playing ? c.current.canvas() : (scene()?.canvas ?? null);
        if (!source) throw new CommandError('unavailable', 'nothing is drawn yet');
        const long = (p.longEdge as number | undefined) ?? 960;
        const k = long / Math.max(source.width, source.height);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(source.width * k));
        out.height = Math.max(1, Math.round(source.height * k));
        const ctx = out.getContext('2d');
        if (!ctx) throw new CommandError('failed', 'this browser cannot draw the snapshot');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, out.width, out.height);
        const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/jpeg', 0.85));
        if (!blob) throw new CommandError('failed', 'the snapshot could not be encoded');
        const d = c.current.latest.current;
        return imageResult(blob, out.width, out.height, `${d.title}${c.current.status.playing ? ' · playing' : ''}`);
      },
    },
    {
      id: 'mosaic.export',
      title: 'Export the mosaic',
      description: `Save the mosaic as the Export section does, into the browser’s downloads: png — the target’s mosaic — or mp4 — the mode’s motion, its opening then steps (H.264, 30 fps, no sound; needs a mode that plays and a browser that encodes video). short is the file’s short side (${EXPORT_SHORTS.join(', ')}), cells "pixels" (a bigger file holds more cells) or "screen" (the stage’s cells, drawn bigger); both kept as the mosaic’s export settings. Answers the file’s name, size in pixels and bytes.`,
      params: {
        kind: { type: 'string', description: 'png or mp4.', enum: ['png', 'mp4'] },
        short: { type: 'number', description: `The short side, pixels: ${EXPORT_SHORTS.join(', ')}.`, min: 720, max: 2160, integer: true, optional: true },
        cells: { type: 'string', description: 'pixels or screen.', enum: ['pixels', 'screen'], optional: true },
        steps: { type: 'number', description: 'Steps a film plays after its opening, 1..40.', min: 1, max: 40, integer: true, optional: true },
      },
      available: () => {
        if (c.current.exporter.running) return 'an export is running';
        if (c.current.latest.current.target === undefined) return 'the mosaic has no target yet';
        return true;
      },
      run: async (p) => {
        if (typeof p.short === 'number' && !(EXPORT_SHORTS as readonly number[]).includes(p.short)) {
          throw new CommandError('invalid', `short is one of ${EXPORT_SHORTS.join(', ')}`);
        }
        const patch: Partial<Settings['export']> = {};
        if (typeof p.short === 'number') patch.short = p.short as Settings['export']['short'];
        if (typeof p.cells === 'string') patch.cells = p.cells as Settings['export']['cells'];
        if (typeof p.steps === 'number') patch.steps = p.steps;
        if (Object.keys(patch).length) c.current.update((s) => ({ ...s, export: { ...s.export, ...patch } }));
        await settle();
        const result = await c.current.exporter.run(p.kind as 'png' | 'mp4', patch);
        if (!result.ok) throw new CommandError(result.cancelled ? 'failed' : 'unavailable', result.message);
        return { name: result.name, width: result.width, height: result.height, bytes: result.bytes, ...(result.seconds ? { seconds: result.seconds } : {}) };
      },
    },
  ];
  useRegisterCommands('mosaic-stage', specs);
}
