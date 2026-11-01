import ShortcutsSheet, { type ShortcutGroup } from '../ui/ShortcutsSheet';

/**
 * Every key and gesture the develop editor answers.
 *
 * It USED to be a legend along the bottom of the roll editor, under the
 * photograph — six shortcuts as one grey sentence that wrapped to three lines
 * on a narrow screen and was read exactly once. A legend nobody reads still
 * costs the picture its room, so it moved behind `H` (or `?`, or the `?` verb
 * in the stage bar), where it can say MORE than it ever did as a sentence: the
 * gestures belong here too.
 */
const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Moving about',
    rows: [
      { keys: '← / →', what: 'the picture before or after this one' },
      { keys: '↑ / ↓', what: 'on a grid — the band pulled up, a column, the contact sheet — the nearest picture in the row above or below, keeping its column while you go on; rows with nothing to work on are stepped over' },
      { keys: 'Z', what: 'closer, or back to the fit' },
      { keys: 'wheel · pinch', what: 'zoom about the pointer, to 4000 %' },
      { keys: 'drag', what: 'pan, once the picture is zoomed' },
      { keys: 'swipe', what: 'at the fit with A/B off, the picture before or after this one — a flick, or past a quarter of the stage; a sideways trackpad sweep does the same, and the roll’s ends resist' },
      { keys: 'the % pill', what: 'the fit, 1:1, and whether a magnified pixel is drawn smooth or as a pixel' },
    ],
  },
  {
    title: 'Judging it',
    rows: [
      { keys: '\\', what: 'hold to see the picture as shot' },
      { keys: 'hold still', what: 'press the picture without moving to see it as shot, until you lift — a press that moves is a swipe' },
      { keys: 'Space', what: 'on a clip, play and pause — the develop and the look follow every frame' },
      { keys: 'drag', what: 'at the fit, wipe between before and after — the middle and the edges hold the line, ⌥ drags past them' },
      { keys: 'double-click', what: 'the divider back in the middle' },
      { keys: 'the divider’s handle', what: 'wipe at any zoom' },
      { keys: '/ · the A/B pill', what: 'the divider on or off — it stays where you left it from picture to picture, and a mask tool suspends it on its own' },
      { keys: 'I', what: 'the facts — the exposure as shot, then this develop — over the picture' },
      { keys: 'V', what: 'black and white ↔ colour — the colour mixer is kept either way' },
      { keys: 'J · blacks / whites', what: 'paint what is clipped — red gone to white, blue gone to black; the pixel under the pointer is read under the histogram' },
    ],
  },
  {
    title: 'Working',
    rows: [
      { keys: 'A · D · L · C · E', what: 'the tabs, each by its own initial — Adjust, Detail, Layers, Crop, Export' },
      { keys: 'X', what: 'on the Crop tab, the zone’s portrait ↔ landscape' },
      { keys: '⇧C · the crop pill', what: 'zoomed in, make what the screen shows the crop — the view goes back to the fit' },
      { keys: '⌘/Ctrl C · V', what: 'copy everything done to this picture; paste it here, or onto the selected pictures — the ▾ beside paste chooses what goes' },
      { keys: '⌘/Ctrl \'', what: 'a variant of this picture as it stands — the same file with its own edits; Add → as shot starts one bare' },
      { keys: '⌘/Ctrl Z', what: 'undo — and ⇧ to put it back' },
      { keys: 'P', what: 'on the Layers tab, Pick (a subject, a colour), Paint (a painted mask) or Place (a shade’s centre) on and off' },
      { keys: 'M · the ◌ in the bar', what: 'on the Layers tab, the mask hidden, as its outline, or filled in red — hidden, its outline still shows while you pick or paint' },
      { keys: 'tap', what: 'with Pick on, add a point to the subject — the + cursor' },
      { keys: '⌥-tap · − Remove', what: 'with Pick on, take a part out of the subject — the − cursor' },
      { keys: 'tap a pin', what: 'take that point off again — it shows ×' },
      { keys: '⌥↑ / ⌥↓', what: 'on a layer’s row, move it up or down the stack — or drag its grip' },
      { keys: 'S · Select', what: 'the band’s selection on — pick several pictures, then act on them all from its bar; S, Done or Esc leaves it' },
      { keys: '⇧ / ⌘-click', what: 'choose pictures along the band — a range, or one more — and the selection comes on' },
      { keys: 'hold a finger on a cell', what: 'on a phone, the selection on with that picture' },
      { keys: '⌘/Ctrl A', what: 'with the selection on, every picture the band shows' },
      { keys: 'P', what: 'off the Layers tab, send this picture ↔ hold it back — edited pictures leave unless you say otherwise' },
      { keys: 'U', what: 'back to the roll’s rule: it leaves if it is edited — on every tab' },
      { keys: 'M', what: 'off the Layers tab, ignore this picture ↔ bring it back — never exported, stepped over by ← / →' },
      { keys: '⋯ on a cell · right-click', what: 'the picture’s verbs — open, send ↔ hold, back to the rule, ignore, a variant, take it off the roll' },
      { keys: 'drag the band’s handle', what: 'the band taller — one row, then a grid of two or three — or down to its rail; double-click folds it. Standing beside the picture, wider: one, two or three columns' },
      { keys: 'B', what: 'the band folded to its rail ↔ back to its size' },
      { keys: '⋯ on the band', what: 'where it sits on this screen — under the picture, or a column at its left or right; a phone keeps it under the picture' },
      { keys: 'G · ▦', what: 'the contact sheet over the picture — the whole roll large, with names, to sort and to act on many; a click opens a picture and closes it' },
      { keys: 'F · ⤢', what: 'focus — the picture alone, the band, the inspector and the page bar away; F, ⤢ or Esc brings them back' },
      { keys: '− · =', what: 'the band’s thumbnails smaller or larger — its ⋯ menu has the rows, the height that follows the roll, and where it sits' },
      { keys: 'the band’s filter', what: 'what it shows — all, edited, to export, held back, ignored, or by Winnow’s culling; ← / → and Apply to N other pictures follow it' },
    ],
  },
  {
    title: 'Repairing',
    rows: [
      { keys: 'tap', what: 'with Repair on, place a patch — it borrows from beside itself' },
      { keys: 'drag from the spot', what: 'point at where it borrows from, at any distance — the source turns with the hand' },
      { keys: 'drag a solid ring', what: 'move that patch, its source going with it' },
      { keys: 'click a solid ring', what: 'take that patch off — the cursor shows −' },
      { keys: 'drag a dashed ring', what: 'move where that patch borrows from' },
      { keys: 'click a dashed ring', what: 'edit the patch — Size, Feather and Heal / Clone then apply to it' },
      { keys: '⌫ · Esc', what: 'take the edited patch off · let go of it, then put Repair down' },
      { keys: 'tap a dotted ring', what: 'heal a spot Find spots proposed — a proposal is never a patch until it is taken' },
    ],
  },
];

/**
 * The shortcuts, as a sheet over the editor (`ShortcutsSheet`, the suite's
 * form). Closed by Escape, by its button, or by the same `H` that opened it
 * (the host's key handler).
 */
export default function DevelopShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <ShortcutsSheet
      groups={GROUPS}
      onClose={onClose}
      foot="A field or a slider keeps every key it could use, so nothing here fires while you are typing a name or dragging a value."
    />
  );
}
