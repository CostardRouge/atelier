// DJI telemetry — the `.srt` beside every clip, parsed into cues, with the
// motion (speed, heading) reconstructed from successive positions and the
// clip's cadence (slow motion, time-lapse) measured from its clocks. Port of
// `src/shared/telemetry/srt-parser.ts`, `motion.ts` and `time-scale.ts`.
//
// Every rate is per second of CAPTURE, not per second of file: on conformed
// footage the file's seconds are not life's, and `timeScale` — capture seconds
// per media second — converts both the divisor and the look-back window.

import Foundation

public struct Motion: Equatable, Sendable {
    /// Horizontal ground speed in m/s (always ≥ 0).
    public var groundSpeed: Double?
    /// Vertical speed in m/s, signed: positive = climbing.
    public var verticalSpeed: Double?
    /// Course over ground in degrees [0, 360); undefined while stationary.
    public var heading: Double?
    public init(groundSpeed: Double? = nil, verticalSpeed: Double? = nil, heading: Double? = nil) {
        self.groundSpeed = groundSpeed; self.verticalSpeed = verticalSpeed; self.heading = heading
    }
}

public struct Cue: Equatable, Sendable {
    /// Start time in seconds of MEDIA.
    public var start: Double
    public var end: Double
    /// DJI FrameCnt, or nil if absent.
    public var frame: Int?
    /// Capture timestamp line as written, or nil.
    public var timestamp: String?
    /// DJI's `DiffTime`, in seconds — the real interval between samples.
    public var diffTime: Double?
    /// Every `key: value` the brackets carried, tolerant to unknown fields.
    public var data: [String: String]
    /// Motion reconstructed backward from earlier cues. Attached by `parseSrt`.
    public var derived: Motion?
    /// The same motion measured FORWARD, on the clip's opening window only.
    public var lead: Motion?

    public init(start: Double, end: Double, frame: Int? = nil, timestamp: String? = nil, diffTime: Double? = nil,
                data: [String: String] = [:], derived: Motion? = nil, lead: Motion? = nil) {
        self.start = start; self.end = end; self.frame = frame; self.timestamp = timestamp; self.diffTime = diffTime
        self.data = data; self.derived = derived; self.lead = lead
    }
}

// MARK: - parsing

private let timingRe = try! NSRegularExpression(pattern: #"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"#)
private let bracketRe = try! NSRegularExpression(pattern: #"\[([^\]]*)\]"#)
/// `key: value` pairs; a value runs until the next `key:` token or the end.
private let kvRe = try! NSRegularExpression(pattern: #"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^\[\]]*?)(?=\s+[A-Za-z_][A-Za-z0-9_]*\s*:|$)"#)
private let frameRe = try! NSRegularExpression(pattern: #"FrameCnt\s*:\s*(\d+)"#)
private let diffTimeRe = try! NSRegularExpression(pattern: #"DiffTime\s*:\s*([\d.]+)\s*ms"#, options: [.caseInsensitive])
private let timestampRe = try! NSRegularExpression(pattern: #"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?"#)
private let tagRe = try! NSRegularExpression(pattern: #"<[^>]*>"#)
/// A blank line, whitespace-only lines included — what separates two cues.
private let blankLineRe = try! NSRegularExpression(pattern: #"\n(?:[ \t]*\n)+"#)

private extension NSRegularExpression {
    func first(in s: String) -> NSTextCheckingResult? {
        firstMatch(in: s, range: NSRange(s.startIndex..., in: s))
    }
    func all(in s: String) -> [NSTextCheckingResult] {
        matches(in: s, range: NSRange(s.startIndex..., in: s))
    }
}

private func group(_ m: NSTextCheckingResult, _ i: Int, in s: String) -> String {
    guard let r = Range(m.range(at: i), in: s) else { return "" }
    return String(s[r])
}

private func timecodeToSeconds(_ h: String, _ m: String, _ s: String, _ ms: String) -> Double {
    // In steps: one expression of four optionals is what Swift 5.10 on Linux
    // refuses to type-check "in reasonable time".
    let hours: Double = Double(h) ?? 0
    let minutes: Double = Double(m) ?? 0
    let seconds: Double = Double(s) ?? 0
    let millis: Double = Double(ms) ?? 0
    return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

private func stripTags(_ text: String) -> String {
    tagRe.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
}

private func parseBracketPayload(_ payload: String) -> (frame: Int?, timestamp: String?, diffTime: Double?, data: [String: String]) {
    let clean = stripTags(payload)
    let frame = frameRe.first(in: clean).flatMap { Int(group($0, 1, in: clean)) }
    var diffTime: Double? = nil
    if let m = diffTimeRe.first(in: clean), let ms = Double(group(m, 1, in: clean)), ms.isFinite, ms > 0 {
        diffTime = ms / 1000
    }
    let timestamp = timestampRe.first(in: clean).map { group($0, 0, in: clean) }
    let brackets = bracketRe.all(in: clean).map { group($0, 1, in: clean) }
    let joined = brackets.joined(separator: " ")
    var data: [String: String] = [:]
    for m in kvRe.all(in: joined) {
        let key = group(m, 1, in: joined)
        let value = group(m, 2, in: joined).trimmingCharacters(in: .whitespaces)
        if !value.isEmpty { data[key] = value }
    }
    return (frame, timestamp, diffTime, data)
}

public enum TimeScaleOption: Sendable {
    case auto
    case fixed(Double)
}

/// Parse a DJI telemetry SRT file into cues sorted by ascending start, with
/// motion attached. Only the modern bracket format is supported; anything else
/// answers an empty list rather than throwing.
public func parseSrt(_ text: String, timeScale: TimeScaleOption = .auto) -> [Cue] {
    guard bracketRe.first(in: text) != nil else { return [] }
    let unix = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    // Blocks split on blank lines (a line of only whitespace counts as blank).
    let normalised = blankLineRe.stringByReplacingMatches(in: unix, range: NSRange(unix.startIndex..., in: unix), withTemplate: "\n\n")
    let blocks = normalised.components(separatedBy: "\n\n")
    var cues: [Cue] = []
    for block in blocks {
        guard let timing = timingRe.first(in: block) else { continue }
        let start = timecodeToSeconds(group(timing, 1, in: block), group(timing, 2, in: block), group(timing, 3, in: block), group(timing, 4, in: block))
        let end = timecodeToSeconds(group(timing, 5, in: block), group(timing, 6, in: block), group(timing, 7, in: block), group(timing, 8, in: block))
        guard let range = Range(timing.range, in: block) else { continue }
        let payload = String(block[range.upperBound...])
        let parsed = parseBracketPayload(payload)
        cues.append(Cue(start: start, end: end, frame: parsed.frame, timestamp: parsed.timestamp, diffTime: parsed.diffTime, data: parsed.data))
    }
    cues.sort { $0.start < $1.start }
    let scale: Double
    switch timeScale {
    case .auto: scale = measureTimeScale(cues).scale
    case .fixed(let s): scale = s
    }
    attachMotion(&cues, timeScale: scale)
    return cues
}

// MARK: - motion

private let earthRadiusM = 6_371_008.8
private let deg2rad = Double.pi / 180
/// Target look-back window for a stable estimate, in seconds of CAPTURE time.
private let windowS = 1.0
/// Minimum spanned CAPTURE time to trust a derived value.
private let minDtS = 0.3
/// Below this horizontal travel (metres) the heading is GPS noise.
private let minMoveM = 1.0

private func num(_ value: String?) -> Double? {
    guard let value, !value.isEmpty, let n = Double(value), n.isFinite else { return nil }
    return n
}

/// Great-circle distance between two WGS-84 points, in metres (haversine).
public func haversine(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let dLat = (lat2 - lat1) * deg2rad
    let dLon = (lon2 - lon1) * deg2rad
    let sinLat = sin(dLat / 2)
    let sinLon = sin(dLon / 2)
    let a = sinLat * sinLat + cos(lat1 * deg2rad) * cos(lat2 * deg2rad) * sinLon * sinLon
    return 2 * earthRadiusM * asin(min(1, a.squareRoot()))
}

/// Initial bearing from point 1 to point 2, in degrees [0, 360) from North.
public func bearing(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
    let phi1 = lat1 * deg2rad
    let phi2 = lat2 * deg2rad
    let dLon = (lon2 - lon1) * deg2rad
    let y = sin(dLon) * cos(phi2)
    let x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLon)
    let deg = atan2(y, x) / deg2rad
    return (deg + 360).truncatingRemainder(dividingBy: 360)
}

private let compass16Names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]

/// 16-point compass abbreviation for a bearing in degrees (`247` → `WSW`).
public func compass16(_ deg: Double) -> String {
    let wrapped = (deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    return compass16Names[Int((wrapped / 22.5).rounded()) % 16]
}

/// Index of the most recent cue at start time `t` or earlier; −1 when `t` precedes every cue.
public func lastIndexAtOrBefore(_ cues: [Cue], _ t: Double) -> Int {
    var lo = 0, hi = cues.count - 1, res = -1
    while lo <= hi {
        let mid = (lo + hi) >> 1
        if cues[mid].start <= t { res = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return res
}

/// Index of the earliest cue at start time `t` or later; −1 when every cue precedes `t`.
public func firstIndexAtOrAfter(_ cues: [Cue], _ t: Double) -> Int {
    var lo = 0, hi = cues.count - 1, res = -1
    while lo <= hi {
        let mid = (lo + hi) >> 1
        if cues[mid].start >= t { res = mid; hi = mid - 1 } else { lo = mid + 1 }
    }
    return res
}

private func motionOver(_ from: Cue, _ to: Cue, _ dt: Double) -> Motion {
    var motion = Motion()
    if !(dt >= minDtS) { return motion }
    if let lat1 = num(from.data["latitude"]), let lon1 = num(from.data["longitude"]),
       let lat2 = num(to.data["latitude"]), let lon2 = num(to.data["longitude"]) {
        let dist = haversine(lat1, lon1, lat2, lon2)
        motion.groundSpeed = dist / dt
        if dist >= minMoveM { motion.heading = bearing(lat1, lon1, lat2, lon2) }
    }
    let useRel = from.data["rel_alt"] != nil && to.data["rel_alt"] != nil
    let alt1 = num(useRel ? from.data["rel_alt"] : from.data["abs_alt"])
    let alt2 = num(useRel ? to.data["rel_alt"] : to.data["abs_alt"])
    if let alt1, let alt2 { motion.verticalSpeed = (alt2 - alt1) / dt }
    return motion
}

private func adds(_ lead: Motion, _ known: Motion) -> Bool {
    (lead.groundSpeed != nil && known.groundSpeed == nil)
        || (lead.verticalSpeed != nil && known.verticalSpeed == nil)
        || (lead.heading != nil && known.heading == nil)
}

/// Compute and attach `derived` motion to every cue, then `lead` on the opening
/// cues. Always derives from the raw positions, so re-running with another
/// `timeScale` re-answers the question rather than compounding a correction.
public func attachMotion(_ cues: inout [Cue], timeScale: Double = 1) {
    let scale = timeScale.isFinite && timeScale > 0 ? timeScale : 1
    let mediaSpan = cues.count > 1 ? cues[cues.count - 1].start - cues[0].start : 0
    let window = mediaSpan > 0 ? min(windowS / scale, mediaSpan / 2) : windowS / scale
    for i in 0..<cues.count {
        var motion = Motion()
        if i > 0 {
            var ref = lastIndexAtOrBefore(cues, cues[i].start - window)
            if ref < 0 { ref = 0 }
            if ref >= i { ref = i - 1 }
            let prev = cues[ref]
            motion = motionOver(prev, cues[i], (cues[i].start - prev.start) * scale)
        }
        cues[i].derived = motion
        cues[i].lead = nil
    }
    attachLead(&cues, window, scale)
}

private func attachLead(_ cues: inout [Cue], _ window: Double, _ scale: Double) {
    if cues.count < 2 { return }
    let openEnd = cues[0].start + window
    for i in 0..<cues.count {
        if cues[i].start >= openEnd { break }
        var ref = firstIndexAtOrAfter(cues, cues[i].start + window)
        if ref < 0 { ref = cues.count - 1 }
        if ref <= i { continue }
        let known = cues[i].derived ?? Motion()
        let lead = motionOver(cues[i], cues[ref], (cues[ref].start - cues[i].start) * scale)
        if adds(lead, known) { cues[i].lead = lead }
    }
}

/// The motion to display for `cue`: each value the backward window could not
/// produce filled with the look-ahead one; a real measurement always wins.
public func motionAt(_ cue: Cue?, early: Bool = true) -> Motion {
    guard let cue else { return Motion() }
    let known = cue.derived ?? Motion()
    guard early, let lead = cue.lead else { return known }
    return Motion(groundSpeed: known.groundSpeed ?? lead.groundSpeed,
                  verticalSpeed: known.verticalSpeed ?? lead.verticalSpeed,
                  heading: known.heading ?? lead.heading)
}

/// A copy of `cues` with motion re-derived at `timeScale`.
public func retimeCues(_ cues: [Cue], timeScale: Double) -> [Cue] {
    var copy = cues
    attachMotion(&copy, timeScale: timeScale)
    return copy
}

public enum SpeedUnit: String, CaseIterable, Sendable {
    case metresPerSecond = "m/s"
    case kilometresPerHour = "km/h"
    case milesPerHour = "mph"

    var factor: Double {
        switch self {
        case .metresPerSecond: return 1
        case .kilometresPerHour: return 3.6
        case .milesPerHour: return 2.236936
        }
    }
}

private func signedSpeed(_ value: Double, _ digits: Int) -> String {
    let eps = 0.5 * pow(10, -Double(digits))
    if abs(value) < eps { return String(format: "%.\(digits)f", 0.0) }
    let text = String(format: "%.\(digits)f", value)
    return value > 0 ? "+\(text)" : text
}

/// `12.3 m/s`, `44.3 km/h`, `27.5 mph`.
public func formatGroundSpeed(_ value: Double?, unit: SpeedUnit = .metresPerSecond) -> String? {
    guard let value else { return nil }
    return "\(String(format: "%.1f", value * unit.factor)) \(unit.rawValue)"
}

/// Signed: `+1.4 m/s` / `-5.1 km/h`.
public func formatVerticalSpeed(_ value: Double?, unit: SpeedUnit = .metresPerSecond) -> String? {
    guard let value else { return nil }
    return "\(signedSpeed(value * unit.factor, 1)) \(unit.rawValue)"
}

/// `247° WSW`.
public func formatHeading(_ value: Double?) -> String? {
    guard let value else { return nil }
    let deg = Int(((value.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)).rounded()) % 360
    return "\(deg)° \(compass16(value))"
}

// MARK: - time scale

public struct TimeScaleReading: Equatable, Sendable {
    /// Capture seconds per second of media. 1 = real time, 0.25 = 4× slow motion.
    public var scale: Double
    public var basis: Basis
    public var mediaFps: Double?
    public var captureFps: Double?
    public var snapped: Bool
    public var spanSeconds: Double
    public var samples: Int

    public enum Basis: String, Sendable { case timestamps, diffTime = "diff-time", none }

    /// Ordinary footage: one second of file is one second of life.
    public static let realtime = TimeScaleReading(scale: 1, basis: Basis.none, mediaFps: nil, captureFps: nil, snapped: false, spanSeconds: 0, samples: 0)
}

private let standardRates: [Double] = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 200, 239.76, 240]
private let snapTolerance = 0.02
private let minPairS = 0.15
private let maxQuantisation = 0.1
private let maxFrozen = 0.4
private let minSpanS = 0.4
private let minScale = 1.0 / 64
private let maxScale = 600.0
private let gapFactor = 3.0

private func median(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    let mid = sorted.count >> 1
    return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/// Snap to the NEAREST standard camera rate when one is within tolerance.
public func snapRate(_ fps: Double) -> (fps: Double, snapped: Bool) {
    var best: Double? = nil
    var bestError = Double.infinity
    for rate in standardRates {
        let error = abs(fps - rate) / rate
        if error <= snapTolerance && error < bestError { best = rate; bestError = error }
    }
    if let best { return (best, true) }
    return (fps, false)
}

/// The file's own cadence from the spacing between cues, measured across the
/// longest unbroken run so millisecond quantisation averages away.
public func measureMediaFps(_ cues: [Cue]) -> Double? {
    if cues.count < 3 { return nil }
    var steps: [Double] = []
    for i in 1..<cues.count {
        let d = cues[i].start - cues[i - 1].start
        if d > 0 { steps.append(d) }
    }
    if steps.count < 2 { return nil }
    let typical = median(steps)
    if !(typical > 0) { return nil }
    var bestFrom = 0, bestTo = 0, from = 0
    for i in 1..<cues.count {
        let d = cues[i].start - cues[i - 1].start
        if d <= 0 || d > typical * gapFactor { from = i; continue }
        if i - from > bestTo - bestFrom { bestFrom = from; bestTo = i }
    }
    let runSteps = bestTo - bestFrom
    if runSteps < 2 { return nil }
    let span = cues[bestTo].start - cues[bestFrom].start
    if !(span > 0) { return nil }
    return snapRate(Double(runSteps) / span).fps
}

/// `2026-05-30 05:49:34.609` → epoch milliseconds, read as UTC (the zone is
/// unknowable and only DIFFERENCES are ever taken from it).
func wallClockMillis(_ timestamp: String?) -> Double? {
    guard let timestamp else { return nil }
    let parts = timestamp.replacingOccurrences(of: ",", with: ".").split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count >= 2 else { return nil }
    let date = parts[0].split(separator: "-").compactMap { Int($0) }
    let clock = parts[1].split(separator: ":")
    guard date.count == 3, clock.count == 3, let h = Int(clock[0]), let m = Int(clock[1]), let s = Double(clock[2]) else { return nil }
    var comps = DateComponents()
    comps.calendar = Calendar(identifier: .gregorian)
    comps.timeZone = TimeZone(identifier: "UTC")
    comps.year = date[0]; comps.month = date[1]; comps.day = date[2]
    comps.hour = h; comps.minute = m; comps.second = 0
    guard let base = comps.date else { return nil }
    return base.timeIntervalSince1970 * 1000 + s * 1000
}

private func clockResolution(_ cues: [Cue], burst: Int = 96) -> Double {
    var previous: Double? = nil
    var smallest = Double.infinity
    for i in 0..<min(cues.count, burst) {
        guard let w = wallClockMillis(cues[i].timestamp) else { continue }
        if let previous {
            let step = (w - previous) / 1000
            if step > 0 { smallest = min(smallest, step) }
        }
        previous = w
    }
    return smallest
}

private struct Anchor { let t: Double; let w: Double }

private func anchors(_ cues: [Cue], max maxCount: Int = 128) -> [Anchor] {
    var out: [Anchor] = []
    let n = cues.count
    if n == 0 { return out }
    let span = cues[n - 1].start - cues[0].start
    let step = max(minPairS, span / Double(maxCount))
    func push(_ cue: Cue) -> Bool {
        guard let w = wallClockMillis(cue.timestamp), w.isFinite else { return false }
        out.append(Anchor(t: cue.start, w: w))
        return true
    }
    var nextAt = -Double.infinity
    for i in 0..<n {
        if cues[i].start < nextAt { continue }
        if push(cues[i]) { nextAt = cues[i].start + step }
    }
    let last = cues[n - 1]
    if out.isEmpty || out[out.count - 1].t != last.start { _ = push(last) }
    return out
}

private func scaleFromTimestamps(_ a: [Anchor], _ clockStep: Double) -> (scale: Double, span: Double, samples: Int)? {
    if a.count < 2 { return nil }
    let span = a[a.count - 1].t - a[0].t
    if span < minSpanS { return nil }
    var resolution = clockStep
    var frozen = 0.0
    var longestFrozen = 0.0
    for i in 1..<a.count {
        let step = (a[i].w - a[i - 1].w) / 1000
        if step > 0 {
            resolution = min(resolution, step)
            frozen = 0
        } else {
            frozen += a[i].t - a[i - 1].t
            longestFrozen = max(longestFrozen, frozen)
        }
    }
    if !resolution.isFinite { return nil }
    if longestFrozen / span > maxFrozen { return nil }
    let minPair = max(minPairS, span / 4)
    var slopes: [Double] = []
    for i in 0..<a.count {
        for j in (i + 1)..<a.count {
            let dt = a[j].t - a[i].t
            if dt < minPair { continue }
            let dw = (a[j].w - a[i].w) / 1000
            if dw < 0 { continue }
            slopes.append(dw / dt)
        }
    }
    if slopes.isEmpty { return nil }
    let scale = median(slopes)
    if !(scale > 0) { return nil }
    if resolution / (scale * span) > maxQuantisation { return nil }
    return (scale, span, slopes.count)
}

private func rateWritingDiffTime(_ stepSeconds: Double) -> Double? {
    let written = Int((stepSeconds * 1000).rounded())
    if written <= 0 { return nil }
    let matches = standardRates.filter { Int((1000 / $0).rounded()) == written }
    if matches.isEmpty { return nil }
    if let integer = matches.first(where: { $0 == $0.rounded() }) { return integer }
    return matches[matches.count - 1]
}

private func scaleFromDiffTime(_ cues: [Cue], _ mediaFps: Double?) -> (scale: Double, samples: Int)? {
    guard let mediaFps else { return nil }
    let diffs = cues.compactMap { $0.diffTime }.filter { $0 > 0 }
    if diffs.count < 3 { return nil }
    let captureStep = median(diffs)
    if !(captureStep > 0) { return nil }
    guard let captureFps = rateWritingDiffTime(captureStep) else { return nil }
    return (mediaFps / captureFps, diffs.count)
}

private func looksLikeTelemetry(_ cues: [Cue]) -> Bool {
    let stride = max(1, cues.count / 32)
    var sampled = 0, carrying = 0
    var i = 0
    while i < cues.count {
        sampled += 1
        if cues[i].frame != nil || !cues[i].data.isEmpty { carrying += 1 }
        i += stride
    }
    return sampled > 0 && Double(carrying) / Double(sampled) >= 0.5
}

/// Measure a clip's cadence from its telemetry. Returns `.realtime` whenever the
/// evidence is missing or implausible.
public func measureTimeScale(_ cues: [Cue]) -> TimeScaleReading {
    if cues.count < 3 || !looksLikeTelemetry(cues) { return .realtime }
    let mediaFps = measureMediaFps(cues)
    let stamped = scaleFromTimestamps(anchors(cues), clockResolution(cues))
    let fromDiff = stamped == nil ? scaleFromDiffTime(cues, mediaFps) : nil
    var scale: Double
    let samples: Int
    if let stamped { scale = stamped.scale; samples = stamped.samples }
    else if let fromDiff { scale = fromDiff.scale; samples = fromDiff.samples }
    else { var r = TimeScaleReading.realtime; r.mediaFps = mediaFps; return r }
    if !scale.isFinite || scale < minScale || scale > maxScale {
        var r = TimeScaleReading.realtime; r.mediaFps = mediaFps; return r
    }
    var snapped = false
    var captureFps = mediaFps
    if abs(scale - 1) <= snapTolerance {
        scale = 1
        snapped = true
    } else if let mediaFps {
        let guess = snapRate(mediaFps / scale)
        if guess.snapped {
            captureFps = guess.fps
            scale = mediaFps / guess.fps
            snapped = true
        } else {
            captureFps = mediaFps / scale
        }
    }
    return TimeScaleReading(scale: scale, basis: stamped != nil ? .timestamps : .diffTime, mediaFps: mediaFps,
                            captureFps: captureFps, snapped: snapped, spanSeconds: stamped?.span ?? 0, samples: samples)
}

private let realtimeTolerance = 0.02

/// True when the clip plays at the speed it was shot.
public func isRealtime(_ scale: Double) -> Bool {
    !scale.isFinite || abs(scale - 1) <= realtimeTolerance
}

private func factorText(_ factor: Double) -> String {
    let rounded = (factor * 10).rounded() / 10
    if rounded == 1 { return String(format: "%.2f", factor) }
    return rounded == rounded.rounded() ? String(Int(rounded)) : String(format: "%.1f", rounded)
}

/// `4× slow` / `10× fast`, or nil for ordinary footage.
public func timeScaleTag(_ scale: Double) -> String? {
    if isRealtime(scale) { return nil }
    return scale < 1 ? "\(factorText(1 / scale))× slow" : "\(factorText(scale))× fast"
}

/// `4× slow motion`, `10× time-lapse`, or nil at real time.
public func describeTimeScale(_ scale: Double) -> String? {
    if isRealtime(scale) { return nil }
    return scale < 1 ? "\(factorText(1 / scale))× slow motion" : "\(factorText(scale))× time-lapse"
}

/// `120 → 30 fps` when the two differ, `60 fps` when they do not, else nil.
public func formatCadence(_ reading: TimeScaleReading) -> String? {
    guard let mediaFps = reading.mediaFps, let captureFps = reading.captureFps, reading.basis != TimeScaleReading.Basis.none else { return nil }
    func round(_ fps: Double) -> String { fps == fps.rounded() ? String(Int(fps)) : String(format: "%.2f", fps) }
    if abs(captureFps - mediaFps) / mediaFps <= snapTolerance { return "\(round(mediaFps)) fps" }
    return "\(round(captureFps)) → \(round(mediaFps)) fps"
}

/// The cue active at media time `t`: the latest cue starting at or before it.
public func cueAt(_ cues: [Cue], _ t: Double) -> Cue? {
    let i = lastIndexAtOrBefore(cues, t)
    return i >= 0 ? cues[i] : nil
}
