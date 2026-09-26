// The Develop editor's rules that are not drawing — which picture is open,
// what a key means, which pictures a Shift/⌘-click selects. Port of
// `src/shared/develop/roll-editor.ts`.
//
// Named `RollSelection.swift` because the app already has a class
// `RollEditor` (`apple/Atelier/Develop/RollEditor.swift`); the web's function
// and type names are kept (`openPictureId`, `stepPicture`, `pictureRange`,
// `selectionAfterClick`, `editorKeyAction`, `pictureAfterRestore`,
// `WorkbenchTab`, `EditorKeyPress`, `EditorKeyAction`), and the one type this
// port adds — the protocol every strip item answers — is `RollSelectionItem`.
//
// Rules kept (`develop-roll.md`): a step is held at the strip's ends, never
// wrapping; an IGNORED picture is stepped over from wherever the step starts,
// so one opened by a click hands the arrows on; a plain click opens and never
// touches the selection — Shift REPLACES the selection with the range from an
// anchor that does not move, ⌘/Ctrl toggles one picture in place; a field or a
// slider keeps every key it could use; the chord is read first, so ⌘C copies
// while a bare `C` opens the crop; `P` and `M` are the mask's on the Layers
// tab and the delivery's everywhere else. `sameDevelop` is `Develop.swift`'s.

import Foundation

/// The inspector's tabs, in order — the same list drives the desktop strip and the phone's bottom bar.
public enum WorkbenchTab: String, CaseIterable, Sendable {
    case adjust, detail, layers, crop, export

    public var label: String {
        switch self {
        case .adjust: return "Adjust"
        case .detail: return "Detail"
        case .layers: return "Layers"
        case .crop: return "Crop"
        case .export: return "Export"
        }
    }
}

/// `WORKBENCH_TABS`: every tab with its label, in the strip's order.
public let workbenchTabs: [(id: WorkbenchTab, label: String)] = WorkbenchTab.allCases.map { ($0, $0.label) }

/// Anything the strip lists by id — a roll's picture, or a plain record.
public protocol RollSelectionItem {
    var id: String { get }
}

extension RollPicture: RollSelectionItem {}

/// The picture the editor shows: the one the route names, else the first; nil on an empty roll.
public func openPictureId<T: RollSelectionItem>(_ pictures: [T], _ routeId: String?) -> String? {
    if let routeId, !routeId.isEmpty, pictures.contains(where: { $0.id == routeId }) { return routeId }
    return pictures.first?.id
}

/// The picture `step` away along the strip, held at its ends (never wrapping:
/// the end of a roll is a place). A picture `skip` answers true for — an
/// IGNORED one — is stepped over, from wherever the step starts: opened by a
/// click, an ignored picture still hands the arrows on to the next that is
/// not. With nothing further in that direction, the step stays where it is.
public func stepPicture<T: RollSelectionItem>(
    _ pictures: [T],
    _ currentId: String?,
    _ step: Int,
    skip: (T) -> Bool = { _ in false }
) -> String? {
    if pictures.isEmpty { return nil }
    let at = pictures.firstIndex { $0.id == currentId } ?? 0
    if step == 0 { return pictures[at].id }
    let dir = step > 0 ? 1 : -1
    var left = abs(step)
    var i = at
    var landed = at
    while left > 0 {
        i += dir
        if i < 0 || i >= pictures.count { break }
        if skip(pictures[i]) { continue }
        landed = i
        left -= 1
    }
    return pictures[landed].id
}

/// What to open once `removedId` leaves the strip: the same picture if
/// another one went, else the one that took its place, else the one before it.
public func openAfterRemoval<T: RollSelectionItem>(_ pictures: [T], _ removedId: String, _ openId: String?) -> String? {
    if openId != removedId { return openId }
    let at = pictures.firstIndex { $0.id == removedId } ?? -1
    let rest = pictures.filter { $0.id != removedId }
    if rest.isEmpty { return nil }
    return rest[min(max(at, 0), rest.count - 1)].id
}

/// The pictures between `a` and `b`, inclusive, in strip order; an id off the
/// roll reads as just the other end.
public func pictureRange<T: RollSelectionItem>(_ pictures: [T], _ a: String, _ b: String) -> [String] {
    guard let ia = pictures.firstIndex(where: { $0.id == a }),
          let ib = pictures.firstIndex(where: { $0.id == b }) else { return [b] }
    let lo = min(ia, ib)
    let hi = max(ia, ib)
    return pictures[lo...hi].map { $0.id }
}

public struct SelectionModifiers: Equatable, Sendable {
    public var shiftKey: Bool
    public var metaKey: Bool
    public var ctrlKey: Bool

    public init(shiftKey: Bool = false, metaKey: Bool = false, ctrlKey: Bool = false) {
        self.shiftKey = shiftKey; self.metaKey = metaKey; self.ctrlKey = ctrlKey
    }
}

/// What a MODIFIED filmstrip click does to the batch selection — a plain
/// click never reaches this, it opens the picture instead. Shift REPLACES the
/// selection with the range from the anchor (repeated shift-clicks do not
/// accumulate, the anchor does not move); ⌘/Ctrl toggles one picture in place
/// and becomes the anchor for the next shift-click.
public func selectionAfterClick<T: RollSelectionItem>(
    _ pictures: [T],
    _ selected: Set<String>,
    _ anchor: String,
    _ id: String,
    _ mods: SelectionModifiers
) -> Set<String> {
    if mods.shiftKey { return Set(pictureRange(pictures, anchor, id)) }
    if mods.metaKey || mods.ctrlKey {
        var next = selected
        if next.contains(id) { next.remove(id) } else { next.insert(id) }
        return next
    }
    return selected
}

public struct EditorKeyPress: Equatable, Sendable {
    public var key: String
    public var `repeat`: Bool
    public var metaKey: Bool
    public var ctrlKey: Bool
    public var altKey: Bool
    public var shiftKey: Bool
    /// The focused element types or moves a value (an input, a slider, a picker).
    public var targetTypes: Bool
    /// Text is selected: ⌘C copies THAT, not the develop.
    public var hasSelection: Bool
    /// The Layers tab is open — where `P` and `M` are the mask's keys, not the delivery's.
    public var layersTab: Bool

    public init(key: String, repeat: Bool = false, metaKey: Bool = false, ctrlKey: Bool = false, altKey: Bool = false,
                shiftKey: Bool = false, targetTypes: Bool = false, hasSelection: Bool = false, layersTab: Bool = false) {
        self.key = key; self.repeat = `repeat`; self.metaKey = metaKey; self.ctrlKey = ctrlKey; self.altKey = altKey
        self.shiftKey = shiftKey; self.targetTypes = targetTypes; self.hasSelection = hasSelection; self.layersTab = layersTab
    }
}

/// What a key press means in the editor; `nil` (the web's `null`) when it
/// belongs to someone else. The web's string actions in lowerCamel:
/// `crop-view` → `cropView`, `deliver-auto` → `deliverAuto`,
/// `copy-settings` → `copySettings`, `paste-settings` → `pasteSettings`.
public enum EditorKeyAction: Equatable, Sendable {
    case previous, next, hold, zoom, copy, paste
    case tab(WorkbenchTab)
    case swap, cropView, help, facts, mask, pick, remove, escape
    case deliver, deliverAuto, ignore, copySettings, pasteSettings, clipping, mono, variant
}

/// The letter each inspector tab answers to — its own initial, which is what
/// makes the set learnable in one reading: `A`djust, `D`etail, `L`ayers,
/// `C`rop, `E`xport.
private let tabKeys: [String: WorkbenchTab] = ["a": .adjust, "d": .detail, "l": .layers, "c": .crop, "e": .export]

/// What a key press means in the editor, or nil when it belongs to someone
/// else. ←/→ move along the strip, `\` holds "before" (its release is the
/// caller's), `Z` goes closer or back to the fit, a tab's own initial opens
/// it, `X` swaps the crop's orientation, ⇧C crops to the zoomed view, `H` (or
/// `?`) the shortcuts, `I` the facts over the picture, `J` the clipping, `V`
/// black and white, `M` the mask's view and `P` Pick / Paint (both on the
/// Layers tab), ⌘/Ctrl-C and -V copy and paste the develop, ⌘⇧C / ⌘⇧V the
/// sections, ⌘' a variant. Delete or Backspace removes what is selected on the
/// picture and Escape lets go of it. A field or a slider keeps every key it
/// could use; a held arrow does step, a held `\` does not re-press.
public func editorKeyAction(_ press: EditorKeyPress) -> EditorKeyAction? {
    if press.targetTypes || press.altKey { return nil }
    let key = press.key
    if press.metaKey || press.ctrlKey {
        let k = key.lowercased()
        if press.shiftKey {
            // ⌘⇧C / ⌘⇧V: the SECTIONS, Lightroom's chord — ⌘C / ⌘V below stay the develop numbers.
            if press.repeat { return nil }
            if k == "c" { return press.hasSelection ? nil : .copySettings }
            if k == "v" { return .pasteSettings }
            return nil
        }
        // ⌘' — Lightroom's virtual copy: a variant of the picture as it stands.
        if k == "'" { return press.repeat ? nil : .variant }
        if k == "c" { return press.hasSelection ? nil : .copy }
        if k == "v" { return .paste }
        return nil
    }
    // `?` is the one key reached WITH shift on most layouts, so it is read
    // before the blanket refusal below: a help key nobody can press is not one.
    if key == "?" { return press.repeat ? nil : .help }
    // ⇧C crops to what a zoomed view shows: the only other shift chord.
    if press.shiftKey && (key == "C" || key == "c") { return press.repeat ? nil : .cropView }
    if press.shiftKey { return nil }
    if key == "ArrowLeft" { return .previous }
    if key == "ArrowRight" { return .next }
    if press.repeat { return nil }
    if key == "Delete" || key == "Backspace" { return .remove }
    if key == "Escape" { return .escape }
    if key == "\\" { return .hold }
    if key == "z" || key == "Z" { return .zoom }
    if let tab = tabKeys[key.lowercased()] { return .tab(tab) }
    if key == "x" || key == "X" { return .swap }
    if key == "h" || key == "H" { return .help }
    if key == "i" || key == "I" { return .facts }
    if key == "j" || key == "J" { return .clipping }
    if key == "v" || key == "V" { return .mono }
    // `P` and `M` mean two things, by where the author is: on the Layers tab
    // they are the mask's, everywhere else the delivery state's. `U` puts the
    // picture back on the roll's rule on every tab.
    if key == "p" || key == "P" { return press.layersTab ? .pick : .deliver }
    if key == "m" || key == "M" { return press.layersTab ? .mask : .ignore }
    if key == "u" || key == "U" { return .deliverAuto }
    return nil
}

/// Which picture to OPEN after an undo or a redo put `after` back over
/// `before`: the undo stack is one for the whole roll, so ⌘Z after stepping
/// on could undo the previous picture with nothing on screen changing. The
/// restore is made visible by going to what it changed.
///
/// On the web "changed" is a different OBJECT — every write replaces the
/// picture it touches and keeps the others, so identity is the diff. A Swift
/// picture is a value, so the caller says what "the same" is (`same`); the
/// overload below reads it as equality. Nil — stay — when the open picture is
/// among the changed ones, or when no picture changed (a roll-wide field, a name).
public func pictureAfterRestore<T: RollSelectionItem>(
    _ before: [T],
    _ after: [T],
    _ openId: String?,
    same: (T, T) -> Bool
) -> String? {
    var was: [String: T] = [:]
    for p in before { was[p.id] = p }
    let changed = after.filter { p in
        guard let old = was[p.id] else { return true }
        return !same(old, p)
    }.map { $0.id }
    if changed.isEmpty { return nil }
    if let openId, changed.contains(openId) { return nil }
    return changed[0]
}

/// `pictureAfterRestore` with "the same" read as equality — right for a
/// `RollPicture`, whose every edit changes its value.
public func pictureAfterRestore<T: RollSelectionItem & Equatable>(_ before: [T], _ after: [T], _ openId: String?) -> String? {
    pictureAfterRestore(before, after, openId, same: ==)
}
