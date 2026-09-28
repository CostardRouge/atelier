// The still a frame grab is saved under — the pure half of
// `src/shared/media/frame-grab.ts` (`frameGrabName`). The capture itself (the
// composed frame at the source's full resolution, graded and burnt in through
// the same drawing the export uses, never scraped from the preview) is the
// app's: `Studio/Stage/StudioFrameGrab.swift`.

import Foundation

/// `clip` at 72.4 s → `clip-frame-1m12s.jpg` — sortable, no punctuation: the
/// time floored to the second and never negative, any extension dropped from
/// the base, `frame` when the base is empty.
public func frameGrabName(_ base: String, _ seconds: Double) -> String {
    let total = seconds.isFinite ? max(0, Int(seconds.rounded(.down))) : 0
    let m = total / 60
    let s = total % 60
    let stamp = m > 0 ? "\(m)m\(String(format: "%02d", s))s" : "\(s)s"
    var clean = base.trimmingCharacters(in: .whitespacesAndNewlines)
    // `/\.[^.]+$/`: the last dot and what follows it, when something does.
    if let dot = clean.lastIndex(of: "."), clean.index(after: dot) < clean.endIndex {
        clean = String(clean[..<dot])
    }
    if clean.isEmpty { clean = "frame" }
    return "\(clean)-frame-\(stamp).jpg"
}
