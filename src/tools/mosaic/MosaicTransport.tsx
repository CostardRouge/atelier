import type { MosaicMode } from '../../shared/mosaic/mosaic-doc';
import { PHASE_WORDS, type Departure, type Motion, type StepPhase } from '../../shared/mosaic/motion';
import Button from '../../shared/ui/Button';
import { SelectField } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import type { PlayerStatus } from './mosaic-player';

/** The modes the transport offers, in order; a recipe not listed here is still played when a document names it. */
const MODES: readonly { id: MosaicMode; label: string; title: string }[] = [
  { id: 'single', label: 'Still', title: 'The target rebuilt, still' },
  { id: 'mosaics', label: 'Mosaics', title: 'From mosaic to mosaic: a dive into a cell lands on the next mosaic, the photo never appears' },
  { id: 'dezoom', label: 'Pull back', title: 'The picture pulls back and turns out to be one cell of another — once' },
  { id: 'chain', label: 'Chain', title: 'Endless: from picture to picture, diving into a cell or pulling back' },
  { id: 'reveal', label: 'Reveal', title: 'The cells flip one by one to the real picture' },
  { id: 'drift', label: 'Drift', title: 'The camera wanders over the mosaic, then fades to the next' },
  { id: 'wave', label: 'Wave', title: 'The next mosaic’s cells land on this one, from the aimed cell outward — no zoom, no photo' },
  { id: 'slideshow', label: 'Slideshow', title: 'A mosaic every six seconds, cut to the next, at a steady beat' },
  { id: 'steer', label: 'Steer', title: 'A long hold on each mosaic: click a cell to choose where the chain goes next' },
  { id: 'custom', label: 'Custom', title: 'The Motion section’s own settings, part by part' },
];
type ChainDepart = Extract<Departure, 'dive' | 'pull' | 'alternate'>;
const DIRECTIONS: readonly { id: ChainDepart; label: string; title: string }[] = [
  { id: 'dive', label: 'Dive in', title: 'Zoom into a cell: its picture becomes the next' },
  { id: 'pull', label: 'Pull out', title: 'The picture pulls back into a cell of the next' },
  { id: 'alternate', label: 'Both', title: 'A dive, a pull back, a dive…' },
];

const EXTRA_WORDS: Record<string, string> = { starting: 'starting…', preparing: 'preparing the next picture…', done: 'done' };

interface MosaicTransportProps {
  mode: MosaicMode;
  motion: Motion;
  setMode: (mode: MosaicMode) => void;
  setDepart: (depart: ChainDepart) => void;
  status: PlayerStatus;
  canPlay: boolean;
  onPlay: () => void;
  onStop: () => void;
  onFullscreen: () => void;
  /** A phone: the mode as a select, no direction (the Motion tab has it), no Screen (the ⋯ has it). */
  compact?: boolean;
}

/**
 * The row under the stage (`docs/mosaic.md` §5): the mode — a recipe of the
 * step grammar —, a chain's departure, Play / Stop (Space, the transport's
 * key), the screen, and what the player is doing. The mode and the motion
 * are the document's.
 */
export default function MosaicTransport({ mode, motion, setMode, setDepart, status, canPlay, onPlay, onStop, onFullscreen, compact = false }: MosaicTransportProps) {
  const playable = mode !== 'single';
  const listed = MODES.some((m) => m.id === mode);
  const chainDepart: ChainDepart = motion.depart === 'pull' || motion.depart === 'alternate' ? motion.depart : 'dive';
  const word = status.playing
    ? `${status.stepIndex + 1} · ${status.phase === 'hold' && motion.arrival === 'mosaic' ? 'the mosaic' : (PHASE_WORDS[status.phase as StepPhase] ?? EXTRA_WORDS[status.phase] ?? status.phase)}${status.waiting ? ' · waiting for the next picture' : ''}`
    : null;
  if (compact) {
    return (
      <div className="flex-none flex items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        <span className="w-[9.5rem] flex-none">
          <SelectField<MosaicMode> label="Mode" value={mode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={setMode} />
        </span>
        {playable &&
          (status.playing ? (
            <Button size="sm" icon={Icons.pause} onClick={onStop} title="Stop — the picture on screen becomes the target">
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Icons.play} disabled={!canPlay} onClick={onPlay} title="Play">
              Play
            </Button>
          ))}
        <span className="flex-1 min-w-0 truncate font-mono text-2xs text-muted tabular-nums" role="status">
          {word ?? (status.error && !status.playing ? status.error : status.note && !status.playing ? status.note : '')}
        </span>
      </div>
    );
  }
  return (
    <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
      <Segmented<MosaicMode> size="sm" value={listed ? mode : 'single'} options={MODES} onChange={setMode} />
      {!listed && <span className="font-mono text-2xs text-muted">{mode}</span>}
      {mode === 'chain' && <Segmented<ChainDepart> size="sm" value={chainDepart} options={DIRECTIONS} onChange={setDepart} />}
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
      {word && (
        <span className="font-mono text-2xs text-muted tabular-nums" role="status">
          {word}
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
