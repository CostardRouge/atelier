import type { ChainDirection, MosaicMode } from '../../shared/mosaic/mosaic-doc';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import type { PlayerStatus } from './mosaic-player';

const MODES: readonly { id: MosaicMode; label: string; title: string }[] = [
  { id: 'single', label: 'Still', title: 'The target rebuilt, still' },
  { id: 'dezoom', label: 'Pull back', title: 'The picture pulls back and turns out to be one cell of another — once' },
  { id: 'chain', label: 'Chain', title: 'Endless: from picture to picture, diving into a cell or pulling back' },
  { id: 'reveal', label: 'Reveal', title: 'The cells flip one by one to the real picture' },
  { id: 'drift', label: 'Drift', title: 'The camera wanders over the mosaic at mid zoom' },
];
const DIRECTIONS: readonly { id: ChainDirection; label: string; title: string }[] = [
  { id: 'in', label: 'Dive in', title: 'Zoom into a cell: its picture becomes the next' },
  { id: 'out', label: 'Pull out', title: 'The picture pulls back into a cell of the next' },
  { id: 'alternate', label: 'Both', title: 'A dive, a pull back, a dive…' },
];

const PHASE_WORDS: Record<string, string> = {
  starting: 'starting…',
  preparing: 'preparing the next picture…',
  hold: 'the picture',
  dissolve: 'into its cells',
  zoom: 'diving in',
  zoomout: 'pulling back',
  resolve: 'the picture appears',
  reveal: 'revealing',
  after: 'the picture',
  drifting: 'drifting',
  done: 'done',
};

interface MosaicTransportProps {
  mode: MosaicMode;
  direction: ChainDirection;
  setMode: (mode: MosaicMode) => void;
  setDirection: (direction: ChainDirection) => void;
  status: PlayerStatus;
  canPlay: boolean;
  onPlay: () => void;
  onStop: () => void;
  onFullscreen: () => void;
}

/**
 * The row under the stage (`docs/mosaic.md` §5): the mode, the chain's
 * direction, Play / Stop (Space, the transport's key), the screen, and what
 * the player is doing. The mode and the direction are the document's.
 */
export default function MosaicTransport({ mode, direction, setMode, setDirection, status, canPlay, onPlay, onStop, onFullscreen }: MosaicTransportProps) {
  const playable = mode !== 'single';
  return (
    <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
      <Segmented<MosaicMode> size="sm" value={mode} options={MODES} onChange={setMode} />
      {mode === 'chain' && <Segmented<ChainDirection> size="sm" value={direction} options={DIRECTIONS} onChange={setDirection} />}
      {playable &&
        (status.playing ? (
          <Button size="sm" icon={Icons.pause} onClick={onStop} title="Stop (Space, Escape) — the picture on screen becomes the target">
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Icons.play} disabled={!canPlay} onClick={onPlay} title="Play (Space)">
            Play
          </Button>
        ))}
      <span className="flex-1" />
      {status.playing && (
        <span className="font-mono text-2xs text-muted tabular-nums" role="status">
          {status.stepIndex + 1} · {PHASE_WORDS[status.phase] ?? status.phase}
          {status.waiting ? ' · waiting for the next picture' : ''}
        </span>
      )}
      {status.error && !status.playing && (
        <span className="font-mono text-2xs text-danger" role="status">
          {status.error}
        </span>
      )}
      {status.note && !status.error && !status.playing && (
        <span className="font-mono text-2xs text-muted" role="status">
          {status.note}
        </span>
      )}
      <Button size="sm" variant="ghost" icon={Icons.monitor} onClick={onFullscreen} title="The stage on the whole screen — the screen saver; Escape leaves it">
        Screen
      </Button>
    </div>
  );
}
