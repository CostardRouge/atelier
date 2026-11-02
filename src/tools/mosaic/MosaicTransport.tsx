import { useRef, useState } from 'react';
import type { MosaicMode } from '../../shared/mosaic/mosaic-doc';
import { PHASE_WORDS, type Departure, type Motion, type Recipe, type StepPhase } from '../../shared/mosaic/motion';
import Button from '../../shared/ui/Button';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import ModeDrawer, { ModeButton } from './ModeDrawer';
import type { PlayerStatus } from './mosaic-player';
import type { MosaicScene } from './scene-builder';

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
  /** The recipe the mode button shows: the mode, or under Still the one Play would start. */
  recipe: Recipe | 'custom';
  /** The mosaic on the stage, which the mode previews are painted from. */
  scene: MosaicScene | null;
  onStill: () => void;
  onPickRecipe: (recipe: Recipe) => void;
  /** Custom: the mode becomes the Motion section's parts, and the section opens. */
  onCustom: () => void;
  setDepart: (depart: ChainDepart) => void;
  status: PlayerStatus;
  canPlay: boolean;
  /** Play — from Still too: the recipe on the button plays. */
  onPlay: () => void;
  onStop: () => void;
  onFullscreen: () => void;
  /** A phone: no direction (the Motion tab has it), no Screen (the ⋯ has it), the drawer a sheet. */
  compact?: boolean;
}

/**
 * The row under the stage (`docs/mosaic.md` §5, lab 4's L1): *Still* — the
 * editing state — then the MODE as one button showing the recipe Play plays,
 * which opens the mode drawer (`ModeDrawer.tsx`), a chain's departure, Play /
 * Stop (Space, the transport's key), the screen, and what the player is
 * doing. The mode and the motion are the document's.
 */
export default function MosaicTransport({ mode, motion, recipe, scene, onStill, onPickRecipe, onCustom, setDepart, status, canPlay, onPlay, onStop, onFullscreen, compact = false }: MosaicTransportProps) {
  const [drawer, setDrawer] = useState(false);
  const modeRef = useRef<HTMLButtonElement>(null);
  const still = mode === 'single';
  const chainDepart: ChainDepart = motion.depart === 'pull' || motion.depart === 'alternate' ? motion.depart : 'dive';
  const word = status.playing
    ? `${status.stepIndex + 1} · ${status.phase === 'hold' && motion.arrival === 'mosaic' ? 'the mosaic' : (PHASE_WORDS[status.phase as StepPhase] ?? EXTRA_WORDS[status.phase] ?? status.phase)}${status.waiting ? ' · waiting for the next picture' : ''}`
    : null;
  const idle = !status.playing ? (status.error ?? status.note) : null;
  const stillButton = (
    <Button size="sm" variant={still ? 'default' : 'ghost'} aria-pressed={still} onClick={onStill} title="Still — the mosaic held, to frame and tune it; Play plays the mode beside it">
      Still
    </Button>
  );
  const modeButton = <ModeButton buttonRef={modeRef} recipe={recipe} scene={scene} active={!still} expanded={drawer} onClick={() => setDrawer((o) => !o)} />;
  const playButton = status.playing ? (
    <Button size="sm" icon={Icons.pause} onClick={onStop} title="Stop (Space, Escape) — the picture on screen becomes the target">
      Stop
    </Button>
  ) : (
    <Button size="sm" variant="primary" icon={Icons.play} disabled={!canPlay} onClick={onPlay} title="Play (Space)">
      Play
    </Button>
  );
  const modeDrawer = (
    <ModeDrawer
      open={drawer}
      onClose={() => setDrawer(false)}
      current={still ? null : recipe}
      scene={scene}
      onPick={(r) => {
        setDrawer(false);
        onPickRecipe(r);
      }}
      onCustom={() => {
        setDrawer(false);
        onCustom();
      }}
      compact={compact}
      anchor={modeRef}
    />
  );
  if (compact) {
    return (
      <div className="relative flex-none flex items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
        {stillButton}
        {modeButton}
        {playButton}
        <span className="flex-1 min-w-0 truncate font-mono text-2xs text-muted tabular-nums" role="status">
          {word ?? idle ?? ''}
        </span>
        {modeDrawer}
      </div>
    );
  }
  return (
    <div className="relative flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-paper-lg bg-surface shadow-paper-soft">
      {stillButton}
      {modeButton}
      {mode === 'chain' && <Segmented<ChainDepart> size="sm" value={chainDepart} options={DIRECTIONS} onChange={setDepart} />}
      {playButton}
      <span className="flex-1" />
      {word && (
        <span className="font-mono text-2xs text-muted tabular-nums" role="status">
          {word}
        </span>
      )}
      {idle && (
        <span className={`font-mono text-2xs ${status.error ? 'text-danger' : 'text-muted'}`} role="status">
          {idle}
        </span>
      )}
      <Button size="sm" variant="ghost" icon={Icons.monitor} onClick={onFullscreen} title="The stage on the whole screen — the screen saver; Escape leaves it">
        Screen
      </Button>
      {modeDrawer}
    </div>
  );
}
