// Pure summary of a parsed telemetry track. Port of
// `src/shared/telemetry/telemetry-summary.ts`, derived entirely from the
// parser's `[Cue]`.
//
// `colorProfile` carries the SRT's `color_md` (`dlog_m` on a D-Log clip) —
// the one fact a "this clip is HLG; we work in SDR" notice would read.

import Foundation

public struct TelemetrySummary: Equatable, Sendable {
    /// Number of cues (≈ frames of telemetry).
    public var cueCount: Int
    /// Min/max relative altitude in metres, or nil if no rel_alt present.
    public var relAltMin: Double?
    public var relAltMax: Double?
    /// Coordinates of the first cue that has them, as raw strings.
    public var startLatitude: String?
    public var startLongitude: String?
    /// Color profile (color_md) of the first cue that has one.
    public var colorProfile: String?

    public init(cueCount: Int, relAltMin: Double?, relAltMax: Double?,
                startLatitude: String?, startLongitude: String?, colorProfile: String?) {
        self.cueCount = cueCount
        self.relAltMin = relAltMin
        self.relAltMax = relAltMax
        self.startLatitude = startLatitude
        self.startLongitude = startLongitude
        self.colorProfile = colorProfile
    }
}

/// Parse a numeric field defensively; nil on missing, empty or NaN.
private func number(_ value: String?) -> Double? {
    guard let value, !value.isEmpty, let n = Double(value), n.isFinite else { return nil }
    return n
}

/// Compute a lightweight summary from parsed cues. Returns a zeroed summary
/// for an empty track rather than throwing.
public func summarizeTelemetry(_ cues: [Cue]) -> TelemetrySummary {
    var relAltMin: Double? = nil
    var relAltMax: Double? = nil
    var startLatitude: String? = nil
    var startLongitude: String? = nil
    var colorProfile: String? = nil

    for cue in cues {
        if let rel = number(cue.data["rel_alt"]) {
            relAltMin = relAltMin.map { min($0, rel) } ?? rel
            relAltMax = relAltMax.map { max($0, rel) } ?? rel
        }
        if startLatitude == nil, let lat = cue.data["latitude"] { startLatitude = lat }
        if startLongitude == nil, let lon = cue.data["longitude"] { startLongitude = lon }
        if colorProfile == nil, let profile = cue.data["color_md"] { colorProfile = profile }
    }

    return TelemetrySummary(cueCount: cues.count, relAltMin: relAltMin, relAltMax: relAltMax,
                            startLatitude: startLatitude, startLongitude: startLongitude,
                            colorProfile: colorProfile)
}
