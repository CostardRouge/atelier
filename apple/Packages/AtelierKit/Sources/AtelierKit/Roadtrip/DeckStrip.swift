// The geometry of the deck STRIP — «Aiguille»: the piece's slides laid end to
// end on one clock, slid under a needle that never moves. Port of
// `src/shared/roadtrip/deck-strip.ts`; the component and the transport are
// the app's, this is the arithmetic both read.
//
// Rules kept:
// - Time is the piece's: slide `i` holds the screen from `start` for `seconds`
//   (a clip for its cut, a still for its inspector's seconds, the closing card
//   for the outro's length). Pixels are the strip's: a fixed number per
//   second, with a FLOOR so a half-second slide stays something a finger can
//   land on. The floor makes the mapping piecewise — linear INSIDE a cell,
//   never across the deck — so time and x only ever convert through the cells.
// - Playback never stops at an end: it LOOPS over the piece, or over the open
//   slide (asked for, or the piece IS one slide).
// - A clip holds what is left of it after its in point at its speed, once its
//   duration is known (`clipSlice`, the one place that arithmetic lives).

import Foundation

public struct StripCell: Equatable, Sendable {
    /// When the slide takes the screen, in piece seconds.
    public var start: Double
    public var seconds: Double
    /// Where its cell starts along the strip, in px, and how wide it is.
    public var left: Double
    public var width: Double

    public init(start: Double, seconds: Double, left: Double, width: Double) {
        self.start = start; self.seconds = seconds; self.left = left; self.width = width
    }
}

public struct StripLayout: Equatable, Sendable {
    public var cells: [StripCell]
    /// The piece's whole length.
    public var seconds: Double
    /// The strip's whole width, gaps included.
    public var width: Double

    public init(cells: [StripCell], seconds: Double, width: Double) {
        self.cells = cells; self.seconds = seconds; self.width = width
    }
}

public func stripLayout(_ lengths: [Double], _ pxPerSecond: Double, _ minPx: Double, _ gapPx: Double) -> StripLayout {
    var start = 0.0
    var left = 0.0
    var cells: [StripCell] = []
    for length in lengths {
        let seconds = length.isFinite ? max(0, length) : 0
        let width = max(minPx, seconds * pxPerSecond)
        cells.append(StripCell(start: start, seconds: seconds, left: left, width: width))
        start += seconds
        left += width + gapPx
    }
    return StripLayout(cells: cells, seconds: start, width: cells.isEmpty ? 0 : left - gapPx)
}

/// What playback loops over: the whole piece, or the slide under the needle.
public enum LoopScope: String, CaseIterable, Sendable {
    case piece, slide
}

/// The open slide starts over on its own: asked for, or the piece IS one slide.
public func loopsOpenSlide(_ scope: LoopScope, _ count: Int) -> Bool {
    scope == .slide || count <= 1
}

/// The slide that plays when the open one runs out: itself when it loops,
/// otherwise the next — and the first after the last.
public func nextAtEnd(_ open: Int, _ count: Int, _ scope: LoopScope) -> Int {
    if count <= 0 { return 0 }
    if loopsOpenSlide(scope, count) { return max(0, min(open, count - 1)) }
    return (open + 1) % count
}

/// The slide under a moment and how far into it.
public struct StripPlace: Equatable, Sendable {
    public var index: Int
    public var local: Double

    public init(index: Int, local: Double) { self.index = index; self.local = local }
}

/// deck-strip's own clamp: `Math.min(hi, Math.max(lo, v))`.
private func stripClamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    min(hi, max(lo, v))
}

/// The slide under a moment, and how far into it. The end of the piece belongs
/// to the last slide, at its own end.
public func locate(_ layout: StripLayout, _ t: Double) -> StripPlace {
    let cells = layout.cells
    if cells.isEmpty { return StripPlace(index: 0, local: 0) }
    let at = stripClamp(t, 0, layout.seconds)
    for (i, cell) in cells.enumerated() where at < cell.start + cell.seconds {
        return StripPlace(index: i, local: at - cell.start)
    }
    let last = cells.count - 1
    return StripPlace(index: last, local: cells[last].seconds)
}

/// Where a moment sits along the strip, in px.
public func xAtTime(_ layout: StripLayout, _ t: Double) -> Double {
    if layout.cells.isEmpty { return 0 }
    let place = locate(layout, t)
    let cell = layout.cells[place.index]
    let fraction = cell.seconds > 0 ? place.local / cell.seconds : 0
    return cell.left + fraction * cell.width
}

/// The moment at a point along the strip; a gap reads as the end of the cell before it.
public func timeAtX(_ layout: StripLayout, _ x: Double) -> Double {
    if layout.cells.isEmpty { return 0 }
    let at = stripClamp(x, 0, layout.width)
    for cell in layout.cells where at <= cell.left + cell.width {
        let f = cell.width > 0 ? stripClamp((at - cell.left) / cell.width, 0, 1) : 0
        return cell.start + f * cell.seconds
    }
    return layout.seconds
}

/// A moment pulled onto the nearest slide edge when it lands within `px` of it
/// — so a flick ends at the start of a slide rather than a few frames into it.
public func snapToEdge(_ layout: StripLayout, _ t: Double, _ px: Double) -> Double {
    if layout.cells.isEmpty { return t }
    let x = xAtTime(layout, t)
    var best = t
    var bestDistance = px
    for cell in layout.cells {
        let edges: [(x: Double, t: Double)] = [
            (cell.left, cell.start),
            (cell.left + cell.width, cell.start + cell.seconds),
        ]
        for edge in edges {
            let distance = abs(edge.x - x)
            if distance <= bestDistance {
                bestDistance = distance
                best = edge.t
            }
        }
    }
    return stripClamp(best, 0, layout.seconds)
}

/// How close to a slide's start still counts as ON it, in seconds.
private let stripStartTolerance = 0.05

/// The start of the next slide (`+1`) or of this one — or of the previous one
/// when already on its start (`-1`), the way a player's ⏮ behaves.
public func stepSlide(_ layout: StripLayout, _ t: Double, _ direction: Int) -> Double {
    let cells = layout.cells
    if cells.isEmpty { return 0 }
    let place = locate(layout, t)
    if direction > 0 {
        return place.index + 1 < cells.count ? cells[place.index + 1].start : layout.seconds
    }
    let onStart = place.local <= stripStartTolerance
    return cells[onStart ? max(0, place.index - 1) : place.index].start
}

/// How long a slide really holds the screen. A clip is capped by what is left
/// of it after its in point — a stored 5 s over a 3 s clip plays 3 — once its
/// duration is known; everything else (and a clip not yet measured) holds the
/// seconds its inspector gives it.
public func screenLength(seconds: Double, videoTimeSeconds: Double, speed: Double, _ clipDuration: Double) -> Double {
    if !(clipDuration > 0) { return seconds }
    return screenSecondsOf(clipSlice(videoTimeSeconds, seconds, speed, clipDuration), speed)
}

/// `screenLength` over a deck slide.
public func screenLength(_ slide: DeckSlide, _ clipDuration: Double) -> Double {
    screenLength(seconds: slide.seconds, videoTimeSeconds: slide.videoTimeSeconds, speed: slide.speed, clipDuration)
}

/// Where a slide's pictures have frames placed, in the slide's own seconds —
/// the lead's and every DRAWN cell's, merged and in order. The band marks them
/// and the needle's «previous / next frame» steps through the same list.
public func slideMotionMarks(motion: FramingMotion?, collage: SlideCollage?, _ seconds: Double,
                             _ openerSeconds: Double = 0) -> [Double] {
    var marks = AtelierKit.motionMarks(motion, seconds, openerSeconds)
    if let collage {
        let drawn = max(0, collageCellCount(collage) - 1)
        for cell in collage.cells.prefix(drawn) {
            marks.append(contentsOf: AtelierKit.motionMarks(cell.motion, seconds, openerSeconds))
        }
    }
    let sorted = marks.sorted()
    var out: [Double] = []
    for (i, m) in sorted.enumerated() where i == 0 || m - sorted[i - 1] > 1e-6 {
        out.append(m)
    }
    return out
}

/// `slideMotionMarks` over a deck slide.
public func slideMotionMarks(_ slide: DeckSlide, _ seconds: Double, _ openerSeconds: Double = 0) -> [Double] {
    slideMotionMarks(motion: slide.motion, collage: slide.collage, seconds, openerSeconds)
}
