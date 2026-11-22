import IconButton from '../../shared/ui/IconButton';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';
import { useVerb } from '../../shared/ui/use-verb';
import TrimBar from '../../shared/media/TrimBar';
import SliderBar from '../../shared/ui/SliderBar';
import { trimDuration, type TrimRange } from '../../shared/media/trim';
import { formatDuration, formatTimecode } from '../../shared/lib/format';
import type { StageSound } from './studio-sound';

/** The preview speed: a step of the menu, or the one that undoes the clip's own conform. */
export type PreviewSpeed = number | 'realtime';

export interface StudioTransportProps {
  playing: boolean;
  onTogglePlay: () => void;
  time: number;
  duration: number;
  range: TrimRange;
  trimmed: boolean;
  frameStep: number;
  onSeek: (t: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onRangeChange: (range: TrimRange) => void;
  onClearTrim: () => void;
  loop: boolean;
  onLoop: (loop: boolean) => void;
  sound: StageSound;
  onSound: (sound: StageSound) => void;
  previewSpeed: PreviewSpeed;
  /** The rate the preview plays at — 1 draws the speed control at rest. */
  previewRate: number;
  speedChoices: readonly number[];
  /** The rate that undoes the clip's conform; 1 when it has none. */
  realtimeRate: number;
  onPreviewSpeed: (speed: PreviewSpeed) => void;
  compareOn: boolean;
  onCompare: (on: boolean) => void;
  /** Save this frame, overlays and look burned in. */
  onGrab: () => Promise<void> | void;
  onShortcuts: () => void;
  /** A phone: Play, the time, the rail, the sound and a ⋯ for the rest. */
  compact: boolean;
  /** The box the row sits in (a floating glass under an immersive phone stage). */
  className: string;
}

/** `0:02.2` — the trimmed range's ends to a tenth: the chip shares the row with the rail it shortens. */
const tenths = (t: number) => formatTimecode(t).slice(0, -1);

const speedLabel = (sp: number) => (sp === 0.5 ? '½×' : sp === 0.25 ? '¼×' : `${sp}×`);

/**
 * The Studio's transport, ONE row (2026-11-22, pick A of his lab
 * https://claude.ai/artifact/JwWuntDseSgSQcqQsrWKjw): the grammar of Flight
 * Atlas's and Mosaic's — Play, the time, the trim rail, then icons of one
 * shape. The trimmed range is said where the duration was, with its reset; the
 * hints that took a line under the rail are in the ⌨ sheet (`StudioShortcuts`).
 * The stage plays the clip's own sound when the speaker is on (`M`), its
 * volume under the speaker on hover. Two groups that wrap between them — the
 * rule of «A control row wraps» — so a narrow window drops the tools to a line
 * rather than past the edge.
 */
export default function StudioTransport(p: StudioTransportProps) {
  const grab = useVerb();
  const runGrab = () => grab.run(p.onGrab);
  const playButton = (
    <IconButton
      label={p.playing ? 'Pause (Space)' : 'Play (Space)'}
      variant="primary"
      size={p.compact ? 'lg' : 'md'}
      onClick={p.onTogglePlay}
    >
      {p.playing ? Icons.pause : Icons.play}
    </IconButton>
  );
  const rail = (
    <TrimBar
      duration={p.duration}
      time={p.time}
      range={p.range}
      minLength={p.frameStep}
      step={p.frameStep}
      onSeek={p.onSeek}
      onScrubStart={p.onScrubStart}
      onScrubEnd={p.onScrubEnd}
      onRangeChange={p.onRangeChange}
    />
  );
  const soundButton = (
    <IconButton
      label={p.sound.on ? 'Sound on — click to mute (M)' : 'Sound off — click to hear the clip (M)'}
      variant={p.sound.on ? 'default' : 'ghost'}
      size={p.compact ? 'lg' : 'md'}
      aria-pressed={p.sound.on}
      onClick={() => p.onSound({ ...p.sound, on: !p.sound.on })}
    >
      {p.sound.on ? Icons.volume : Icons.volumeOff}
    </IconButton>
  );

  if (p.compact) {
    const items: OverflowItem[] = [
      { id: 'loop', label: 'Loop the range', checked: p.loop, onSelect: () => p.onLoop(!p.loop) },
      { id: 'compare', label: 'Compare A/B', checked: p.compareOn, onSelect: () => p.onCompare(!p.compareOn) },
      { id: 'grab', label: 'Capture this frame', onSelect: runGrab, disabled: grab.phase === 'working' },
      ...(p.trimmed ? [{ id: 'untrim', label: 'Use the whole clip again', onSelect: p.onClearTrim }] : []),
      ...p.speedChoices.map((sp, i) => ({
        id: `speed-${sp}`,
        label: `Preview at ${speedLabel(sp)}`,
        checked: p.previewSpeed === sp,
        rule: i === 0,
        onSelect: () => p.onPreviewSpeed(sp),
      })),
      ...(p.realtimeRate !== 1
        ? [{ id: 'speed-real', label: `Preview at real time (${Math.round(p.realtimeRate * 100) / 100}×)`, checked: p.previewSpeed === 'realtime', onSelect: () => p.onPreviewSpeed('realtime') }]
        : []),
      { id: 'keys', label: 'Keys and gestures', rule: true, onSelect: p.onShortcuts },
    ];
    return (
      <div className={`flex items-center gap-1.5 px-1.5 py-1.5 border border-line rounded-paper ${p.className}`}>
        {playButton}
        <span className="flex-none font-mono text-xs tabular-nums text-ink-soft" title={p.trimmed ? 'Trimmed — only the range previews and exports' : undefined}>
          {formatTimecode(p.time).replace(/\.\d+$/, '')}
        </span>
        <div className="flex flex-1 min-w-0">{rail}</div>
        {soundButton}
        <OverflowMenu label="More playback controls" items={items} size="lg" side="above" />
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5 border border-line rounded-control ${p.className}`}>
      <div className="flex items-center gap-2 grow shrink basis-[15rem] min-w-0">
        {playButton}
        <span className="flex-none font-mono text-xs tabular-nums text-ink-soft">
          {formatTimecode(p.time)}
          {!p.trimmed && <span className="text-muted"> / {formatDuration(p.duration)}</span>}
        </span>
        <div className="flex flex-1 min-w-0">{rail}</div>
        {p.trimmed && (
          <span
            className="flex-none inline-flex items-center gap-1 h-[2.125rem] pl-2.5 pr-0.5 rounded-control bg-accent-wash text-accent-ink font-mono text-2xs tabular-nums"
            title="Trimmed range — only this part previews and exports"
          >
            {tenths(p.range.start)} → {tenths(p.range.end)} · {trimDuration(p.range).toFixed(1)} s
            <IconButton label="Use the whole clip again" variant="ghost" size="sm" className="text-accent-ink" onClick={p.onClearTrim}>
              {Icons.reset}
            </IconButton>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 max-w-full">
        {/* The volume lives under the speaker: on hover or focus, never a
            control of its own on the row (a finger has the device's buttons). */}
        <div className="group relative flex">
          {soundButton}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 hidden group-hover:block group-focus-within:block pointer-coarse:!hidden z-20">
            <div className="w-52 p-1.5 border border-line-strong rounded-control bg-surface shadow-paper">
              <SliderBar
                label="Volume"
                name="Volume of the clip’s sound"
                value={p.sound.volume}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)} %`}
                onChange={(volume) => p.onSound({ on: true, volume })}
              />
            </div>
          </div>
        </div>
        <IconButton
          label={p.loop ? 'Looping the range — click to stop on its out point (L)' : 'Loop the range instead of stopping on its out point (L)'}
          variant={p.loop ? 'default' : 'ghost'}
          aria-pressed={p.loop}
          onClick={() => p.onLoop(!p.loop)}
        >
          {Icons.loop}
        </IconButton>
        {/* Preview speed. Viewing only — it moves no readout and no export;
            the delivered speed lives in the Export tab. */}
        <select
          value={p.previewSpeed === 'realtime' ? 'realtime' : String(p.previewSpeed)}
          onChange={(e) => p.onPreviewSpeed(e.target.value === 'realtime' ? 'realtime' : Number(e.target.value))}
          aria-label="Preview speed"
          title="Preview speed — the readouts and the export are untouched"
          className={`flex-none h-[2.125rem] pl-2.5 pr-1 rounded-control border font-mono text-2xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors ${
            p.previewRate === 1 ? 'border-line-strong bg-paper text-ink-soft hover:border-accent' : 'border-accent bg-accent-wash text-accent-ink'
          }`}
        >
          {p.speedChoices.map((sp) => (
            <option key={sp} value={sp}>
              {speedLabel(sp)}
            </option>
          ))}
          {p.realtimeRate !== 1 && <option value="realtime">real ({Math.round(p.realtimeRate * 100) / 100}×)</option>}
        </select>
        <span className="flex-none w-px h-5 mx-1 bg-line" aria-hidden="true" />
        <IconButton
          label={p.compareOn ? 'Comparing — drag the divider on the stage; click to stop' : 'Compare the original and the composed picture (A/B)'}
          variant={p.compareOn ? 'default' : 'ghost'}
          aria-pressed={p.compareOn}
          onClick={() => p.onCompare(!p.compareOn)}
        >
          {Icons.compare}
        </IconButton>
        <IconButton label="Save this frame as a JPEG, overlays and look burned in" variant="ghost" phase={grab.phase} onClick={runGrab}>
          {Icons.camera}
        </IconButton>
        <IconButton label="Keys and gestures (?)" variant="ghost" onClick={p.onShortcuts}>
          {Icons.keyboard}
        </IconButton>
      </div>
    </div>
  );
}
