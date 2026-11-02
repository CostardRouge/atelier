import { useEffect, useRef, useState } from 'react';
import type { ChainEntry } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import IconButton from '../../shared/ui/IconButton';
import { ToggleField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import { revealInScroller } from '../../shared/ui/reveal';
import { getTile } from './mosaic-store';

interface ChainBandProps {
  /** The Winnow the pictures come from — the key the tiles are filed under. */
  instance: string;
  client: WinnowClient | null;
  /** The picture on screen: the target, or what the player shows. */
  current: number | undefined;
  queue: readonly ChainEntry[];
  /** Steps played to their end this run — the entries before them are behind. */
  done: number;
  playing: boolean;
  /** The step holds its last frame because the next picture is not ready: the *next* tile says so. */
  waiting?: boolean;
  draw: boolean;
  setDraw: (draw: boolean) => void;
  /** The chooser for the entry at `at` (in place), or for one more at the end. */
  onReplace: (at: number) => void;
  onInsert: () => void;
  onRemove: (at: number) => void;
  onShuffle: () => void;
  /** A phone: the switch without its words (its name stays its accessible name and its tooltip). */
  compact?: boolean;
}

/** Object URLs of the tiles shown lately, by `instance:id`; the oldest revoked past `TILE_URLS`. */
const tileUrls = new Map<string, Promise<string | null>>();
const TILE_URLS = 64;

/**
 * The tile's object URL, made once and kept for a while: an element that
 * revoked its own URL on unmount broke the picture React's development
 * double-mount had just asked for, and a band re-rendered on every edit
 * would read the store again for the same tile.
 */
function tileUrl(instance: string, id: number): Promise<string | null> {
  const key = `${instance}:${id}`;
  const have = tileUrls.get(key);
  if (have) {
    tileUrls.delete(key);
    tileUrls.set(key, have);
    return have;
  }
  const p = getTile(instance, id).then((blob) => (blob ? URL.createObjectURL(blob) : null));
  tileUrls.set(key, p);
  while (tileUrls.size > TILE_URLS) {
    const oldest = tileUrls.keys().next().value;
    if (oldest === undefined) break;
    const gone = tileUrls.get(oldest);
    tileUrls.delete(oldest);
    void gone?.then((url) => url && URL.revokeObjectURL(url));
  }
  return p;
}

/**
 * The 160 × 90 tile the device keeps for a picture, as an `<img>` — free, no
 * request; the instance's thumbnail (`WinnowThumb`) only when the store has
 * none.
 */
function TileThumb({ instance, client, id }: { instance: string; client: WinnowClient | null; id: number }) {
  const [url, setUrl] = useState<string | null | 'none'>(null);
  useEffect(() => {
    let alive = true;
    void tileUrl(instance, id).then((made) => {
      if (alive) setUrl(made ?? 'none');
    });
    return () => {
      alive = false;
    };
  }, [instance, id]);
  if (url === 'none' && client) return <WinnowThumb client={client} id={id} label="picture" box="w-full h-full" />;
  return url && url !== 'none' ? <img src={url} alt="" draggable={false} className="block w-full h-full object-cover" /> : <span className="block w-full h-full bg-frame" />;
}

/**
 * The chain as a FILE of pictures under the stage (lab 2, R6): the one on
 * screen first, in vermilion, then the ones to come — drawn from the seed in
 * grey, picked by the person in white — ten ahead, refilled under five
 * (`refillQueue`). A press on one opens the chooser to replace it, its ×
 * removes it, + adds one at the end, Shuffle draws the coming ones again;
 * *Draw the next ones* off, the chain ends at the last picked picture. While
 * a run plays the played entries fall away so the current stays at the left,
 * and the entry being prepared is not touched.
 */
export default function ChainBand({ instance, client, current, queue, done, playing, waiting = false, draw, setDraw, onReplace, onInsert, onRemove, onShuffle, compact = false }: ChainBandProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const from = playing ? Math.min(done, queue.length) : 0;
  const coming = queue.slice(from);
  // The current picture stays at the left as the chain advances.
  useEffect(() => {
    revealInScroller(scroller.current?.querySelector<HTMLElement>('[data-chain-current]'), { inline: 'start', block: null, behavior: playing ? 'smooth' : 'auto', scroller: scroller.current });
  }, [current, from, playing]);

  return (
    <div className="flex-none flex items-center gap-2 px-2 py-1.5 border border-line rounded-control bg-surface shadow-paper-soft" aria-label="The chain" role="group">
      <div ref={scroller} className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden py-0.5 [scrollbar-width:thin]">
        {current !== undefined && (
          <div data-chain-current data-id={current} className="relative flex-none w-20 h-11 overflow-hidden ring-2 ring-accent rounded-[2px]" title="The picture on screen">
            <TileThumb instance={instance} client={client} id={current} />
            <span className="absolute left-1 top-0.5 font-mono text-2xs leading-none text-on-media drop-shadow">now</span>
          </div>
        )}
        {coming.map((e, k) => {
          const at = from + k;
          // The step being prepared, or played towards, is already in the player's hands.
          const locked = playing && k === 0;
          return (
            <div key={`${at}:${e.id}`} className="relative flex-none w-20 h-11" data-chain-entry={at} data-chain-by={e.by}>
              <button
                type="button"
                data-chain-tile
                disabled={locked}
                onClick={() => onReplace(at)}
                className={`block w-full h-full overflow-hidden rounded-[2px] border ${e.by === 'pick' ? 'border-paper' : 'border-line-strong/60 opacity-80'} ${k === 0 ? 'shadow-[inset_0_-2px_0_0_#f4f0e7]' : ''} disabled:cursor-default hover:enabled:opacity-100 focus-visible:outline-2 focus-visible:outline-accent`}
                title={locked ? 'The next picture — already being prepared' : e.by === 'pick' ? 'Picked by you — press to replace it' : 'Drawn from the seed — press to replace it'}
              >
                <TileThumb instance={instance} client={client} id={e.id} />
                <span className="absolute left-1 top-0.5 font-mono text-2xs leading-none text-on-media drop-shadow">{k === 0 ? 'next' : `${at + 1}`}</span>
                {locked && waiting && (
                  <span className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-paper/20" role="progressbar" aria-label="Preparing the next picture" title="Not ready yet — the stage holds its picture until it is">
                    <span className="block h-full w-1/3 bg-accent animate-[chain-wait_1.1s_ease-in-out_infinite_alternate]" />
                  </span>
                )}
              </button>
              {!locked && (
                <button
                  type="button"
                  aria-label={`Remove picture ${at + 1} from the chain`}
                  title="Remove from the chain"
                  onClick={() => onRemove(at)}
                  className="absolute -right-1 -top-1 w-5 h-5 grid place-items-center rounded-full bg-frame/85 text-on-media hover:bg-accent [&>svg]:w-3 [&>svg]:h-3 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {Icons.close}
                </button>
              )}
            </div>
          );
        })}
        {!coming.length && (
          <span className="font-mono text-2xs text-muted px-1" role="status">
            {draw ? 'the chain draws its pictures from the seed' : 'nothing queued — pick a picture, or let the chain draw'}
          </span>
        )}
      </div>
      <IconButton label="Add a picture to the chain" size="sm" variant="ghost" onClick={onInsert}>
        {Icons.plus}
      </IconButton>
      <IconButton label="Shuffle — draw the coming pictures again (your picks stay)" size="sm" variant="ghost" onClick={onShuffle} disabled={playing}>
        {Icons.refresh}
      </IconButton>
      <span title="On, the chain draws the coming pictures from the mosaic’s seed; off, it ends at the last picture you picked">
        <ToggleField label="Draw the next ones" checked={draw} onChange={setDraw}>
          {compact ? null : 'Draw the next ones'}
        </ToggleField>
      </span>
    </div>
  );
}
