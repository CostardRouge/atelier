// What every document kept on a connected instance shares — port of
// `src/shared/sources/doc-remote.ts`, the plumbing under the trip, project
// and roll remotes: which instance a source id names, one guarded PUT, and how
// a client failure maps onto the reducer's vocabulary (`DocSync.swift`). No
// policy lives here: the reducer decides, the pill speaks, the tools trigger.
// Nothing retries a write on its own.
//
// The web reads the connection from its store; here the app hands over the
// connections it keeps and the one transport every client sends through.

import Foundation

public struct RemoteSource: Sendable {
    public var sourceId: String
    /// What the pill prints — the host.
    public var label: String
    public var client: WinnowClient
    /// The instance's body cap, checked before a PUT; nil when it declared none.
    public var maxBytes: Int?

    public init(sourceId: String, label: String, client: WinnowClient, maxBytes: Int?) {
        self.sourceId = sourceId; self.label = label; self.client = client; self.maxBytes = maxBytes
    }
}

public func isRemoteSource(_ sourceId: String) -> Bool {
    sourceId != defaultSourceId
}

/// The instance a source id names, ready to talk to — or nil for `local`, for
/// a host this device has not connected, for one whose capabilities say it has
/// no document bucket (a push there would only 404), and, when `kind` is
/// given, for one whose bucket does not keep that kind (a push would only 400).
public func remoteFor(_ sourceId: String, kind: String? = nil, connections: [WinnowConnection],
                      transport: @escaping WinnowTransport) -> RemoteSource? {
    guard isRemoteSource(sourceId), let conn = connections.first(where: { $0.id == sourceId }),
          let caps = conn.capabilities, caps.documents?.bucket == true else { return nil }
    if let kind, !bucketHolds(caps, kind) { return nil }
    return RemoteSource(
        sourceId: sourceId,
        label: conn.id,
        client: WinnowClient(config: WinnowConfig(baseUrl: conn.baseUrl, auth: conn.auth), transport: transport),
        maxBytes: caps.documents?.maxBytes
    )
}

public struct RemoteFailure: Equatable, Sendable {
    public var kind: PushFailure
    public var message: String
    public var theirs: TheirCopy?

    public init(kind: PushFailure, message: String, theirs: TheirCopy?) {
        self.kind = kind; self.message = message; self.theirs = theirs
    }
}

/// Whatever the client threw, as the reducer's vocabulary plus a sentence.
public func failureOf(_ error: Error) -> RemoteFailure {
    if let e = error as? WinnowError { return RemoteFailure(kind: e.kind, message: e.message, theirs: e.theirs) }
    let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    return RemoteFailure(kind: .protocol, message: message, theirs: nil)
}

/// One line a person can act on, with the sign-in link when that is the fix.
public struct FailureExplanation: Equatable, Sendable {
    public var text: String
    public var login: String?

    public init(text: String, login: String? = nil) { self.text = text; self.login = login }
}

public func explainFailure(_ failure: RemoteFailure, _ remote: RemoteSource) -> FailureExplanation {
    switch failure.kind {
    case .unauthenticated:
        return FailureExplanation(text: "Not signed in to \(remote.label).", login: remote.client.loginUrl())
    case .unreachable:
        return FailureExplanation(text: "\(remote.label) is unreachable — showing what this device holds.")
    default:
        return FailureExplanation(text: failure.message)
    }
}

public enum PushOutcome: Equatable, Sendable {
    case ok(etag: String)
    case failed(RemoteFailure)
}

/// One PUT of one document, guarded by the etag we hold. Never throws: the
/// outcome is what the reducer eats. A tool runs the reducer around this
/// itself, because an edit can land WHILE the request is out and only the
/// live record knows.
public func putDocOnce(_ remote: RemoteSource, kind: String, id: String, version: Int, wireDoc: JSONValue,
                       etag: String?) async -> PushOutcome {
    do {
        let ack = try await remote.client.putDoc(docsApp, id, DocBody(kind: kind, version: version, doc: wireDoc),
                                                 ifMatch: etag, maxBytes: remote.maxBytes)
        return .ok(etag: ack.etag)
    } catch {
        return .failed(failureOf(error))
    }
}

/// The reducer event an outcome stands for.
public func outcomeEvent(_ outcome: PushOutcome, now: Double) -> SyncEvent {
    switch outcome {
    case .ok(let etag): return .pushOk(etag: etag, now: now)
    case .failed(let failure): return failureEvent(failure)
    }
}

/// The reducer event a failed pull stands for — the same mapping as a push.
public func failureEvent(_ failure: RemoteFailure) -> SyncEvent {
    .pushFailed(kind: failure.kind, message: failure.message, theirs: failure.theirs)
}
