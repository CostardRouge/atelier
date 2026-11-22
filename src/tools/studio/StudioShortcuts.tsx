import ShortcutsSheet, { type ShortcutGroup } from '../../shared/ui/ShortcutsSheet';

/**
 * Every key and gesture the Studio's editor answers, in the suite's sheet
 * (`ShortcutsSheet`, Develop's and Storytelling's): behind `?` or `H`, the ⌨
 * of the transport, and the phone's ⋯. It replaced the line of hints under
 * the transport (2026-11-22, his pick A of the lab). Kept beside the handlers
 * it describes — `StudioEditor`'s key effect, `StudioTransport`, `TrimBar`.
 */
const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Playing',
    rows: [
      { keys: 'Space', what: 'play and pause' },
      { keys: 'M', what: 'the clip’s sound on or off — the volume is under the speaker' },
      { keys: 'L', what: 'loop the range instead of stopping on its out point' },
      { keys: 'drag the bar', what: 'scrub — the picture follows' },
    ],
  },
  {
    title: 'Cutting',
    rows: [
      { keys: 'I / O', what: 'cut in or out at the playhead' },
      { keys: '⇧I / ⇧O', what: 'a handle back to the clip’s own end' },
      { keys: 'drag a handle', what: 'move the in or out point — only the range previews and exports' },
      { keys: '← / → on a handle', what: 'a frame — a second with ⇧' },
    ],
  },
  {
    title: 'On the stage',
    rows: [
      { keys: 'drag an element', what: 'move it — onto the grid when the grid is on' },
      { keys: 'A/B, then drag', what: 'the divider between the original and the composed picture' },
    ],
  },
  {
    title: 'Working',
    rows: [
      { keys: '⌘/Ctrl Z', what: 'undo — and ⇧ to put it back' },
      { keys: '? or H', what: 'this sheet' },
    ],
  },
];

export default function StudioShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <ShortcutsSheet
      groups={GROUPS}
      onClose={onClose}
      foot="A field keeps every key it could use, so nothing here fires while you are typing a name."
    />
  );
}
