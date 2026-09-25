// A photograph, read as one telemetry cue — port of `src/shared/exif/exif-cue.ts`.
//
// The overlay engine speaks a single language for values it draws: a `Cue` of
// `key: string` telemetry, the way DJI's `.srt` writes it. A photo carries most
// of the same facts in its EXIF, so rather than teaching every element a
// second vocabulary, a still is turned into the one cue it is: `iso`,
// `shutter`, `fnum`, `ev`, `focal_len`, `latitude`, `longitude`, `abs_alt`,
// `timestamp` then work over a photograph with no code downstream knowing.
//
// The rules it keeps:
// - What a photo cannot answer stays ABSENT, never invented: ground and
//   vertical speed, heading, frame number and colour profile have no meaning
//   for a still, so their elements draw `—`. A DRONE still does know its
//   height above take-off (`rel_alt`).
// - Every number is written exactly as the web writes it — JS's own
//   `toFixed`, `parseFloat`/`toString` and `Math.round` rules, ported below as
//   `ExifText`, because a `6.765` reads `6.76` under one rule and `6.77` under
//   another and the two lines must never disagree with the browser's.
// - The capture time is taken AS WRITTEN: EXIF has no timezone.
//
// `Cue` is the kernel's own (`Telemetry.swift`); nothing was added to it.

import Foundation

// MARK: - the web's number-to-text, exactly

/// JavaScript's number formatting, for the strings these lines print. Each is
/// the exact twin of the JS expression it names, so a Swift line and a browser
/// line are one text.
enum ExifText {
    /// JS `Math.round`: the nearest integer, a half rounding toward +∞.
    static func jsRound(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let floor = x.rounded(.down)
        return x - floor >= 0.5 ? floor + 1 : floor
    }

    /// JS `String(n)` for the finite numbers printed here: an integer with no
    /// `.0` (`24`, not `24.0`), else the shortest round-trip text, which is
    /// what Swift's `description` prints too at these magnitudes.
    static func jsString(_ n: Double) -> String {
        if n.isFinite, n == n.rounded(), n.magnitude < 1e15 { return String(Int64(n)) }
        return "\(n)"
    }

    /// `String(Math.round(n * 100) / 100)` — `2.8`, not `2.80`; `24`, not
    /// `24.0`. `exposureSummary`'s and `cameraFacts`' rounding.
    static func rounded2(_ n: Double) -> String {
        jsString(jsRound(n * 100) / 100)
    }

    /// `+0.3`, `−1`: a typographic minus, the suite's signed number, one decimal.
    static func signed(_ n: Double) -> String {
        let magnitude = jsRound(n.magnitude * 10) / 10
        return (n < 0 ? "−" : "+") + jsString(magnitude)
    }

    /// JS `Number.prototype.toFixed(digits)`: the exact decimal expansion of
    /// the double, rounded at `digits` places half AWAY from zero (the spec's
    /// "larger n" on a tie, applied to the magnitude), trailing zeros kept —
    /// `(151.2099).toFixed(6)` is `151.209900`. printf's `%f` converts a double
    /// exactly, so the digits past the cut are the true ones; the one rule it
    /// would get wrong is the tie, which glibc rounds half to even.
    static func toFixed(_ x: Double, _ digits: Int) -> String {
        guard x.isFinite else { return x.isNaN ? "NaN" : (x < 0 ? "-Infinity" : "Infinity") }
        let negative = x < 0
        let expansion = String(format: "%.40f", x.magnitude)
        let parts = expansion.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        var whole = Array(parts[0].utf8)
        let fraction: [UInt8] = parts.count > 1 ? Array(parts[1].utf8) : []
        var kept = Array(fraction.prefix(digits))
        while kept.count < digits { kept.append(UInt8(ascii: "0")) }
        let next: UInt8 = fraction.count > digits ? fraction[digits] : UInt8(ascii: "0")
        if next >= UInt8(ascii: "5") {
            var carry = true
            var i = kept.count - 1
            while carry, i >= 0 {
                if kept[i] == UInt8(ascii: "9") { kept[i] = UInt8(ascii: "0"); i -= 1 } else { kept[i] += 1; carry = false }
            }
            var j = whole.count - 1
            while carry, j >= 0 {
                if whole[j] == UInt8(ascii: "9") { whole[j] = UInt8(ascii: "0"); j -= 1 } else { whole[j] += 1; carry = false }
            }
            if carry { whole.insert(UInt8(ascii: "1"), at: 0) }
        }
        var text = String(decoding: whole, as: UTF8.self)
        if digits > 0 { text += "." + String(decoding: kept, as: UTF8.self) }
        return negative ? "-" + text : text
    }

    /// `Number.parseFloat(n.toFixed(digits)).toString()` — `toFixed` with its
    /// trailing zeros dropped (`58.20` → `58.2`, `-0.00` → `0`). The cue's `trim`.
    static func trimFixed(_ n: Double, _ digits: Int = 2) -> String {
        jsString(Double(toFixed(n, digits)) ?? n)
    }
}

private func finite(_ n: Double?) -> Double? {
    guard let n, n.isFinite else { return nil }
    return n
}

/// Shutter speed the way a camera badge reads it: `1/200` under a second,
/// `2.5s` above (where the bare fraction would be ambiguous). Mirrors DJI's
/// own `shutter: 1/240`, so the overlay field needs no unit of its own.
public func exifShutter(_ seconds: Double?) -> String? {
    guard let seconds = finite(seconds), seconds > 0 else { return nil }
    if seconds >= 1 { return "\(ExifText.trimFixed(seconds))s" }
    return "1/\(ExifText.jsString(ExifText.jsRound(1 / seconds)))"
}

private let exifTimestampRe = try! NSRegularExpression(
    pattern: #"^(\d{4})[:-](\d{2})[:-](\d{2})[\sT]+(\d{2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)"#
)

/// EXIF writes `2026:05:30 05:49:34`; the time formatter reads
/// `2026-05-30 05:49:34`. Only the date separators differ, and a camera with a
/// flat clock battery writes `0000:00:00`, which is refused rather than
/// rendered as a date. Taken AS WRITTEN: EXIF has no timezone.
public func exifTimestamp(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let m = exifTimestampRe.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    func group(_ i: Int) -> String {
        guard let r = Range(m.range(at: i), in: text) else { return "" }
        return String(text[r])
    }
    let year = group(1)
    let month = group(2)
    let day = group(3)
    let time = group(4)
    guard let monthNumber = Int(month), monthNumber >= 1, monthNumber <= 12 else { return nil }
    guard let dayNumber = Int(day), dayNumber >= 1, dayNumber <= 31 else { return nil }
    return "\(year)-\(month)-\(day) \(time)"
}

/// The exposure fields as DJI would have written them.
private func exposureData(_ exif: ExifData) -> [String: String] {
    var data: [String: String] = [:]
    if let iso = finite(exif.iso), iso > 0 { data["iso"] = ExifText.jsString(ExifText.jsRound(iso)) }
    if let shutter = exifShutter(exif.exposureTime) { data["shutter"] = shutter }
    if let fNumber = finite(exif.fNumber), fNumber > 0 { data["fnum"] = ExifText.trimFixed(fNumber) }
    if let bias = finite(exif.exposureBias) {
        data["ev"] = bias > 0 ? "+\(ExifText.trimFixed(bias))" : ExifText.trimFixed(bias)
    }
    if let focal = finite(exif.focalLength), focal > 0 { data["focal_len"] = ExifText.trimFixed(focal) }
    return data
}

/// Build the single cue a photograph is worth, or nil when its EXIF holds
/// nothing any element could draw (a screenshot, a stripped export, a RAW the
/// reader could not walk). Nil is the honest answer there: the telemetry
/// fields then read `—`, exactly as they do for a clip with no `.srt`.
///
/// `start` is 0 so `cueAt` returns it at any playhead — a still has one
/// instant, and every render path asks for the cue at some time.
public func cueFromExif(_ exif: ExifData) -> Cue? {
    var data = exposureData(exif)
    if let gps = exif.gps {
        data["latitude"] = ExifText.toFixed(gps.lat, 6)
        data["longitude"] = ExifText.toFixed(gps.lon, 6)
    }
    // GPS altitude is height above sea level — the absolute one. A DRONE photo
    // also knows its height above take-off, which is the reading `rel_alt`
    // draws for a clip; an ordinary camera has no such reference and leaves it
    // absent, so the element goes on reading `—`.
    if let alt = finite(exif.gpsAltitude) { data["abs_alt"] = ExifText.trimFixed(alt) }
    if let rel = finite(exif.relativeAltitude) { data["rel_alt"] = ExifText.trimFixed(rel) }

    let timestamp = exifTimestamp(exif.dateTimeOriginal)
    if timestamp == nil && data.isEmpty { return nil }

    return Cue(start: 0, end: 0, frame: nil, timestamp: timestamp, data: data)
}
