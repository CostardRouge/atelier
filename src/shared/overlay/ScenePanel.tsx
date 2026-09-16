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
import { DEFAULT_STAGGER, STAGGER_ORDERS, newStaggerSeed } from './stagger';
import Button from '../ui/Button';
import { FieldRow, NumberField, RangeField, SelectField, ToggleField } from '../ui/Inspector';

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
    <div className="flex flex-col gap-2.5">
      <FieldRow label="Starts">
        <NumberField
          label="Scene starts"
          min={0}
          step={0.1}
          unit="s"
          value={scene.start}
          onChange={(v) => patch({ start: Math.max(0, v) })}
        />
      </FieldRow>
      <FieldRow label="Ends">
        <NumberField
          label="Scene ends"
          min={0}
          step={0.1}
          unit="s"
          value={scene.end}
          onChange={(v) => patch({ end: v })}
        />
        <Button size="sm" variant="ghost" onClick={() => patch({ end: Number(Math.max(0, playhead).toFixed(2)) })}>
          Playhead
        </Button>
      </FieldRow>

      <FieldRow label="Veil">
        <ToggleField
          label="Veil over the picture"
          checked={scrim != null}
          onChange={(on) => patch({ scrim: on ? { ...DEFAULT_SCRIM } : null })}
        >
          Over the picture
        </ToggleField>
        {scrim && (
          <input
            type="color"
            className="flex-none ml-auto w-8 h-8 p-0 border border-line-strong rounded-[7px] bg-surface cursor-pointer"
            value={scrim.color}
            onChange={(e) => patch({ scrim: { ...scrim, color: e.target.value } })}
            aria-label="Veil colour"
          />
        )}
      </FieldRow>
      {scrim && (
        <>
          <FieldRow label="Strength">
            <RangeField
              label="Veil strength"
              min={0.05}
              max={1}
              step={0.05}
              value={scrim.opacity}
              onChange={(opacity) => patch({ scrim: { ...scrim, opacity } })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </FieldRow>
          <FieldRow label="Fade">
            <RangeField
              label="Veil fade"
              min={0}
              max={2}
              step={0.05}
              value={scrim.fade}
              onChange={(fade) => patch({ scrim: { ...scrim, fade } })}
              format={(v) => `${v.toFixed(2)} s`}
            />
          </FieldRow>
        </>
      )}

      {/* One cascade over the scene's members, from where they sit — added to
          each element's own delay, so the intro's titles arrive one rank after
          another without a delay typed on each. */}
      <FieldRow
        label="Cascade"
        hint={
          scene.stagger
            ? 'Added to each element’s own delay; an element with no entrance cuts in on its beat.'
            : 'Spread the scene’s entrances by where its elements sit.'
        }
      >
        <ToggleField
          label="Cascade the scene’s elements"
          checked={Boolean(scene.stagger)}
          onChange={(on) => patch({ stagger: on ? { ...DEFAULT_STAGGER } : null })}
        />
      </FieldRow>
      {scene.stagger && (
        <>
          <FieldRow label="Order">
            <SelectField
              label="Cascade order"
              value={scene.stagger.order}
              onChange={(order) =>
                patch({
                  stagger: {
                    ...scene.stagger!,
                    order,
                    ...(order === 'random' && scene.stagger!.seed === undefined ? { seed: newStaggerSeed() } : {}),
                  },
                })
              }
              options={STAGGER_ORDERS.map((o) => ({ id: o.id, label: `${o.label} — ${o.hint}` }))}
            />
          </FieldRow>
          <FieldRow label="Each">
            <RangeField
              label="Seconds between two ranks"
              min={0}
              max={1}
              step={0.01}
              value={scene.stagger.each}
              onChange={(each) => patch({ stagger: { ...scene.stagger!, each } })}
              format={(v) => `${v.toFixed(2)} s`}
            />
          </FieldRow>
          {scene.stagger.order === 'random' && (
            <FieldRow label="Shuffle">
              <Button size="sm" onClick={() => patch({ stagger: { ...scene.stagger!, seed: newStaggerSeed() } })}>
                Shuffle again
              </Button>
            </FieldRow>
          )}
        </>
      )}

      <FieldRow label="Solo" hint="Holds the rest of the deck back while the intro plays.">
        <ToggleField label="Hold the rest of the deck back" checked={scene.solo} onChange={(solo) => patch({ solo })} />
      </FieldRow>
      {scene.solo && (
        <FieldRow label="Comes back">
          <RangeField
            label="The deck comes back over"
            min={0}
            max={3}
            step={0.05}
            value={scene.hudFade}
            onChange={(hudFade) => patch({ hudFade })}
            format={(v) => (v === 0 ? 'cut' : `${v.toFixed(2)} s`)}
          />
        </FieldRow>
      )}

      <FieldRow
        label="Contents"
        hint={confirming ? 'Drop the intro and every element in it?' : undefined}
      >
        <span className="flex-1 min-w-0 text-xs text-muted truncate">
          {memberCount === 0
            ? 'Nothing in it yet.'
            : `${memberCount} element${memberCount > 1 ? 's' : ''}`}
        </span>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
            >
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Remove the intro
          </Button>
        )}
      </FieldRow>
    </div>
  );
}
