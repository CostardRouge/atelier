// The Winnow instances this device has connected — the native twin of the
// web's `winnow/store.ts` (the list), `use-source-health.ts` (asking each one
// where it stands), `refresh-capabilities.ts` (re-asking one a gallery would
// otherwise leave out in silence) and `use-connection.ts` (the FIRST one is
// the one every media surface talks to).
//
// A connection is a base URL, an auth mode and the capabilities sheet read the
// last time it was asked — a SNAPSHOT, stamped `refreshedAt`, re-asked by the
// screen that shows it (the probe IS the refresh) and by a gallery only where
// the stored sheet is what hides something. Persisted as JSON under
// `Application Support/Atelier/sources/winnow.v1.json` (the web's
// `localStorage` key, `atelier.sources.winnow.v1`), with ONE difference: the
// web keeps no secret, the native app keeps a Bearer token — and that token
// lives in the Keychain (`Keychain.swift`), never in this file.
//
// Rules kept (`architecture.md`, «Connecting and managing a source are ONE
// screen»):
// - Nothing is asked at launch. Loading reads a file and the Keychain; the
//   first request is the sources screen appearing, a connect, or a gallery.
// - Connecting is the person's act, and nothing is stored unless the instance
//   answered `/api/capabilities` (and the token was kept).
// - Forgetting deletes nothing there, and says so before it asks.
// - Still FIRST-WINS (`first`): choosing between several instances is the
//   maintainer's deferred item ("on verra ça après"), answered once, here.
//
// One departure, deliberate: a connection re-asked or re-made keeps its PLACE
// in the list. The web appends it at the end, so opening its sources screen
// with two instances connected can swap which one is first — and every media
// surface with it.

import Foundation
import Observation
import AtelierKit

// MARK: - the file

/// The stored list read back: connections whose token mode is `token` carry
/// `.token("")` until the Keychain is asked. Lenient like the web's
/// `isConnection`: a row with no id, no base URL or no auth mode is dropped.
func readStoredConnections(_ raw: JSONValue?) -> [WinnowConnection] {
    guard let list = raw?.arrayValue else { return [] }
    var out: [WinnowConnection] = []
    for item in list {
        guard let o = item.objectValue,
              let id = o["id"]?.stringValue, !id.isEmpty, id != localSource.id,
              let baseUrl = o["baseUrl"]?.stringValue,
              let mode = o["auth"]?.objectValue?["mode"]?.stringValue else { continue }
        guard !out.contains(where: { $0.id == id }) else { continue }
        let capabilities: WinnowCapabilities? = (o["capabilities"]?.objectValue).map { readWinnowCapabilities(.object($0)) }
        out.append(WinnowConnection(
            id: id,
            baseUrl: baseUrl,
            auth: mode == "token" ? .token("") : .cookie,
            capabilities: capabilities,
            connectedAt: o["connectedAt"]?.finiteNumber ?? 0,
            refreshedAt: o["refreshedAt"]?.finiteNumber
        ))
    }
    return out
}

/// The list as it is written — the web's shape, minus the secret: a token
/// connection is `{ "mode": "token" }`, its token in the Keychain.
func storedConnectionsJSON(_ list: [WinnowConnection]) -> JSONValue {
    .array(list.map { c in
        var o: [String: JSONValue] = [
            "id": .string(c.id),
            "baseUrl": .string(c.baseUrl),
            "connectedAt": .number(c.connectedAt),
        ]
        switch c.auth {
        case .cookie: o["auth"] = .object(["mode": .string("cookie")])
        case .token: o["auth"] = .object(["mode": .string("token")])
        }
        o["capabilities"] = c.capabilities?.raw ?? .null
        if let refreshedAt = c.refreshedAt { o["refreshedAt"] = .number(refreshedAt) }
        return .object(o)
    })
}

/// The kernel's sentences are the web's, written for a browser. The app is
/// not one: "this browser" becomes "this device", everywhere a kernel
/// sentence reaches the screen.
func deviceWords(_ sentence: String) -> String {
    sentence
        .replacingOccurrences(of: "this browser’s cache", with: "this device’s cache")
        .replacingOccurrences(of: "This browser", with: "This device")
        .replacingOccurrences(of: "this browser", with: "this device")
}

// MARK: - the connect form's arithmetic

/// What the address field says as it is typed — the web's inline validation.
struct ConnectDraft: Equatable {
    var baseUrl: String?
    /// The source id it will be listed as.
    var sourceId: String?
    /// Why it is not an address, or nil.
    var problem: String?

    init(address: String) {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let base = try normalizeBaseUrl(trimmed)
            baseUrl = base
            sourceId = sourceIdFor(base)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? "That is not an address."
        }
    }
}

/// What a connect came to.
enum ConnectOutcome: Equatable {
    case connected(WinnowConnection)
    /// 401: the instance answered and does not accept what was sent.
    case refused(loginUrl: String)
    case failed(String)
}

// MARK: - the store

@MainActor
@Observable
final class ConnectionStore {
    static let shared = ConnectionStore()

    private(set) var connections: [WinnowConnection] = []
    /// Where each instance stood the last time this session asked.
    private(set) var health: [String: SourceHealth] = [:]
    /// What re-asking an instance from a gallery came to — at most once a session.
    private(set) var probes: [String: CapabilityProbe] = [:]
    /// Token connections whose token this device does not hold (a backup
    /// restored elsewhere keeps the connection and never the token).
    private(set) var missingTokens: Set<String> = []

    @ObservationIgnored private let file: URL
    @ObservationIgnored private let credentials: CredentialStore
    @ObservationIgnored let transport: WinnowTransport
    @ObservationIgnored private let clock: () -> Double
    @ObservationIgnored private var probeTasks: [String: Task<CapabilityProbe, Never>] = [:]

    init(root: URL? = nil, credentials: CredentialStore? = nil, transport: WinnowTransport? = nil,
         clock: @escaping () -> Double = nowMillis) {
        let base = root ?? DocumentStore<RollDoc>.defaultRoot
        file = base.appendingPathComponent("sources", isDirectory: true).appendingPathComponent("winnow.v1.json")
        #if canImport(Security)
        self.credentials = credentials ?? Keychain()
        #else
        self.credentials = credentials ?? MemoryCredentials()
        #endif
        self.transport = transport ?? URLSessionWinnowTransport.shared.transport
        self.clock = clock
        load()
    }

    private func load() {
        guard let data = try? Data(contentsOf: file) else { return }
        var missing: Set<String> = []
        connections = readStoredConnections(JSONValue.parse(data)).map { stored -> WinnowConnection in
            guard case .token = stored.auth else { return stored }
            var conn = stored
            if let token = credentials.token(for: stored.id), !token.isEmpty {
                conn.auth = .token(token)
            } else {
                missing.insert(stored.id)
            }
            return conn
        }
        missingTokens = missing
    }

    private func save() {
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? storedConnectionsJSON(connections).serialized(pretty: true).write(to: file, atomically: true, encoding: .utf8)
    }

    /// Add or replace (same id) — connecting twice refreshes, never duplicates,
    /// and a known connection keeps its place.
    private func put(_ conn: WinnowConnection) {
        precondition(conn.id != localSource.id, "\"local\" is not a remote source.")
        if let i = connections.firstIndex(where: { $0.id == conn.id }) {
            connections[i] = conn
        } else {
            connections.append(conn)
        }
        save()
    }

    // MARK: reading

    func connection(_ id: String) -> WinnowConnection? {
        connections.first { $0.id == id }
    }

    /// The web's `useWinnowConnection`: the FIRST connection is the one every
    /// media surface talks to, until multi-instance is designed.
    var first: WinnowConnection? { connections.first }

    func client(for connection: WinnowConnection) -> WinnowClient {
        WinnowClient(config: WinnowConfig(baseUrl: connection.baseUrl, auth: connection.auth), transport: transport)
    }

    /// A client for the first connection, or nil when none is connected.
    var firstClient: WinnowClient? { first.map { client(for: $0) } }

    /// Every source this device knows: local first, then what was connected.
    var registry: SourceRegistry { SourceRegistry(remote: connections.map(toSourceInfo)) }

    func capabilities(of id: String) -> WinnowCapabilities? {
        connection(id)?.capabilities
    }

    /// The instance a document of `kind` on `sourceId` is pushed to, or nil —
    /// `local`, not connected, no bucket, or a bucket that does not keep the kind.
    func remote(for sourceId: String, kind: String? = nil) -> RemoteSource? {
        remoteFor(sourceId, kind: kind, connections: connections, transport: transport)
    }

    /// The sources that can HOLD documents of `kind` — a create or import picker.
    func documentSources(for kind: String) -> [SourceInfo] {
        documentSourcesFor(kind, registry: registry, capabilities: { self.capabilities(of: $0) })
    }

    /// A source as a sentence names it: "this device", or the instance's host.
    func label(_ sourceId: String) -> String {
        deviceWords(sourceLabel(sourceId, registry: registry))
    }

    /// Where an instance stands, as far as this session knows.
    func healthOf(_ id: String) -> SourceHealth {
        health[id] ?? checkingHealth
    }

    /// A token connection whose instance answered without naming an account:
    /// it may not accept Bearer tokens yet (Winnow's §3.6 step), so what it
    /// keeps for an account will be refused.
    func tokenUnrecognised(_ conn: WinnowConnection) -> Bool {
        guard case .token(let token) = conn.auth, !token.isEmpty, let caps = conn.capabilities else { return false }
        return caps.viewer == nil
    }

    // MARK: connecting

    /// Ask the instance what it can do, with the token given (none: no
    /// credential at all), and keep the connection only if it answered. The
    /// ONE request is `/api/capabilities`.
    func connect(address: String, token: String) async -> ConnectOutcome {
        let draft = ConnectDraft(address: address)
        guard let baseUrl = draft.baseUrl, let id = draft.sourceId else {
            return .failed(draft.problem ?? "That is not an address.")
        }
        guard id != localSource.id else { return .failed("\"local\" is this device, not an instance.") }
        let secret = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let auth: WinnowAuth = secret.isEmpty ? .cookie : .token(secret)
        let client = WinnowClient(config: WinnowConfig(baseUrl: baseUrl, auth: auth), transport: transport)
        let asked = clock()
        let capabilities: WinnowCapabilities
        do {
            capabilities = try await client.capabilities()
        } catch is CancellationError {
            return .failed("Cancelled — nothing was stored.")
        } catch let error as WinnowError where error.kind == .unauthenticated {
            return .refused(loginUrl: client.loginUrl())
        } catch {
            return .failed(deviceWords((error as? LocalizedError)?.errorDescription ?? String(describing: error)))
        }
        do {
            if case .token(let t) = auth {
                try credentials.setToken(t, for: id)
            } else {
                credentials.removeToken(for: id)
            }
        } catch {
            let why = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            return .failed("\(id) answered, but its token could not be kept on this device — nothing was stored. \(why)")
        }
        let now = clock()
        let conn = WinnowConnection(id: id, baseUrl: baseUrl, auth: auth, capabilities: capabilities,
                                    connectedAt: connection(id)?.connectedAt ?? now, refreshedAt: now)
        put(conn)
        missingTokens.remove(id)
        // A connection re-made forgets what a gallery's probe said about the old one.
        probeTasks[id] = nil
        probes[id] = nil
        health[id] = healthFromAnswer(now - asked, now: now)
        return .connected(conn)
    }

    /// Forget a connection: its token leaves the Keychain, its row leaves the
    /// list. Nothing is deleted on the instance, and the documents it kept
    /// here stay, greyed with the reason.
    func forget(_ id: String) {
        credentials.removeToken(for: id)
        connections.removeAll { $0.id == id }
        health[id] = nil
        probes[id] = nil
        probeTasks[id] = nil
        missingTokens.remove(id)
        save()
    }

    // MARK: asking where each one stands

    /// The health a failed probe leaves, in this device's words: a 401 here
    /// means the TOKEN, not a cookie — the fix is a new one, pasted with
    /// Reconnect — and no CORS allowlist stands between an app and a server.
    func deviceHealth(_ error: Error, host: String, now: Double) -> SourceHealth {
        var health = healthFromError(error, host, now: now)
        let kind = (error as? WinnowError)?.kind
        switch health.state {
        case .signin where kind == .unauthenticated:
            health.reason = "\(host) did not accept this device’s token. Make a new one there and paste it with Reconnect — it is kept in this device’s Keychain, never in a document."
        case .signin:
            health.reason = "\(host) knows this token but will not answer for its account."
        case .unreachable where kind == .unreachable:
            health.reason = "No answer from \(host). It may be offline, or the address may be wrong."
        default:
            health.reason = health.reason.map(deviceWords)
        }
        return health
    }

    /// Ask one instance where it stands, and store the sheet it answers with:
    /// the probe IS the refresh. Refresh and Retry call this.
    func check(_ id: String) async {
        guard let conn = connection(id) else { return }
        if missingTokens.contains(id) {
            health[id] = SourceHealth(
                state: .signin,
                reason: "This device holds no token for \(id) — a restored backup keeps a connection, never its token. Paste one with Reconnect.",
                latencyMs: nil, checkedAt: clock())
            return
        }
        health[id] = checkingHealth
        let client = self.client(for: conn)
        let asked = clock()
        do {
            let capabilities = try await client.capabilities()
            let now = clock()
            store(capabilities, for: id, now: now)
            health[id] = healthFromAnswer(now - asked, now: now)
        } catch is CancellationError {
            health[id] = nil
        } catch {
            health[id] = deviceHealth(error, host: id, now: clock())
        }
    }

    /// Ask every instance once — the sources screen appearing.
    func checkAll() async {
        await withTaskGroup(of: Void.self) { group in
            for conn in connections {
                let id = conn.id
                group.addTask { await self.check(id) }
            }
        }
    }

    private func store(_ capabilities: WinnowCapabilities, for id: String, now: Double) {
        guard var conn = connection(id) else { return }
        conn.capabilities = capabilities
        conn.refreshedAt = now
        put(conn)
    }

    // MARK: galleries

    /// Re-ask ONE instance what it can do, at most once a session — only where
    /// its stored sheet is what leaves it out of a gallery. Never throws: a
    /// refusal is an outcome, and the old sheet is kept.
    func refreshCapabilitiesOnce(_ id: String) async -> CapabilityProbe {
        if let held = probeTasks[id] { return await held.value }
        guard let conn = connection(id) else { return .refused(problem: "\(id) is not connected.") }
        let client = self.client(for: conn)
        let probe = Task { () -> CapabilityProbe in
            do {
                let capabilities = try await client.capabilities()
                self.store(capabilities, for: id, now: self.clock())
                return .read
            } catch {
                return .refused(problem: deviceWords((error as? LocalizedError)?.errorDescription ?? String(describing: error)))
            }
        }
        probeTasks[id] = probe
        let result = await probe.value
        if probes[id] == nil { probes[id] = result }
        return result
    }

    /// The connected instances a gallery of `kind` draws no group for, each
    /// with its line once there is one worth believing (`absentSources`).
    func absences(for kind: String, noun: String) -> [AbsentSource] {
        let present = documentSources(for: kind).map(\.id).filter(isRemoteSource)
        return AtelierKit.absentSources(connections.map(\.id), present, noun, probes).map {
            AbsentSource(sourceId: $0.sourceId, text: $0.text.map(deviceWords))
        }
    }

    /// Probe every instance a gallery of `kind` leaves out — and only those, so
    /// a healthy gallery makes no request at all.
    func probeHidden(kind: String) async {
        let present = Set(documentSources(for: kind).map(\.id))
        let hidden = connections.map(\.id).filter { !present.contains($0) }
        await withTaskGroup(of: Void.self) { group in
            for id in hidden {
                group.addTask { _ = await self.refreshCapabilitiesOnce(id) }
            }
        }
    }
}

// MARK: - previews

extension ConnectionStore {
    /// A store over a temporary folder, in-memory tokens and a stub instance
    /// that answers a capabilities sheet — for `#Preview` and tests, never a
    /// real request.
    static func preview(connections: [(host: String, sheet: JSONValue)] = [],
                        transport: WinnowTransport? = nil) -> ConnectionStore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview-\(UUID().uuidString)")
        let credentials = MemoryCredentials()
        var stored: [WinnowConnection] = []
        for (host, sheet) in connections {
            try? credentials.setToken("preview-token", for: host)
            stored.append(WinnowConnection(id: host, baseUrl: "https://\(host)", auth: .token("preview-token"),
                                           capabilities: readWinnowCapabilities(sheet),
                                           connectedAt: nowMillis() - 86_400_000, refreshedAt: nowMillis() - 3_600_000))
        }
        let file = root.appendingPathComponent("sources", isDirectory: true)
        try? FileManager.default.createDirectory(at: file, withIntermediateDirectories: true)
        try? storedConnectionsJSON(stored).serialized().write(to: file.appendingPathComponent("winnow.v1.json"),
                                                              atomically: true, encoding: .utf8)
        let stub: WinnowTransport = transport ?? { request in
            let host = URL(string: request.url)?.host ?? ""
            let sheet = connections.first { $0.host == host }?.sheet ?? .object([:])
            return WinnowResponse.json(sheet)
        }
        return ConnectionStore(root: root, credentials: credentials, transport: stub)
    }

    /// A capabilities sheet as a current Winnow answers it — for previews.
    static let previewSheet: JSONValue = [
        "api": ["version": 1],
        "auth": ["methods": ["cookie", "token"]],
        "media": [
            "sidecars": true,
            "proxies": ["video": ["container": "mp4", "codec": "h264", "height": 1080], "photo": ["format": "webp", "size": 2048]],
        ],
        "documents": ["bucket": true, "kinds": ["trip", "project", "roll", "lutpack"], "maxBytes": 4_194_304],
        "files": ["bucket": true, "maxBytes": 16_777_216],
        "scheduling": ["reminders": false],
        "limits": ["maxUploadBytes": 536_870_912],
        "viewer": ["id": 1, "username": "steeve", "role": "admin"],
    ]
}
