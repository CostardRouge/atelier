// A Studio project's media that lives on an INSTANCE — which of it this
// device lost with the last session, what the editor says while it fetches it
// back, what a save must keep meanwhile — and the day the open media was
// captured, which the Studio publishes to the Library. No web twin: the web's
// Studio reads the Library pool, which a reload empties, and neither fetches a
// project's instance media back nor publishes a day. Trips and Develop do the
// first (`resolve-media.ts`, `use-collage-refetch.ts`), and these are their
// rules applied to a project (`architecture.md`, «A remote ref is re-FETCHED,
// never cached»):
//
// - Only a CONNECTED instance is asked, and only when a project opens: a
//   stored id is never a reason to call a server nobody named. A ref with no
//   id, or naming `local`, is a folder file — the folder banner's business.
// - One fetch per CAPTURE: a clip and its `.srt` share one id, and the
//   capture is named by its main file, never by its log.
// - An instance that no longer has the asset (`gone`) is said as such; one
//   that answered badly says ITS reason, "not signed in" with the sign-in.
// - A save while a media is out of reach KEEPS its ref. What a save writes is
//   the working set, and a clip being fetched back — or kept on an instance
//   this device is not connected to — must not fall off the project because
//   the device has not got it yet. A capture the instance no longer has is
//   an ordinary missing file, removable like any other.
//
// The capture day is MEASURED or absent (the badge's rule, `media-date.ts`):
// a clip's own log, else a still's EXIF, else the capture instant a source
// dated a fetched file with. A local file's modified time is not a capture
// day, and the Studio says nothing rather than publish one.

import Foundation

/// Where one capture of the project stands on its way back.
public enum StudioRecoveryPhase: String, Equatable, Sendable, CaseIterable {
    /// Its instance is connected and is being asked.
    case fetching
    /// Its instance answered that it no longer has it.
    case gone
    /// Its instance answered badly — `reason` says how.
    case failed
    /// Its instance is not connected on this device.
    case unreachable
}

/// One capture the project names on an instance and this device does not hold.
public struct StudioRecoveryItem: Equatable, Sendable {
    /// The refs' `assetId` — `<host>/<id>`, one per capture.
    public var key: String
    /// The instance that holds it.
    public var sourceId: String
    /// Its main file's name, as the project saved it.
    public var name: String
    public var phase: StudioRecoveryPhase
    /// What the instance said, for `failed`.
    public var reason: String?
    /// The instance wants a sign-in first.
    public var signIn: Bool

    public init(key: String, sourceId: String, name: String, phase: StudioRecoveryPhase, reason: String? = nil,
                signIn: Bool = false) {
        self.key = key; self.sourceId = sourceId; self.name = name; self.phase = phase
        self.reason = reason; self.signIn = signIn
    }
}

/// The project's missing media that an instance holds, one item per capture,
/// in the saved order: `fetching` where `connected` says its instance is
/// connected here, `unreachable` otherwise.
public func remoteMissingMedia(_ reconciliation: Reconciliation?, connected: (String) -> Bool) -> [StudioRecoveryItem] {
    guard let reconciliation else { return [] }
    var order: [String] = []
    var byKey: [String: StudioRecoveryItem] = [:]
    for item in reconciliation.items where item.status == .missing {
        guard let key = refetchKey(item.ref), let split = splitAssetId(key), split.host != defaultSourceId else { continue }
        let isLog = classifyPart(item.ref.name) == .srt
        if var known = byKey[key] {
            // The capture is named by its clip or its still, never by its log.
            if !isLog && classifyPart(known.name) == .srt {
                known.name = item.ref.name
                byKey[key] = known
            }
            continue
        }
        order.append(key)
        let phase: StudioRecoveryPhase = connected(split.host) ? .fetching : .unreachable
        byKey[key] = StudioRecoveryItem(key: key, sourceId: split.host, name: item.ref.name, phase: phase)
    }
    return order.compactMap { byKey[$0] }
}

/// The captures the recovery still speaks for — every phase but `gone`.
private func recoverySpokenKeys(_ items: [StudioRecoveryItem]) -> Set<String> {
    Set(items.filter { $0.phase != .gone }.map(\.key))
}

private func recoverySpeaksFor(_ ref: SavedMediaRef, _ keys: Set<String>) -> Bool {
    guard let key = refetchKey(ref) else { return false }
    return keys.contains(key)
}

/// The saved refs a save must keep although nothing on this device holds
/// them: every file of a capture being fetched, refused or out of reach.
public func refsKeptThroughRecovery(_ saved: [SavedMediaRef], _ items: [StudioRecoveryItem]) -> [SavedMediaRef] {
    let keys = recoverySpokenKeys(items)
    return saved.filter { recoverySpeaksFor($0, keys) }
}

/// The media list a save writes: the working set, then every saved ref the
/// recovery still speaks for that the working set does not hold (by identity
/// or by name). An EMPTY working set stays empty — the save then keeps the
/// stored list whole, the web's rule.
public func filesKeepingRecovery(_ working: [SavedMediaRef], saved: [SavedMediaRef],
                                 _ items: [StudioRecoveryItem]) -> [SavedMediaRef] {
    guard !working.isEmpty else { return working }
    let identities = Set(working.map(fileIdentity))
    let names = Set(working.map { $0.name.lowercased() })
    let kept = refsKeptThroughRecovery(saved, items).filter { ref in
        !identities.contains(fileIdentity(ref)) && !names.contains(ref.name.lowercased())
    }
    return working + kept
}

/// How many missing files the FOLDER banner speaks for — the missing ones the
/// recovery does not already say.
public func missingOutsideRecovery(_ reconciliation: Reconciliation?, _ items: [StudioRecoveryItem]) -> Int {
    guard let reconciliation else { return 0 }
    let keys = recoverySpokenKeys(items)
    return reconciliation.items.filter { $0.status == .missing && !recoverySpeaksFor($0.ref, keys) }.count
}

/// `forgetMissingMedia`, leaving alone what the recovery still speaks for: a
/// clip being fetched back is not "missing on purpose". Nil when nothing else
/// is missing.
public func forgetMissingMedia(_ media: ProjectMedia, _ reconciliation: Reconciliation,
                               keeping items: [StudioRecoveryItem]) -> (media: ProjectMedia, reconciliation: Reconciliation)? {
    let keys = recoverySpokenKeys(items)
    let forgotten = reconciliation.items.filter { $0.status == .missing && !recoverySpeaksFor($0.ref, keys) }
    let names = Set(forgotten.map { $0.ref.name.lowercased() })
    guard !names.isEmpty else { return nil }
    var next = media
    next.files = media.files.filter { !names.contains($0.name.lowercased()) }
    let items = reconciliation.items.filter { !($0.status == .missing && names.contains($0.ref.name.lowercased())) }
    let renamed = items.filter { item in item.actual.map { $0.name != item.ref.name } ?? false }.count
    let counted = Reconciliation(
        items: items,
        found: items.filter { $0.status == .found }.count,
        changed: items.filter { $0.status == .changed }.count,
        missing: items.filter { $0.status == .missing }.count,
        renamed: renamed
    )
    return (next, counted)
}

// MARK: - the words

/// One line the editor says about the recovery.
public struct StudioRecoveryLine: Equatable, Sendable {
    public var text: String
    /// A failure worth attention, not a state.
    public var alarm: Bool
    /// The instance to sign in to, when that is the cure.
    public var signIn: String?
    /// Connecting the instance in Sources is the cure.
    public var connect: Bool

    public init(text: String, alarm: Bool, signIn: String? = nil, connect: Bool = false) {
        self.text = text; self.alarm = alarm; self.signIn = signIn; self.connect = connect
    }
}

private func recoveryCount(_ n: Int) -> String {
    n == 1 ? "1 media file" : "\(n) media files"
}

/// The hosts of `items` in `phase`, in order of first appearance, with their captures.
private func recoveryGroups(_ items: [StudioRecoveryItem],
                            _ phase: StudioRecoveryPhase) -> [(host: String, items: [StudioRecoveryItem])] {
    var order: [String] = []
    var groups: [String: [StudioRecoveryItem]] = [:]
    for item in items where item.phase == phase {
        if groups[item.sourceId] == nil { order.append(item.sourceId) }
        groups[item.sourceId, default: []].append(item)
    }
    return order.map { ($0, groups[$0] ?? []) }
}

/// What the editor says, in this order: what is being fetched (per
/// instance), what is out of reach (per instance, with Sources as the cure),
/// what was refused (a sign-in grouped per instance, any other reason per
/// capture), and what the instance no longer has (per capture).
public func studioRecoveryLines(_ items: [StudioRecoveryItem]) -> [StudioRecoveryLine] {
    var lines: [StudioRecoveryLine] = []
    for group in recoveryGroups(items, .fetching) {
        lines.append(StudioRecoveryLine(text: "Fetching \(recoveryCount(group.items.count)) back from \(group.host)…",
                                        alarm: false))
    }
    for group in recoveryGroups(items, .unreachable) {
        let n = group.items.count
        let verb = n == 1 ? "lives" : "live"
        let pronoun = n == 1 ? "it" : "them"
        let text = "\(recoveryCount(n)) of this project \(verb) on \(group.host), which this device is not connected to — connect it in Sources to fetch \(pronoun) back."
        lines.append(StudioRecoveryLine(text: text, alarm: false, connect: true))
    }
    for group in recoveryGroups(items, .failed) {
        let signIns = group.items.filter(\.signIn)
        if !signIns.isEmpty {
            let what = signIns.count == 1 ? signIns[0].name : recoveryCount(signIns.count)
            lines.append(StudioRecoveryLine(text: "Not signed in to \(group.host) — \(what) could not be fetched back.",
                                            alarm: true, signIn: group.host))
        }
        for item in group.items where !item.signIn {
            let reason = item.reason.map { " — \($0)" } ?? ""
            lines.append(StudioRecoveryLine(text: "\(item.name) could not be fetched back from \(group.host)\(reason).",
                                            alarm: true))
        }
    }
    for item in items where item.phase == .gone {
        lines.append(StudioRecoveryLine(text: "\(item.sourceId) no longer has \(item.name) — it stays missing from this project.",
                                        alarm: true))
    }
    return lines
}

// MARK: - the day the open media was captured

/// The calendar day a Studio media was captured, or nil when nothing
/// measured says: a clip's own log (its first timestamp), else a still's
/// EXIF (`DateTimeOriginal`, the source's record merged under the file's),
/// else the capture instant a source dated a fetched file with. Each written
/// as the camera wrote it — the day it was where it was, never a UTC
/// conversion; the instant read in `timeZone`.
public func studioCaptureDay(logTimestamp: String?, exifDateTime: String?, vouchedStamp: Double?,
                             timeZone: TimeZone = .current) -> IsoDate? {
    if let day = isoFromExifDateTime(logTimestamp) { return day }
    if let day = isoFromExifDateTime(exifDateTime) { return day }
    if let stamp = vouchedStamp { return isoFromTimestamp(stamp, timeZone: timeZone) }
    return nil
}

/// That day as the span the Studio publishes to the Library — one day,
/// `14 Mar 2025 · Studio`, nothing waiting on a click (so a tile opens large,
/// as when no tool speaks). Nil says nothing.
public func studioMediaScope(_ day: IsoDate?) -> MediaScope? {
    guard let day, parseIsoDate(day) != nil else { return nil }
    return MediaScope(from: day, to: day, label: formatIsoDate(day), publisher: "Studio")
}
