// ONE registry of the curves motion travels on — the overlay engine's element
// animations and the openers' moving heads both read it, and a picture's
// motion (`FramingMotion.swift`) glides on it. Port of
// `src/shared/motion/easing.ts`.
//
// Three rules the consumers depend on:
//
// - every curve starts at 0 and ends at 1;
// - a curve that has a CLOSED-FORM inverse says so, and is then monotonic. A
//   moving opener places its stops on the inverse and glides on the curve, so
//   a stop is reached exactly at its time; it may only offer `invertibleEasings`;
// - a curve that OVERSHOOTS (back, spring) goes past 1 on the way to rest: a
//   scale or an offset follows it, an opacity clamps. It has no inverse and
//   is for entrances and exits, never for a head that must land on a day.
//
// `steps` moves in jumps — stop-motion, the one curve that takes a number.
//
// The ids are STORED in documents (`FramingMotion.easing`, an overlay step's
// easing), so each raw string matches the web's byte for byte. The web's
// `Curve` interface is `EasingCurve` here: the kernel already calls a tone
// curve `Curve` (`Curves.swift`).

import Foundation

public enum EasingId: String, CaseIterable, Codable, Sendable {
    case linear
    case `in`
    case out
    case inOut = "in-out"
    case inCubic = "in-cubic"
    case outCubic = "out-cubic"
    case inOutCubic = "in-out-cubic"
    case outExpo = "out-expo"
    case back
    case spring
    case steps
}

public struct EasingCurve: Sendable {
    public let id: EasingId
    public let label: String
    /// Eased progress for `t` in 0..1. May exceed 1 on an overshooting curve.
    /// `steps` only matters to the stepped curve.
    public let at: @Sendable (_ t: Double, _ steps: Int?) -> Double
    /// The closed-form inverse, when the curve has one: `inverse(at(u)) == u`.
    public let inverse: (@Sendable (_ p: Double) -> Double)?
    /// Goes past 1 before it rests.
    public let overshoots: Bool
    /// Takes a step count.
    public let stepped: Bool

    fileprivate init(_ id: EasingId, _ label: String,
                     at: @escaping @Sendable (Double, Int?) -> Double,
                     inverse: (@Sendable (Double) -> Double)? = nil,
                     overshoots: Bool = false, stepped: Bool = false) {
        self.id = id; self.label = label; self.at = at; self.inverse = inverse
        self.overshoots = overshoots; self.stepped = stepped
    }
}

/// `out-expo` is normalised so the curve really reaches 1 at t = 1.
private let expoTail = 1 - pow(2.0, -10.0)

public let defaultSteps = 4
public let minSteps = 2
public let maxSteps = 12

/// JavaScript's `Math.round`: halves go toward +∞, never away from zero.
private func roundHalfUp(_ v: Double) -> Double {
    let down = v.rounded(.down)
    return v - down >= 0.5 ? down + 1 : down
}

/// A step count read out of anything.
public func clampSteps(_ n: Double?) -> Int {
    guard let n, n.isFinite else { return defaultSteps }
    let rounded = roundHalfUp(n)
    return Int(min(Double(maxSteps), max(Double(minSteps), rounded)))
}

/// `clampSteps` over a count the document already holds as an integer.
public func clampSteps(_ n: Int?) -> Int {
    clampSteps(n.map(Double.init))
}

private let curveList: [EasingCurve] = [
    EasingCurve(.linear, "Linear", at: { t, _ in t }, inverse: { p in p }),
    EasingCurve(.in, "In", at: { t, _ in t * t }, inverse: { p in p.squareRoot() }),
    EasingCurve(.out, "Out", at: { t, _ in 1 - (1 - t) * (1 - t) }, inverse: { p in 1 - (1 - p).squareRoot() }),
    EasingCurve(.inOut, "In-out",
                at: { t, _ in t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t) },
                inverse: { p in p < 0.5 ? (p / 2).squareRoot() : 1 - ((1 - p) / 2).squareRoot() }),
    EasingCurve(.inCubic, "In cubic", at: { t, _ in pow(t, 3.0) }, inverse: { p in cbrt(p) }),
    EasingCurve(.outCubic, "Out cubic", at: { t, _ in 1 - pow(1 - t, 3.0) }, inverse: { p in 1 - cbrt(1 - p) }),
    EasingCurve(.inOutCubic, "In-out cubic",
                at: { t, _ in t < 0.5 ? 4 * pow(t, 3.0) : 1 - pow(-2 * t + 2, 3.0) / 2 },
                // Upper half: p = 1 − (2 − 2t)³ / 2  ⇒  2 − 2t = ∛(2(1 − p)).
                inverse: { p in p < 0.5 ? cbrt(p / 4) : 1 - cbrt(2 * (1 - p)) / 2 }),
    EasingCurve(.outExpo, "Out expo",
                at: { t, _ in t >= 1 ? 1 : (1 - pow(2.0, -10 * t)) / expoTail },
                inverse: { p in -log2(1 - p * expoTail) / 10 }),
    // The classic ease-out-back: overshoots by ~10% then settles.
    EasingCurve(.back, "Back", at: { t, _ in
        let c1 = 1.70158
        let c3 = c1 + 1
        return 1 + c3 * pow(t - 1, 3.0) + c1 * pow(t - 1, 2.0)
    }, overshoots: true),
    // A damped oscillation that has died out by t = 1.
    EasingCurve(.spring, "Spring", at: { t, _ in t >= 1 ? 1 : 1 - exp(-6.5 * t) * cos(13 * t) }, overshoots: true),
    EasingCurve(.steps, "Steps", at: { t, steps in
        let n = Double(clampSteps(steps))
        return t >= 1 ? 1 : (t * n).rounded(.down) / n
    }, stepped: true),
]

/// The registry, keyed by id. The web's `CURVES`.
public let easingCurves: [EasingId: EasingCurve] = Dictionary(uniqueKeysWithValues: curveList.map { ($0.id, $0) })

/// Every id, in the registry's own order. The web's `EASING_IDS`.
public let easingIds: [EasingId] = EasingId.allCases

/// The curves a stop can be placed on exactly. The web's `INVERTIBLE`.
public let invertibleEasings: [EasingId] = easingIds.filter { easingCurves[$0]?.inverse != nil }

public func isEasingId(_ id: String?) -> Bool {
    guard let id else { return false }
    return EasingId(rawValue: id) != nil
}

/// The curve for an id; an id this build does not know eases linearly rather than throwing.
public func curveOf(_ id: String) -> EasingCurve {
    curveOf(EasingId(rawValue: id) ?? .linear)
}

public func curveOf(_ id: EasingId) -> EasingCurve {
    // Every case is in `curveList`; a registry that missed one is a build error, not a document's.
    easingCurves[id] ?? easingCurves[.linear]!
}

/// Eased progress, `p` clamped to 0..1 first. `steps` only matters to the stepped curve.
public func easeAt(_ id: String, _ p: Double, _ steps: Int? = nil) -> Double {
    curveOf(id).at(clamp01(p), steps)
}

public func easeAt(_ id: EasingId, _ p: Double, _ steps: Int? = nil) -> Double {
    curveOf(id).at(clamp01(p), steps)
}
