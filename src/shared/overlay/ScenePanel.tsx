/**
 * The intro scene's own controls: how long it runs, its scrim, and whether it
 * holds the rest of the deck back while it plays.
 *
 * One panel per scene; the studio shows the single intro it creates on the
 * first intro element. The model already takes several (scenes.ts) — the day a
 * second one is worth an author's time, this component is what repeats.
 */

import { useState } from 'react';
import type { Scene, SceneScrim } from './scenes';

interface ScenePanelProps {
  scene: Scene;
  /** How many elements live in it — an empty scene is worth saying so. */
  memberCount: number;
  /** Playhead, in seconds from the first exported frame. */
  playhead: number;
  onChange: (next: Scene) => void;
  /** Drops the scene AND the elements in it — hence the two-step confirm. */
  onRemove: () => void;
}

const labelClass = 'font-mono text-[0.62rem] tracking-[0.12em] uppercase text-muted';
const inputClass =
  'font-sans text-[0.82rem] text-ink bg-surface border border-line-strong rounded-paper px-[0.6rem] py-[0.4rem] w-full';
const linkClass =
  'p-0 border-0 bg-transparent text-accent-ink font-semibold text-[0.68rem] cursor-pointer underline underline-offset-[2px] hover:text-accent';

const DEFAULT_SCRIM: SceneScrim = { color: '#0b0a09', opacity: 0.55, fade: 0.4 };

export default function ScenePanel({
  scene,
  memberCount,
  playhead,
  onChange,
  onRemove,
}: ScenePanelProps) {
  const scrim = scene.scrim;
  const [confirming, setConfirming] = useState(false);

  function patch(next: Partial<Scene>) {
    const merged = { ...scene, ...next };
    // A scene that ends before it starts would never draw; nudge instead of
    // letting the author type something with no visible effect.
    if (merged.end <= merged.start) merged.end = merged.start + 0.2;
    onChange(merged);
  }

  return (
    <div className="flex flex-col gap-[0.85rem]">
      <div className="flex gap-2">
        <label className="flex flex-col gap-1 flex-1 min-w-0">
          <span className={labelClass}>Starts · s</span>
          <input
            type="number"
            className={inputClass}
            min={0}
            step={0.1}
            value={scene.start}
            onChange={(e) => patch({ start: Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-0">
          <span className={labelClass}>Ends · s</span>
          <input
            type="number"
            className={inputClass}
            min={0}
            step={0.1}
            value={scene.end}
            onChange={(e) => patch({ end: Number(e.target.value) })}
          />
          <button
            type="button"
            className={`${linkClass} self-start`}
            onClick={() => patch({ end: Number(Math.max(0, playhead).toFixed(2)) })}
          >
            From playhead
          </button>
        </label>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-accent cursor-pointer"
          checked={scrim != null}
          onChange={(e) => patch({ scrim: e.target.checked ? { ...DEFAULT_SCRIM } : null })}
        />
        <span className={labelClass}>Veil over the picture</span>
      </label>
      {scrim && (
        <div className="flex flex-col gap-2 pl-[1.4rem]">
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Colour</span>
              <input
                type="color"
                className="w-[2.6rem] h-[1.9rem] p-0 border border-line-strong rounded-paper bg-surface cursor-pointer"
                value={scrim.color}
                onChange={(e) => patch({ scrim: { ...scrim, color: e.target.value } })}
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className={labelClass}>
                Strength · {Math.round(scrim.opacity * 100)}%
              </span>
              <input
                type="range"
                className="w-full accent-accent cursor-pointer"
                min={0.05}
                max={1}
                step={0.05}
                value={scrim.opacity}
                onChange={(e) =>
                  patch({ scrim: { ...scrim, opacity: Number(e.target.value) } })
                }
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Fade · {scrim.fade.toFixed(2)} s</span>
            <input
              type="range"
              className="w-full accent-accent cursor-pointer"
              min={0}
              max={2}
              step={0.05}
              value={scrim.fade}
              onChange={(e) => patch({ scrim: { ...scrim, fade: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="w-3.5 h-3.5 accent-accent cursor-pointer"
          checked={scene.solo}
          onChange={(e) => patch({ solo: e.target.checked })}
        />
        <span className={labelClass}>Hold the rest of the deck back</span>
      </label>
      {scene.solo && (
        <label className="flex flex-col gap-1 pl-[1.4rem]">
          <span className={labelClass}>
            They come back over · {scene.hudFade === 0 ? 'a cut' : `${scene.hudFade.toFixed(2)} s`}
          </span>
          <input
            type="range"
            className="w-full accent-accent cursor-pointer"
            min={0}
            max={3}
            step={0.05}
            value={scene.hudFade}
            onChange={(e) => patch({ hudFade: Number(e.target.value) })}
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[0.72rem] text-faint">
          {memberCount === 0
            ? 'Nothing in it yet — add from the Intro row above.'
            : `${memberCount} element${memberCount > 1 ? 's' : ''} in it.`}
        </span>
        {confirming ? (
          <span className="ml-auto flex items-center gap-2 text-[0.72rem]">
            <span className="text-muted">Drop it and its elements?</span>
            <button
              type="button"
              className={linkClass}
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              Remove
            </button>
            <button
              type="button"
              className={linkClass}
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${linkClass} ml-auto`}
            onClick={() => setConfirming(true)}
          >
            Remove the intro
          </button>
        )}
      </div>
    </div>
  );
}
