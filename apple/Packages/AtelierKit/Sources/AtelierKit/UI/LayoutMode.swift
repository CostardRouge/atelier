// How much room the SHELL has, named once. Port of `src/shared/ui/layout-mode.ts`.
//
// Three modes over two boundaries: `compact` (a phone — the stage owns the
// screen, a tool's sections sit in a bottom bar, the panels are sheets over
// it), `medium` (a tablet or a split laptop — the library docked but collapsed
// to its rail) and `expanded` (the desktop: library column, stage, inspector).
// A tool reads the mode to know which chrome the shell wears, never to lay out
// its own columns (`frontend.md`, «The shell wears THREE layouts»).
//
// The rules kept: 820 keeps exactly the meaning the web's `max-[820px]:`
// utilities give it, so the number is a constant and not a knob; the
// boundaries are bottom-EXCLUSIVE (820 itself is already `medium`), which is
// where this function and the CSS utility deliberately disagree by one pixel;
// a width nothing could measure (0, negative, not finite) is `compact`, the
// one layout that fits anywhere. The web's `matchMedia` listener is the app's
// (a window or scene size read into `modeForWidth`); `modeForMatches` and the
// two query strings are ported so the arithmetic stays one for one.

import Foundation

public enum LayoutMode: String, CaseIterable, Sendable {
    case compact, medium, expanded

    /// The two boundaries, in CSS pixels. `compactMax` is the suite's existing
    /// `820` — changing it would silently re-tune every `max-[820px]:` utility
    /// still in the web tree, so it is a constant, not a knob.
    public static let compactMax = 820.0
    public static let mediumMax = 1180.0

    /// The media queries the web shell listens on, narrowest first. Two
    /// listeners answer three modes: a width matching neither is `medium`.
    public static let compactQuery = "(max-width: \(Int(compactMax) - 1)px)"
    public static let mediumQuery = "(max-width: \(Int(mediumMax) - 1)px)"

    /// Every mode, widest last — the order a picker or a test should walk
    /// (the web's `LAYOUT_MODES`). `allCases` is declaration order.
    public static let layoutModes: [LayoutMode] = allCases

    private var rank: Int {
        switch self {
        case .compact: return 0
        case .medium: return 1
        case .expanded: return 2
        }
    }

    /// True when the mode has at least this much room — `mode.atLeast(.medium)`
    /// is "not a phone". Keeps the ordering in one place.
    public func atLeast(_ min: LayoutMode) -> Bool {
        rank >= min.rank
    }
}

extension LayoutMode: Comparable {
    /// Narrowest first, so `compact < medium < expanded`.
    public static func < (a: LayoutMode, b: LayoutMode) -> Bool {
        a.rank < b.rank
    }
}

/// The mode for a viewport width. Bottom-exclusive at both boundaries: `820`
/// is `medium`, `1180` is `expanded`. A width that is not a finite positive
/// number reads as `compact`.
public func modeForWidth(_ width: Double) -> LayoutMode {
    if !width.isFinite || width < LayoutMode.compactMax { return .compact }
    if width < LayoutMode.mediumMax { return .medium }
    return .expanded
}

/// The mode two `max-width` matches name. A compact width matches BOTH
/// queries, so the narrower one wins — or every phone would read as a tablet.
public func modeForMatches(compact: Bool, medium: Bool) -> LayoutMode {
    if compact { return .compact }
    return medium ? .medium : .expanded
}
