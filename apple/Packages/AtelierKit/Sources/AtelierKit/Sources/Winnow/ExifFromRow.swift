// What Winnow already knows about a photograph, as `ExifData`. Port of
// `src/shared/sources/winnow/exif-from-row.ts`.
//
// Winnow parses every capture's EXIF at ingest and keeps the useful half in
// columns: exposure, position, the capture time and — for a DJI still, which
// writes them as XMP — the altitudes (its migration 0028). Its photo PROXY, a
// WebP re-encode, carries none of it; so a picture edited from the proxy
// would read `—` on every exposure and position element while the answer sat
// in a column. This maps those columns onto the record the kernel's own
// reader produces, so `cueFromExif` turns them into the one cue a still is
// worth and nothing downstream learns a second vocabulary.
//
// Deliberately NOT carried: the gimbal attitude (no overlay element draws it,
// and a key held for nobody is how a vocabulary rots) and `camera_model` (a
// display label here, not part of the cue).

import Foundation

/// Winnow stores a shutter as the text the camera wrote — `1/240`, `2.5`,
/// sometimes `2.5s` — while `ExifData` speaks seconds. Parsed rather than
/// passed through, so a badge reads the same from a folder or an instance.
/// Nil for what it cannot read (`auto`, `1/0`, a non-positive number).
public func parseShutterSeconds(_ raw: String?) -> Double? {
    guard let raw, !raw.isEmpty else { return nil }
    let s = stripSecondsUnit(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    if let slash = s.firstIndex(of: "/") {
        let top = s[..<slash].trimmingCharacters(in: .whitespaces)
        let bottom = s[s.index(after: slash)...].trimmingCharacters(in: .whitespaces)
        // `^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$` — a second slash, a sign
        // or an exponent is not a fraction, and falls through to `Number`.
        if isPlainDecimal(top), isPlainDecimal(bottom), let t = Double(top), let b = Double(bottom) {
            guard t.isFinite, b.isFinite, b != 0 else { return nil }
            return t / b
        }
    }
    // `Number(s)`: an empty string is 0, which is not a shutter either.
    guard let n = Double(s), n.isFinite, n > 0 else { return nil }
    return n
}

/// `\d+(\.\d+)?` — ASCII digits, one optional fraction.
private func isPlainDecimal(_ s: String) -> Bool {
    let parts = s.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 1 || parts.count == 2 else { return false }
    return parts.allSatisfy { part in !part.isEmpty && part.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } }
}

/// `s.replace(/\s*(s|sec|secs|seconds)$/i, '')`: the unit at the end, and the
/// whitespace before it.
private func stripSecondsUnit(_ s: String) -> String {
    let lower = s.lowercased()
    for unit in ["seconds", "secs", "sec", "s"] where lower.hasSuffix(unit) && lower.count == s.count {
        var kept = String(s.dropLast(unit.count))
        while let last = kept.last, last.isWhitespace { kept.removeLast() }
        return kept
    }
    return s
}

/// `captured_at` back as the wall clock the camera wrote, `YYYY:MM:DD HH:MM:SS`.
///
/// EXIF carries no zone, and the hour on the picture is the hour it was where
/// it was taken. Winnow puts the zone-less EXIF string into a `TIMESTAMPTZ`, so
/// Postgres reads it in the SERVER's zone and hands it back with an offset;
/// taking the **UTC** components undoes that exactly when the server runs UTC,
/// which a container does by default. If a badge's hour is ever off by a
/// constant, this is the line to suspect: Winnow's Postgres is not on UTC.
public func exifTimestampFromIso(_ iso: String?, timeZone: TimeZone = .current) -> String? {
    guard let iso, !iso.isEmpty, let ms = winnowParseInstant(iso, timeZone: timeZone) else { return nil }
    let p = winnowUtcParts(ms)
    return "\(p.year):\(winnowPad2(p.month)):\(winnowPad2(p.day)) "
        + "\(winnowPad2(p.hour)):\(winnowPad2(p.minute)):\(winnowPad2(p.second))"
}

/// The row as `ExifData`, or nil when it holds nothing an element could draw —
/// the fields then read `—`, exactly as for a picture whose own EXIF was
/// stripped. Dimensions alone are not telemetry.
public func exifFromRow(_ row: WinnowAssetRow, timeZone: TimeZone = .current) -> ExifData? {
    var exif = ExifData()
    if let iso = row.iso, iso > 0 { exif.iso = iso }
    if let shutter = parseShutterSeconds(row.shutter) { exif.exposureTime = shutter }
    if let f = row.aperture, f > 0 { exif.fNumber = f }
    if let focal = row.focalLength, focal > 0 { exif.focalLength = focal }
    if let lat = row.gpsLat, let lon = row.gpsLon { exif.gps = GpsCoord(lat: lat, lon: lon) }
    if let alt = row.absoluteAltitude { exif.gpsAltitude = alt }
    if let rel = row.relativeAltitude { exif.relativeAltitude = rel }
    if let stamp = exifTimestampFromIso(row.capturedAt, timeZone: timeZone) { exif.dateTimeOriginal = stamp }
    if let w = row.width { exif.pixelWidth = Double(w) }
    if let h = row.height { exif.pixelHeight = Double(h) }

    let drawable = exif.iso != nil || exif.exposureTime != nil || exif.fNumber != nil || exif.focalLength != nil
        || exif.gps != nil || exif.gpsAltitude != nil || exif.relativeAltitude != nil || exif.dateTimeOriginal != nil
    return drawable ? exif : nil
}
