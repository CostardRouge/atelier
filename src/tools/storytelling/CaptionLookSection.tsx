import { CAPTION_COLUMN, CAPTION_LINES, CAPTION_LOOK_DEFAULTS, captionLook, type CaptionEdge, type CaptionLook } from '../../shared/story/caption-layout';
import { withLook } from '../../shared/story/sources';
import type { StoryScript } from '../../shared/story/story-script';
import { FieldRow, SelectField, SliderRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';

const EDGES: readonly { id: CaptionEdge; label: string }[] = [
  { id: 'all', label: 'Every short-video app' },
  { id: 'reels', label: 'Instagram Reels' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'shorts', label: 'YouTube Shorts' },
  { id: 'none', label: 'No edge' },
];

/**
 * How the series' captions are laid (`caption-layout.ts`), the hook's rules:
 * how wide a line runs, how many lines before a long one shrinks (or lets it
 * grow, as before), and whose buttons the words stay clear of.
 */
export default function CaptionLookSection({ script, onScript }: { script: StoryScript; onScript: (s: StoryScript) => void }) {
  const look = captionLook(script.look?.captions);
  const set = (patch: Partial<CaptionLook>) => onScript(withLook(script, { captions: patch }));
  return (
    <div className="flex flex-col gap-2">
      <SliderRow
        label="Column"
        value={Math.round(look.column * 100)}
        min={CAPTION_COLUMN[0] * 100}
        max={CAPTION_COLUMN[1] * 100}
        step={1}
        reset={Math.round(CAPTION_LOOK_DEFAULTS.column * 100)}
        format={(v) => `${v} %`}
        onChange={(v) => set({ column: v / 100 })}
      />
      <FieldRow label="Long">
        <Segmented<'shrink' | 'grow'>
          size="sm"
          fill
          value={look.long}
          onChange={(long) => set({ long })}
          options={[
            { id: 'shrink', label: 'Shrink to fit' },
            { id: 'grow', label: 'Grow upward' },
          ]}
        />
      </FieldRow>
      {look.long === 'shrink' ? (
        <SliderRow label="Lines" value={look.maxLines} min={CAPTION_LINES[0]} max={CAPTION_LINES[1]} step={1} reset={CAPTION_LOOK_DEFAULTS.maxLines} onChange={(maxLines) => set({ maxLines })} />
      ) : null}
      <FieldRow label="Clear of">
        <SelectField<CaptionEdge> label="Whose buttons the captions stay clear of" value={look.edge} options={EDGES} onChange={(edge) => set({ edge })} />
      </FieldRow>
    </div>
  );
}
