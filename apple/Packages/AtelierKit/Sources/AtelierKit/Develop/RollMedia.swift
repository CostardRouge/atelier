// Where a roll picture's BYTES are, told apart from where its numbers are.
// Port of `src/shared/develop/roll-media.ts`.
//
// A roll holds references (`Roll.swift`); the pixels are found at the moment
// a picture is looked at. A picture from a Winnow is fetched back by the roll
// itself from the address its ref carries, near the open one, never into the
// Library (`develop-media.md`, the maintainer's Q1–Q3). These are the rules
// that decide what is asked for, in which order, and what is kept; the app's
// fetcher runs them.
//
// The web's `File` is the kernel's `SavedMediaRef` (name · size ·
// lastModified), as in `Library/Assets.swift`. `Date.now()` is a parameter.

import Foundation

/// What the editor can say about one picture's bytes.
public enum PictureAvailability: Equatable, Sendable {
    /// In hand — from the Library, the roll's folders, or fetched by the roll.
    case ready
    /// Not in hand, but its working preview is: developable, not full size.
    case preview
    /// Being fetched from its instance right now.
    case fetching(sourceId: String)
    /// On a connected instance, not asked for yet (it is not near the open picture).
    case waiting(sourceId: String)
    /// The instance answered badly; `loginUrl` when signing in is the answer.
    case failed(sourceId: String, problem: String, loginUrl: String? = nil)
    /// The instance no longer has it (purged, or soft-deleted).
    case gone(sourceId: String)
    /// Kept on an instance this device has not been connected to.
    case unconnected(sourceId: String)
    /// A file from this machine that is not open right now.
    case local
}

/// How far either side of the open picture the roll fetches ahead.
public let fetchRadius = 2
/// How far either side a fetched picture is kept before it is let go.
public let keepRadius = 6

/// The pictures to fetch, in the order they are wanted: the open one, then its
/// neighbours alternating after/before, out to `radius`. The strip is read
/// forwards, so the next picture comes before the previous one.
public func fetchOrder(_ ids: [String], _ openId: String?, radius: Int = fetchRadius) -> [String] {
    if ids.isEmpty { return [] }
    let at = openId.flatMap { id in ids.firstIndex(of: id) } ?? 0
    var out = [ids[at]]
    if radius >= 1 {
        for d in 1...radius {
            if at + d < ids.count { out.append(ids[at + d]) }
            if at - d >= 0 { out.append(ids[at - d]) }
        }
    }
    return out
}

/// The pictures whose fetched bytes are worth keeping while `openId` is open.
public func keepWindow(_ ids: [String], _ openId: String?, radius: Int = keepRadius) -> Set<String> {
    if ids.isEmpty { return [] }
    let at = openId.flatMap { id in ids.firstIndex(of: id) } ?? 0
    let lo = max(0, at - radius)
    let hi = min(ids.count, at + radius + 1)
    return lo < hi ? Set(ids[lo..<hi]) : []
}

public struct AvailabilitySummary: Equatable, Sendable {
    public var fetching = 0
    /// Shown from a working preview.
    public var previewed = 0
    /// Failed or gone, per instance: the problem worth saying once.
    public var failed = 0
    public var gone = 0
    public var unconnected = 0
    public var local = 0
    /// The first instance that failed or no longer has a picture.
    public var sourceId: String? = nil
    /// The first instance this device is not connected to — a different one, often.
    public var unconnectedSourceId: String? = nil
    /// The first problem, as the instance put it.
    public var problem: String? = nil
    public var loginUrl: String? = nil

    public init() {}
}

/// One line's worth of facts about a roll's bytes, in the strip's order.
public func summarizeAvailability(_ ids: [String], _ availability: [String: PictureAvailability]) -> AvailabilitySummary {
    var out = AvailabilitySummary()
    for id in ids {
        guard let a = availability[id] else { continue }
        switch a {
        case .fetching:
            out.fetching += 1
        case .preview:
            out.previewed += 1
        case .failed(let sourceId, let problem, let loginUrl):
            out.failed += 1
            if out.sourceId == nil { out.sourceId = sourceId }
            if out.problem == nil { out.problem = problem }
            if out.loginUrl == nil { out.loginUrl = loginUrl }
        case .gone(let sourceId):
            out.gone += 1
            if out.sourceId == nil { out.sourceId = sourceId }
        case .unconnected(let sourceId):
            out.unconnected += 1
            if out.unconnectedSourceId == nil { out.unconnectedSourceId = sourceId }
        case .local:
            out.local += 1
        case .ready, .waiting:
            break
        }
    }
    return out
}

/// What the stage says over a picture whose bytes are not in hand.
public func availabilityText(_ name: String, _ a: PictureAvailability?) -> String {
    switch a {
    case .fetching(let sourceId)?:
        return "Fetching \(name) from \(sourceId)…"
    case .waiting(let sourceId)?:
        return "\(name) is on \(sourceId) — fetching it next."
    case .failed(_, let problem, _)?:
        return "\(name) could not be fetched: \(problem)"
    case .gone(let sourceId)?:
        return "\(sourceId) no longer has \(name). Its numbers are kept."
    case .unconnected(let sourceId)?:
        return "\(name) is kept on \(sourceId), which this browser is not connected to — connect it in Sources."
    default:
        return "\(name) is a file from this computer that is not open right now — reopen its folder, or drop it on the roll. Its numbers can still be set."
    }
}

/// The calendar day a picture was taken, in THIS device's zone (`YYYY-MM-DD`)
/// — the day the "add a day" sheet opens on. A ref's `lastModified` is the
/// capture instant for a fetched file; an unknown one (0) falls back to `now`.
public func pictureDay(_ lastModified: Double, now: Double = nowMillis(), timeZone: TimeZone = .current) -> String {
    let ms = lastModified > 0 ? lastModified : now
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ms / 1000))
    return "\(dayPart(parts.year ?? 1970, 4))-\(dayPart(parts.month ?? 1, 2))-\(dayPart(parts.day ?? 1, 2))"
}

/// `String(n).padStart(width, '0')`.
private func dayPart(_ n: Int, _ width: Int) -> String {
    let s = String(n)
    return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
}

/// The photographs among `files`, as the Library would read them: grouped by
/// base name, a RAW yielding to its own JPEG, clips and logs left out.
public func photoFiles(_ files: [SavedMediaRef]) -> [SavedMediaRef] {
    buildAssets(files).compactMap { $0.kind == .photo ? $0.parts.image : nil }
}

/// The capture files BESIDE those photographs — the DNG beside a JPEG, the HIF
/// beside an ARW — that lost the image slot (`AssetParts.siblings`). A roll
/// never lists them; the workbench offers them as the picture's other
/// renditions, found again by base name.
public func captureSiblings(_ files: [SavedMediaRef]) -> [SavedMediaRef] {
    buildAssets(files).flatMap { $0.kind == .photo ? ($0.parts.siblings ?? []) : [] }
}

/// What a set of incoming refs means for a roll: how many are pictures it
/// already holds (found again), and which are new — each once, in order.
public func splitByRoll(_ held: [SavedMediaRef], _ incoming: [SavedMediaRef]) -> (found: Int, fresh: [SavedMediaRef]) {
    var found = 0
    var fresh: [SavedMediaRef] = []
    for ref in incoming {
        if held.contains(where: { sameMediaRef($0, ref) }) {
            found += 1
        } else if !fresh.contains(where: { sameMediaRef($0, ref) }) {
            fresh.append(ref)
        }
    }
    return (found, fresh)
}
