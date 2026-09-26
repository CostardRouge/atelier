// What the Sources specs stand in place of a network with: a stub Winnow
// DOCUMENT BUCKET behind the kernel's transport seam (the way the web's specs
// run against a stub `fetch`), and a `URLProtocol` that answers URLSession
// in place of a server, so the real transport is exercised end to end.
//
// The bucket keeps the rules the route keeps (`docs/roadtrip-persistence.md`
// §7): a PUT with no `If-Match` creates and refuses (412) a row that exists;
// a PUT or DELETE whose `If-Match` is not the row's etag is a 412 carrying the
// server's revision; a row that is not there is a 404 — never a 403; a GET
// whose `If-None-Match` is the row's etag is a 304.

import AtelierKit
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import Atelier

final class StubDocBucket: @unchecked Sendable {
    struct Row: Equatable {
        var kind: String
        var version: Int
        var doc: JSONValue
        var etag: String
        var updatedAt: String
    }

    private let lock = NSLock()
    private var _rows: [String: Row] = [:]
    private var _requests: [WinnowRequest] = []
    private var counter = 0

    /// The instance does not answer at all.
    var offline = false
    /// Every write answers 403 (a viewer account).
    var refuseWrites = false
    /// Every request answers 401 (the token is not known there).
    var unauthorised = false
    /// The capabilities sheet `/api/capabilities` answers.
    var sheet: JSONValue = [
        "api": ["version": 1],
        "documents": ["bucket": true, "kinds": ["trip", "project", "roll"]],
        "viewer": ["id": 1, "username": "steeve", "role": "admin"],
    ]
    /// Run while a PUT is out, before it answers — an edit landing mid-push.
    var duringPut: (@Sendable () async -> Void)?

    var rows: [String: Row] {
        lock.lock()
        defer { lock.unlock() }
        return _rows
    }

    var requests: [WinnowRequest] {
        lock.lock()
        defer { lock.unlock() }
        return _requests
    }

    func requests(_ method: String) -> [WinnowRequest] {
        requests.filter { $0.method == method && $0.path.hasPrefix("/api/apps/") }
    }

    var transport: WinnowTransport {
        { request in try await self.handle(request) }
    }

    func remote(_ host: String = "w.example") -> RemoteSource {
        RemoteSource(sourceId: host, label: host,
                     client: WinnowClient(config: WinnowConfig(baseUrl: "https://\(host)", auth: .token("t")), transport: transport),
                     maxBytes: nil)
    }

    private func nextEtag() -> String {
        lock.lock()
        defer { lock.unlock() }
        counter += 1
        return "\"e\(counter)\""
    }

    /// Someone else saved `doc` there — a new revision.
    func changeElsewhere(_ id: String, _ doc: JSONValue, updatedAt: String = "2026-09-26T12:02:00.000Z") {
        let etag = nextEtag()
        lock.lock()
        defer { lock.unlock() }
        let kind = _rows[id]?.kind ?? "roll"
        _rows[id] = Row(kind: kind, version: 6, doc: doc, etag: etag, updatedAt: updatedAt)
    }

    func deleteElsewhere(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        _rows[id] = nil
    }

    private func store(_ id: String, _ row: Row?) {
        lock.lock()
        defer { lock.unlock() }
        _rows[id] = row
    }

    private func rowJSON(_ id: String, _ row: Row) -> JSONValue {
        [
            "id": .string(id), "kind": .string(row.kind), "version": .number(Double(row.version)),
            "updated_at": .string(row.updatedAt), "etag": .string(row.etag), "doc": row.doc,
        ]
    }

    private func handle(_ req: WinnowRequest) async throws -> WinnowResponse {
        lock.lock()
        _requests.append(req)
        lock.unlock()
        if offline { throw URLError(.notConnectedToInternet) }
        if unauthorised { return .json(["error": "not signed in"], status: 401) }
        if req.path == "/api/capabilities" { return .json(sheet) }

        let base = "/api/apps/atelier/docs"
        guard req.path.hasPrefix(base) else { return WinnowResponse(status: 404) }
        let rest = String(req.path.dropFirst(base.count))
        let id = rest.hasPrefix("/") ? String(rest.dropFirst()).removingPercentEncoding ?? "" : ""
        let current = id.isEmpty ? nil : rows[id]

        switch (req.method, id.isEmpty) {
        case ("GET", true):
            let kind = req.queryValue("kind") ?? ""
            let listed = rows.filter { $0.value.kind == kind }.sorted { $0.key < $1.key }
            return .json(["docs": .array(listed.map { rowJSON($0.key, $0.value) })])
        case ("GET", false):
            guard let row = current else { return .json(["error": "not found"], status: 404) }
            if req.header("If-None-Match") == row.etag { return WinnowResponse(status: 304, headers: ["ETag": row.etag]) }
            return .json(rowJSON(id, row), headers: ["ETag": row.etag])
        case ("PUT", false):
            if refuseWrites { return .json(["error": "forbidden"], status: 403) }
            let ifMatch = req.header("If-Match")
            if let row = current {
                guard ifMatch == row.etag else {
                    return .json(["error": "changed", "etag": .string(row.etag), "updated_at": .string(row.updatedAt)], status: 412)
                }
            } else if ifMatch != nil {
                return .json(["error": "not found"], status: 404)
            }
            if let duringPut { await duringPut() }
            guard case .text(let text)? = req.body, let body = JSONValue.parse(text)?.objectValue else {
                return .json(["error": "bad body"], status: 400)
            }
            let etag = nextEtag()
            let updatedAt = "2026-09-26T10:00:00.000Z"
            store(id, Row(kind: body["kind"]?.stringValue ?? "", version: Int(body["version"]?.finiteNumber ?? 0),
                          doc: body["doc"] ?? .null, etag: etag, updatedAt: updatedAt))
            return .json(["etag": .string(etag), "updated_at": .string(updatedAt)], headers: ["ETag": etag])
        case ("DELETE", false):
            if refuseWrites { return .json(["error": "forbidden"], status: 403) }
            guard let row = current else { return .json(["error": "not found"], status: 404) }
            if let ifMatch = req.header("If-Match"), ifMatch != row.etag {
                return .json(["error": "changed", "etag": .string(row.etag), "updated_at": .string(row.updatedAt)], status: 412)
            }
            store(id, nil)
            return WinnowResponse(status: 204)
        default:
            return WinnowResponse(status: 405)
        }
    }
}

// MARK: - URLSession answered in place of a server

/// Answers every request of a session configured with it. One handler at a
/// time — XCTest runs a class's cases one after another.
final class SourcesStubProtocol: URLProtocol {
    struct Reply {
        var status: Int = 200
        var headers: [String: String] = [:]
        var body = Data()
        /// No answer at all.
        var failure: URLError?
        /// Never answer: the request hangs until it is cancelled.
        var hang = false
    }

    struct Seen {
        var request: URLRequest
        var body: Data?
    }

    private static let lock = NSLock()
    private static var _handler: (URLRequest) -> Reply = { _ in Reply() }
    private static var _seen: [Seen] = []

    static func answer(_ handler: @escaping (URLRequest) -> Reply) {
        lock.lock()
        defer { lock.unlock() }
        _handler = handler
        _seen = []
    }

    static var seen: [Seen] {
        lock.lock()
        defer { lock.unlock() }
        return _seen
    }

    /// A transport over URLSession whose every request this protocol answers.
    static func transport() -> URLSessionWinnowTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SourcesStubProtocol.self]
        return URLSessionWinnowTransport(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private static func readBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }

    override func startLoading() {
        let request = self.request
        Self.lock.lock()
        let handler = Self._handler
        Self._seen.append(Seen(request: request, body: Self.readBody(request)))
        Self.lock.unlock()
        let reply = handler(request)
        if reply.hang { return }
        if let failure = reply.failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                       headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !reply.body.isEmpty { client?.urlProtocol(self, didLoad: reply.body) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A fresh folder under the temporary directory, for one spec.
func sourcesScratch() -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("atelier-sources-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// A roll on `sourceId` with one picture — enough document to see it travel.
func sourcesRoll(_ id: String = "r1", sourceId: String = "w.example", name: String = "Roll", now: Double = 1_000) -> RollDoc {
    let doc = createRollDoc(name: name, sourceId: sourceId, now: now, id: id)
    return addPictures(doc, [SavedMediaRef(name: "DJI_0101.JPG", size: 1234, lastModified: 500)], now: now) { "p1" }
}
