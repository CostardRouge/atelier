// A draft the document may move under. Port of `src/shared/develop/write-through.ts`.
//
// The Develop tool has no Done: the numbers being dialled are WRITTEN THROUGH
// to the roll after a short rest. That makes the draft a second copy of a value
// the document also holds, and a second copy has to answer the question every
// second copy does — what happens when the other one changes on its own?
//
// It changes whenever the editor is not the author of the edit: an undo or a
// redo putting a whole document back, a batch verb writing onto the open
// picture, an instance's copy replacing the roll. The draft has to TAKE those,
// or the sliders keep showing numbers the roll no longer holds and the next
// nudge writes them straight back over the step.
//
// So this is a two-sided rule, and the whole of it is which side spoke last:
//
// - the DRAFT moved → the document owes a write, after its rest;
// - the DOCUMENT moved to something this editor did not write → the draft is
//   stale: drop whatever was owed and re-seed from the document.
//
// Telling the two apart needs one remembered value — the last thing handed to
// the document — because during a gesture the document LAGS the draft by a
// rest, and a lagging value must not read as somebody else's edit.
//
// Pure: the timer is the app's (the web's `use-write-through.ts`).

import Foundation

public struct WriteThrough<T> {
    /// A write owed but not yet made — of a value, or of "nothing" (nil).
    public struct Pending {
        public let value: T?
        public init(value: T?) { self.value = value }
    }

    /// The last value handed to the document — what its own value is expected to be.
    public let written: T?
    /// A write owed but not yet made; nil when nothing is owed.
    public let pending: Pending?

    public init(written: T?, pending: Pending?) {
        self.written = written; self.pending = pending
    }
}

extension WriteThrough.Pending: Equatable where T: Equatable {}
extension WriteThrough: Equatable where T: Equatable {}
extension WriteThrough.Pending: Sendable where T: Sendable {}
extension WriteThrough: Sendable where T: Sendable {}

/// Nothing owed, and the document's value is the one we last "wrote".
public func newWriteThrough<T>(_ stored: T?) -> WriteThrough<T> {
    WriteThrough(written: stored, pending: nil)
}

/// The draft moved to `value` (as the document would hold it).
///
/// A draft dragged back to where the document already is owes nothing — and
/// cancels what it owed, so a gesture that ends where it started is not a step.
public func drafted<T>(_ w: WriteThrough<T>, _ value: T?, _ same: (T?, T?) -> Bool) -> WriteThrough<T> {
    if same(value, w.written) {
        return w.pending != nil ? WriteThrough(written: w.written, pending: nil) : w
    }
    return WriteThrough(written: w.written, pending: WriteThrough.Pending(value: value))
}

/// The rest ended. `owed` says whether there was anything to write.
public func flushed<T>(_ w: WriteThrough<T>) -> (state: WriteThrough<T>, owed: Bool, value: T?) {
    guard let pending = w.pending else { return (w, false, w.written) }
    return (WriteThrough(written: pending.value, pending: nil), true, pending.value)
}

/// The document's own value is now `value`.
///
/// `reseed` is true only when it is not what this editor last wrote: the
/// document was changed under the draft, so the draft takes it and anything it
/// owed is dropped — a pending write would otherwise land a moment later and put
/// the undone state back.
public func arrived<T>(_ w: WriteThrough<T>, _ value: T?, _ same: (T?, T?) -> Bool) -> (state: WriteThrough<T>, reseed: Bool) {
    if same(value, w.written) { return (w, false) }
    return (WriteThrough(written: value, pending: nil), true)
}
