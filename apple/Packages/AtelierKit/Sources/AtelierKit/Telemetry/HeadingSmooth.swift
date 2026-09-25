// Smoothing and gap-bridging for the reconstructed heading. Port of
// `src/shared/telemetry/heading-smooth.ts`; reads the cues `Telemetry.swift`
// parses and the motion it attaches.
//
// Why the heading is jumpy, and why it disappears: the `.srt` carries no
// compass and no yaw, so the heading shown is COURSE OVER GROUND, the azimuth
// between two GPS fixes about a second apart (`attachMotion`). It steps,
// because the GPS refreshes a few times a second while the overlay renders at
// 30–60 fps; and it vanishes whenever horizontal travel over the window drops
// below a metre — hovering, creeping, yawing on the spot — because below that
// floor there is no direction to report, only GPS noise. Lowering the floor
// would trade a gap for a weathervane. What helps is averaging over a window,
// and the same window bridges the short gaps for free, because it still holds
// older cues that DID have a reading.
//
// Two rules this keeps (`docs/memory/studio.md`):
//
// 1. It is a pure function of `(cues, time)`, never an accumulator over
//    rendered frames. The preview and the export do not render at the same
//    cadence; a filter fed frame by frame would drift between them, and the
//    burned-in overlay would not match what was on screen.
// 2. The average is CIRCULAR — unit vectors, not degrees. Averaging 350° and
//    10° arithmetically gives 180°, pointing exactly backwards.

import Foundation

public struct SmoothedHeading: Equatable, Sendable {
    /// The eased bearing in `[0, 360)`, or nil when nothing is in reach.
    public var heading: Double?
    /// Seconds since the newest real reading; 0 while data is live.
    public var age: Double
    /// 1 while readings are arriving, falling to 0 across the hold window once
    /// they stop. Renderers fade with it rather than cutting out.
    public var confidence: Double

    public init(heading: Double?, age: Double, confidence: Double) {
        self.heading = heading
        self.age = age
        self.confidence = confidence
    }

    /// The web's `NO_HEADING`.
    public static let noHeading = SmoothedHeading(heading: nil, age: 0, confidence: 0)
}

private let deg2rad = Double.pi / 180
/// Weights below this add nothing visible; stop walking there.
private let negligible = 0.02
/// Never walk back more than this, whatever the time constant.
private let maxWindowS = 12.0

/// The eased heading at `timeSeconds`.
///
/// - `tauSeconds`: easing time constant. 0 disables smoothing and returns the
///   newest reading as-is.
/// - `holdSeconds`: how long a stale reading keeps being reported after the
///   data stops, with `confidence` decaying across it.
/// - `early`: accept the look-ahead readings of the opening window
///   (`Cue.lead`) so the instrument is already pointing on the clip's first
///   frame instead of waiting a second for its first backward measurement.
///   Default on; `false` is the strictly backward-looking behaviour.
public func smoothHeading(_ cues: [Cue], _ timeSeconds: Double, tauSeconds: Double = 0.6,
                          holdSeconds: Double = 2, early: Bool = true) -> SmoothedHeading {
    if cues.isEmpty { return .noHeading }
    let start = lastIndexAtOrBefore(cues, timeSeconds)
    if start < 0 { return .noHeading }

    let tau = max(0, tauSeconds)
    let hold = max(0, holdSeconds)
    let now = cues[start].start
    let reach = min(maxWindowS, tau > 0 ? tau * 4 : 0)

    var sx = 0.0
    var sy = 0.0
    var weight = 0.0
    var newest: Double? = nil
    var newestAt = 0.0

    var i = start
    while i >= 0 {
        let cue = cues[i]
        i -= 1
        let dt = now - cue.start
        if dt > max(reach, hold) { break }
        // Read the field directly rather than through `motionAt`: this loop
        // runs per rendered frame over up to a 12 s window, and a value per
        // cue is a needless allocation.
        let backward = cue.derived?.heading
        let ahead = early ? cue.lead?.heading : nil
        guard let h = backward ?? ahead else { continue }

        if newest == nil {
            newest = h
            newestAt = cue.start
        }
        // Only cues inside the easing window feed the average; the ones beyond
        // it exist solely to answer "when did we last know anything".
        if dt <= reach {
            let w = tau > 0 ? exp(-dt / tau) : 1
            if w < negligible { continue }
            sx += sin(h * deg2rad) * w
            sy += cos(h * deg2rad) * w
            weight += w
        }
        if tau == 0 { break } // Unsmoothed: the newest reading is the answer.
    }

    guard let newest else { return .noHeading }
    let age = max(0, timeSeconds - newestAt)

    // Nothing inside the easing window: we are in a gap, holding the last
    // known bearing while its confidence runs out.
    if weight == 0 || tau == 0 {
        let confidence: Double
        if hold > 0 {
            confidence = max(0, 1 - age / hold)
        } else {
            confidence = age > 0 ? 0 : 1
        }
        return SmoothedHeading(heading: newest, age: age, confidence: confidence)
    }

    let degrees = atan2(sx, sy) / deg2rad + 360
    let mean = degrees.truncatingRemainder(dividingBy: 360)
    // A gap inside the window still counts against confidence: the average is
    // real, but it is being carried by increasingly old samples.
    let confidence = hold > 0 ? max(0, min(1, 1 - age / hold)) : 1
    return SmoothedHeading(heading: mean, age: age, confidence: confidence)
}
