// Pure presentation helpers — port of `src/shared/lib/format.ts`.
//
// The numbers are formatted the way JavaScript formats them, because these
// strings sit beside ones the web app draws and a `1.5 KB` must read the same
// on both: `toFixed` rounds a half UP (never to even), an integer-valued
// number prints without a decimal, and a byte count is decimal (1 KB = 1000).

import Foundation

/// JavaScript's `Number.prototype.toFixed` for a finite, non-negative value:
/// the closest integer to `x × 10^digits`, a half going UP — `printf` would
/// round an exact half to even and print `250` where the web prints `251`.
private func fixed(_ x: Double, _ digits: Int) -> String {
    let scale = pow(10.0, Double(digits))
    let n = (x * scale).rounded(.toNearestOrAwayFromZero)
    if digits == 0 { return String(Int64(n)) }
    return String(format: "%.\(digits)f", n / scale)
}

/// JavaScript's `${n}`: an integer-valued number prints without `.0`.
private func jsNumber(_ x: Double) -> String {
    if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
    return "\(x)"
}

/// Format a byte count as KB/MB/GB (decimal, 1 KB = 1000 bytes).
public func formatBytes(_ bytes: Double) -> String {
    if !bytes.isFinite || bytes < 0 { return "—" }
    if bytes < 1000 { return "\(jsNumber(bytes)) B" }
    let units = ["KB", "MB", "GB", "TB"]
    var value = bytes / 1000
    var i = 0
    while value >= 1000 && i < units.count - 1 {
        value /= 1000
        i += 1
    }
    return "\(fixed(value, value >= 100 ? 0 : 1)) \(units[i])"
}

/// Format a byte count as KB/MB/GB (decimal, 1 KB = 1000 bytes).
public func formatBytes(_ bytes: Int) -> String {
    formatBytes(Double(bytes))
}

/// Precise current-position readout: `M:SS.cs` (centiseconds).
public func formatTimecode(_ seconds: Double) -> String {
    if !seconds.isFinite || seconds < 0 { return "0:00.00" }
    let m = Int((seconds / 60).rounded(.down))
    let s = Int(seconds.truncatingRemainder(dividingBy: 60).rounded(.down))
    let cs = Int((seconds.truncatingRemainder(dividingBy: 1) * 100).rounded(.down))
    return "\(m):" + String(format: "%02d", s) + "." + String(format: "%02d", cs)
}

/// Format a duration in seconds as `M:SS` or `H:MM:SS`.
public func formatDuration(_ seconds: Double?) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else {
        return "duration unavailable"
    }
    let total = Int(seconds.rounded(.toNearestOrAwayFromZero))
    let h = total / 3600
    let m = (total % 3600) / 60
    let s = total % 60
    let mm = String(format: "%02d", m)
    let ss = String(format: "%02d", s)
    return h > 0 ? "\(h):\(mm):\(ss)" : "\(m):\(ss)"
}
