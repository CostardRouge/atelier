// Every key and gesture the editor answers — the web's `DevelopShortcuts.tsx`,
// behind `H`, `?` and the bar's `?` (`develop-roll.md`, «The stage gets its
// room back»): a legend read once still costs the picture its room, so it
// lives here, where it can say MORE than a sentence under the photograph ever
// did — the gestures too. The rows are the web's, with the Mac's and the
// touch screen's own words where the hand differs.

import SwiftUI

private struct ShortcutRow: Identifiable {
    let keys: String
    let what: String
    var id: String { keys + what }
}

private struct ShortcutGroup: Identifiable {
    let title: String
    let rows: [ShortcutRow]
    var id: String { title }
}

private let shortcutGroups: [ShortcutGroup] = [
    ShortcutGroup(title: "Moving about", rows: [
        ShortcutRow(keys: "← / →", what: "the picture before or after this one"),
        ShortcutRow(keys: "Z · double tap", what: "closer, or back to the fit"),
        ShortcutRow(keys: "wheel · pinch", what: "zoom about the pointer, to 4000 %"),
        ShortcutRow(keys: "drag", what: "pan, once the picture is zoomed"),
        ShortcutRow(keys: "the % pill", what: "the fit, 1:1, and whether a magnified pixel is drawn smooth or as a pixel"),
    ]),
    ShortcutGroup(title: "Judging it", rows: [
        ShortcutRow(keys: "\\", what: "hold to see the picture as shot"),
        ShortcutRow(keys: "drag", what: "at the fit, wipe between before and after"),
        ShortcutRow(keys: "the divider’s handle", what: "wipe at any zoom"),
        ShortcutRow(keys: "the A/B pill", what: "the divider on or off — a tool that holds the pointer suspends it on its own"),
        ShortcutRow(keys: "I", what: "the facts — the exposure as shot, then this develop — over the picture"),
        ShortcutRow(keys: "V", what: "black and white ↔ colour — the colour mixer is kept either way"),
        ShortcutRow(keys: "J · blacks / whites", what: "paint what is clipped — red gone to white, blue gone to black; the pixel under the pointer is read under the histogram"),
    ]),
    ShortcutGroup(title: "Working", rows: [
        ShortcutRow(keys: "A · D · L · C · E", what: "the tabs, each by its own initial — Adjust, Detail, Layers, Crop, Export"),
        ShortcutRow(keys: "X", what: "on the Crop tab, the zone’s portrait ↔ landscape"),
        ShortcutRow(keys: "⇧C · the crop pill", what: "zoomed in, make what the screen shows the crop — the view goes back to the fit"),
        ShortcutRow(keys: "⌘C · ⌘V", what: "copy this develop, paste it onto another — and the three verbs above the picture"),
        ShortcutRow(keys: "⌘⇧C · ⌘⇧V", what: "the picture’s settings in sections — copy the ticked ones, paste them here, or apply them to others"),
        ShortcutRow(keys: "⌘'", what: "a variant of this picture as it stands — the same file with its own edits; Add → as shot starts one bare"),
        ShortcutRow(keys: "⌘Z", what: "undo — and ⇧ to put it back"),
        ShortcutRow(keys: "P", what: "on the Layers tab, Pick (a subject) or Paint (a painted mask) on and off"),
        ShortcutRow(keys: "M", what: "on the Layers tab, the mask hidden, as its outline, or filled in red"),
        ShortcutRow(keys: "⇧ / ⌘-click · the cell’s menu", what: "choose pictures along the filmstrip"),
        ShortcutRow(keys: "P", what: "off the Layers tab, send this picture ↔ hold it back — edited pictures leave unless you say otherwise"),
        ShortcutRow(keys: "U", what: "back to the roll’s rule: it leaves if it is edited — on every tab"),
        ShortcutRow(keys: "M", what: "off the Layers tab, ignore this picture ↔ bring it back — never exported, stepped over by ← / →"),
        ShortcutRow(keys: "a cell’s badge", what: "tap to send ↔ hold · its menu (right-click, or hold a finger) to ignore"),
    ]),
    ShortcutGroup(title: "Repairing", rows: [
        ShortcutRow(keys: "tap", what: "with Repair on, place a patch — it borrows from beside itself"),
        ShortcutRow(keys: "drag from the spot", what: "point at where it borrows from, at any distance — the source turns with the hand"),
        ShortcutRow(keys: "drag a solid ring", what: "move that patch, its source going with it"),
        ShortcutRow(keys: "click a solid ring", what: "take that patch off — the cursor shows −"),
        ShortcutRow(keys: "drag a dashed ring", what: "move where that patch borrows from"),
        ShortcutRow(keys: "click a dashed ring", what: "edit the patch — Size, Feather and Heal / Clone then apply to it"),
        ShortcutRow(keys: "⌫ · Esc", what: "take the edited patch off · let go of it, then put Repair down"),
        ShortcutRow(keys: "tap a dotted ring", what: "heal a spot Find spots proposed — a proposal is never a patch until it is taken"),
    ]),
]

struct ShortcutsSheet: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(shortcutGroups) { group in
                        VStack(alignment: .leading, spacing: 6) {
                            Eyebrow(group.title)
                            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 5) {
                                ForEach(group.rows) { row in
                                    GridRow {
                                        Text(row.keys)
                                            .font(Brand.mono(11))
                                            .foregroundStyle(palette.inkSoft)
                                            .frame(maxWidth: 150, alignment: .trailing)
                                            .gridColumnAlignment(.trailing)
                                        Text(row.what)
                                            .font(Brand.mono(11))
                                            .foregroundStyle(palette.faint)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                        }
                    }
                    Text("A text field keeps every key it could use, so nothing here fires while you are typing a name.")
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
            }
            .background(palette.surface)
            .navigationTitle("Keys and gestures")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 540, minHeight: 600)
        #endif
    }
}

#Preview("Keys and gestures") {
    ShortcutsSheet().darkroom()
}
