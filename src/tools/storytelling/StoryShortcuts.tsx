import ShortcutsSheet, { type ShortcutGroup } from '../../shared/ui/ShortcutsSheet';

/**
 * Every key and gesture a post's Studio answers, in the suite's sheet
 * (`ShortcutsSheet`, Develop's): behind H or ?, the ⌨ beside the guides, and
 * the phone's ⋯. Kept beside the handlers it describes — `PostEditor`'s
 * keyboard effect, `StoryTransport`, `StoryStage`, `StudioTimeline`.
 */
const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Playing',
    rows: [
      { keys: 'Space', what: 'play and pause — the sound follows, from where the playhead stands' },
      { keys: '← / → on the time bar', what: 'a tenth of a second back or on — a second with ⇧; Home and End go to either end' },
      { keys: 'drag the time bar', what: 'scrub — the post stops where you let go' },
      { keys: 'a row in the list', what: 'its object selected, and the playhead where it shows' },
    ],
  },
  {
    title: 'On the stage',
    rows: [
      { keys: 'click · tap', what: 'select what is under it — the topmost thing drawn there; under a finger, the nearest within a fingertip' },
      { keys: 'drag', what: 'move the selected object — a press that moves on the object you just picked' },
      { keys: '← ↑ → ↓', what: 'nudge the selected object by a pixel of the frame — ten with ⇧' },
      { keys: 'Esc', what: 'let the object go — the inspector shows the charte again' },
      { keys: 'Guides', what: 'the TikTok, Reels or Shorts dead zones and a grid over the preview — never in the export' },
    ],
  },
  {
    title: 'On the timeline',
    rows: [
      { keys: 'drag a scene’s right edge', what: 'its length — the scenes after it move with it' },
      { keys: 'drag a caption’s edges', what: 'when it comes in and goes' },
      { keys: 'click a bar', what: 'select it and bring the playhead there' },
    ],
  },
  {
    title: 'Working',
    rows: [
      { keys: '⌘/Ctrl Z', what: 'undo — and ⇧ to put it back; edits of one object within a moment are one step' },
      { keys: 'H · ?', what: 'this sheet, open and closed' },
    ],
  },
];

export default function StoryShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <ShortcutsSheet
      groups={GROUPS}
      onClose={onClose}
      foot="A field, a select or a slider keeps the keys it uses: nothing here fires while you type a caption or drag a value."
    />
  );
}
