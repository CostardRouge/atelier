// Every key the web's workbench binds, answered by the kernel's one reading
// (`editorKeyAction`, `roll-editor.ts`): ←/→ step, `\` holds before, `Z`
// closer or the fit, the tab initials (A · D · L · C · E), `X` the crop's
// orientation, ⇧C crop to the view, `H` / `?` the shortcuts, `I` the facts,
// `J` the clipping, `V` black and white, `P` / `U` / `M` the delivery (on the
// Layers tab `P` and `M` are the mask's), ⌘C / ⌘V the develop, ⌘⇧C / ⌘⇧V the
// sections, ⌘' a variant, ⌫ and Esc what the tool holds.
//
// A field keeps every key it could use: the editor's view only hands a press
// here while no text field of the editor has the keyboard (`textEditing`),
// and a question over the editor (a confirmation, a sheet) keeps every key.

import SwiftUI
import AtelierKit

extension RollEditor {
    /// A press, read and acted on. True when the editor took it (the caller
    /// then stops it), false when it belongs to somebody else. `zoom` is the
    /// stage's Looking zoom, which `Z` drives.
    @discardableResult
    func handleKey(_ press: EditorKeyPress, zoom: LookingZoom?) -> Bool {
        if textEditing || settingsOpen || confirmRemove != nil { return false }
        if helpOpen {
            // The same key closes it, and Escape does.
            if press.key == "Escape" || editorKeyAction(press) == .help {
                helpOpen = false
                return true
            }
            return false
        }
        // On the Layers tab `P` and `M` are the mask's, not the delivery's.
        var press = press
        press.layersTab = tab == .layers
        guard let action = editorKeyAction(press) else { return false }
        switch action {
        case .tab(let t):
            tab = t
        case .previous:
            step(-1)
        case .next:
            step(1)
        case .hold:
            setHolding(true)
        case .zoom:
            if tab == .crop {
                sendToTool(.zoom)
            } else {
                zoom?.toggle()
            }
        case .copy:
            guard !asShot else { return false }
            copyDevelopHere()
        case .paste:
            guard canPasteDevelop else { return false }
            pasteDevelopHere()
        case .mono:
            toggleMono()
        case .copySettings:
            settingsOpen = true
        case .pasteSettings:
            return pasteSectionsHere()
        case .variant:
            makeVariant(.clone)
        case .help:
            helpOpen.toggle()
        case .deliver:
            guard let id = openId else { return false }
            deliver(id, .toggle)
        case .deliverAuto:
            guard let id = openId else { return false }
            deliver(id, .auto)
        case .ignore:
            guard let id = openId else { return false }
            deliver(id, .ignore)
        case .facts:
            setShowFacts(!showFacts)
        case .clipping:
            clipping.toggle()
        case .mask, .pick:
            // The Layers tab's, with a layer open: the layers task answers.
            guard tab == .layers else { return false }
            return layerKey(action)
        case .swap:
            guard tab == .crop else { return false }
            sendToTool(.swap)
        case .cropView:
            // Only where it would change something: zoomed, off the Crop tab.
            return cropToView(zoom)
        case .remove:
            // What is selected ON the picture (a repair patch) — the tool's.
            guard activeTool == .repair else { return false }
            sendToTool(.remove)
        case .escape:
            // Let go of what the tool holds, then put the tool down.
            guard activeTool != .none else { return false }
            if activeTool == .eyedropper {
                setTool(.none)
            } else {
                sendToTool(.escape)
            }
        }
        return true
    }

    /// A key let go — only `\` answers.
    func handleKeyUp(_ key: String) {
        if key == "\\" { setHolding(false) }
    }
}

extension EditorKeyPress {
    /// A SwiftUI key press in the web's words: `ArrowLeft`, `Backspace`,
    /// `Escape`, or the character typed (`c`, `C`, `?`, `\`).
    init?(_ press: KeyPress) {
        let key: String
        if press.key == .leftArrow {
            key = "ArrowLeft"
        } else if press.key == .rightArrow {
            key = "ArrowRight"
        } else if press.key == .delete {
            key = "Backspace"
        } else if press.key == .deleteForward {
            key = "Delete"
        } else if press.key == .escape {
            key = "Escape"
        } else if let c = press.characters.first {
            key = String(c)
        } else {
            return nil
        }
        let mods = press.modifiers
        self.init(key: key, repeat: press.phase == .repeat,
                  metaKey: mods.contains(.command), ctrlKey: mods.contains(.control),
                  altKey: mods.contains(.option), shiftKey: mods.contains(.shift))
    }
}
