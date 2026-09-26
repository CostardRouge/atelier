// What one finished export cost — the feedback line under a variant row.
// Port of `src/shared/media/export-stats.ts`.
//
// These are measurements of THIS machine, right now (a laptop on battery
// renders slower than the same laptop plugged in), which is why they live for
// the session and are never written into the project document: they describe
// the run, not the composition.

import Foundation

public struct ExportStat: Equatable, Sendable {
    /// Size of the delivered file, in bytes.
    public var bytes: Int
    /// Wall-clock seconds from the variant starting to its file being written.
    public var seconds: Double
    /// The clip's own duration in seconds, when known — the divisor of the
    /// realtime ratio. Nil when the transport never reported one, and then
    /// the ratio is simply not shown rather than guessed.
    public var clipSeconds: Double?

    public init(bytes: Int, seconds: Double, clipSeconds: Double?) {
        self.bytes = bytes; self.seconds = seconds; self.clipSeconds = clipSeconds
    }
}

/// JavaScript's `toFixed` for a finite, non-negative value (a half goes UP).
private func fixed(_ x: Double, _ digits: Int) -> String {
    let scale = pow(10.0, Double(digits))
    let n = (x * scale).rounded(.toNearestOrAwayFromZero)
    if digits == 0 { return String(Int64(n)) }
    return String(format: "%.\(digits)f", n / scale)
}

/// A wall-clock render time, read at a glance: `8.3 s`, `41 s`, `1 min 48 s`,
/// `1 h 04 min`. Deliberately NOT `formatDuration`'s `M:SS` — that shape reads
/// as a position in the clip, and these two numbers sit inches apart.
public func formatElapsed(_ seconds: Double) -> String {
    if !seconds.isFinite || seconds < 0 { return "—" }
    if seconds < 10 { return "\(fixed(seconds, 1)) s" }
    if seconds < 60 { return "\(Int(seconds.rounded(.toNearestOrAwayFromZero))) s" }
    let total = Int(seconds.rounded(.toNearestOrAwayFromZero))
    if total < 3600 {
        return "\(total / 60) min " + String(format: "%02d", total % 60) + " s"
    }
    let h = total / 3600
    return "\(h) h " + String(format: "%02d", (total % 3600) / 60) + " min"
}

/// How the render compares to playing the clip: `2.9× realtime`. The only one
/// of the three figures that stays comparable between clips of different
/// lengths. Nil when there is nothing to divide.
public func formatSpeed(_ clipSeconds: Double?, _ seconds: Double) -> String? {
    guard let clipSeconds, clipSeconds.isFinite, clipSeconds > 0 else { return nil }
    guard seconds.isFinite, seconds > 0 else { return nil }
    let ratio = clipSeconds / seconds
    return "\(fixed(ratio, ratio < 10 ? 1 : 0))× realtime"
}

/// The stat line for one finished variant: `412.8 MB · 1 min 48 s · 1.1× realtime`.
public func describeExportStat(_ stat: ExportStat) -> String {
    var parts = [formatBytes(stat.bytes), formatElapsed(stat.seconds)]
    if let speed = formatSpeed(stat.clipSeconds, stat.seconds) { parts.append(speed) }
    return parts.filter { !$0.isEmpty }.joined(separator: " · ")
}

/// The run's total: bytes written and wall-clock spent across every variant.
/// Summed from the per-variant measurements, so it excludes the pauses
/// between them (there are none in practice — the loop is sequential).
public func totalExportStats(_ stats: [ExportStat]) -> (bytes: Int, seconds: Double) {
    stats.reduce((bytes: 0, seconds: 0.0)) { acc, s in (acc.bytes + s.bytes, acc.seconds + s.seconds) }
}

/// The summary line under the button: `2 files · 451.0 MB · 2 min 29 s`.
public func describeExportRun(_ stats: [ExportStat]) -> String {
    let total = totalExportStats(stats)
    let files = "\(stats.count) file\(stats.count == 1 ? "" : "s")"
    return [files, formatBytes(total.bytes), formatElapsed(total.seconds)].joined(separator: " · ")
}
