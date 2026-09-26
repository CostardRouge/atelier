// The editor's CHORDS, native on each platform. Bare keys (←/→, `\`, the tab
// initials, `Z`, `I`, `J`, `V`, `P`/`U`/`M`, `H`/`?`, ⌫, Esc) are read by the
// editor's own key handler (`RollEditorView`, `onKeyPress`) — a text field
// with the keyboard keeps them all. The ⌘ chords go where the platform reads
// chords:
//
// - on the Mac, a *Picture* menu in the menu bar (⌘⇧C sections, ⌘⇧V paste
//   sections, ⌘' variant, the shortcuts sheet), acting on the FOCUSED
//   editor (`FocusedValues.rollEditor`), and ⌘C / ⌘V through the Edit menu's
//   own Copy and Paste (`onCopyCommand` / `onPasteCommand` in the editor), so
//   a text field's copy stays the field's;
// - on an iPad with a keyboard, invisible buttons carrying the same
//   shortcuts (`EditorChordButtons`), disabled while a field of the editor
//   types — so a preset's name keeps its ⌘C.
//
// ⌘Z / ⇧⌘Z are the window's own UndoManager, which the editor registers
// every step on.

import SwiftUI
import AtelierKit

struct RollEditorFocusKey: FocusedValueKey {
    typealias Value = RollEditor
}

extension FocusedValues {
    /// The Develop editor in the key window, for the menu bar's commands.
    var rollEditor: RollEditor? {
        get { self[RollEditorFocusKey.self] }
        set { self[RollEditorFocusKey.self] = newValue }
    }
}

/// The Mac's *Picture* menu.
struct DevelopCommands: Commands {
    @FocusedValue(\.rollEditor) private var editor: RollEditor?

    var body: some Commands {
        CommandMenu("Picture") {
            Button("Previous Picture") { editor?.step(-1) }
                .disabled(editor?.picture == nil)
            Button("Next Picture") { editor?.step(1) }
                .disabled(editor?.picture == nil)
            Divider()
            Button("Copy Settings…") { editor?.settingsOpen = true }
                .keyboardShortcut("c", modifiers: [.command, .shift])
                .disabled(editor?.picture == nil)
            Button("Paste Settings") { editor?.pasteSectionsHere() }
                .keyboardShortcut("v", modifiers: [.command, .shift])
                .disabled(editor?.heldSettings == nil || editor?.picture == nil)
            Divider()
            Button("New Variant, as Edited") { editor?.makeVariant(.clone) }
                .keyboardShortcut("'", modifiers: [.command])
                .disabled(editor?.picture == nil)
            Button("New Variant, as Shot") { editor?.makeVariant(.fresh) }
                .disabled(editor?.picture == nil)
            Divider()
            Button("Keys and Gestures") { editor?.helpOpen.toggle() }
                .disabled(editor == nil)
        }
    }
}

#if os(iOS)
/// The ⌘ chords on an iPad keyboard: invisible buttons carrying them, off
/// while a field of the editor types.
struct EditorChordButtons: View {
    @Bindable var editor: RollEditor

    var body: some View {
        ZStack {
            Button("Copy develop") { editor.copyDevelopHere() }
                .keyboardShortcut("c", modifiers: [.command])
            Button("Paste develop") { editor.pasteDevelopHere() }
                .keyboardShortcut("v", modifiers: [.command])
            Button("Copy settings…") { editor.settingsOpen = true }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Paste settings") { editor.pasteSectionsHere() }
                .keyboardShortcut("v", modifiers: [.command, .shift])
            Button("New variant") { editor.makeVariant(.clone) }
                .keyboardShortcut("'", modifiers: [.command])
        }
        .disabled(editor.textEditing || editor.picture == nil)
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}
#endif
