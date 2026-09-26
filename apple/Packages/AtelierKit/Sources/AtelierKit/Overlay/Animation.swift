// When an overlay element is on screen, and how it arrives and leaves — port
// of `src/shared/overlay/animation.ts`. Pure, and a FUNCTION OF TIME ALONE.
//
// That last point is the rule, not a detail: the preview redraws per display
// frame while an export walks decoded frames at the source cadence, so
// anything driven by "how much time passed since the last frame" would make
// the burn-in disagree with what the author validated. Same time in, same
// transform out, on every render path.
//
// Distances come out as fractions of the frame's SHORTER side, never pixels:
// the renderer multiplies by its own reference dimension, so a title rises as
// far in a 480 px preview as in a 4K export.
//
// The curves are the ONE registry's (`Motion/Easing.swift`); `easeAt` there is
// this module's `easeAt`. An overshooting curve takes a scale or an offset past
// its rest, and an opacity never above 1. The web's `Transform` is
// `OverlayTransform` here, and `IDENTITY` its `.identity`.

import Foundation

/// How an element enters or leaves: a hard cut, opacity alone, travel from
/// `direction` with the fade, growth from `scaleFrom` with the fade, a
/// character-by-character reveal, or a continuous left-to-right reveal.
public enum AnimPreset: String, CaseIterable, Sendable {
    case none, fade, slide, scale, typewriter, wipe
}

/// Travel direction of a `slide`: where the element goes on the way out, and
/// where it comes back from on the way in.
public enum AnimDirection: String, CaseIterable, Sendable {
    case up, down, left, right
}

public struct AnimStep: Equatable, Sendable {
    public var preset: AnimPreset
    /// Seconds the step lasts. 0 makes it instant.
    public var duration: Double
    public var easing: EasingId
    /// `slide` only. Absent = `up` (the element rises into place).
    public var direction: AnimDirection?
    /// `slide` only: travel as a fraction of the shorter side. Absent = 0.06.
    public var distanceFrac: Double?
    /// `scale` only: the scale it starts (in) or ends (out) at. Absent = 0.86.
    public var scaleFrom: Double?
    /// IN steps only: seconds to wait, invisible, after the window opens. An
    /// OUT step is always laid against the window's end and ignores it.
    public var delay: Double?
    /// `steps` curve only: how many jumps (2–12, default 4), as stored.
    public var steps: Double?
    /// A PICTURE in a cell only: move the picture inside its mask rather than
    /// the cell. Ignored by a text element.
    public var inside: Bool?

    public init(preset: AnimPreset, duration: Double, easing: EasingId, direction: AnimDirection? = nil,
                distanceFrac: Double? = nil, scaleFrom: Double? = nil, delay: Double? = nil,
                steps: Double? = nil, inside: Bool? = nil) {
        self.preset = preset; self.duration = duration; self.easing = easing; self.direction = direction
        self.distanceFrac = distanceFrac; self.scaleFrom = scaleFrom; self.delay = delay
        self.steps = steps; self.inside = inside
    }
}

public struct ElementAnimation: Equatable, Sendable {
    /// Absent (`.none`), written `null` (`.some(nil)`), or a step.
    public var `in`: AnimStep??
    public var out: AnimStep??

    public init(in inStep: AnimStep?? = .none, out outStep: AnimStep?? = .none) {
        self.in = inStep
        self.out = outStep
    }

    /// The entrance, when there is one.
    public var inStep: AnimStep? { self.in ?? nil }
    /// The exit, when there is one.
    public var outStep: AnimStep? { out ?? nil }
}

/// When an element is on screen, in seconds from the first exported frame (or
/// from its scene's start). The IN animation plays just after `start`, the OUT
/// one finishes exactly AT `end`: "it disappears at 3 s" means gone at 3 s.
public struct TimeWindow: Equatable, Sendable {
    public var start: Double
    /// nil = to the end of the clip.
    public var end: Double?

    public init(start: Double, end: Double?) {
        self.start = start
        self.end = end
    }
}

/// What the renderer applies before drawing an element. The web's `Transform`.
public struct OverlayTransform: Equatable, Sendable {
    /// 0 = do not draw at all.
    public var alpha: Double
    /// Offset as a fraction of the shorter side.
    public var dx: Double
    public var dy: Double
    public var scale: Double
    /// Share of the element revealed from its left edge, 0..1.
    public var reveal: Double
    /// `reveal` must land on whole characters (a typewriter types, it does not
    /// wipe). The renderer, holding the font metrics, decides how.
    public var revealSteps: Bool

    public init(alpha: Double = 1, dx: Double = 0, dy: Double = 0, scale: Double = 1, reveal: Double = 1, revealSteps: Bool = false) {
        self.alpha = alpha; self.dx = dx; self.dy = dy; self.scale = scale; self.reveal = reveal; self.revealSteps = revealSteps
    }

    /// The web's `IDENTITY`.
    public static let identity = OverlayTransform()
    fileprivate static let hidden = OverlayTransform(alpha: 0)
}

private let defaultDistance = 0.06
private let defaultScaleFrom = 0.86

/// A step that only fades, the sane default for both ends.
public func defaultStep(_ preset: AnimPreset = .fade, duration: Double = 0.5) -> AnimStep {
    AnimStep(preset: preset, duration: duration, easing: .out)
}

/// The four instants of an element's life. `outStart` is `.infinity` when
/// there is nothing to lay against the window's close.
public struct Phases: Equatable, Sendable {
    public var inStart: Double
    public var inEnd: Double
    public var outStart: Double
    public var end: Double?
}

/// A window too short to hold both animations cuts them back to meet in the
/// middle rather than fighting: a 0.4 s window over two 0.5 s steps gets 0.2 s
/// each, never a title that never appears.
public func phasesFor(_ win: TimeWindow, _ anim: ElementAnimation?) -> Phases {
    let end = win.end
    let inStep = anim?.inStep
    let outStep = anim?.outStep
    let inStart = win.start + max(0, inStep?.delay ?? 0)
    var inEnd = inStart + max(0, inStep?.duration ?? 0)
    // No end, or no out step: nothing to lay against the window's close.
    var outStart = Double.infinity
    if let end, let outStep { outStart = end - max(0, outStep.duration) }

    if let end {
        inEnd = min(inEnd, end)
        if outStart < inEnd {
            let mid = (max(inStart, win.start) + end) / 2
            inEnd = mid
            outStart = mid
        }
    }
    return Phases(inStart: inStart, inEnd: inEnd, outStart: outStart, end: end)
}

private enum Phase { case enter, leave }

/// The transform of one step at eased progress `e`, entering or leaving.
private func stepTransform(_ step: AnimStep, _ e: Double, _ phase: Phase) -> OverlayTransform {
    // `k` is the distance from the resting state: 1 at the far end, 0 at rest.
    // An overshooting curve takes it below 0: a scale or an offset follows it
    // past its rest, an opacity never gets brighter than 1.
    let k = phase == .enter ? 1 - e : e
    let alpha = step.preset == .none ? 1 : clamp01(1 - k)
    var t = OverlayTransform(alpha: alpha)

    switch step.preset {
    case .slide:
        let d = (step.distanceFrac ?? defaultDistance) * k
        switch step.direction ?? .up {
        // Travelling "up" means leaving upwards, so it enters from below.
        case .up: t.dy = phase == .enter ? d : -d
        case .down: t.dy = phase == .enter ? -d : d
        case .left: t.dx = phase == .enter ? d : -d
        case .right: t.dx = phase == .enter ? -d : d
        }
    case .scale:
        let from = step.scaleFrom ?? defaultScaleFrom
        t.scale = 1 + (from - 1) * k
    case .typewriter, .wipe:
        t.reveal = clamp01(1 - k)
        t.revealSteps = step.preset == .typewriter
        // A reveal carries the whole statement: fading it as well would make
        // the last characters arrive twice as slowly as the first.
        t.alpha = 1
    case .none, .fade:
        break
    }
    return t
}

private func eased(_ step: AnimStep, _ p: Double) -> Double {
    easeAt(step.easing, p, step.steps.map { clampSteps($0) })
}

/// The transform for an element at media-relative time `t`, or an alpha-0
/// transform when it is not on screen. Callers skip drawing on `alpha <= 0`.
public func transformAt(_ anim: ElementAnimation?, _ win: TimeWindow?, _ t: Double) -> OverlayTransform {
    // No window = the whole clip from its first frame: an element given an
    // entrance but no window still makes it, at the start.
    let w = win ?? TimeWindow(start: 0, end: nil)
    if anim == nil && win == nil { return .identity }
    let ph = phasesFor(w, anim)
    if t < w.start { return .hidden }
    if let end = ph.end, t >= end { return .hidden }
    if t < ph.inStart { return .hidden } // the stagger delay

    if let inStep = anim?.inStep, t < ph.inEnd {
        let span = ph.inEnd - ph.inStart
        let p = span <= 0 ? 1 : (t - ph.inStart) / span
        return stepTransform(inStep, eased(inStep, p), .enter)
    }
    if let outStep = anim?.outStep, let end = ph.end, t >= ph.outStart {
        let span = end - ph.outStart
        let p = span <= 0 ? 1 : (t - ph.outStart) / span
        return stepTransform(outStep, eased(outStep, p), .leave)
    }
    return .identity
}

/// True when the transform would draw nothing.
public func isHidden(_ t: OverlayTransform) -> Bool {
    t.alpha <= 0.001 || t.reveal <= 0
}

/// True when the transform changes nothing — the fast path for a still deck.
public func isIdentity(_ t: OverlayTransform) -> Bool {
    t.alpha == 1 && t.dx == 0 && t.dy == 0 && t.scale == 1 && t.reveal == 1
}

// MARK: - JSON

extension AnimStep {
    /// A stored step read back, every field kept — nil when it is not a
    /// record. What the web DRAWS for a junk value is what is read: an unknown
    /// preset fades, an unknown curve is linear, a missing duration is 0.
    public init?(json: JSONValue?) {
        guard let o = json?.objectValue else { return nil }
        typealias J = OverlayJSON
        self.init(
            preset: J.value(o, "preset", AnimPreset.self) ?? .fade,
            duration: J.number(o, "duration") ?? 0,
            easing: J.value(o, "easing", EasingId.self) ?? .linear
        )
        direction = J.value(o, "direction", AnimDirection.self)
        distanceFrac = J.number(o, "distanceFrac")
        scaleFrom = J.number(o, "scaleFrom")
        delay = J.number(o, "delay")
        steps = J.number(o, "steps")
        inside = J.bool(o, "inside")
    }

    public var json: JSONValue {
        typealias J = OverlayJSON
        var o: [String: JSONValue] = [
            "preset": .string(preset.rawValue), "duration": .number(duration), "easing": .string(easing.rawValue),
        ]
        J.put(&o, "direction", direction)
        J.put(&o, "distanceFrac", distanceFrac)
        J.put(&o, "scaleFrom", scaleFrom)
        J.put(&o, "delay", delay)
        J.put(&o, "steps", steps)
        J.put(&o, "inside", inside)
        return .object(o)
    }
}

private func readNullableStep(_ v: JSONValue?) -> AnimStep?? {
    guard let v else { return .none }
    if v.isNull { return .some(nil) }
    guard let step = AnimStep(json: v) else { return .none }
    return .some(step)
}

private func writeNullableStep(_ o: inout [String: JSONValue], _ key: String, _ step: AnimStep??) {
    switch step {
    case .none: break
    case .some(.none): o[key] = .null
    case .some(.some(let s)): o[key] = s.json
    }
}

extension ElementAnimation {
    /// A stored animation read back — nil when it is not a record. `null`
    /// ends stay `null`, so the element writes back as it was read.
    public init?(json: JSONValue?) {
        guard let o = json?.objectValue else { return nil }
        self.init(in: readNullableStep(o["in"]), out: readNullableStep(o["out"]))
    }

    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        writeNullableStep(&o, "in", self.in)
        writeNullableStep(&o, "out", out)
        return .object(o)
    }
}

extension TimeWindow {
    /// A stored window read back — nil when it is not a record. A missing
    /// start is the first frame; a missing end is the end of the clip.
    public init?(json: JSONValue?) {
        guard let o = json?.objectValue else { return nil }
        self.init(start: OverlayJSON.number(o, "start") ?? 0, end: OverlayJSON.number(o, "end"))
    }

    /// `end` is written `null` for "to the end", as the web writes it.
    public var json: JSONValue {
        .object(["start": .number(start), "end": end.map { .number($0) } ?? .null])
    }
}
