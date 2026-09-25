// Which buffer each pass reads from and writes to — a multi-pass renderer's
// ping-pong, as arithmetic. Port of `src/shared/render/pass-plan.ts`.
//
// Apart from the GPU because this is where a multi-pass renderer goes wrong
// in a way nothing catches: a pass that reads and writes the same target
// samples what it is drawing, and an off-by-one at the end leaves the result
// in a buffer nobody shows. Both are silent, so the plan is pure and pinned
// by specs. The property that matters most: at ONE pass the plan is
// source → canvas with no framebuffer at all — the common case is the general
// algorithm at n = 1, not a fast path bolted beside it.

import Foundation

/// A buffer of the chain: the uploaded source, one of the two ping-pong
/// targets, or the canvas the viewer sees. The web spells the source side
/// `PassSource` and the destination side `PassTarget`; one type here lets a
/// plan compare where a pass reads with where the one before it wrote.
public enum PassBuffer: Equatable, Sendable {
    case source
    case target(Int)
    case canvas
}

public typealias PassSource = PassBuffer
public typealias PassTarget = PassBuffer

public struct PassSlot: Equatable, Sendable {
    public var from: PassSource
    public var to: PassTarget

    public init(from: PassSource, to: PassTarget) {
        self.from = from; self.to = to
    }
}

/// The read/write plan for `count` passes: the first reads the source, the
/// last writes the canvas, everything between alternates. Two targets are
/// enough however long the chain — a pass never needs anything older than
/// what the one before it produced.
public func planPasses(_ count: Int) -> [PassSlot] {
    let n = max(0, count)
    var slots: [PassSlot] = []
    slots.reserveCapacity(n)
    for i in 0..<n {
        slots.append(PassSlot(
            from: i == 0 ? .source : .target((i - 1) % 2),
            to: i == n - 1 ? .canvas : .target(i % 2)
        ))
    }
    return slots
}

/// The same, rounding a fractional count down rather than planning half a pass.
public func planPasses(_ count: Double) -> [PassSlot] {
    planPasses(wholePasses(count))
}

/// How many ping-pong targets a plan actually needs — 0 for the single-pass case.
public func targetsNeeded(_ count: Int) -> Int {
    let n = max(0, count)
    if n <= 1 { return 0 }
    return n == 2 ? 1 : 2
}

public func targetsNeeded(_ count: Double) -> Int {
    targetsNeeded(wholePasses(count))
}

/// `Math.max(0, Math.floor(count))`, with a count that is not a number read as none.
private func wholePasses(_ count: Double) -> Int {
    guard count.isFinite else { return 0 }
    return max(0, Int(count.rounded(.down)))
}
