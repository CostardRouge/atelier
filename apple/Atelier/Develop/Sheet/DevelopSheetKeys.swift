// The develop sheet's KEYS — what the web's `DevelopSheet` binds over its
// picture (`zoom-keys.ts`: `Z` toggles the view between the fit and a first
// zoom, the arrows pan a ZOOMED view and mean nothing at the fit, Shift makes
// a stride), plus the Develop stage's own: `J` paints the clipping, `\` holds
// the picture as shot while it is down, and ⌘C / ⌘V copy and paste the
// develop through the session's clipboard.
//
// A modified press is never ours but ⌘C / ⌘V, and those go where each
// platform reads chords: the Edit menu's own Copy and Paste on the Mac
// (`onCopyCommand` / `onPasteCommand` — a text field with the keyboard keeps
// its own), invisible buttons carrying the shortcuts on an iPad's keyboard.
// Return and Escape stay the sheet's Done and Cancel (the toolbar's
// `.defaultAction` / `.cancelAction`).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct DevelopSheetKeys: ViewModifier {
    @Bindable var picture: DevelopSheetPicture
    @Binding var draft: DevelopSettings
    let onTold: (String) -> Void
    @FocusState private var focused: Bool

    /// Points one arrow press pans; Shift makes it a stride (`ARROW_PAN_PX`).
    private static let panStep = 40.0
    private static let panStride = 200.0

    func body(content: Content) -> some View {
        chords(
            content
                .focusable()
                .focusEffectDisabled()
                .focused($focused)
                .onKeyPress(phases: [.down, .repeat, .up]) { press in handle(press) }
                .onAppear { focused = true }
        )
    }

    // MARK: - bare keys

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        let mods = press.modifiers
        if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
        let key = press.characters.lowercased()
        if press.phase == .up {
            guard key == "\\" else { return .ignored }
            picture.setHolding(false)
            return .handled
        }
        guard picture.shown != nil else { return .ignored }
        if let pan = arrowPan(press) {
            // At the fit a picture has nowhere to go: the arrows are somebody else's.
            guard picture.zoom.zoomed else { return .ignored }
            picture.zoom.pan(dx: pan.dx, dy: pan.dy)
            return .handled
        }
        switch key {
        case "z":
            if press.phase == .down { picture.zoom.toggle() }
        case "j":
            if press.phase == .down { picture.toggleClipping() }
        case "\\":
            picture.setHolding(true)
        default:
            return .ignored
        }
        return .handled
    }

    private func arrowPan(_ press: KeyPress) -> (dx: Double, dy: Double)? {
        let step = press.modifiers.contains(.shift) ? DevelopSheetKeys.panStride : DevelopSheetKeys.panStep
        if press.key == .leftArrow { return (step, 0) }
        if press.key == .rightArrow { return (-step, 0) }
        if press.key == .upArrow { return (0, step) }
        if press.key == .downArrow { return (0, -step) }
        return nil
    }

    // MARK: - ⌘C / ⌘V

    private func copy() {
        guard !isDefaultDevelop(draft) else { return }
        copyDevelop(draft)
        onTold("copied")
    }

    private func paste() {
        if let pasted = pasteDevelop() { draft = pasted }
    }

    #if os(macOS)
    private func chords(_ content: some View) -> some View {
        content
            .onCopyCommand {
                guard !isDefaultDevelop(draft) else { return [] }
                copy()
                return [NSItemProvider(object: describeDevelop(draft) as NSString)]
            }
            .onPasteCommand(of: [.plainText, .utf8PlainText, .json]) { _ in paste() }
    }
    #else
    private func chords(_ content: some View) -> some View {
        content.background { chordButtons }
    }

    /// The ⌘ chords on an iPad keyboard: invisible buttons carrying them.
    private var chordButtons: some View {
        ZStack {
            Button("Copy develop") { copy() }
                .keyboardShortcut("c", modifiers: [.command])
                .disabled(isDefaultDevelop(draft))
            Button("Paste develop") { paste() }
                .keyboardShortcut("v", modifiers: [.command])
                .disabled(!picture.canPaste)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
    #endif
}
