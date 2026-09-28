// What the sources screen needs to say about a source — port of
// `src/shared/sources/source-ledger.ts`. Three jobs, none of which belongs in
// a view:
//
// - **A health state and its sentence.** A connection is not a boolean: an
//   instance can answer, refuse (401 — sign in *there*), or never answer, and
//   each asks for a different verb. The mapping from a `WinnowError` to that
//   state lives here, not in the screen that happens to show it first.
// - **How many documents a source holds**, counted BEFORE forgetting it —
//   "8 projects and 3 trips live there" is the difference between a decision
//   and a surprise.
// - **A short label for a host.** `winnow.steeve.website` truncated in a
//   narrow tab reads as a defect; the first label is what a person calls the
//   instance — but only while it stays unambiguous, hence `shortHosts`
//   deciding for the whole set.

import Foundation

/// Where an instance stands, the last time this session asked.
public enum HealthState: String, Equatable, Sendable, CaseIterable {
    /// Asked, no answer yet.
    case checking
    /// `/api/capabilities` answered: the sheet on screen is fresh.
    case reachable
    /// 401/403 — the instance is up and does not know (or allow) this device.
    case signin
    /// No answer at all: offline, wrong address, a refused origin, or 5xx.
    case unreachable
}

public struct SourceHealth: Equatable, Sendable {
    public var state: HealthState
    /// What went wrong, in the reader's terms. Nil while fine or checking.
    public var reason: String?
    /// Round trip of the capabilities call, when it answered.
    public var latencyMs: Double?
    /// When this session last asked. Nil before the first answer.
    public var checkedAt: Double?

    public init(state: HealthState, reason: String?, latencyMs: Double?, checkedAt: Double?) {
        self.state = state; self.reason = reason; self.latencyMs = latencyMs; self.checkedAt = checkedAt
    }
}

/// The web's `CHECKING`.
public let checkingHealth = SourceHealth(state: .checking, reason: nil, latencyMs: nil, checkedAt: nil)

/// The health a failed probe leaves behind — the error mapped to a sentence.
public func healthFromError(_ error: Error, _ host: String, now: Double) -> SourceHealth {
    let winnow = error as? WinnowError
    if let kind = winnow?.kind, kind == .unauthenticated || kind == .forbidden {
        let reason = kind == .forbidden
            ? "\(host) knows this browser but will not answer for this account."
            : "\(host) does not know this browser. Sign in there, then check again — the session stays in that site's cookie, never here."
        return SourceHealth(state: .signin, reason: reason, latencyMs: nil, checkedAt: now)
    }
    if winnow?.kind == .unreachable {
        return SourceHealth(state: .unreachable,
                            reason: "No answer from \(host). It may be offline, or this browser may not be on its allowed list.",
                            latencyMs: nil, checkedAt: now)
    }
    let message = winnow?.message ?? (error as? LocalizedError)?.errorDescription
    let tail = message.map { $0.isEmpty ? "." : ": \($0)" } ?? "."
    return SourceHealth(state: .unreachable, reason: "\(host) answered something this app could not read\(tail)",
                        latencyMs: nil, checkedAt: now)
}

/// The health a successful probe leaves behind.
public func healthFromAnswer(_ latencyMs: Double, now: Double) -> SourceHealth {
    SourceHealth(state: .reachable, reason: nil, latencyMs: latencyMs, checkedAt: now)
}

public struct DocCount: Equatable, Sendable {
    public var projects: Int
    public var trips: Int
    public var rolls: Int

    public init(projects: Int = 0, trips: Int = 0, rolls: Int = 0) {
        self.projects = projects; self.trips = trips; self.rolls = rolls
    }
}

/// The web's `NO_DOCS`.
public let noDocs = DocCount()

/// How many documents each source holds, counted from the local stores — one
/// `sourceId` per document. A document with none was written before the field
/// existed and belongs to this device: the rule `groupBySource` applies, kept
/// identical so the gallery and this screen never disagree.
public func countBySource(projects: [String?] = [], trips: [String?] = [], rolls: [String?] = [],
                          localId: String = defaultSourceId) -> [String: DocCount] {
    var counts: [String: DocCount] = [:]
    for id in projects { counts[id ?? localId, default: noDocs].projects += 1 }
    for id in trips { counts[id ?? localId, default: noDocs].trips += 1 }
    for id in rolls { counts[id ?? localId, default: noDocs].rolls += 1 }
    return counts
}

/// "8 projects, 3 trips and 2 rolls", "one trip", "nothing yet" — never "0 projects".
public func describeDocs(_ count: DocCount) -> String {
    var parts: [String] = []
    func say(_ n: Int, _ noun: String) {
        if n > 0 { parts.append(n == 1 ? "one \(noun)" : "\(n) \(noun)s") }
    }
    say(count.projects, "project")
    say(count.trips, "trip")
    say(count.rolls, "roll")
    if parts.isEmpty { return "nothing yet" }
    if parts.count == 1 { return parts[0] }
    return "\(parts.dropLast().joined(separator: ", ")) and \(parts[parts.count - 1])"
}

/// What forgetting a connection actually does, said before it is done. The
/// documents are not deleted — they live on the instance, and connecting again
/// brings them back; what goes is this device's copy and the ability to save.
public func forgetWarning(_ host: String, _ count: DocCount) -> String {
    let held = describeDocs(count)
    return held == "nothing yet"
        ? "Forget \(host)? Its media stop showing in the library. Nothing is deleted there."
        : "Forget \(host)? \(held) came from it — those stay on the instance, and connecting again brings them back, but this browser stops listing and saving them."
}

/// The name a host goes by in a tab: its first label (past a `www`), with the
/// port when it carries one (`localhost:5174` is another instance than
/// `localhost`); an IP address stays whole.
public func shortHost(_ host: String) -> String {
    let bits = host.components(separatedBy: ":")
    let name = bits.first ?? ""
    let port = bits.count > 1 ? bits[1] : ""
    let labels = name.split(separator: ".").map(String.init).filter { !$0.isEmpty }
    guard !labels.isEmpty else { return host }
    let first = labels[0] == "www" && labels.count > 1 ? labels[1] : labels[0]
    let allDigits = !first.isEmpty && first.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
    let head = allDigits ? name : first
    return port.isEmpty ? head : "\(head):\(port)"
}

/// Short names for a whole set of hosts, where a collision falls back to the
/// full host for the hosts that collide — `winnow.a.tech` and `winnow.b.tech`
/// both stay long rather than both reading "winnow".
public func shortHosts(_ hosts: [String]) -> [String: String] {
    var byShort: [String: [String]] = [:]
    for host in hosts { byShort[shortHost(host), default: []].append(host) }
    var out: [String: String] = [:]
    for (short, group) in byShort {
        for host in group { out[host] = group.count == 1 ? short : host }
    }
    return out
}
