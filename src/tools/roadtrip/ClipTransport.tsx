import { useCallback, useEffect } from 'react';
import { formatTimecode } from '../../shared/lib/format';
import TrimBar from '../../shared/media/TrimBar';
import { describeKeyTarget, targetOwnsSpace, targetOwnsTyping } from '../../shared/media/transport-keys';
import { setEnd, setStart, trimDuration, type TrimRange } from '../../shared/media/trim';
import { CLIP_SPEEDS, MIN_HOOK_SECONDS, screenSecondsOf } from '../../shared/roadtrip/hook-video';
import { useLearnedGesture } from '../../shared/ui/use-learned-gesture';

interface ClipTransportProps {
  /** The clip's length, in source seconds. */
  duration: number;
  /** The playhead, in source seconds. */
  time: number;
  /** The stretch of the source this slide delivers. */
  range: TrimRange;
  /** The speed the stretch plays at — on the stage and in the file. */
  speed: number;
  playing: boolean;
  loop: boolean;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onScrubStart: () => void;
  onRangeChange: (range: TrimRange) => void;
  onSpeed: (speed: number) => void;
  onLoop: (on: boolean) => void;
  /** A phone: fewer words, tighter gaps. */
  compact: boolean;
}

/** Shortest stretch the handles may leave — the same floor `clipSlice` keeps. */
const MIN_LENGTH = MIN_HOOK_SECONDS / 4;
/** Arrow-key step. The container is not probed here; a thirtieth is a frame on most clips. */
const STEP = 1 / 30;

const pill =
  'flex-none px-2.5 py-1 rounded-full border font-mono text-2xs tracking-[0.06em] cursor-pointer transition-colors focus:outline-none';
const pillOff = 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent';
const pillOn = 'border-accent bg-accent-wash text-accent-ink';

/**
 * The transport of a slide whose picture is a CLIP: play the stretch it
 * delivers, cut it with the Studio's own trim bar, choose its speed.
 *
 * It is the Studio's transport with one difference that matters: the speed
 * here is not a viewing choice, it is the SLIDE's — what the stage plays at is
 * what the file plays at, so the author sees the piece as it will go out, and
 * a re-timed clip is announced silent here before it is ever encoded.
 *
 * Space plays and pauses; `I` and `O` cut at the playhead, the Studio's
 * reflexes. Bound on `window` for the same reason the Studio's are — the
 * picture is a canvas, and nothing on it is worth focusing.
 */
export default function ClipTransport({
  duration,
  time,
  range,
  speed,
  playing,
  loop,
  onTogglePlay,
  onSeek,
  onScrubStart,
  onRangeChange,
  onSpeed,
  onLoop,
  compact,
}: ClipTransportProps) {
  // The shortcut hint retires itself once a cut has been made, from the
  // handler the cut lands in — never from a mount, or it goes before it is read.
  const cut = useLearnedGesture('roadtrip.clip-cut');
  const changeRange = useCallback(
    (next: TrimRange) => {
      cut.learn();
      onRangeChange(next);
    },
    [cut, onRangeChange],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = describeKeyTarget(e.target);
      if (e.code === 'Space' || e.key === ' ') {
        if (e.repeat || e.shiftKey || targetOwnsSpace(target)) return;
        e.preventDefault();
        onTogglePlay();
        return;
      }
      // A letter needs the NARROWER guard: a button does not own `i`, and
      // treating it as if it did kills the shortcut after any button click.
      if (targetOwnsTyping(target)) return;
      const key = e.key.toLowerCase();
      if (key === 'i') {
        e.preventDefault();
        changeRange(setStart(range, e.shiftKey ? 0 : time, duration, MIN_LENGTH));
      } else if (key === 'o') {
        e.preventDefault();
        changeRange(setEnd(range, e.shiftKey ? duration : time, duration, MIN_LENGTH));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onTogglePlay, changeRange, range, time, duration]);

  const screen = screenSecondsOf(range, speed);
  const silent = speed !== 1;

  return (
    <div className={`flex-none flex flex-col w-full max-w-[30rem] ${compact ? 'gap-1' : 'gap-1.5'}`}>
      <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`}>
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex-none w-[2.1rem] h-[2.1rem] border-0 rounded-full bg-ink text-paper cursor-pointer text-xs leading-none inline-flex items-center justify-center hover:bg-accent"
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play / pause the slide (Space)"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        {!compact && (
          <span className="font-mono text-xs tabular-nums text-muted flex-none min-w-[3.2ch] text-center">
            {formatTimecode(time)}
          </span>
        )}
        <TrimBar
          duration={duration}
          time={time}
          range={range}
          minLength={MIN_LENGTH}
          step={STEP}
          onSeek={onSeek}
          onScrubStart={onScrubStart}
          onRangeChange={changeRange}
        />
        <select
          value={String(speed)}
          onChange={(e) => onSpeed(Number(e.target.value))}
          className={`${pill} pl-2 pr-1 ${speed === 1 ? pillOff : pillOn}`}
          aria-label="Clip speed"
          title="The speed this slide plays at — on the stage and in the file. Other than 1× it goes out without sound"
        >
          {CLIP_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onLoop(!loop)}
          aria-pressed={loop}
          className={`${pill} ${loop ? pillOn : pillOff}`}
          title="Loop the stretch instead of stopping on its out point"
        >
          ↻
        </button>
      </div>
      {/* The readout is ALWAYS rendered on its own line: a line that appears
          on the first drag resizes the row and moves the rail under the
          pointer mid-gesture (the Studio's own trap). */}
      <p
        className={`m-0 flex flex-wrap items-center gap-x-2 font-mono tabular-nums text-muted ${
          compact ? 'text-3xs pl-[2.6rem]' : 'text-2xs pl-[5.7rem]'
        }`}
      >
        <span className="uppercase tracking-[0.12em]">Cut</span>
        <span className="text-ink-soft">
          {formatTimecode(range.start)} → {formatTimecode(range.end)}
        </span>
        <span>· {trimDuration(range).toFixed(1)}s of the clip</span>
        {silent ? (
          <span className="text-accent-ink">
            · {screen.toFixed(1)}s on screen at {speed}× · no sound
          </span>
        ) : (
          <span>· {screen.toFixed(1)}s on screen</span>
        )}
        {!compact && !cut.learned && (
          <span className="text-faint">· drag the handles, or I / O cut at the playhead</span>
        )}
      </p>
    </div>
  );
}
