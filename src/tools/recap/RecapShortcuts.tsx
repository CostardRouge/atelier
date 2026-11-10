import ShortcutsSheet, { type ShortcutGroup } from '../../shared/ui/ShortcutsSheet';

/**
 * Every key and gesture the Recap editor answers, in the suite's sheet
 * (`ShortcutsSheet`): behind H or ?, and the ⌨ beside the transport. Kept
 * beside the handlers it describes — `RecapEditor`'s `useEditorKeys`, and
 * `RecapStage`'s while a picture is framed.
 */
const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Playing',
    rows: [
      { keys: 'Space', what: 'play and pause — the recap as it will be exported' },
      { keys: '← / →', what: 'the page before, the page after' },
      { keys: 'drag the time bar', what: 'scrub — Play then starts from there' },
    ],
  },
  {
    title: 'On the stage',
    rows: [
      { keys: 'click · tap', what: 'select a place, a text or the background — the inspector follows' },
      { keys: 'drag a picture', what: 'onto another place to swap them, onto a slide of the strip to send it there' },
      { keys: 'drag the heading', what: 'move it' },
      { keys: 'Delete', what: 'empty the place in hand — in a carousel, one picture fewer' },
      { keys: 'Esc', what: 'let go of what is selected' },
    ],
  },
  {
    title: 'Framing a picture',
    rows: [
      { keys: 'double-click · Enter', what: 'frame the picture in hand, or the background' },
      { keys: 'drag · ← ↑ → ↓', what: 'move it in its place — a bigger step with ⇧' },
      { keys: 'wheel · pinch · + −', what: 'zoom' },
      { keys: '⇧ wheel · [ ]', what: 'turn it, half a degree at a time' },
      { keys: '0', what: 'back to the centre, whole and level' },
      { keys: 'Enter', what: 'keep the framing' },
      { keys: 'Esc', what: 'give the picture back as it was' },
    ],
  },
  {
    title: 'Working',
    rows: [
      { keys: '⌘/Ctrl Z', what: 'undo — and ⇧ to put it back' },
      { keys: 'H · ?', what: 'this sheet, open and closed' },
    ],
  },
];

export default function RecapShortcuts({ onClose }: { onClose: () => void }) {
  return <ShortcutsSheet groups={GROUPS} onClose={onClose} foot="A field, a select or a slider keeps the keys it uses: nothing here fires while you type a caption or nudge a value." />;
}
