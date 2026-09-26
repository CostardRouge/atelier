// What a hook's clip is by default — port of the part of
// `src/shared/roadtrip/hook-video.ts` the trip DOCUMENT reads: the length a
// hook is on screen when nothing says otherwise, and its bounds.
//
// Types + reader only; the behaviour of `hook-video.ts` (the clip slice, the
// screen time within a clip, the burn-in plan, the file name) is ported later
// INTO THIS FILE.
//
// The rule kept: a hook runs the badge's own hold plus ONE second of picture
// after it — the trip migrations read it for every stored piece that never
// said its screen time, so no composed piece changes length.

import Foundation

/// The shortest screen time a hook may be given, in seconds.
public let minHookSeconds = 1.0

/// The longest screen time a hook may be given, in seconds.
public let maxHookSeconds = 30.0

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
