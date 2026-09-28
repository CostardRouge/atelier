// The active cue for a playback time. Port of
// `src/shared/telemetry/find-cue.ts` — the web's name over the binary search
// `Telemetry.swift` already carries as `cueAt` / `lastIndexAtOrBefore`, so
// there is one search and two names, not two searches.

import Foundation

/// The last cue whose `start <= t`, or nil if `t` precedes the first cue (or
/// there are no cues). O(log n): a 5-minute clip at ~60 fps has ~18 000 cues,
/// so a linear scan per frame is not acceptable.
///
/// - `cues`: sorted by ascending `start`, as `parseSrt` produces them.
/// - `t`: playback time in seconds.
public func findCue(_ cues: [Cue], _ t: Double) -> Cue? {
    cueAt(cues, t)
}
