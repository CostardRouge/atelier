// How much the session may HOLD of the originals it fetched, and which to let
// go when it holds more. Port of `src/shared/sources/held-budget.ts` (R9 of
// `docs/capture-renditions.md`, the maintainer's D16).
//
// The original cache had no bound: a forty-picture roll developed from its
// DNGs is forty times 74 MB, which is an ended app on a phone and a swollen
// one on a desktop. The bound is a byte CEILING and the policy is least
// recently USED — a read counts as a use, since a read is what the stage,
// the plan and the export do with a held file — and what is evicted is only
// the cache's reference: a consumer holding the bytes keeps them, and the
// next one to ask fetches again. Pure; the cache calls it. The browser's
// `navigator.deviceMemory` was already a parameter on the web and stays one.

import Foundation

private let mib = 1024 * 1024

/// Where the ceiling lands when the platform says nothing about the device.
public let defaultHeldCeiling = 512 * mib

/// Where it lands on a phone or a tablet (`DeviceClass.constrained`): two
/// and a half DJI DNGs. Safari says nothing about its memory, so before this
/// an iPhone took the desktop default — half a gigabyte of held originals
/// beside the decoder's own heap, on a tab that is killed at a fraction of
/// that.
public let constrainedHeldCeiling = 192 * mib

private let leastCeiling = 256 * mib
private let mostCeiling = 1024 * mib

/// JavaScript's `Math.round`: half rounds UP.
private func roundHalfUp(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The ceiling for this device: a quarter of the memory the platform reports
/// (in GiB — Chrome's `navigator.deviceMemory`, coarse on purpose), kept
/// between 256 MiB and 1 GiB — unless the device is CONSTRAINED, which takes
/// its own flat ceiling whatever is reported (Chrome on Android says 8 GiB of
/// a phone whose tab is given far less). A quarter, because the app also
/// feeds a stage at its pixel budget, a decoder and an export from the same
/// memory. Nil, non-finite or non-positive memory falls back to the default.
public func heldCeiling(_ deviceMemoryGiB: Double?, _ klass: DeviceClass = .roomy) -> Int {
    if klass == .constrained { return constrainedHeldCeiling }
    guard let gib = deviceMemoryGiB, gib.isFinite, gib > 0 else { return defaultHeldCeiling }
    let quarter = (gib * 1024 * Double(mib)) / 4
    let clamped = min(Double(mostCeiling), max(Double(leastCeiling), roundHalfUp(quarter)))
    return Int(clamped)
}

public struct HeldEntry: Equatable, Sendable {
    public var key: String
    public var bytes: Int
    /// A monotonic tick of the last hold or read — higher is more recent.
    public var lastUsed: Double

    public init(key: String, bytes: Int, lastUsed: Double) {
        self.key = key; self.bytes = bytes; self.lastUsed = lastUsed
    }
}

/// The keys to drop so the rest fits under `ceiling`: the least recently used
/// first, and never the one used LAST — it is the file being worked on, and a
/// single file over the ceiling is held rather than fetched on every read.
public func toEvict(_ entries: [HeldEntry], _ ceiling: Int) -> [String] {
    var total = 0
    for e in entries { total += e.bytes }
    if total <= ceiling || entries.count < 2 { return [] }
    // Oldest first; ties keep their listed order, as the web's stable sort does.
    let indexed = Array(entries.enumerated())
    let byAge = indexed.sorted { a, b in
        if a.element.lastUsed != b.element.lastUsed { return a.element.lastUsed < b.element.lastUsed }
        return a.offset < b.offset
    }.map { $0.element }
    let newestIndex = byAge.count - 1
    var out: [String] = []
    for (i, e) in byAge.enumerated() {
        if total <= ceiling { break }
        if i == newestIndex { break }
        out.append(e.key)
        total -= e.bytes
    }
    return out
}
