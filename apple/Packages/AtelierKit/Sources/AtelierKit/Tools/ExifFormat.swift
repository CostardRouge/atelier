// Pure presentation helpers for the Photo EXIF instrument — port of
// `src/tools/exif/exif-format.ts`. No view, no file: each returns a display
// string, or nil when the value is missing or nonsensical, so a panel draws
// one em-dash uniformly (the telemetry panels' rule).
//
// The rules it keeps:
// - Numbers read the way the browser prints them: `trim` is the web's
//   `Number.parseFloat(n.toFixed(2)).toString()` (`24.0` → `24`, `0.67` stays
//   `0.67`), `Math.round` rounds a half up — both through `ExifText`, the
//   kernel's one copy of JavaScript's number-to-text.
// - A coded value outside its table is nil, never a guessed label.
// - The capture time is the camera's own spelling in the suite's
//   (`2026-05-30 05:49`), taken AS WRITTEN: EXIF carries no timezone, and a
//   flat clock battery's `0000:00:00` is refused (`exifTimestamp`).
// - The OpenStreetMap link is only a URL: nothing here fetches it, and the
//   app opens it on the person's own click (`local-first.md`).
//
// The web's names are kept; they are specific enough (`formatShutter`,
// `orientationLabel`) not to collide in the one kernel module.

import Foundation

/// `Number.parseFloat(n.toFixed(2)).toString()` — at most two decimals, the
/// trailing zeros dropped.
private func trimTwo(_ n: Double) -> String {
    ExifText.trimFixed(n, 2)
}

private func positiveFinite(_ n: Double?) -> Double? {
    guard let n, n.isFinite, n > 0 else { return nil }
    return n
}

/// Shutter speed: sub-second as `1/x s`, otherwise `n s`.
public func formatShutter(_ seconds: Double?) -> String? {
    guard let seconds = positiveFinite(seconds) else { return nil }
    if seconds >= 1 { return "\(trimTwo(seconds)) s" }
    return "1/\(ExifText.jsString(ExifText.jsRound(1 / seconds))) s"
}

/// `f/2.8`, `f/8`.
public func formatAperture(_ fNumber: Double?) -> String? {
    guard let fNumber = positiveFinite(fNumber) else { return nil }
    return "f/\(trimTwo(fNumber))"
}

/// `24 mm`, `35.5 mm`.
public func formatFocal(_ mm: Double?) -> String? {
    guard let mm = positiveFinite(mm) else { return nil }
    return "\(trimTwo(mm)) mm"
}

/// `ISO 400`.
public func formatIso(_ iso: Double?) -> String? {
    guard let iso = positiveFinite(iso) else { return nil }
    return "ISO \(ExifText.jsString(ExifText.jsRound(iso)))"
}

/// Exposure compensation, always signed: `+0.7 EV`, `0 EV`, `-1 EV`.
public func formatExposureBias(_ ev: Double?) -> String? {
    guard let ev, ev.isFinite else { return nil }
    if ev == 0 { return "0 EV" }
    return "\(ev > 0 ? "+" : "")\(trimTwo(ev)) EV"
}

/// `37.774900, -122.419400` — six decimals, JavaScript's `toFixed`.
public func formatCoord(_ gps: GpsCoord?) -> String? {
    guard let gps else { return nil }
    return "\(ExifText.toFixed(gps.lat, 6)), \(ExifText.toFixed(gps.lon, 6))"
}

/// `80.2 m`, `-5 m`.
public func formatAltitude(_ metres: Double?) -> String? {
    guard let metres, metres.isFinite else { return nil }
    return "\(trimTwo(metres)) m"
}

/// An OpenStreetMap URL for a coordinate. Opened only when the person clicks
/// the link, so a photo's location never leaves the machine on its own.
public func mapsUrl(_ gps: GpsCoord) -> String {
    let lat = ExifText.jsString(gps.lat)
    let lon = ExifText.jsString(gps.lon)
    return "https://www.openstreetmap.org/?mlat=\(lat)&mlon=\(lon)#map=15/\(lat)/\(lon)"
}

// MARK: - coded-value labels

/// A JavaScript object read with a number key: only an integral value names
/// an entry.
private func pickLabel(_ table: [Int: String], _ v: Double?) -> String? {
    guard let v, v.isFinite, let key = Int(exactly: v) else { return nil }
    return table[key]
}

private let exposurePrograms: [Int: String] = [
    0: "Not defined",
    1: "Manual",
    2: "Program AE",
    3: "Aperture priority",
    4: "Shutter priority",
    5: "Creative",
    6: "Action",
    7: "Portrait",
    8: "Landscape",
]

private let meteringModes: [Int: String] = [
    0: "Unknown",
    1: "Average",
    2: "Center-weighted",
    3: "Spot",
    4: "Multi-spot",
    5: "Pattern",
    6: "Partial",
    255: "Other",
]

private let whiteBalances: [Int: String] = [0: "Auto", 1: "Manual"]

private let orientations: [Int: String] = [
    1: "Normal",
    2: "Mirrored",
    3: "Rotated 180°",
    4: "Mirrored, 180°",
    5: "Mirrored, 90° CCW",
    6: "Rotated 90° CW",
    7: "Mirrored, 90° CW",
    8: "Rotated 90° CCW",
]

public func exposureProgramLabel(_ v: Double?) -> String? { pickLabel(exposurePrograms, v) }

public func meteringModeLabel(_ v: Double?) -> String? { pickLabel(meteringModes, v) }

public func whiteBalanceLabel(_ v: Double?) -> String? { pickLabel(whiteBalances, v) }

/// Flash status — bit 0 of the EXIF flash field is "fired". JavaScript's `&`
/// works on the value truncated to 32 bits; a non-finite value is 0 there.
public func flashLabel(_ v: Double?) -> String? {
    guard let v else { return nil }
    let bits: Int = v.isFinite ? Int(Int32(truncatingIfNeeded: Int64(v.rounded(.towardZero)))) : 0
    return (bits & 1) == 1 ? "Fired" : "Did not fire"
}

public func orientationLabel(_ v: Double?) -> String? { pickLabel(orientations, v) }

// MARK: - summary lines

/// `[a, b].filter(Boolean)` — an empty string is as absent as nil.
private func present(_ parts: [String?]) -> [String] {
    parts.compactMap { part in
        guard let part, !part.isEmpty else { return nil }
        return part
    }
}

/// One-line camera summary for a card, e.g. `SONY ILCE-7M3`.
public func cameraLine(_ data: ExifData) -> String? {
    let body = present([data.make, data.model]).joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return body.isEmpty ? nil : body
}

/// Compact exposure triplet for a card, e.g. `1/200 s  ·  f/2.8  ·  ISO 400`.
public func exposureLine(_ data: ExifData) -> String? {
    let parts = present([formatShutter(data.exposureTime), formatAperture(data.fNumber), formatIso(data.iso)])
    return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
}

/// `RAW`, `JPEG`, or the bare extension in capitals (`HEIC`, `PNG`), `image`
/// for a name with none — the type a card and the detail name a file by.
/// Port of `src/shared/media/image-meta.ts`'s `imageTypeLabel`.
public func imageTypeLabel(_ name: String) -> String {
    let ext: String
    if let dot = name.lastIndex(of: ".") {
        ext = name[name.index(after: dot)...].lowercased()
    } else {
        ext = ""
    }
    if isRawImage(name) { return "RAW" }
    if ext == "jpg" || ext == "jpeg" { return "JPEG" }
    return ext.isEmpty ? "image" : ext.uppercased()
}

/// The capture time as the camera wrote it, in the suite's spelling
/// (`2026-05-30 05:49`) — the day and hour the shutter fired, never the
/// file's modified time, which a copy or a re-export rewrites.
public func formatCaptured(_ value: String?) -> String? {
    guard let stamp = exifTimestamp(value) else { return nil }
    return String(stamp.prefix(16))
}
