// Who follows whom when the Library's tick and the open slide disagree — the
// port of `src/tools/roadtrip/library-sync.ts`.
//
// The two are kept pointed at the same picture BOTH ways (the web's
// `use-slide-library.ts`): opening a slide ticks its picture in the Library,
// and ticking another picture re-points the slide. The two sides are not
// peers — the document is the work, the tick a view of it — so a
// disagreement is settled by WHICH SIDE MOVED. The tick moved (the author
// picked a picture): the slide takes it. Anything else is the document moving
// (an undo, a redo, a cleared cell, a drop on another cell, another cell
// selected), and the Library follows it instead. Reading "the Library wins"
// is what made undo look dead on a collage (`roadtrip.md`, «the way back
// does nothing»).

import Foundation

/// What the sync should do this pass.
public enum SyncMove: String, Sendable {
    /// Point the Library at the picture the slide names.
    case restore
    /// Write the ticked picture onto the slide.
    case record
    /// They agree, or neither side moved.
    case idle
}

public struct SyncState: Equatable, Sendable {
    /// Has the restore already settled on the picture the slide names NOW?
    public var settled: Bool
    /// Has the Library's own tick moved since the last pass that acted on it?
    public var tickMoved: Bool
    /// The file the slide names, or nil for a slide with no picture.
    public var slideName: String?
    /// The file the Library has active, or nil when nothing is ticked.
    public var activeName: String?

    public init(settled: Bool, tickMoved: Bool, slideName: String?, activeName: String?) {
        self.settled = settled; self.tickMoved = tickMoved; self.slideName = slideName; self.activeName = activeName
    }
}

/// Two file names for the same picture. A rename is a different picture here.
public func sameFileName(_ a: String?, _ b: String?) -> Bool {
    guard let a, let b else { return a == nil && b == nil }
    return a.lowercased() == b.lowercased()
}

public func syncMove(_ state: SyncState) -> SyncMove {
    // Until the restore has settled on THIS picture, nothing the tick says is
    // an answer about it: the Library is still showing the slide before.
    if !state.settled { return .restore }
    guard state.activeName != nil else { return .idle }
    if sameFileName(state.slideName, state.activeName) { return .idle }
    return state.tickMoved ? .record : .idle
}

/// What a restore is ABOUT: one picture of one slide, never the slide alone —
/// keyed by the pair, a picture replaced under the Library re-points it, and a
/// fetch is still made at most once per picture.
public func restoreClaim(_ slideKey: String, _ mediaName: String?) -> String {
    "\(slideKey)\u{0}\(mediaName?.lowercased() ?? "")"
}

/// The claim for a slide's ref, as the web passes `{ name }` or null.
public func restoreClaim(_ slideKey: String, media: SavedMediaRef?) -> String {
    restoreClaim(slideKey, media?.name)
}
