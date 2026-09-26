// A picture that MOVES inside its frame over a slide — a pan and a zoom, the
// rostrum camera's move (*banc-titre*; the effect iMovie calls Ken Burns).
// Port of `src/shared/media/framing-motion.ts`.
//
// It is not a second transform. A motion is the picture's own FRAMING read at
// a moment: a list of frames placed at instants of the slide, the last of
// which is the framing the document already stores. So every renderer that
// draws a framing draws a motion by being handed `framingAt(t)` instead of
// `framing`, and nothing about the draw changes. Decided 2026-09-23 against a
// dedicated opener — `roadtrip.md`, «A picture moves in its frame».
//
// Four rules the shape keeps:
//
// - **The rest is `framing`.** Keys are the frames BEFORE it, each at `at` in
//   [0, 1) of the motion's span; the rest sits at 1 and is never stored twice.
//   Every surface that draws a slide settled keeps drawing `framing`.
// - **A key holds the pan and the zoom only.** Rotation, mirror and fit belong
//   to the picture and are read from `framing` at every instant.
// - **Zoom is geometric, and the centre travels with the window's width.** The
//   scale is interpolated as `a·(b/a)^e` and `pan / scale` linearly in
//   `1 / scale`, which keeps a point the two frames share still on screen
//   under both fits and at any rotation.
// - **Nothing here clamps to the frame.** `framingTransform` clamps the scale
//   and the pan against the slack at the moment it DRAWS, so an interpolated
//   (or overshooting — Back, Spring) instant can never show an edge.
//
// Every number below is the web's; the document's `motion` field (v28) reads
// through `readMotion` and writes back through `json`.

import Foundation

/// One placed frame: where the picture sits at `at` of the motion's span.
public struct FramingKey: Equatable, Sendable {
    /// 0..1 of the motion's span, strictly before its end (the rest).
    public var at: Double
    /// Same meaning as `Framing.scale`.
    public var scale: Double
    /// Same meaning as `Framing.x` / `Framing.y`.
    public var x: Double
    public var y: Double

    public init(at: Double, scale: Double, x: Double, y: Double) {
        self.at = at; self.scale = scale; self.x = x; self.y = y
    }

    public var json: JSONValue {
        .object(["at": .number(at), "scale": .number(scale), "x": .number(x), "y": .number(y)])
    }
}

/// When the motion runs. `afterOpener` waits for the opener's own length (the
/// hook's alone): Défilé covers the frame while it sweeps and Virée reveals
/// the picture at its end, so a motion started with the slide would be half
/// spent before anyone saw it.
public enum MotionStart: String, Codable, Sendable {
    case slide
    case afterOpener = "after-opener"
}

public struct FramingMotion: Equatable, Sendable {
    /// The frames before the rest, sorted by `at`. Never empty — no key is no motion.
    public var keys: [FramingKey]
    /// The curve each hop travels on, from the suite's one registry.
    public var easing: EasingId
    /// Only read under `steps`.
    public var steps: Int?
    public var start: MotionStart

    public init(keys: [FramingKey], easing: EasingId, steps: Int? = nil, start: MotionStart) {
        self.keys = keys; self.easing = easing; self.steps = steps; self.start = start
    }

    /// The motion as the document holds it: `steps` only when it has one.
    public var json: JSONValue {
        var o: [String: JSONValue] = [
            "keys": .array(keys.map(\.json)),
            "easing": .string(easing.rawValue),
            "start": .string(start.rawValue),
        ]
        if let steps { o["steps"] = .number(Double(steps)) }
        return .object(o)
    }
}

/// A framing and the motion written beside it — what every write at the
/// needle, a preset, a tour or a card row hands back.
public struct FramingWrite: Equatable, Sendable {
    public var framing: Framing
    public var motion: FramingMotion?
    public init(framing: Framing, motion: FramingMotion?) { self.framing = framing; self.motion = motion }
}

/// Slow to leave, slow to arrive — what a rostrum move looks like.
public let defaultMotionEasing: EasingId = .inOutCubic

/// How near the needle must stand to a placed frame, in seconds, for a gesture
/// to EDIT that frame rather than place a new one — and for the stage to show
/// the frame itself rather than an instant a hair away from it.
public let keySnapSeconds = 0.15

/// How much a new motion starts zoomed in, over the frame it comes to rest on.
public let starterZoom = 1.15

/// The latest a key may sit: at 1 it would be the rest.
private let lastAt = 0.999

/// Keys in time order, one per instant — a later write at the same `at` wins.
private func sortKeys(_ keys: [FramingKey]) -> [FramingKey] {
    var byAt: [Double: FramingKey] = [:]
    for key in keys { byAt[key.at] = key }
    return byAt.values.sorted { $0.at < $1.at }
}

/// Read a motion out of anything — a stored document, an imported file, a
/// newer build's field. Junk keys are dropped rather than repaired, and a
/// motion left with no key is no motion at all (nil), the one spelling of
/// "this picture holds still".
public func readMotion(_ v: JSONValue?) -> FramingMotion? {
    guard let m = v?.objectValue, let list = m["keys"]?.arrayValue else { return nil }
    var keys: [FramingKey] = []
    for k in list {
        guard let o = k.objectValue else { continue }
        guard let at = o["at"]?.finiteNumber, let scale = o["scale"]?.finiteNumber,
              let x = o["x"]?.finiteNumber, let y = o["y"]?.finiteNumber else { continue }
        keys.append(FramingKey(at: clamp(at, 0, lastAt), scale: clamp(scale, 1, maxFramingScale), x: x, y: y))
    }
    if keys.isEmpty { return nil }
    let easing = m["easing"]?.stringValue.flatMap(EasingId.init(rawValue:)) ?? defaultMotionEasing
    return FramingMotion(
        keys: sortKeys(keys),
        easing: easing,
        steps: easing == .steps ? clampSteps(m["steps"]?.finiteNumber) : nil,
        start: m["start"]?.stringValue == MotionStart.afterOpener.rawValue ? .afterOpener : .slide
    )
}

/// Whether a picture moves at all.
public func hasMotion(_ motion: FramingMotion?) -> Bool {
    guard let motion else { return false }
    return !motion.keys.isEmpty
}

/// The moment the motion starts, in the slide's seconds.
public func motionOffset(_ motion: FramingMotion, _ seconds: Double, _ openerSeconds: Double = 0) -> Double {
    if motion.start != .afterOpener { return 0 }
    return clamp(openerSeconds.isFinite ? openerSeconds : 0, 0, max(0, seconds))
}

/// How far into its span the motion is at `t` seconds into the slide, 0..1.
/// `seconds` is the slide's screen time — a clip's DELIVERED stretch.
public func motionProgress(_ motion: FramingMotion, _ t: Double, _ seconds: Double, _ openerSeconds: Double = 0) -> Double {
    let offset = motionOffset(motion, seconds, openerSeconds)
    let span = seconds - offset
    if !(span > 1e-3) { return t >= offset ? 1 : 0 }
    return clamp((t - offset) / span, 0, 1)
}

/// A key's instant in the slide's own seconds — where the band draws its mark.
public func keySeconds(_ motion: FramingMotion, _ at: Double, _ seconds: Double, _ openerSeconds: Double = 0) -> Double {
    let offset = motionOffset(motion, seconds, openerSeconds)
    return offset + clamp(at, 0, 1) * max(0, seconds - offset)
}

/// Every placed frame's instant, the rest's included, in the slide's seconds.
public func motionMarks(_ motion: FramingMotion?, _ seconds: Double, _ openerSeconds: Double = 0) -> [Double] {
    guard let motion, !motion.keys.isEmpty else { return [] }
    var marks = motion.keys.map { keySeconds(motion, $0.at, seconds, openerSeconds) }
    marks.append(keySeconds(motion, 1, seconds, openerSeconds))
    return marks
}

/// A key as the frame it stands for — the rest's rotation, mirror and fit.
private func keyFraming(_ framing: Framing, _ key: FramingKey) -> Framing {
    var out = framing
    out.scale = key.scale
    out.x = key.x
    out.y = key.y
    return out
}

/// The rest, as a key at the end of the span.
private func restKey(_ framing: Framing) -> FramingKey {
    FramingKey(at: 1, scale: framing.scale, x: framing.x, y: framing.y)
}

/// One hop at eased progress `e` — see the module's third rule. `e` may leave
/// 0..1 on an overshooting curve: the scale is held to its range here, the pan
/// is left to the draw's own clamp.
private func between(_ a: FramingKey, _ b: FramingKey, _ e: Double) -> (scale: Double, x: Double, y: Double) {
    let sa = max(a.scale, 1e-6)
    let sb = max(b.scale, 1e-6)
    let scale = sa * pow(sb / sa, e)
    let wa = 1 / sa
    let wb = 1 / sb
    let q = abs(wb - wa) > 1e-9 ? (1 / scale - wa) / (wb - wa) : e
    let ax = a.x / sa
    let bx = b.x / sb
    let ay = a.y / sa
    let by = b.y / sb
    let vx = ax + (bx - ax) * q
    let vy = ay + (by - ay) * q
    return (clamp(scale, 1, maxFramingScale), vx * scale, vy * scale)
}

/// The framing at progress `u` of the motion (see `motionProgress`).
/// Before the first key the picture holds on it; at 1 it IS `framing`.
public func framingAtProgress(_ framing: Framing, _ motion: FramingMotion?, _ u: Double) -> Framing {
    guard let motion, !motion.keys.isEmpty else { return framing }
    if u >= 1 { return framing }
    let points = motion.keys + [restKey(framing)]
    if u <= points[0].at { return keyFraming(framing, points[0]) }
    for i in 1..<points.count {
        let b = points[i]
        if u > b.at { continue }
        let a = points[i - 1]
        let span = b.at - a.at
        let p = span > 1e-9 ? (u - a.at) / span : 1
        let e = easeAt(motion.easing, p, motion.steps)
        let hop = between(a, b, e)
        var out = framing
        out.scale = hop.scale
        out.x = hop.x
        out.y = hop.y
        return out
    }
    return framing
}

/// The framing at `t` seconds into a slide of `seconds` — what a renderer asks.
public func framingAt(_ framing: Framing, _ motion: FramingMotion?, _ t: Double, _ seconds: Double, _ openerSeconds: Double = 0) -> Framing {
    guard let motion, !motion.keys.isEmpty else { return framing }
    return framingAtProgress(framing, motion, motionProgress(motion, t, seconds, openerSeconds))
}

/// The clock a renderer is handed with a picture that moves: the motion, the
/// slide's screen time and the opener's own length. A surface that draws a
/// slide SETTLED is handed none, and draws the rest.
public struct MotionClock: Equatable, Sendable {
    public var motion: FramingMotion?
    public var seconds: Double
    public var openerSeconds: Double?
    public init(motion: FramingMotion?, seconds: Double, openerSeconds: Double? = nil) {
        self.motion = motion; self.seconds = seconds; self.openerSeconds = openerSeconds
    }
}

/// `framingAt` over a `MotionClock`; no clock is the rest.
public func framingOnClock(_ framing: Framing, _ clock: MotionClock?, _ t: Double) -> Framing {
    guard let clock else { return framing }
    return framingAt(framing, clock.motion, t, clock.seconds, clock.openerSeconds ?? 0)
}

/// What a gesture at the needle writes. `key` edits a placed frame (`index`
/// into `keys`, `start` when it is the first), `rest` the framing itself,
/// `new` places a frame at the needle.
public enum NeedleTarget: Equatable, Sendable {
    case rest
    case key(index: Int, start: Bool)
    case new
}

/// The frame the needle is on. `snap` is `keySnapSeconds` as a share of the
/// span; the rest wins its own neighbourhood, then the nearest key.
public func needleTarget(_ motion: FramingMotion?, _ u: Double, _ snap: Double) -> NeedleTarget {
    guard let motion, !motion.keys.isEmpty, u < 1 - snap else { return .rest }
    var best = -1
    var gap = Double.infinity
    for (i, k) in motion.keys.enumerated() {
        let d = abs(k.at - u)
        if d <= snap && d < gap {
            best = i
            gap = d
        }
    }
    if best < 0 { return .new }
    return .key(index: best, start: best == 0)
}

/// `keySnapSeconds` as a share of a motion's span.
public func snapShare(_ motion: FramingMotion?, _ seconds: Double, _ openerSeconds: Double = 0) -> Double {
    guard let motion, !motion.keys.isEmpty else { return 0 }
    let span = seconds - motionOffset(motion, seconds, openerSeconds)
    return span > 1e-3 ? min(0.25, keySnapSeconds / span) : 0.25
}

/// The framing to SHOW with the needle held at `u`: the placed frame itself
/// when the needle is on one, the instant otherwise. A stage that showed the
/// instant a hair from a key would hand the gesture a frame that is neither,
/// and the write would move the picture the moment it landed.
public func framingAtNeedle(_ framing: Framing, _ motion: FramingMotion?, _ u: Double, _ snap: Double) -> Framing {
    guard let motion, !motion.keys.isEmpty else { return framing }
    switch needleTarget(motion, u, snap) {
    case .rest: return framing
    case .key(let index, _): return keyFraming(framing, motion.keys[index])
    case .new: return framingAtProgress(framing, motion, u)
    }
}

/// The picture's own members of `next` — rotation, mirror and fit — over `framing`.
private func withShared(_ framing: Framing, from next: Framing) -> Framing {
    var out = framing
    out.rotation = next.rotation
    out.flipX = next.flipX
    out.flipY = next.flipY
    out.fit = next.fit
    return out
}

/// Write a gesture's framing at the needle. The pan and the zoom go to the
/// frame the needle is on (a new one is placed there when it is on none);
/// rotation, mirror and fit always go to the rest, since they belong to the
/// picture at every instant. With no motion this is the plain write it always
/// was.
public func placeAtNeedle(_ framing: Framing, _ motion: FramingMotion?, _ u: Double, _ next: Framing, _ snap: Double) -> FramingWrite {
    guard let motion, !motion.keys.isEmpty else { return FramingWrite(framing: next, motion: motion) }
    let shared = withShared(framing, from: next)
    switch needleTarget(motion, u, snap) {
    case .rest:
        var f = shared
        f.scale = next.scale
        f.x = next.x
        f.y = next.y
        return FramingWrite(framing: f, motion: motion)
    case .key(let index, _):
        var m = motion
        m.keys[index].scale = next.scale
        m.keys[index].x = next.x
        m.keys[index].y = next.y
        return FramingWrite(framing: shared, motion: m)
    case .new:
        var m = motion
        let placed = FramingKey(at: clamp(u, 0, lastAt), scale: next.scale, x: next.x, y: next.y)
        m.keys = sortKeys(motion.keys + [placed])
        return FramingWrite(framing: shared, motion: m)
    }
}

/// Take off the frame the needle is on. The rest cannot be taken off — it is
/// the picture's framing — and the last key taken off leaves no motion.
public func removeAtNeedle(_ motion: FramingMotion?, _ u: Double, _ snap: Double) -> FramingMotion? {
    guard let motion, !motion.keys.isEmpty else { return nil }
    guard case .key(let index, _) = needleTarget(motion, u, snap) else { return motion }
    var m = motion
    m.keys.remove(at: index)
    return m.keys.isEmpty ? nil : m
}

/// Keep the start and the rest, drop every frame placed between them.
public func keepEnds(_ motion: FramingMotion?) -> FramingMotion? {
    guard let motion, !motion.keys.isEmpty else { return nil }
    var m = motion
    m.keys = [motion.keys[0]]
    return m
}

/// A new motion over `framing`: it starts `starterZoom` closer on the same
/// point and comes to rest on the frame the author composed — so the slide
/// ENDS where the badge was placed, and turning it on shows a move at once
/// instead of a switch that seems to do nothing. `pan / scale` held constant
/// is what keeps the same point in the middle.
public func starterMotion(_ framing: Framing) -> FramingMotion {
    let scale = clamp(framing.scale * starterZoom, 1, maxFramingScale)
    let k = scale / max(framing.scale, 1e-6)
    return FramingMotion(
        keys: [FramingKey(at: 0, scale: scale, x: framing.x * k, y: framing.y * k)],
        easing: defaultMotionEasing,
        start: .slide
    )
}

/// `-v || 0` — a negated pan with −0 and NaN spelled 0.
private func negated(_ v: Double) -> Double {
    let n = -v
    return n == 0 || n.isNaN ? 0 : n
}

/// Mirror a motion the way `flipFraming` mirrors its rest: the pan along that
/// axis changes sign, at every key. Without this a flipped picture would
/// start its move from the other side of the frame.
public func flipMotion(_ motion: FramingMotion?, axis: Character) -> FramingMotion? {
    guard let motion, !motion.keys.isEmpty else { return motion }
    var m = motion
    m.keys = motion.keys.map { k in
        var out = k
        if axis == "x" { out.x = negated(k.x) } else { out.y = negated(k.y) }
        return out
    }
    return m
}

/// The framing at its DEEPEST zoom over the whole motion — what a delivery
/// must be able to fill. Asking the rest alone would let a slide that starts
/// at ×2 over a proxy come to rest at ×1 and be judged sharp: the pixels a
/// move needs are the ones its closest frame shows.
public func deepestFraming(_ framing: Framing, _ motion: FramingMotion?) -> Framing {
    guard let motion, !motion.keys.isEmpty else { return framing }
    let scale = motion.keys.reduce(framing.scale) { max($0, $1.scale) }
    if scale == framing.scale { return framing }
    var out = framing
    out.scale = scale
    return out
}

// MARK: - quick moves

/// A move written in one tap — the first frame and the rest together, which
/// the needle then refines like any other. Named from the camera's side:
/// `panRight` is the view travelling right across the picture, `pushIn` the
/// camera moving closer.
public enum MotionPreset: String, CaseIterable, Sendable {
    case panLeft = "pan-left"
    case panRight = "pan-right"
    case panUp = "pan-up"
    case panDown = "pan-down"
    case pushIn = "push-in"
    case pullOut = "pull-out"
}

/// The web's `MOTION_PRESETS`, in the order the buttons are drawn.
public let motionPresets: [MotionPreset] = MotionPreset.allCases

/// How much closer a push or a pull goes.
public let presetZoom = 1.6

/// The least room a pan must have to be worth offering, as a share of the
/// frame's long edge: under it the picture would creep, not travel.
public let minPanShare = 0.02

/// A picture in its frame, in any consistent pixels — only the shapes matter.
public struct PictureBox: Equatable, Sendable {
    public var srcW: Double
    public var srcH: Double
    public var dstW: Double
    public var dstH: Double
    public init(srcW: Double, srcH: Double, dstW: Double, dstH: Double) {
        self.srcW = srcW; self.srcH = srcH; self.dstW = dstW; self.dstH = dstH
    }
}

/// A preset's write: the framing (the rest) and the motion that ends on it.
public struct PresetWrite: Equatable, Sendable {
    public var framing: Framing
    public var motion: FramingMotion
    public init(framing: Framing, motion: FramingMotion) { self.framing = framing; self.motion = motion }
}

/// How far a pan can travel each way from the middle, as a share of the
/// frame's long edge — the slack `framingTransform` measures at this zoom, in
/// the axes the framing stores its pan in.
private func panReach(_ framing: Framing, _ box: PictureBox) -> (x: Double, y: Double) {
    let t = framingTransform(box.srcW, box.srcH, box.dstW, box.dstH, framing)
    let unit = max(box.dstW, box.dstH)
    return unit > 0 ? (t.slackX / unit, t.slackY / unit) : (0, 0)
}

private func boxKnown(_ box: PictureBox?) -> Bool {
    guard let box else { return false }
    return box.srcW > 0 && box.srcH > 0 && box.dstW > 0 && box.dstH > 0
}

/// Why a preset cannot be written for this picture as it is framed, or nil
/// when it can. Said, never hidden: a pan across a picture with no room to
/// pan is a button that would do nothing.
public func presetProblem(_ preset: MotionPreset, _ framing: Framing, _ box: PictureBox?) -> String? {
    guard let box, boxKnown(box) else { return "The picture is still being read." }
    switch preset {
    case .panLeft, .panRight:
        return panReach(framing, box).x < minPanShare
            ? "No room to pan sideways at this zoom — zoom in, or use a picture wider than the frame."
            : nil
    case .panUp, .panDown:
        return panReach(framing, box).y < minPanShare
            ? "No room to pan up or down at this zoom — zoom in, or use a picture taller than the frame."
            : nil
    case .pullOut:
        return framing.scale * 1.01 >= maxFramingScale ? "The picture is already as close as it goes." : nil
    case .pushIn:
        return nil
    }
}

/// The framing at `scale`, about the middle of the frame.
private func zoomedAbout(_ framing: Framing, _ scale: Double, _ box: PictureBox) -> Framing {
    zoomFramingAbout(framing, scale, anchorX: box.dstW / 2, anchorY: box.dstH / 2, box.srcW, box.srcH, box.dstW, box.dstH)
}

/// Write `preset` over this picture: a fresh move of two frames, the curve
/// and the start of the motion it replaces kept. Nil when the preset has a
/// `presetProblem`.
///
/// - A PAN keeps the zoom the author composed and travels from one edge of
///   the real slack to the other — the rest moves to the far edge, since a
///   pan that ends where it started is no pan.
/// - A PUSH ends on the composition when there is room to start wider
///   (`presetZoom` back, never past covering); a picture composed at its
///   widest is pushed in on instead, the rest brought `presetZoom` closer
///   about the middle of the frame.
/// - A PULL starts `presetZoom` closer on the middle and ends on the
///   composition, untouched.
public func applyPreset(_ preset: MotionPreset, _ framing: Framing, _ motion: FramingMotion?, _ box: PictureBox?) -> PresetWrite? {
    guard let box, boxKnown(box), presetProblem(preset, framing, box) == nil else { return nil }
    let easing = motion?.easing ?? defaultMotionEasing
    let start = motion?.start ?? .slide
    let steps: Int? = motion?.easing == .steps ? motion?.steps : nil
    func moved(_ from: Framing, _ rest: Framing) -> PresetWrite {
        let key = FramingKey(at: 0, scale: from.scale, x: from.x, y: from.y)
        return PresetWrite(framing: rest, motion: FramingMotion(keys: [key], easing: easing, steps: steps, start: start))
    }

    switch preset {
    case .panLeft, .panRight, .panUp, .panDown:
        let reach = panReach(framing, box)
        // A positive pan moves the PICTURE right (or down), so the view is on
        // the picture's left (or top): travelling right means + to −.
        let sign: Double = preset == .panRight || preset == .panDown ? 1 : -1
        var from = framing
        var rest = framing
        if preset == .panLeft || preset == .panRight {
            from.x = sign * reach.x
            rest.x = -sign * reach.x
        } else {
            from.y = sign * reach.y
            rest.y = -sign * reach.y
        }
        return moved(from, rest)

    case .pullOut:
        return moved(zoomedAbout(framing, min(maxFramingScale, framing.scale * presetZoom), box), framing)

    case .pushIn:
        // Push in: from wider onto the composition when it can start wider.
        let wider = max(1, framing.scale / presetZoom)
        if framing.scale / wider >= 1.15 { return moved(zoomedAbout(framing, wider, box), framing) }
        return moved(framing, zoomedAbout(framing, min(maxFramingScale, framing.scale * presetZoom), box))
    }
}

// MARK: - the tour

/// A TOUR: the view visits points of the picture in order, at one zoom,
/// pausing at each — a panorama read spot by spot. It is written as ordinary
/// keys (a pause is two equal frames) whose last stop is the rest, so it needs
/// no field of its own, and a tour is READ BACK out of any motion's frames
/// (`tourOf`): every move is a sequence of stops.
public struct TourStop: Equatable, Sendable {
    /// A point of the picture, 0..1 of its width and height.
    public var x: Double
    public var y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
}

public struct TourPlan: Equatable, Sendable {
    public var stops: [TourStop]
    /// The zoom every stop is seen at.
    public var zoom: Double
    /// How long the view rests on each stop, in seconds.
    public var holdSeconds: Double
    public init(stops: [TourStop], zoom: Double, holdSeconds: Double) {
        self.stops = stops; self.zoom = zoom; self.holdSeconds = holdSeconds
    }
}

/// More stops than this and a slide becomes a slideshow of blurs.
public let maxTourStops = 8

/// The least a glide between two stops may take, in seconds, before the pauses give way.
public let minGlideSeconds = 0.35

/// The framing that looks at `stop` at `zoom` — the point in the middle of the
/// frame, or as near as the picture's edges allow: the pan goes through
/// `panBy`, which clamps, so a stop near an edge never opens a gap.
public func framingOn(_ framing: Framing, _ stop: TourStop, _ zoom: Double, _ box: PictureBox) -> Framing {
    var base = framing
    base.scale = clamp(zoom, 1, maxFramingScale)
    base.x = 0
    base.y = 0
    guard boxKnown(box) else { return base }
    let (px, py) = framePoint(stop.x * box.srcW, stop.y * box.srcH, box.srcW, box.srcH, box.dstW, box.dstH, base)
    return panBy(base, box.srcW, box.srcH, box.dstW, box.dstH, box.dstW / 2 - px, box.dstH / 2 - py)
}

/// The point of the picture in the middle of the frame, as a stop — where a
/// map of the whole picture draws a card's dot, and what `framingOn` brings
/// back to the middle at another zoom.
public func stopOf(_ framing: Framing, _ box: PictureBox) -> TourStop {
    let (sx, sy) = unframePoint(box.dstW / 2, box.dstH / 2, box.srcW, box.srcH, box.dstW, box.dstH, framing)
    return TourStop(x: clamp(sx / box.srcW, 0, 1), y: clamp(sy / box.srcH, 0, 1))
}

/// The part of the picture a framing shows, as four corners in 0..1 of the
/// picture — what a map of the whole picture outlines for each stop. Four
/// corners, not a rectangle: a turned picture shows a turned window.
public func framingWindow(_ framing: Framing, _ box: PictureBox) -> [Point] {
    guard boxKnown(box) else { return [] }
    let corners: [Point] = [Point(0, 0), Point(box.dstW, 0), Point(box.dstW, box.dstH), Point(0, box.dstH)]
    return corners.map { c in
        let (sx, sy) = unframePoint(c.x, c.y, box.srcW, box.srcH, box.dstW, box.dstH, framing)
        return Point(sx / box.srcW, sy / box.srcH)
    }
}

private func sameFrame(_ a: FramingKey, _ b: FramingKey) -> Bool {
    abs(a.scale - b.scale) < 1e-6 && abs(a.x - b.x) < 1e-6 && abs(a.y - b.y) < 1e-6
}

/// The motion's keys, or none — the web's `hasMotion(motion) ? motion.keys : []`.
private func keysOf(_ motion: FramingMotion?) -> [FramingKey] {
    guard let motion else { return [] }
    return motion.keys
}

/// Read a motion as a tour: its frames, the rest last, one stop per run of
/// equal frames; the zoom the rest is seen at; the first pause found, in
/// seconds of the span. With no motion, the tour is the one stop the picture
/// rests on. What a tour editor opens on, whoever wrote the frames.
public func tourOf(_ framing: Framing, _ motion: FramingMotion?, _ box: PictureBox?, _ spanSeconds: Double) -> TourPlan {
    var plan = TourPlan(stops: [], zoom: framing.scale, holdSeconds: 0)
    guard let box, boxKnown(box) else { return plan }
    let frames = keysOf(motion) + [restKey(framing)]
    for i in 1..<frames.count {
        let prev = frames[i - 1]
        let f = frames[i]
        // `!plan.holdSeconds` on the web: the first pause found sets it.
        let unset = plan.holdSeconds == 0 || plan.holdSeconds.isNaN
        if sameFrame(prev, f) && unset {
            plan.holdSeconds = (f.at - prev.at) * max(0, spanSeconds)
        }
    }
    plan.stops = tourFrames(framing, motion).map { stopOf($0, box) }
    return plan
}

/// The frames a motion stops on, in order, the rest last — one per run of
/// equal frames. What a map of the picture outlines, as they really are
/// (each at its own zoom), rather than as a rewrite would make them.
public func tourFrames(_ framing: Framing, _ motion: FramingMotion?) -> [Framing] {
    let frames = keysOf(motion) + [restKey(framing)]
    var out: [Framing] = []
    for (i, f) in frames.enumerated() where i == 0 || !sameFrame(frames[i - 1], f) {
        out.append(keyFraming(framing, f))
    }
    return out
}

/// Write a tour over the picture: the first stop at the start, the last at
/// the rest, each held `holdSeconds`, the glides between them sharing what is
/// left of the span by how far each travels — so the view keeps one pace
/// rather than rushing the long hops. A span too short for the pauses shrinks
/// them before any glide drops under `minGlideSeconds`. One stop is no move
/// at all: the picture rests on it. Easing and start are kept.
public func tourMotion(_ framing: Framing, _ motion: FramingMotion?, _ plan: TourPlan, _ box: PictureBox?, _ spanSeconds: Double) -> FramingWrite? {
    guard let box, boxKnown(box), !plan.stops.isEmpty else { return nil }
    let stops = plan.stops.prefix(maxTourStops).map { framingOn(framing, $0, plan.zoom, box) }
    let rest = stops[stops.count - 1]
    if stops.count == 1 { return FramingWrite(framing: rest, motion: nil) }

    let span = max(0.1, spanSeconds)
    let hops = stops.count - 1
    let count = Double(stops.count)
    var hold = max(0, plan.holdSeconds.isFinite ? plan.holdSeconds : 0)
    let glideFloor = min(minGlideSeconds, span / Double(hops))
    if span - count * hold < Double(hops) * glideFloor {
        hold = max(0, (span - Double(hops) * glideFloor) / count)
    }
    let glideTotal = max(0, span - count * hold)
    // How far each hop travels on screen, the zoom being the same at both ends.
    var reach: [Double] = []
    for i in 0..<hops {
        let a = stops[i]
        let b = stops[i + 1]
        reach.append(hypot(b.x - a.x, b.y - a.y) + 1e-3)
    }
    let total = reach.reduce(0, +)

    var keys: [FramingKey] = []
    func push(_ seconds: Double, _ f: Framing) {
        let at = seconds / span
        if at < lastAt { keys.append(FramingKey(at: at, scale: f.scale, x: f.x, y: f.y)) }
    }
    var t = 0.0
    for (i, stop) in stops.enumerated() {
        push(t, stop)
        if i < hops {
            if hold > 0 { push(t + hold, stop) }
            t += hold + (glideTotal * reach[i]) / total
        }
    }
    // The last stop's pause runs to the end of the span, where the rest sits:
    // its arrival was pushed above, and a stop reached at the very end has none.
    var restFraming = framing
    restFraming.scale = rest.scale
    restFraming.x = rest.x
    restFraming.y = rest.y
    return FramingWrite(
        framing: restFraming,
        motion: FramingMotion(
            keys: sortKeys(keys),
            easing: motion?.easing ?? defaultMotionEasing,
            steps: motion?.easing == .steps ? motion?.steps : nil,
            start: motion?.start ?? .slide
        )
    )
}

/// Where the view ARRIVES at each distinct frame, in the slide's seconds —
/// what «previous / next frame» steps through. A pause is two equal frames,
/// and stepping onto the end of one would show nothing new.
public func arrivalMarks(_ framing: Framing, _ motion: FramingMotion?, _ seconds: Double, _ openerSeconds: Double = 0) -> [Double] {
    guard let motion, !motion.keys.isEmpty else { return [] }
    let frames = motion.keys + [restKey(framing)]
    var out: [Double] = []
    for (i, f) in frames.enumerated() where i == 0 || !sameFrame(frames[i - 1], f) {
        out.append(keySeconds(motion, f.at, seconds, openerSeconds))
    }
    return out
}
