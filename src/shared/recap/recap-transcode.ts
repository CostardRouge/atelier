/**
 * An ORIGINAL the browser cannot play (an iPhone HEVC `.MOV`, a Live Photo's
 * motion) converted for one recap's film by the suite's ffmpeg.wasm — his yes
 * of 2026-11-05. Only what the film needs: the background's loop window (a
 * little margin around it), scaled to the size it is SHOWN at — the page
 * covered, at its zoom — never past the source's own pixels; H.264 at a high
 * quality, no sound (a recap's sound is its bed). The result is kept on the
 * device under a key derived from what it was made for, so the next export
 * reuses it.
 *
 * Pure: the window, the filter, the arguments and the key.
 */

/** Seconds kept around the loop, so a seek just outside it still lands on a frame. */
export const WINDOW_MARGIN = 0.5;
/** A cell's clip is converted whole, up to this — its turns rarely reach past it. */
export const CELL_MAX_SECONDS = 30;
/** x264's constant quality: visually lossless for a film the platforms re-encode anyway. */
export const TRANSCODE_CRF = 17;

export interface TranscodeWindow {
  /** Seconds into the original where the converted clip starts. */
  from: number;
  /** Seconds into the original where it ends; null = its end. */
  to: number | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The background's window: its loop with a margin each side. */
export function loopWindow(bg: { loopIn: number; loopOut: number | null }): TranscodeWindow {
  const from = r2(Math.max(0, bg.loopIn - WINDOW_MARGIN));
  return { from, to: bg.loopOut === null ? null : r2(Math.max(from + 0.1, bg.loopOut + WINDOW_MARGIN)) };
}

/** A cell's window: the clip from its start, at most `CELL_MAX_SECONDS`. */
export function cellWindow(): TranscodeWindow {
  return { from: 0, to: CELL_MAX_SECONDS };
}

/**
 * The loop as it reads on the CONVERTED clip, which starts at `win.from`:
 * every time moves back by it. An open out stays open.
 */
export function shiftedLoop<T extends { loopIn: number; loopOut: number | null }>(bg: T, win: TranscodeWindow): T {
  return { ...bg, loopIn: Math.max(0, bg.loopIn - win.from), loopOut: bg.loopOut === null ? null : Math.max(0, bg.loopOut - win.from) };
}

/**
 * ffmpeg's scale for a clip shown covering `boxW × boxH` at `zoom`: the axis
 * that governs the cover gets the box's size times the zoom, never more than
 * the source's own (`min(…, iw)`), the other follows the aspect, even.
 * Written as an expression because the original's size is unknown here —
 * the browser could not open it.
 */
export function coverScale(boxW: number, boxH: number, zoom = 1): string {
  const z = Math.min(4, Math.max(1, zoom));
  const w = Math.round(boxW * z);
  const h = Math.round(boxH * z);
  const box = `${boxW}/${boxH}`;
  // Wider than the box: its height covers. Else its width does.
  return `scale=w='if(gt(a,${box}),-2,min(iw,${w}))':h='if(gt(a,${box}),min(ih,${h}),-2)':flags=lanczos`;
}

/** ffmpeg's arguments for one conversion. `-ss` before `-i` seeks fast; the re-encode makes it exact. */
export function transcodeArgs(inName: string, outName: string, win: TranscodeWindow, scale: string): string[] {
  return [
    ...(win.from > 0 ? ['-ss', String(win.from)] : []),
    '-i', inName,
    ...(win.to !== null ? ['-t', String(r2(win.to - win.from))] : []),
    '-vf', scale,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(TRANSCODE_CRF),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outName,
  ];
}

/** Where a conversion is kept: the clip's key, then what it was made for (`pruneMedia` reads the part before `#`). */
export function transcodeKey(key: string, win: TranscodeWindow, boxW: number, boxH: number, zoom = 1): string {
  return `${key}#hq:${win.from}-${win.to ?? 'end'}@${boxW}x${boxH}z${Math.round(Math.min(4, Math.max(1, zoom)) * 100) / 100}`;
}
