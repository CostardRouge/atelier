// Burning an animated hook into a clip: the arithmetic — port of
// `src/shared/roadtrip/hook-video.ts`. The video itself is not rendered here:
// the export pipeline decodes, reframes, burns overlays in and muxes; this
// module only says WHICH slice of the clip goes out and under what name.
//
// Rules kept:
// - A hook runs the badge's own hold plus ONE second of picture after it —
//   the trip migrations read it for every stored piece that never said its
//   screen time, so no composed piece changes length.
// - The badge's animation windows count from the FIRST EXPORTED frame, and the
//   pipeline gets that from the trim's in point: the clip starts on the frame
//   the author picked, so the entrance lands on frame one.
// - A slide stores its SCREEN time and its speed; the source stretch
//   (`clipSlice`) is derived here and nowhere else, so the trim bar, the
//   rail's length and the encoder's cut cannot disagree.
// - A speed other than 1 ships SILENT (audio is copied, never re-encoded),
//   and is not written into the file name: it is composition, not a second cut.

import Foundation

/// The shortest screen time a hook may be given, in seconds.
public let minHookSeconds = 1.0

/// The longest screen time a hook may be given, in seconds.
public let maxHookSeconds = 30.0

/// The speeds a clip slide is offered at — the Studio's own steps. The web's `CLIP_SPEEDS`.
public let clipSpeeds: [Double] = [0.25, 0.5, 1, 2, 4]

/// hook-video's own clamp: a value that is not a finite number lands on `lo`.
private func hookClamp(_ value: Double, _ lo: Double, _ hi: Double) -> Double {
    if !value.isFinite { return lo }
    return Swift.min(hi, Swift.max(lo, value))
}

/// How long the clip should run by default: the badge's own hold plus a beat
/// of picture after it. A duration that is not a finite number (a stored one
/// that was never written) counts as no hold — the web's `Number.isFinite`
/// guard — so it lands on the shortest hook.
public func defaultHookSeconds(_ badgeDurationSeconds: Double?) -> Double {
    let held = badgeDurationSeconds ?? .nan
    let base = held.isFinite ? held : 0
    let wanted = ExifText.jsRound(base + 1)
    return min(maxHookSeconds, max(minHookSeconds, wanted))
}

/// The speed a slide really plays at: the Studio's clamp, 1 for anything odd.
public func clipSpeed(_ speed: Double?) -> Double {
    resolveSpeed(speed)
}

/// The stretch of the SOURCE a slide delivers: from its in point, as much
/// footage as its screen time holds at its speed — `seconds × speed` of the
/// clip — never past the end. With an unknown duration the clip is assumed
/// long enough: the range is the ask.
public func clipSlice(_ inSeconds: Double, _ screenSeconds: Double, _ speed: Double, _ duration: Double) -> TrimRange {
    let rate = clipSpeed(speed)
    let total = duration.isFinite && duration > 0 ? duration : Double.infinity
    let start = hookClamp(inSeconds, 0, Swift.max(0, total - minHookSeconds / 4))
    let length = Swift.max((minHookSeconds / 4) * rate, screenSeconds * rate)
    return TrimRange(start: start, end: Swift.min(total, start + length))
}

/// How long `range` of the source is on screen at `speed`.
public func screenSecondsOf(_ range: TrimRange, _ speed: Double) -> Double {
    Swift.max(0, range.end - range.start) / clipSpeed(speed)
}

/// The most screen time a slide can honestly promise: what is left of the
/// clip after its in point, stretched or squeezed by the speed, within the
/// control's own bounds. Unknown duration → the control's ceiling.
public func screenSecondsCeiling(_ inSeconds: Double, _ speed: Double, _ duration: Double) -> Double {
    if !duration.isFinite || duration <= 0 { return maxHookSeconds }
    let left = Swift.max(0, duration - Swift.max(0, inSeconds))
    return hookClamp(left / clipSpeed(speed), minHookSeconds, maxHookSeconds)
}

/// A slide's screen time, clamped to what its clip can deliver from its in
/// point at its speed.
public func screenSecondsWithin(_ wanted: Double, _ inSeconds: Double, _ speed: Double, _ duration: Double) -> Double {
    hookClamp(wanted, minHookSeconds, screenSecondsCeiling(inSeconds, speed, duration))
}

/// A slide re-timed to another speed keeps the FOOTAGE it delivers and changes
/// how long that footage is on screen — "play this at 2×" is the same six
/// seconds of the shot, in three.
public func retimedScreenSeconds(_ screenSeconds: Double, _ fromSpeed: Double, _ toSpeed: Double) -> Double {
    let source = screenSeconds * clipSpeed(fromSpeed)
    return hookClamp(source / clipSpeed(toSpeed), minHookSeconds / 4, maxHookSeconds)
}

/// The length actually offered, given the clip in hand: the author's choice
/// when they made one, the badge's own hold otherwise, never longer than the
/// clip itself.
public func hookSecondsWithin(_ preferred: Double?, _ badgeDurationSeconds: Double, _ duration: Double,
                              _ inSeconds: Double = 0, _ speed: Double = 1) -> Double {
    let wanted = preferred ?? defaultHookSeconds(badgeDurationSeconds)
    return screenSecondsWithin(wanted, inSeconds, speed, duration)
}

/// Why this file cannot be burned in, in a sentence, or nil when it can. The
/// pipeline demuxes MP4 (and the MOV/M4V that share its boxes) and nothing
/// else; the still export has no such limit, which is why it is said.
public func hookSourceProblem(_ fileName: String, _ mimeType: String = "") -> String? {
    if fileName.range(of: #"\.(mp4|mov|m4v)$"#, options: [.regularExpression, .caseInsensitive]) != nil { return nil }
    if mimeType.range(of: #"^video/(mp4|quicktime)$"#, options: [.regularExpression, .caseInsensitive]) != nil { return nil }
    return "The video burn-in reads MP4 and MOV only — \(fileName) is not one. The slide still exports as a PNG."
}

/// The slice to encode, or nil when the whole clip goes out as it is (an
/// unknown duration, or a length that already covers everything). Nil is not a
/// failure: the pipeline reads it as "no trim". `lengthSeconds` is SCREEN time.
public func hookRange(_ startSeconds: Double, _ lengthSeconds: Double, _ duration: Double,
                      _ speed: Double = 1) -> TrimRange? {
    if !duration.isFinite || duration <= 0 { return nil }
    let slice = clipSlice(startSeconds, lengthSeconds, speed, duration)
    if slice.start <= 0 && slice.end >= duration { return nil }
    return slice
}

/// The export variant for a hook: the post's own frame, burned overlays, the
/// clip's own cadence and the slide's speed (a re-timed clip ships silent).
public func hookVariant(_ aspectId: String, _ resolution: VariantResolution = .shortSide(1080), _ speed: Double = 1,
                        id: String = UUID().uuidString.lowercased()) -> ExportVariant {
    var variant = createVariant(aspectId, id: id)
    variant.resolution = resolution
    variant.frameRate = .source
    variant.speed = clipSpeed(speed)
    variant.overlays = true
    return variant
}

/// `australia-day-27-hook-9x16-1080p.mp4` — recognisable in a downloads
/// folder. The speed is deliberately NOT in the name.
public func hookVideoName(_ tripName: String, _ postSlug: String, _ variant: ExportVariant) -> String {
    let stem = [tripName, postSlug, "hook"].map(TripJS.fileSlug).filter { !$0.isEmpty }.joined(separator: "-")
    var unsped = variant
    unsped.speed = 1
    return variantFileName(stem.isEmpty ? "hook" : stem, unsped)
}

extension TripJS {
    /// The deck's and the hook file's slug: trimmed, every run of characters
    /// outside JavaScript's ASCII `\w` and `-` made one `-`, dashes collapsed,
    /// one leading and one trailing dash dropped, lower-cased.
    static func fileSlug(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        var out = ""
        var inRun = false
        for scalar in trimmed.unicodeScalars {
            let v = scalar.value
            let word = (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
                || v == 0x5F || v == 0x2D
            if word {
                out.unicodeScalars.append(scalar)
                inRun = false
            } else if !inRun {
                out.append("-")
                inRun = true
            }
        }
        // `/-+/g` → `-`.
        var collapsed = ""
        var lastDash = false
        for ch in out {
            if ch == "-" {
                if !lastDash { collapsed.append(ch) }
                lastDash = true
            } else {
                collapsed.append(ch)
                lastDash = false
            }
        }
        // `/^-|-$/g`: one at each end.
        if collapsed.hasPrefix("-") { collapsed.removeFirst() }
        if collapsed.hasSuffix("-") { collapsed.removeLast() }
        return collapsed.lowercased()
    }
}
