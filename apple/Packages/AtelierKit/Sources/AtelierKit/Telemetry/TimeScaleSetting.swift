// How a PROJECT answers "what cadence is this clip?" — the setting half of
// `src/shared/telemetry/time-scale.ts` (`TimeScaleSetting`, `AUTO_TIME_SCALE`,
// `overrideApplies`, `resolveTimeScale`, `withScale`); the measuring half is
// `Telemetry.swift`'s, which left this one to the Studio's project port.
//
// `auto` follows the measurement, which is right whenever the telemetry can
// speak; `manual` is the escape hatch for the case nothing can detect — a
// firmware that conformed its own timestamps along with the timings, or a clip
// with no `.srt` at all. Kept as a project setting beside the capture-time
// shift: both are corrections about the FOOTAGE, not about one badge.
//
// Rules kept: a manual figure that is not a positive, finite number is no
// override at all; an override names the clip it was set for, so stepping to
// another clip of the working set never inherits a cadence measured elsewhere
// (absent means "whatever is open", which only old documents mean).

import Foundation

public enum TimeScaleMode: String, CaseIterable, Sendable {
    case auto
    case manual
}

public struct TimeScaleSetting: Equatable, Sendable {
    public var mode: TimeScaleMode
    /// Capture seconds per media second; read only when mode is `manual`.
    public var scale: Double
    /// The clip the override was set for; nil means "whatever is open".
    public var clipId: String?

    public init(mode: TimeScaleMode, scale: Double, clipId: String? = nil) {
        self.mode = mode; self.scale = scale; self.clipId = clipId
    }

    /// Follow the telemetry — what every project starts with (`AUTO_TIME_SCALE`).
    public static let auto = TimeScaleSetting(mode: .auto, scale: 1)
}

/// The web's `AUTO_TIME_SCALE`.
public let autoTimeScale = TimeScaleSetting.auto

/// True when this override is the one to use for the clip now open.
public func overrideApplies(_ setting: TimeScaleSetting?, _ clipId: String? = nil) -> Bool {
    guard let setting, setting.mode == .manual else { return false }
    if !setting.scale.isFinite || setting.scale <= 0 { return false }
    return setting.clipId == nil || setting.clipId == clipId
}

/// The scale actually in force: the author's figure, or the measured one.
public func resolveTimeScale(_ setting: TimeScaleSetting?, _ measured: TimeScaleReading, _ clipId: String? = nil) -> Double {
    if overrideApplies(setting, clipId), let setting { return setting.scale }
    return measured.scale
}

/// The reading as it stands under `scale` — used when the author overrode the
/// measurement, so the capture rate quoted back to them follows their figure
/// instead of contradicting it.
public func withScale(_ reading: TimeScaleReading, _ scale: Double) -> TimeScaleReading {
    // `!(scale > 0)` is also true of NaN, as on the web.
    if scale == reading.scale || !(scale > 0) { return reading }
    var out = reading
    out.scale = scale
    out.captureFps = reading.mediaFps.map { $0 / scale }
    out.snapped = false
    return out
}

// MARK: - JSON

/// A stored setting read back — nil when it is not a record (the web leaves an
/// absent one undefined, and `resolveTimeScale` then follows the measurement).
/// An unknown mode reads as `auto`, a missing scale as 1; a scale that is not a
/// positive number is KEPT as written, `overrideApplies` refusing it at use.
public func readTimeScaleSetting(_ raw: JSONValue?) -> TimeScaleSetting? {
    guard let o = raw?.objectValue else { return nil }
    let mode = (o["mode"]?.stringValue).flatMap(TimeScaleMode.init(rawValue:)) ?? .auto
    var setting = TimeScaleSetting(mode: mode, scale: o["scale"]?.finiteNumber ?? 1)
    if let clip = o["clipId"]?.stringValue { setting.clipId = clip }
    return setting
}

extension TimeScaleSetting {
    /// `clipId` written only when there is one, as the web's spread leaves it out.
    public var json: JSONValue {
        var o: [String: JSONValue] = ["mode": .string(mode.rawValue), "scale": .number(scale)]
        if let clipId { o["clipId"] = .string(clipId) }
        return .object(o)
    }
}
