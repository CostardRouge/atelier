// The easings the hook variants share — the openers' NAMES for curves that
// live in the one registry (`Motion/Easing.swift`, which the overlay engine
// reads too). Port of `src/shared/roadtrip/hooks/easing.ts`.
//
// The ids here are the ones stored in every Défilé, Itinerary and Virée
// option, so they stay as aliases with the web's raw strings; the labels and
// hints are the openers' own words (a head "settles" on today, a pen
// "brakes").
//
// A variant that moves places its stops on the INVERSE of the chosen curve and
// glides on the curve itself, so a stop is reached EXACTLY at its time rather
// than near it — which is why every curve offered here has a closed-form
// inverse and why nothing is bisected.

import Foundation

/// The case order is the web's key order (`EASING_IDS`).
public enum HookEasing: String, CaseIterable, Codable, Sendable {
    case easeOut = "ease-out"
    case easeOutHard = "ease-out-hard"
    case linear
    case easeIn = "ease-in"
    case easeInOut = "ease-in-out"
}

/// Which registry curve each opener id stands for. The web's `HOOK_EASING_CURVE`.
public let hookEasingCurve: [HookEasing: EasingId] = [
    .easeOut: .outCubic,
    .easeOutHard: .outExpo,
    .linear: .linear,
    .easeIn: .inCubic,
    .easeInOut: .inOutCubic,
]

/// An opener's curve: its words, the curve and the inverse a stop placement
/// needs. `u` and `p` are both 0..1; every curve is monotonic, starts at 0 and
/// ends at 1, so `inverse(ease(u)) == u` to floating precision.
public struct HookEasingSpec: Sendable {
    public let label: String
    public let hint: String
    public let ease: @Sendable (_ u: Double) -> Double
    public let inverse: @Sendable (_ p: Double) -> Double
}

private let hookEasingWords: [HookEasing: (label: String, hint: String)] = [
    .easeOut: ("Settle", "Fast off the start, coming to rest on today"),
    .easeOutHard: ("Brake", "A hard stop — most of the trip goes by in the first half-second"),
    .linear: ("Even", "Every day takes the same time — a metronome, not a mechanism"),
    .easeIn: ("Wind up", "Slow to leave, arriving at speed"),
    .easeInOut: ("Glide", "Slow to leave and slow to arrive"),
]

/// The curves a moving opener may travel on — the scrub's head, the route's
/// pen — keyed by opener id. The web's `EASINGS`; like the web (which throws
/// at import), a registry curve without an inverse is a build fault, not a
/// document's.
public let hookEasings: [HookEasing: HookEasingSpec] = Dictionary(uniqueKeysWithValues: HookEasing.allCases.map { id in
    let curve = curveOf(hookEasingCurve[id] ?? .linear)
    guard let inverse = curve.inverse else { preconditionFailure("hook easing \(id.rawValue) needs an invertible curve") }
    let words = hookEasingWords[id] ?? (id.rawValue, "")
    let at = curve.at
    return (id, HookEasingSpec(label: words.label, hint: words.hint, ease: { u in at(u, nil) }, inverse: inverse))
})

/// Every opener id, in the web's order. The web's `EASING_IDS`.
public let hookEasingIds: [HookEasing] = HookEasing.allCases
