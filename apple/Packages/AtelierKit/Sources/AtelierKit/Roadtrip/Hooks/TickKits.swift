// The tick kits the hook variants share — which voices a landing, a leg's
// landing and the seat are played on, and how a pitch may drift along a run.
// Port of `src/shared/roadtrip/hooks/tick-kits.ts`.
//
// Grown in the scrub (Défilé), lifted out when the route's pen wanted to tick
// at the places it reaches; the map and the drive read it too. A kit is a
// stored option (`'ratchet'` …), so its raw values are the web's words. The
// voices themselves are `Audio/Voices.swift`.

import Foundation

public enum TickKit: String, CaseIterable, Codable, Sendable {
    case ratchet, wood, typewriter, click
}

/// How a run of ticks' pitch moves from its first to its last.
public enum TickDrift: String, CaseIterable, Sendable {
    case flat, rising, falling
}

/// How a LEG's landing departs from the ordinary one.
public struct TickKitLeg: Equatable, Sendable {
    public var voice: VoiceName
    public var rate: Double
    public var gain: Double
}

/// A kit: the ordinary landing, how a LEG's landing departs from it (the one
/// sound carrying meaning, so the one that is different: lower and a little
/// louder), and the seat — which stays the seat in every kit, because it is
/// the end of the phrase rather than a tick.
public struct TickKitSpec: Equatable, Sendable {
    public var label: String
    public var hint: String
    public var tick: VoiceName
    public var leg: TickKitLeg
    public var seat: VoiceName
}

extension TickKit {
    public var spec: TickKitSpec {
        switch self {
        case .ratchet:
            return TickKitSpec(label: "Ratchet",
                               hint: "A mechanism — a narrow click, a deeper one where a leg starts",
                               tick: .detent, leg: TickKitLeg(voice: .leg, rate: 1, gain: 1), seat: .seat)
        case .wood:
            return TickKitSpec(label: "Woodblock",
                               hint: "Warmer knocks, a low one where a leg starts",
                               tick: .wood, leg: TickKitLeg(voice: .wood, rate: 0.67, gain: 1.3), seat: .seat)
        case .typewriter:
            return TickKitSpec(label: "Typewriter",
                               hint: "A key strike a day, a heavier one where a leg starts",
                               tick: .typewriter, leg: TickKitLeg(voice: .typewriter, rate: 0.7, gain: 1.3), seat: .seat)
        case .click:
            return TickKitSpec(label: "Shutter",
                               hint: "A soft camera click a day",
                               tick: .click, leg: TickKitLeg(voice: .click, rate: 0.6, gain: 1.3), seat: .seat)
        }
    }
}

/// The voices a variant's ticks may be played on — the web's `TICK_KITS`.
public let tickKits: [TickKit: TickKitSpec] =
    Dictionary(uniqueKeysWithValues: TickKit.allCases.map { ($0, $0.spec) })

/// The kits in the web's order (`Object.keys(TICK_KITS)`).
public let kitIds: [TickKit] = TickKit.allCases

public struct DriftSpan: Equatable, Sendable {
    public var from: Double
    public var to: Double
}

/// How far the pitch travels along a drifting sweep: ×0.84 at one end to
/// ×1.19 at the other, about three semitones each way — audible as a climb or
/// a fall, small enough that every tick still reads as the same instrument.
public let driftSpan = DriftSpan(from: 0.84, to: 1.19)

/// The pitch factor at `share` (0..1) of the way along the sweep. A NaN share
/// stays NaN on a drifting sweep, as JavaScript's `Math.min`/`Math.max` leave it.
public func driftAt(_ drift: TickDrift, _ share: Double) -> Double {
    let u = share.isNaN ? share : max(0, min(1, share))
    switch drift {
    case .rising: return driftSpan.from + (driftSpan.to - driftSpan.from) * u
    case .falling: return driftSpan.to - (driftSpan.to - driftSpan.from) * u
    case .flat: return 1
    }
}
