// Who owns ⌘Z. Port of `src/shared/history/undo-keys.ts`.
//
// The third of the suite's key-ownership modules, beside the transport key
// (space) and the dialog keys (Enter and Escape), and it answers the same
// question: a shortcut bound on the window has to stand down whenever the
// focused control has a better claim to the press. For undo that claim is
// narrow but absolute — inside a text field, ⌘Z is the field's own undo of
// the letters being typed, and taking it would throw away a half-typed name
// to step the whole document back instead. Everywhere else the document owns
// it, a focused button included: a button does not undo anything
// (`frontend.md`, «⌘Z is the third window-bound key»).
//
// Pure: the DOM read is a parameter. The web describes the focused element
// (`describeKeyTarget`, from `HTMLElement`); the app describes its focused
// control in the same words — a text field is an `INPUT` of type `text`, a
// slider an `INPUT` of type `range`, a text view a `TEXTAREA` — and hands the
// description in. On the Mac the responder chain already gives a text field
// its own undo; this is what the app asks before it steps the document.

import Foundation

/// A description of the focused control — the half of an event target the key
/// modules need. The web's `KeyTarget`, from `media/transport-keys.ts`, defined
/// here until that module is ported.
public struct KeyTarget: Equatable, Sendable {
    /// Uppercase tag name, as `HTMLElement.tagName` gives it.
    public var tagName: String
    public var isContentEditable: Bool
    /// Explicit ARIA role, or nil.
    public var role: String?
    /// An `INPUT`'s own `type`, lowercased; nil on everything else. A slider
    /// is an input that holds no text, so it has neither typing to protect nor
    /// an undo of its own.
    public var inputType: String?
    /// Whether the KEYBOARD put the focus here, rather than a click leaving it
    /// behind. Nil means "assume it did": an environment that cannot answer
    /// keeps the old, safe behaviour. Read by the transport key, not by undo.
    public var focusedByKeyboard: Bool?

    public init(tagName: String, isContentEditable: Bool = false, role: String? = nil,
                inputType: String? = nil, focusedByKeyboard: Bool? = nil) {
        self.tagName = tagName; self.isContentEditable = isContentEditable; self.role = role
        self.inputType = inputType; self.focusedByKeyboard = focusedByKeyboard
    }
}

/// Input types that hold no text, and so have no undo of their own to protect.
///
/// A slider is the one that matters: every number in the suite is a range
/// input, and dragging one leaves it focused — so standing down for "a field"
/// swallowed every ⌘Z from the first edit onwards, which is what made undo look
/// broken in the Develop tool, where a slider is most of the tool. An unknown
/// type keeps the field's claim: guessing wrong that way only costs a step, the
/// other way it eats a half-typed word.
private let textlessInputTypes: Set<String> = [
    "range", "checkbox", "radio", "color", "file", "button", "submit", "reset", "image", "hidden",
]

/// True where ⌘Z is the field's own undo of the letters being typed, and not the document's.
private func fieldOwnsUndo(_ target: KeyTarget?) -> Bool {
    guard let target else { return false }
    if target.isContentEditable { return true }
    if target.tagName == "TEXTAREA" { return true }
    // A `<select>` types nothing either — only a field being typed IN wins.
    if target.tagName != "INPUT" { return false }
    return !textlessInputTypes.contains((target.inputType ?? "").lowercased())
}

/// The half of a key event the decision needs.
public struct UndoKeyPress: Equatable, Sendable {
    public var key: String
    /// Set by a control that already handled the chord itself.
    public var defaultPrevented: Bool
    public var altKey: Bool
    public var ctrlKey: Bool
    public var metaKey: Bool
    public var shiftKey: Bool
    public var target: KeyTarget?

    public init(key: String, defaultPrevented: Bool = false, altKey: Bool = false, ctrlKey: Bool = false,
                metaKey: Bool = false, shiftKey: Bool = false, target: KeyTarget? = nil) {
        self.key = key; self.defaultPrevented = defaultPrevented; self.altKey = altKey; self.ctrlKey = ctrlKey
        self.metaKey = metaKey; self.shiftKey = shiftKey; self.target = target
    }
}

public enum UndoKeyAction: String, Sendable {
    case undo, redo
}

/// What a key press means to the open document; nil when nothing.
///
/// Both accelerators are accepted on every platform rather than sniffing for a
/// Mac: ⌘Z / ⇧⌘Z is what a Mac sends, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z what
/// Windows and Linux send, and either can be driven by an external keyboard of
/// the other kind. Exactly one of the two modifiers has to be held — both
/// together is somebody else's chord — and Alt is left alone for the same
/// reason.
///
/// A HELD key repeats, deliberately, unlike the suite's other global keys: space
/// is a toggle, where a repeat would flip the transport forever, while holding
/// undo to walk back through a stack is what every editor does and what a hand
/// expects.
public func undoKeyAction(_ press: UndoKeyPress) -> UndoKeyAction? {
    if press.defaultPrevented || press.altKey { return nil }
    // Exactly one of ⌘ / Ctrl.
    if press.metaKey == press.ctrlKey { return nil }
    // A field's own undo is the text being typed in it, and it wins.
    if fieldOwnsUndo(press.target) { return nil }
    let key = press.key.lowercased()
    if key == "z" { return press.shiftKey ? .redo : .undo }
    if key == "y" && !press.shiftKey { return .redo }
    return nil
}
