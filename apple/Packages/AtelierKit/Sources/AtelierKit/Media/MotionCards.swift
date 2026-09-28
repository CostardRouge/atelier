// A picture's motion as CARDS — the frames the view rests on, in order, the
// last being the composition the picture comes to rest on. Port of
// `src/shared/media/motion-cards.ts`.
//
// `FramingMotion.swift` stores a move as keys at instants; this module reads
// those keys as a row of frames one can SEE and edit one at a time, which is
// how the editor shows them since 2026-09-24 (`docs/picture-motion-ui.md`):
// a tap picks a card, a drag or a pinch on the stage writes THAT card and
// never another, `+` adds one after it, and the time between cards is not
// placed by hand but shared — the tour's own arithmetic, generalised to a
// zoom per card. Nothing here is a second storage: a card row is read out of
// any motion and written back as ordinary keys, so the two can never drift.
//
// Rules the shape keeps:
//
// - **The last card IS the framing.** `readCards` returns the composition as
//   its last card and `cardsMotion` writes the last card into `framing`.
// - **One card = one run of equal frames.** A pause is two equal keys, so a
//   card whose view holds is still one card; `holdSeconds` is the first pause
//   found, and the ONE pause every card shares when written back.
// - **Editing a card keeps its instants.** `writeCard` replaces the pan and
//   zoom of that card's frames in place; only adding or taking off a card, or
//   changing the pause, re-shares the time.

import Foundation

/// The frames a motion rests on, in order, the last being the composition.
public struct MotionCards: Equatable, Sendable {
    public var cards: [Framing]
    /// How long the view holds on each card, in seconds; 0 when it never does.
    public var holdSeconds: Double
    public init(cards: [Framing], holdSeconds: Double) { self.cards = cards; self.holdSeconds = holdSeconds }
}

/// A card row's write that also says which card to pick next.
public struct CardWrite: Equatable, Sendable {
    public var framing: Framing
    public var motion: FramingMotion?
    public var selected: Int
    public init(framing: Framing, motion: FramingMotion?, selected: Int) {
        self.framing = framing; self.motion = motion; self.selected = selected
    }
}

/// More cards than this and a slide becomes a slideshow of blurs.
public let maxCards = maxTourStops

/// How much of a pan a doubling of the zoom counts for, as a share of the
/// frame's long edge, when the glides between cards share the slide's time by
/// how far each travels. A push from ×1 to ×2 reads about as long as a pan
/// across a third of the frame.
public let zoomTravel = 0.35

/// How much closer a card ADDED beside another starts: a copy would be read
/// back as a pause (two equal frames are one card), so the new card is a
/// touch closer on the same point — enough to be its own frame, too little to
/// change what the author composed. Said on the stage, never silent.
public let insertZoom = 1.08

/// The latest a key may sit: at 1 it would be the rest.
private let lastAt = 0.999

private func sameFrame(_ a: FramingKey, _ b: FramingKey) -> Bool {
    abs(a.scale - b.scale) < 1e-6 && abs(a.x - b.x) < 1e-6 && abs(a.y - b.y) < 1e-6
}

/// Keys in time order, one per instant — a later write at the same `at` wins.
private func sortKeys(_ keys: [FramingKey]) -> [FramingKey] {
    var byAt: [Double: FramingKey] = [:]
    for key in keys { byAt[key.at] = key }
    return byAt.values.sorted { $0.at < $1.at }
}

/// The rest, as a key at the end of the span.
private func restKey(_ framing: Framing) -> FramingKey {
    FramingKey(at: 1, scale: framing.scale, x: framing.x, y: framing.y)
}

/// `framing` with the pan and zoom of `placed` — the web's `{ ...framing, ...placedOf(f) }`.
private func placing(_ framing: Framing, _ placed: Framing) -> Framing {
    var out = framing
    out.scale = placed.scale
    out.x = placed.x
    out.y = placed.y
    return out
}

/// Read a motion as its cards: one per run of equal frames, the rest last, and
/// the first pause found as the hold. A picture that holds still is one card,
/// the composition. What the row draws, whoever wrote the frames.
public func readCards(_ framing: Framing, _ motion: FramingMotion?, _ spanSeconds: Double) -> MotionCards {
    let cards = tourFrames(framing, motion)
    var holdSeconds = 0.0
    if let motion, !motion.keys.isEmpty {
        let frames = motion.keys + [restKey(framing)]
        for i in 1..<frames.count where sameFrame(frames[i - 1], frames[i]) {
            holdSeconds = (frames[i].at - frames[i - 1].at) * max(0, spanSeconds)
            break
        }
    }
    return MotionCards(cards: cards, holdSeconds: holdSeconds)
}

/// What a card is called: the first is where the move starts, the last where it ends.
public func cardLabel(_ index: Int, _ count: Int) -> String {
    if count <= 1 { return "Composition" }
    if index <= 0 { return "Start" }
    if index >= count - 1 { return "End" }
    return "Stop \(index + 1)"
}

/// How far the view travels from one card to the next, in shares of the frame's
/// long edge: the pan's own distance (it is stored in those units) plus the
/// zoom's, a doubling counting for `zoomTravel`. Never 0, so a hop between two
/// cards that differ in nothing measurable still takes a moment.
private func travel(_ a: Framing, _ b: Framing) -> Double {
    let zoom = abs(log2(max(b.scale, 1e-6) / max(a.scale, 1e-6))) * zoomTravel
    return hypot(b.x - a.x, b.y - a.y) + zoom + 1e-3
}

/// Write a row of cards over the picture: the first at the start, the last as
/// the rest, each held `holdSeconds`, the glides between them sharing what is
/// left of the span by how far each travels — one pace, never a rush over the
/// long hops. A span too short for the pauses shrinks them before any glide
/// drops under `minGlideSeconds`. One card is no move at all: the picture
/// rests on it. Rotation, mirror and fit are the framing's; easing and start
/// are kept from the motion being rewritten.
public func cardsMotion(_ framing: Framing, _ motion: FramingMotion?, _ cards: [Framing], _ holdSeconds: Double, _ spanSeconds: Double) -> FramingWrite? {
    let stops = Array(cards.prefix(maxCards))
    guard !stops.isEmpty else { return nil }
    let rest = stops[stops.count - 1]
    let restFraming = placing(framing, rest)
    if stops.count == 1 { return FramingWrite(framing: restFraming, motion: nil) }

    let span = max(0.1, spanSeconds)
    let hops = stops.count - 1
    let count = Double(stops.count)
    var hold = max(0, holdSeconds.isFinite ? holdSeconds : 0)
    let glideFloor = min(minGlideSeconds, span / Double(hops))
    if span - count * hold < Double(hops) * glideFloor {
        hold = max(0, (span - Double(hops) * glideFloor) / count)
    }
    let glideTotal = max(0, span - count * hold)
    var reach: [Double] = []
    for i in 0..<hops { reach.append(travel(stops[i], stops[i + 1])) }
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

/// The keys of each card, as runs of indices into `motion.keys`; the rest is
/// index `keys.count`. One run per card, in order.
private func cardRuns(_ motion: FramingMotion, _ framing: Framing) -> [[Int]] {
    let frames = motion.keys + [restKey(framing)]
    var runs: [[Int]] = []
    for (i, f) in frames.enumerated() {
        if i > 0 && sameFrame(frames[i - 1], f) {
            runs[runs.count - 1].append(i)
        } else {
            runs.append([i])
        }
    }
    return runs
}

/// Reframe ONE card: its frames take the gesture's pan and zoom, at the
/// instants they already have; rotation, mirror and fit go to the rest, since
/// they belong to the picture at every instant. With no motion this is the
/// plain write it always was. An index past the row writes nothing.
public func writeCard(_ framing: Framing, _ motion: FramingMotion?, _ index: Int, _ next: Framing) -> FramingWrite {
    guard let motion, !motion.keys.isEmpty else { return FramingWrite(framing: next, motion: nil) }
    var shared = framing
    shared.rotation = next.rotation
    shared.flipX = next.flipX
    shared.flipY = next.flipY
    shared.fit = next.fit
    let runs = cardRuns(motion, framing)
    guard index >= 0, index < runs.count else { return FramingWrite(framing: framing, motion: motion) }
    let run = runs[index]
    let restIndex = motion.keys.count
    var m = motion
    for i in m.keys.indices where run.contains(i) {
        m.keys[i].scale = next.scale
        m.keys[i].x = next.x
        m.keys[i].y = next.y
    }
    let isRest = run.contains(restIndex)
    return FramingWrite(framing: isRest ? placing(shared, next) : shared, motion: m)
}

/// Add a card after `after` — before the rest when the rest is the one
/// selected, since the last card is where the picture ends — as a copy of it
/// pushed `insertZoom` closer on the same point (out, when it is already as
/// close as it goes). Nil past `maxCards`.
public func insertCard(_ framing: Framing, _ motion: FramingMotion?, _ cards: [Framing], _ holdSeconds: Double, _ spanSeconds: Double, _ after: Int) -> CardWrite? {
    let n = cards.count
    if n == 0 || n >= maxCards { return nil }
    let from = min(max(after, 0), n - 1)
    let at = from >= n - 1 ? n - 1 : from + 1
    let source = cards[from]
    let closer = source.scale * insertZoom <= maxFramingScale ? insertZoom : 1 / insertZoom
    let k = clamp(source.scale * closer, 1, maxFramingScale) / max(source.scale, 1e-6)
    var copy = source
    copy.scale = source.scale * k
    copy.x = source.x * k
    copy.y = source.y * k
    var next = cards
    next.insert(copy, at: at)
    guard let out = cardsMotion(framing, motion, next, holdSeconds, spanSeconds) else { return nil }
    return CardWrite(framing: out.framing, motion: out.motion, selected: at)
}

/// Take a card off. The last cannot go — it is the picture's framing — and the
/// last card taken off before it leaves no motion at all.
public func removeCard(_ framing: Framing, _ motion: FramingMotion?, _ cards: [Framing], _ holdSeconds: Double, _ spanSeconds: Double, _ index: Int) -> CardWrite? {
    let n = cards.count
    if n < 2 || index < 0 || index >= n - 1 { return nil }
    var next = cards
    next.remove(at: index)
    guard let out = cardsMotion(framing, motion, next, holdSeconds, spanSeconds) else { return nil }
    return CardWrite(framing: out.framing, motion: out.motion, selected: min(index, next.count - 1))
}

/// The card the needle is on: the one whose arrival (`arrivalMarks`, one per
/// card) lies within `snapSeconds` of `local`, the nearest winning; the last
/// card also owns everything from its arrival to the end of the slide, where
/// the picture rests. Nil between two cards.
public func cardAtNeedle(_ arrivals: [Double], _ local: Double, _ snapSeconds: Double) -> Int? {
    let n = arrivals.count
    if n == 0 { return nil }
    if local >= arrivals[n - 1] - snapSeconds { return n - 1 }
    var best: Int? = nil
    var gap = Double.infinity
    for (i, a) in arrivals.enumerated() {
        let d = abs(a - local)
        if d <= snapSeconds && d < gap {
            best = i
            gap = d
        }
    }
    return best
}
