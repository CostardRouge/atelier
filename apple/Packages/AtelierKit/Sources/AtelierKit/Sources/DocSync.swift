// The bookkeeping of a document kept on a connected instance — a REDUCER
// beside the document, shared by trips, projects and rolls. Port of
// `src/shared/sources/doc-sync.ts`.
//
// A remote document has a local mirror; the remote copy is the AUTHORITY and
// the mirror is a cache of that ONE document, never a second truth
// (`docs/roadtrip-persistence.md` D1: local now, remote on idle). This module
// decides what the mirror knows about its distance from the authority: whether
// it is dirty, whether a push is due, and — the honesty rule — the exact
// sentence the status pill prints for every state. No sync engine: one
// document, last-write-wins, an etag that REFUSES a stale write and says so.
//
// The record is NOT on the document. Put there it would leak into the file
// and onto the wire; on the web it is a sibling row in the same database
// (each store's `sync` object store), here a sidecar the app keeps beside
// the document (`SyncRecord.json` / `readSyncRecord`). `dirtyAt` persisting
// is the whole crash story: an app killed mid-edit leaves the record dirty,
// and the next open on that device pushes it.
//
// Pure: the clock is an argument everywhere the web read `Date.now()`, and
// the reader's own clock (`clockTime`) is a `TimeZone` argument.

import Foundation

public enum SyncStatus: String, CaseIterable, Sendable {
    /// The mirror equals what the server acknowledged.
    case synced
    /// A local edit is newer than `etag`; a push is due after the idle delay.
    case dirty
    /// A push is in flight.
    case saving
    /// The instance did not answer; kept here, retried on the next trigger.
    case offline
    /// 401: the session there has ended — sign in, then it retries.
    case unauthenticated
    /// 403: this account may not write there. Stops retrying until reopened.
    case forbidden
    /// 412: changed elsewhere since our etag. Nothing overwritten; the author decides.
    case conflict
    /// 404 on push: deleted elsewhere. Keep here as local, or delete here.
    case gone
}

/// What the server holds when it refused us — enough for the pill and for "keep mine".
public struct TheirCopy: Equatable, Sendable {
    public var etag: String
    /// ISO timestamp, as the server reports it; nil when it did not say.
    public var updatedAt: String?

    public init(etag: String, updatedAt: String?) { self.etag = etag; self.updatedAt = updatedAt }
}

public struct SyncRecord: Equatable, Sendable {
    /// The document id — the same key as the document.
    public var id: String
    /// The host, as the source id mints it.
    public var sourceId: String
    /// What the server last acknowledged; nil = never pushed.
    public var etag: String?
    public var syncedAt: Double?
    /// The LAST local edit newer than `etag`, or nil when clean. Survives a relaunch.
    public var dirtyAt: Double?
    /// When the in-flight push began — an edit after it keeps the record dirty.
    public var pushStartedAt: Double?
    public var status: SyncStatus
    /// The last failure's sentence, for the pill; nil when there is none.
    public var error: String?
    /// The server's copy behind a `conflict`; nil otherwise.
    public var theirs: TheirCopy?

    public init(id: String, sourceId: String, etag: String? = nil, syncedAt: Double? = nil, dirtyAt: Double? = nil,
                pushStartedAt: Double? = nil, status: SyncStatus, error: String? = nil, theirs: TheirCopy? = nil) {
        self.id = id; self.sourceId = sourceId; self.etag = etag; self.syncedAt = syncedAt; self.dirtyAt = dirtyAt
        self.pushStartedAt = pushStartedAt; self.status = status; self.error = error; self.theirs = theirs
    }
}

/// How a push failed, in the client's own vocabulary (the web's `WinnowErrorKind`).
public enum PushFailure: String, CaseIterable, Sendable {
    case unreachable
    case unauthenticated
    case forbidden
    case conflict
    case notfound
    case `protocol`
}

public enum SyncEvent: Equatable, Sendable {
    case edited(now: Double)
    case pushStarted(now: Double)
    case pushOk(etag: String, now: Double)
    case pushFailed(kind: PushFailure, message: String? = nil, theirs: TheirCopy? = nil)
    case pulled(etag: String, now: Double)
    /// After a conflict: re-push over the server's copy, with its etag.
    case resolvedKeepMine
    /// After a conflict: the mirror was replaced by the server's copy.
    case resolvedTakeTheirs(etag: String, now: Double)
}

/// A record for a document that has never been pushed.
public func newSyncRecord(id: String, sourceId: String, now: Double) -> SyncRecord {
    SyncRecord(id: id, sourceId: sourceId, etag: nil, syncedAt: nil, dirtyAt: now, pushStartedAt: nil,
               status: .dirty, error: nil, theirs: nil)
}

private func failureStatus(_ kind: PushFailure) -> SyncStatus {
    switch kind {
    case .unreachable: return .offline
    case .unauthenticated: return .unauthenticated
    case .forbidden: return .forbidden
    case .conflict: return .conflict
    case .notfound: return .gone
    // Any other refusal (5xx, a body cap, a bad body) keeps the edit and retries.
    case .protocol: return .dirty
    }
}

/// The states that hold until a person acts; an edit does not move them.
private let heldStatuses: Set<SyncStatus> = [.conflict, .gone, .forbidden]

public func reduceSync(_ record: SyncRecord, _ event: SyncEvent) -> SyncRecord {
    var r = record
    switch event {
    case .edited(let now):
        // A held state stays held — the author has a decision to make and an
        // edit does not make it for them; the edit is kept in the mirror. A
        // push in flight stays in flight; the edit after it is what `pushOk`
        // reads to know the mirror moved on.
        let keeps = heldStatuses.contains(record.status) || record.status == .saving
        r.dirtyAt = now
        r.status = keeps ? record.status : .dirty
    case .pushStarted(let now):
        r.status = .saving
        r.pushStartedAt = now
        r.error = nil
    case .pushOk(let etag, let now):
        let movedOn: Bool
        if let dirtyAt = record.dirtyAt, let started = record.pushStartedAt {
            movedOn = dirtyAt > started
        } else {
            movedOn = false
        }
        r.etag = etag
        r.syncedAt = now
        r.pushStartedAt = nil
        r.error = nil
        r.theirs = nil
        r.status = movedOn ? .dirty : .synced
        r.dirtyAt = movedOn ? record.dirtyAt : nil
    case .pushFailed(let kind, let message, let theirs):
        r.pushStartedAt = nil
        r.status = failureStatus(kind)
        r.error = message
        r.theirs = kind == .conflict ? theirs : nil
    case .pulled(let etag, let now), .resolvedTakeTheirs(let etag, let now):
        r.etag = etag
        r.syncedAt = now
        r.dirtyAt = nil
        r.pushStartedAt = nil
        r.status = .synced
        r.error = nil
        r.theirs = nil
    case .resolvedKeepMine:
        // Adopt the server's etag so the next push is accepted; the edit is
        // still ours, so the record is dirty and flushes on the next trigger.
        r.etag = record.theirs?.etag ?? record.etag
        r.status = .dirty
        r.dirtyAt = record.dirtyAt ?? record.syncedAt ?? 0
        r.error = nil
        r.theirs = nil
    }
    return r
}

/// The quiet before a push — long enough that typing does not push per word.
public let remoteIdleMs: Double = 5000

/// Whether a push is due now. Dirty after the idle delay, yes. Offline or
/// signed out: yes — every trigger is a retry, since only trying can tell that
/// the network or the session is back. Forbidden, conflict, gone: no — a
/// person has to act first. Saving: no, one push at a time.
public func shouldFlush(_ record: SyncRecord, now: Double, idleMs: Double = remoteIdleMs) -> Bool {
    guard let dirtyAt = record.dirtyAt else { return false }
    switch record.status {
    case .dirty, .offline, .unauthenticated:
        return now - dirtyAt >= idleMs
    default:
        return false
    }
}

/// JavaScript's `Math.round`: half rounds UP (towards +∞), not away from zero.
private func roundHalfUp(_ x: Double) -> Int {
    Int((x + 0.5).rounded(.down))
}

/// "just now", "2 min ago", "3 h ago", "2 days ago".
public func describeAgo(_ ms: Double) -> String {
    if ms < 45_000 { return "just now" }
    let min = roundHalfUp(ms / 60_000)
    if min < 60 { return "\(min) min ago" }
    let h = roundHalfUp(ms / 3_600_000)
    if h < 24 { return "\(h) h ago" }
    let d = roundHalfUp(ms / 86_400_000)
    return "\(d) day\(d == 1 ? "" : "s") ago"
}

private func twoDigits(_ n: Int) -> String {
    n < 10 ? "0\(n)" : "\(n)"
}

/// An ISO 8601 instant, with or without fractional seconds — what a Winnow
/// stamps a row with. Nil when the text is not one (the web's `Date.parse`
/// answering NaN).
private func parseInstant(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: iso) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: iso)
}

/// `HH:MM` in the reader's own clock, or nil when the stamp is unreadable.
private func clockTime(_ iso: String?, timeZone: TimeZone) -> String? {
    guard let iso, let instant = parseInstant(iso) else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let parts = calendar.dateComponents([.hour, .minute], from: instant)
    guard let hour = parts.hour, let minute = parts.minute else { return nil }
    return "\(twoDigits(hour)):\(twoDigits(minute))"
}

/// The sentence the pill prints. Every status yields the line it really means
/// — the same rule as the badge panels: no state is described in the abstract
/// when the concrete sentence can be shown. `timeZone` is the reader's clock,
/// the one a conflict's "at 14:02" is told in.
public func pillText(_ record: SyncRecord, sourceLabel: String, now: Double, timeZone: TimeZone = .current) -> String {
    switch record.status {
    case .synced:
        guard let syncedAt = record.syncedAt else { return "saved to \(sourceLabel)" }
        return "saved to \(sourceLabel) · \(describeAgo(now - syncedAt))"
    case .dirty:
        if let error = record.error {
            return "could not save to \(sourceLabel): \(error) — kept on this device, will retry"
        }
        return "unsaved changes — saving to \(sourceLabel) shortly"
    case .saving:
        return "saving to \(sourceLabel)…"
    case .offline:
        return "offline — kept on this device, will retry"
    case .unauthenticated:
        return "sign in to \(sourceLabel) to keep saving"
    case .forbidden:
        return "this account cannot save on \(sourceLabel) — kept on this device"
    case .conflict:
        if let at = clockTime(record.theirs?.updatedAt, timeZone: timeZone) {
            return "refused: changed on another device at \(at)"
        }
        return "refused: changed on another device"
    case .gone:
        return "deleted on \(sourceLabel)"
    }
}

/// The ONE word the collapsed pill wears in a header row. The sentence above is
/// the truth and stays one tap away; this is what fits beside a back button and
/// a settings gear without costing the row a second line. Sentence case: the
/// pill applies its own casing, so the string stays readable as the control's
/// accessible name too.
public func pillLabel(_ status: SyncStatus) -> String {
    switch status {
    case .synced: return "Saved"
    case .dirty: return "Unsaved"
    case .saving: return "Saving…"
    case .offline: return "Offline"
    case .unauthenticated: return "Sign in"
    case .forbidden: return "Read-only"
    case .conflict: return "Conflict"
    case .gone: return "Deleted"
    }
}

/// Whether the state is waiting on the author rather than on the clock. These
/// are the four the pill must never shrink to a bare dot: a decision nobody is
/// asked to make does not get made. `forbidden` is in for a different reason —
/// nothing in the app can fix it, so it has to be legible where it happened.
public func pillNeedsAction(_ status: SyncStatus) -> Bool {
    status == .unauthenticated || status == .forbidden || status == .conflict || status == .gone
}

/// A pull of one document, as a tool's remote driver reports it.
public enum PullOutcome<D> {
    /// 304: the mirror's etag is the server's.
    case current
    case fetched(doc: D, etag: String, updatedAt: String)
    case failed(kind: PushFailure, message: String, theirs: TheirCopy?)
}

/// What `afterPull` decides: the document to take (nil for none) and the event
/// to reduce (nil for none).
public struct AfterPull<D> {
    public var take: D?
    public var event: SyncEvent?

    public init(take: D?, event: SyncEvent?) { self.take = take; self.event = event }
}

extension AfterPull: Equatable where D: Equatable {}

/// What opening a document kept on an instance does with the answer to "did it
/// move?" — the resume workflow, once for every kind of document:
///
/// - still current → nothing;
/// - newer there and the mirror is CLEAN → take the server's copy silently;
/// - newer there and the mirror is DIRTY → a conflict, nothing overwritten —
///   the pill offers the two ways out;
/// - unreachable, signed out, gone → say it, except a protocol error on a
///   clean mirror, which is not worth a sentence (the next push reports it).
///
/// `now` stamps the `pulled` event; the web read `Date.now()` there.
public func afterPull<D>(_ record: SyncRecord, _ pulled: PullOutcome<D>, now: Double) -> AfterPull<D> {
    switch pulled {
    case .current:
        return AfterPull(take: nil, event: nil)
    case .fetched(let doc, let etag, let updatedAt):
        if record.dirtyAt == nil {
            return AfterPull(take: doc, event: .pulled(etag: etag, now: now))
        }
        let theirs = TheirCopy(etag: etag, updatedAt: updatedAt)
        return AfterPull(take: nil, event: .pushFailed(kind: .conflict, message: "changed on another device", theirs: theirs))
    case .failed(let kind, let message, let theirs):
        if kind == .protocol && record.dirtyAt == nil { return AfterPull(take: nil, event: nil) }
        return AfterPull(take: nil, event: .pushFailed(kind: kind, message: message, theirs: theirs))
    }
}

// MARK: - the record as a sidecar

extension SyncRecord {
    /// The record as JSON — the same keys the web's `sync` store holds, nulls
    /// where the web writes nulls, so a sidecar diffs cleanly against a row.
    public var json: JSONValue {
        var o: [String: JSONValue] = [:]
        o["id"] = .string(id)
        o["sourceId"] = .string(sourceId)
        o["etag"] = etag.map { JSONValue.string($0) } ?? .null
        o["syncedAt"] = syncedAt.map { JSONValue.number($0) } ?? .null
        o["dirtyAt"] = dirtyAt.map { JSONValue.number($0) } ?? .null
        o["pushStartedAt"] = pushStartedAt.map { JSONValue.number($0) } ?? .null
        o["status"] = .string(status.rawValue)
        o["error"] = error.map { JSONValue.string($0) } ?? .null
        if let theirs {
            o["theirs"] = .object([
                "etag": .string(theirs.etag),
                "updatedAt": theirs.updatedAt.map { JSONValue.string($0) } ?? .null,
            ])
        } else {
            o["theirs"] = .null
        }
        return .object(o)
    }
}

/// A stored record, or nil when it names no document. A status this build
/// does not know is read from the stamps: dirty when an edit is pending, else
/// synced — never a state the reducer cannot leave.
public func readSyncRecord(_ raw: JSONValue?) -> SyncRecord? {
    guard let o = raw?.objectValue,
          let id = o["id"]?.stringValue, !id.isEmpty,
          let sourceId = o["sourceId"]?.stringValue, !sourceId.isEmpty else { return nil }
    let dirtyAt = o["dirtyAt"]?.finiteNumber
    let status = (o["status"]?.stringValue).flatMap { SyncStatus(rawValue: $0) } ?? (dirtyAt == nil ? .synced : .dirty)
    var theirs: TheirCopy? = nil
    if let t = o["theirs"]?.objectValue, let etag = t["etag"]?.stringValue {
        theirs = TheirCopy(etag: etag, updatedAt: t["updatedAt"]?.stringValue)
    }
    return SyncRecord(
        id: id,
        sourceId: sourceId,
        etag: o["etag"]?.stringValue,
        syncedAt: o["syncedAt"]?.finiteNumber,
        dirtyAt: dirtyAt,
        pushStartedAt: o["pushStartedAt"]?.finiteNumber,
        status: status,
        error: o["error"]?.stringValue,
        theirs: theirs
    )
}
