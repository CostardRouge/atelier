// Sending a render HOME — the arithmetic behind "send to <host>" after an
// export. Port of `src/shared/sources/winnow/finals.ts`
// (`docs/winnow-timeline.md` §6, bridge phase 2).
//
// Winnow already models lineage (`assets.original_asset_id`, `/api/reconcile`
// linking a final to the capture it came from by basename + capture time,
// refusing to guess). What Atelier adds is honesty about WHICH capture: a file
// materialised from Winnow is vouched for with `assetId = "<host>/<id>"`, so
// the numeric id is sent along and the match is exact — and only on the
// instance that minted it: a final cut from `a.example`'s clip must never be
// linked on `b.example`.
//
// The path is derived from Winnow's nouns (a chapter id, the file's own name),
// never a trip's: a path is a contract with a filesystem, and a trip's slug
// changes when a trip is renamed. `limits.maxUploadBytes` is checked HERE,
// before a byte moves: behind a tunnel a 4K master fails at 90 %.

import Foundation

/// `"winnow.example/42"` → its two halves; nil for anything else.
public func splitAssetId(_ assetId: String?) -> (host: String, id: Int)? {
    guard let assetId, !assetId.isEmpty, let slash = assetId.lastIndex(of: "/"),
          slash != assetId.startIndex else { return nil }
    let host = String(assetId[..<slash])
    // `Number(…)`: surrounding whitespace is ignored, an empty tail is 0.
    let tail = assetId[assetId.index(after: slash)...].trimmingCharacters(in: .whitespacesAndNewlines)
    guard !host.isEmpty, !tail.isEmpty, let n = Double(tail), n.isFinite, n == n.rounded(), n > 0,
          n < 9_007_199_254_740_992 else { return nil }
    return (host, Int(n))
}

public struct FinalCandidate: Equatable, Sendable {
    public var name: String
    public var size: Int
    /// This file's OWN capture, when a run mixes several (a roll's pictures).
    /// Three states, as on the web: `.none` — absent, the run's `assetId`
    /// stands for it; `.some(nil)` — "no id"; `.some(id)` — its capture.
    public var assetId: String??

    public init(name: String, size: Int, assetId: String?? = .none) {
        self.name = name; self.size = size; self.assetId = assetId
    }
}

public struct FinalsInput: Equatable, Sendable {
    /// The rendered deliverables of one export run.
    public var files: [FinalCandidate]
    /// The source media's identity as the instance vouched for it, or nil — the run's one capture.
    public var assetId: String?
    /// The instance the finals go to — the one the clip came from.
    public var targetSourceId: String
    /// The chapter the clip belongs to, when known. Winnow's noun, not ours.
    public var chapterId: String?
    /// `capabilities.limits.maxUploadBytes`; nil when the instance sets none.
    public var maxUploadBytes: Int?

    public init(files: [FinalCandidate], assetId: String?, targetSourceId: String, chapterId: String? = nil,
                maxUploadBytes: Int?) {
        self.files = files; self.assetId = assetId; self.targetSourceId = targetSourceId
        self.chapterId = chapterId; self.maxUploadBytes = maxUploadBytes
    }
}

public struct FinalsItem: Equatable, Sendable {
    public var name: String
    /// Relative path inside the finals root, `POST /api/upload`'s `paths[]`.
    public var path: String
    public var bytes: Int
    /// THIS file's capture on the target, sent with its own upload; nil = let reconcile match.
    public var originalAssetId: Int?

    public init(name: String, path: String, bytes: Int, originalAssetId: Int?) {
        self.name = name; self.path = path; self.bytes = bytes; self.originalAssetId = originalAssetId
    }
}

public struct FinalsPlan: Equatable, Sendable {
    public var items: [FinalsItem]
    /// The run's one capture on the target when it has one; nil = several, or let reconcile match.
    public var originalAssetId: Int?
    public var chapterId: String?
    public var totalBytes: Int
    /// Why nothing must be sent; empty when the plan is sound.
    public var problems: [String]
    /// Worth saying, not blocking.
    public var notes: [String]
}

/// Where a final lands: under its chapter when one is known, else at the
/// root. A name never carries a directory of its own: every run of `/` or `\`
/// becomes one `_`.
public func finalsPath(_ chapterId: String?, _ name: String) -> String {
    var safe = ""
    var inRun = false
    for ch in name {
        if ch == "/" || ch == "\\" {
            if !inRun { safe.append("_") }
            inRun = true
        } else {
            safe.append(ch)
            inRun = false
        }
    }
    if let chapterId, !chapterId.isEmpty { return "\(chapterId)/\(safe)" }
    return safe
}

public func finalsPlan(_ input: FinalsInput) -> FinalsPlan {
    var problems: [String] = []
    var notes: [String] = []
    let trimmed = input.chapterId?.trimmingCharacters(in: .whitespacesAndNewlines)
    let chapterId = (trimmed?.isEmpty ?? true) ? nil : trimmed
    var items: [FinalsItem] = []
    var unlinked = 0
    for f in input.files {
        let id: String? = f.assetId ?? input.assetId
        var originalAssetId: Int?
        if let split = splitAssetId(id) {
            if split.host != input.targetSourceId {
                problems.append(
                    "\(f.name) was made from a picture picked on \(split.host), not \(input.targetSourceId) — it would be linked to the wrong capture."
                )
            } else {
                originalAssetId = split.id
            }
        } else {
            unlinked += 1
        }
        items.append(FinalsItem(name: f.name, path: finalsPath(chapterId, f.name), bytes: f.size,
                                originalAssetId: originalAssetId))
    }
    let totalBytes = items.reduce(0) { $0 + $1.bytes }

    if items.isEmpty { problems.append("There is nothing to send — export first.") }
    if unlinked > 0 {
        notes.append(
            unlinked == items.count
                ? "This media carries no Winnow id, so the instance will match the final to its capture by name and capture time."
                : "\(unlinked) of these carry no Winnow id; the instance will match those to their captures by name and capture time."
        )
    }

    // The run's ONE capture, for the sentence after a send: only when every
    // linked file names the same one.
    var linked: [Int] = []
    for item in items {
        if let id = item.originalAssetId, !linked.contains(id) { linked.append(id) }
    }
    let originalAssetId = linked.count == 1 ? linked[0] : nil

    if let limit = input.maxUploadBytes, limit > 0 {
        for item in items where item.bytes > limit {
            problems.append(
                "\(item.name) is \(formatBytes(item.bytes)); \(input.targetSourceId) accepts at most \(formatBytes(limit)) per upload."
            )
        }
    }

    return FinalsPlan(items: items, originalAssetId: originalAssetId, chapterId: chapterId, totalBytes: totalBytes,
                      problems: problems, notes: notes)
}
