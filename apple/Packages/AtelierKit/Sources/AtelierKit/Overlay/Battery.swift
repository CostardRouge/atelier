// Battery level for the gauge element — port of
// `src/shared/overlay/battery.ts`, pure.
//
// THE HONEST SITUATION: the per-frame `.srt` a DJI writes beside the video
// carries exposure, GPS and altitude — no battery, the Mini 4 Pro included;
// the pack's state of charge lives in the flight record, not the video
// sidecar. So the gauge reads from a SOURCE:
// - `telemetry` probes the cue for a battery key. The parser keeps every
//   `key: value`, so a firmware that ever emits one works with no code
//   change; today this yields nothing and the gauge draws empty with `—`.
// - `manual` is a percentage the author sets — a prop, never presented as a
//   measurement.
// What is never done: invent a plausible level, or ramp one from the clip's
// duration. A HUD that lies about the battery is worse than none.

import Foundation

/// Keys seen (or plausibly emitted) across DJI firmware, probed in order.
/// Matching ignores case and separators: `batteryPercent`, `battery_percent`
/// and `BATTERY-PERCENT` are one key. The web's `BATTERY_KEYS`.
public let batteryKeys: [String] = [
    "battery",
    "battery_percent",
    "batterypercent",
    "battery_level",
    "batterylevel",
    "batt",
    "remain_battery",
    "remainbattery",
    "power",
]

/// Lowercased, every character outside `[a-z0-9]` dropped.
private func normaliseBatteryKey(_ key: String) -> String {
    var out = ""
    for scalar in key.lowercased().unicodeScalars {
        let v = scalar.value
        if (v >= 0x61 && v <= 0x7A) || (v >= 0x30 && v <= 0x39) { out.unicodeScalars.append(scalar) }
    }
    return out
}

/// A percentage out of a raw SRT value (`"87"`, `"87%"`, `"0.42"`), else nil.
public func parseBatteryValue(_ raw: String?) -> Double? {
    guard let raw else { return nil }
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.hasSuffix("%") { text.removeLast() }
    if text.isEmpty { return nil }
    // JS `Number()` trims what is left; Swift's parser does not.
    guard let n = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), n.isFinite else { return nil }
    // A fraction in 0..1 is a percentage in disguise — but only below 1, since
    // "1" on a 0..100 scale is a nearly-flat pack, not a full one.
    let pct = n > 0 && n < 1 ? n * 100 : n
    if pct < 0 || pct > 100 { return nil }
    return pct
}

/// The battery percentage `cue` carries, if any key holds one. A named key
/// is the only one asked; otherwise the known set, in order.
public func batteryFromCue(_ cue: Cue?, _ preferredKey: String? = nil) -> Double? {
    guard let cue else { return nil }
    let named = preferredKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let wanted = named.isEmpty ? batteryKeys.map(normaliseBatteryKey) : [normaliseBatteryKey(preferredKey ?? "")]
    var found: [String: String] = [:]
    for (key, value) in cue.data { found[normaliseBatteryKey(key)] = value }
    for key in wanted {
        if let parsed = parseBatteryValue(found[key]) { return parsed }
    }
    return nil
}

/// The level the gauge draws, 0..100, or nil when there is nothing to show.
/// A telemetry gauge with no data is nil — it draws empty with a `—`, like a
/// missing telemetry field.
public func batteryLevel(_ el: OverlayElement, _ cue: Cue?) -> Double? {
    if (el.batterySource ?? .manual) == .manual {
        guard let pct = el.batteryPercent else { return nil }
        return max(0, min(100, pct))
    }
    return batteryFromCue(cue, el.batteryKey)
}
