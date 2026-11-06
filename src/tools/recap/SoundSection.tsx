import { useState } from 'react';
import { decodeSoundFile } from '../../shared/audio/sound-clip';
import { withRecap, type RecapDoc } from '../../shared/recap/recap-doc';
import Button from '../../shared/ui/Button';
import { InspectorSection, SliderRow, ToggleField } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import type { Change } from './RecapPanels';
import { putSound } from './recap-store';
import { beatOfBuffer } from './recap-beat-find';
import { bpmOf } from '../../shared/recap/recap-beat';

function pickOne(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * The recap's SOUND: one file from this device, looped under the film — kept
 * here for this recap (it never travels with the document), its gain, its
 * fades, and whether the film's length follows the loop so the music ends on
 * its own seam. Heard in a VIDEO export only: a still or a photo carousel
 * takes its music in the social app.
 */
export default function SoundSection({ doc, change, onChanged }: { doc: RecapDoc; change: Change; onChanged?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const s = doc.sound;
  const add = async () => {
    const file = await pickOne('audio/*,.mp3,.m4a,.wav,.aac,.ogg');
    if (!file) return;
    const buffer = await decodeSoundFile(file);
    if (!buffer) {
      setError(`This browser cannot read “${file.name}”. A WAV, MP3 or M4A file usually works.`);
      return;
    }
    setError(null);
    if (!(await putSound(doc.id, { name: file.name, blob: file }))) {
      setError('This browser refused to keep the sound (a private window, or the disk is full).');
      return;
    }
    // Its beat, found once here: what «Cuts on the beat» lands the film on.
    const beat = beatOfBuffer(buffer);
    change((d) => withRecap(d, { sound: { name: file.name, gain: d.sound?.gain ?? 0.8, fade: d.sound?.fade ?? 0.8, fit: d.sound?.fit ?? true, seconds: Math.round(buffer.duration * 1000) / 1000, beat } }));
    onChanged?.();
  };
  const remove = async () => {
    await putSound(doc.id, null);
    change((d) => withRecap(d, { sound: null }));
    onChanged?.();
  };
  const set = (patch: Partial<NonNullable<RecapDoc['sound']>>) => change((d) => (d.sound ? withRecap(d, { sound: { ...d.sound, ...patch } }) : d));
  return (
    <InspectorSection id="recap-sound" title="Sound" marked={Boolean(s)}>
      <div className="flex flex-col gap-2">
        {s ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex-1 min-w-0 truncate text-sm" title={s.name}>
                {s.name}
              </span>
              <span className="font-mono text-2xs text-muted tabular-nums" title={s.beat ? 'Its beat, found on this device' : undefined}>
                {s.seconds.toFixed(1)} s loop{s.beat ? ` · ♩ ${bpmOf(s.beat)}` : ''}
              </span>
            </div>
            <SliderRow label="Volume" value={Math.round(s.gain * 100)} min={0} max={150} step={1} reset={80} format={(v) => `${v} %`} onChange={(v) => set({ gain: v / 100 })} />
            <SliderRow label="Fades" value={s.fade} min={0} max={5} step={0.1} reset={0.8} format={(v) => `${v.toFixed(1)} s`} onChange={(fade) => set({ fade })} />
            <ToggleField checked={s.fit} onChange={(fit) => set({ fit })} label="The film lasts whole loops">
              The film lasts whole loops
            </ToggleField>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={Icons.swap} onClick={() => void add()}>
                Replace…
              </Button>
              <Button size="sm" variant="ghost" icon={Icons.trash} onClick={() => void remove()}>
                Remove
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon={Icons.plus} onClick={() => void add()} title="A music or a sound from this device, looped under the video export">
            Add a sound…
          </Button>
        )}
        {error && (
          <p className="m-0 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <p className="m-0 text-2xs text-muted">Heard in the video export. A still or a carousel takes its music in the app you post it from.</p>
      </div>
    </InspectorSection>
  );
}
