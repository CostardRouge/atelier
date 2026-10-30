// The BLOCK LIBRARY: one drawing function per block, (ctx, localSeconds, params, episode).
// A block is pure canvas drawing at a local clock; it never knows where in the episode it sits.
import type { Ctx } from "../motion";
import type { Episode } from "../episode";
import { drawIntro } from "../scenes/Intro";
import { drawHook } from "../scenes/Hook";
import { drawMap } from "../scenes/MapScene";
import { drawFolders } from "../scenes/Folders";
import { drawRecap, drawRecapCarte } from "../scenes/Recap";

export type BlockFn = (c: Ctx, lt: number, params: Record<string, unknown>, ep: Episode) => void;

export const BLOCKS: Record<string, BlockFn> = {
  intro: (c, lt, p) => drawIntro(c, lt, p as { title: string; number: string; season?: number }),
  wall: (c, lt, p) => drawHook(c, lt, p),
  "map-camera": (c, lt, p) => drawMap(c, lt, p),
  folders: (c, lt, p) => drawFolders(c, lt, p),
  recap: (c, lt, p) => drawRecap(c, lt, p as { next: { number: string; title: string; thumb?: CanvasImageSource | null } }),
  "recap-carte": (c, lt, p) => drawRecapCarte(c, lt, p as { series?: string; handle?: string; ask?: string }),
};

/** Blocks register themselves here from their own file: `register("counter", drawCounter)`. */
export const register = (name: string, fn: BlockFn) => { BLOCKS[name] = fn; };
