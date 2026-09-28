// Undo and redo as a value: a past, a present, a future. Port of
// `src/shared/history/history.ts`.
//
// Every editor in the suite funnels its edits through ONE call — Trips hands
// the whole `TripDoc` to its change handler, Develop the whole `RollDoc`, the
// Studio rebuilds its document from the editing state on each autosave — so
// history is a stack of WHOLE DOCUMENTS, not a log of operations. Nothing has
// to describe how to invert itself, which is the half of an undo engine that
// rots: a new field on a document is undoable the day it is added, with no
// inverse to write and none to forget (`architecture.md`, «Undo is a stack of
// whole DOCUMENTS»). On the web the documents are JSON held immutably, so a
// snapshot costs a pointer; here a document is a value with copy-on-write
// storage, and a snapshot costs the same.
//
// The one thing a snapshot stack must get right is WHAT COUNTS AS ONE STEP. A
// slider fires a change per pixel; typing a name fires one per keystroke. Undo
// that walks back a drag one pixel at a time is not undo. So two edits MERGE
// into one step when they arrive close together under the same label — the
// label is what a caller says the edit was about ("the piece I am editing",
// "the trip"), so a gesture never merges with the different thing done right
// after it.
//
// IDENTITY is the one place the port reads differently. The web tells a
// restore from an edit by `Object.is`: restoring hands the tool the very
// object the history holds, so when it comes back down the watcher sees its
// own state. A Swift value has no identity, and for a value held immutably an
// unchanged member IS an equal member — so `record` compares with `==` for an
// `Equatable` document, and takes a `same:` closure for a caller that holds a
// class-typed document and wants `===`. `shallowSame` and `sameSlice` keep
// their names for the same reason: in a value world both read as `==`, and
// the web's "one level deeper" is already what `==` reads.
//
// Pure: the clock is an argument. The SwiftUI half (watching the change
// funnel, the buttons, ⌘Z) is the app's; `UndoKeys.swift` decides who owns ⌘Z.

import Foundation

public struct HistoryState<T> {
    /// Oldest first; `present` is not in it.
    public var past: [T]
    public var present: T
    /// The undone states, nearest first — what redo walks back up.
    public var future: [T]
    /// When `present` was recorded, for merging. `-∞` for a state nothing may merge into.
    public var at: Double
    /// What produced `present`. Two edits merge only if they carry the same one.
    public var label: String?

    public init(past: [T], present: T, future: [T], at: Double, label: String?) {
        self.past = past; self.present = present; self.future = future; self.at = at; self.label = label
    }
}

extension HistoryState: Equatable where T: Equatable {}
extension HistoryState: Sendable where T: Sendable {}

/// How many steps back one document keeps.
public let historyLimit = 50

/// How long a gesture stays open. 700 ms is longer than the gap between two
/// frames of a drag and two keystrokes of a word, and shorter than the pause
/// before a person does the next, different thing — and it sits just under the
/// 800 ms local-save debounce, so one saved document is one undo step.
public let coalesceMs: Double = 700

/// A present no later edit may merge into: the state a document opened on, and
/// whatever undo or redo leaves behind. Without it the first edit after an undo
/// would swallow the state it just came back to, and the step would be gone.
private let sealed = -Double.infinity

public func newHistory<T>(_ present: T) -> HistoryState<T> {
    HistoryState(past: [], present: present, future: [], at: sealed, label: nil)
}

public func canUndo<T>(_ history: HistoryState<T>) -> Bool {
    !history.past.isEmpty
}

public func canRedo<T>(_ history: HistoryState<T>) -> Bool {
    !history.future.isEmpty
}

public struct RecordOptions: Equatable, Sendable {
    /// The clock at the call site, in ms.
    public var now: Double
    /// What the edit was about; two edits merge only under the same one.
    public var label: String?
    public var limit: Int
    public var coalesceMs: Double

    public init(now: Double, label: String? = nil, limit: Int = historyLimit, coalesceMs: Double = AtelierKit.coalesceMs) {
        self.now = now; self.label = label; self.limit = limit; self.coalesceMs = coalesceMs
    }
}

/// Take `next` as the new present.
///
/// It either MERGES into the current step (same label, inside the window) or
/// pushes the present onto the past and starts one. Either way the future is
/// dropped: editing after an undo is the branch the author chose, and keeping a
/// redo across it would put back a state that never followed this one.
/// `same` is what tells a restore from an edit (the web's `Object.is`).
public func record<T>(_ history: HistoryState<T>, _ next: T, _ options: RecordOptions,
                      same: (T, T) -> Bool) -> HistoryState<T> {
    if same(next, history.present) { return history }
    let label = options.label
    let limit = options.limit
    let window = options.coalesceMs

    // `at` is -∞ on a sealed present, so the subtraction is +∞ and the test
    // fails without a second branch for it.
    if label == history.label && options.now - history.at <= window {
        var merged = history
        merged.present = next
        merged.future = []
        merged.at = options.now
        return merged
    }

    var grown = history.past
    grown.append(history.present)
    let kept = grown.count > limit ? Array(grown.suffix(limit)) : grown
    return HistoryState(past: kept, present: next, future: [], at: options.now, label: label)
}

/// `record` for a document compared by value — an unchanged document is an
/// equal one.
public func record<T: Equatable>(_ history: HistoryState<T>, _ next: T, _ options: RecordOptions) -> HistoryState<T> {
    record(history, next, options, same: ==)
}

/// Step back. Unchanged when there is nothing to step back to.
public func undo<T>(_ history: HistoryState<T>) -> HistoryState<T> {
    guard canUndo(history), let last = history.past.last else { return history }
    return HistoryState(
        past: Array(history.past.dropLast()),
        present: last,
        future: [history.present] + history.future,
        at: sealed,
        label: nil
    )
}

/// Step forward again, while nothing has been edited since the undo.
public func redo<T>(_ history: HistoryState<T>) -> HistoryState<T> {
    guard canRedo(history), let first = history.future.first else { return history }
    return HistoryState(
        past: history.past + [history.present],
        present: first,
        future: Array(history.future.dropFirst()),
        at: sealed,
        label: nil
    )
}

/// Close the current step, so the next edit starts a new one whatever the clock
/// says. What a caller reaches for when a gesture ends at a moment only it knows
/// about — a media switched under the editor, a sheet closed.
public func seal<T>(_ history: HistoryState<T>) -> HistoryState<T> {
    if history.at == sealed { return history }
    var closed = history
    closed.at = sealed
    return closed
}

/// Two slices that mean the same composition.
///
/// On the web `shallowSame` asks whether every member is the SAME object — the
/// right question for state held immutably, and the wrong one for a member a
/// hook rebuilds while meaning nothing by it (a grade stack emptied onto a
/// fresh `[]`), so `sameSlice` looks ONE LEVEL DEEPER for an array or a plain
/// record, and never further. A Swift value carries no identity: a member is
/// the same when it is equal, at every level, so the two read alike here. Kept
/// under the web's name so the watcher that is ported later finds it.
public func sameSlice<V: Equatable>(_ a: [String: V], _ b: [String: V]) -> Bool {
    a == b
}

/// Same keys, same values. The primitive `sameSlice` is built on; what a
/// caller wants when every member it compares is held immutably — on the web
/// identity IS equality there, and here equality is all there is.
public func shallowSame<V: Equatable>(_ a: [String: V], _ b: [String: V]) -> Bool {
    a == b
}
