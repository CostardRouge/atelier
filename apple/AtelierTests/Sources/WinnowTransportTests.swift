// The transport under the kernel's Winnow client, driven through a REAL
// URLSession answered by `SourcesStubProtocol`: the request goes out verbatim
// (route, query, the Bearer header, no cookie), a 412 reaches the client as a
// conflict carrying the server's copy, a 304 as "still current", a multipart
// body is written part by part from a file, `maxBodyBytes` stops a transfer,
// a read with no answer is asked once more past the cache and a write never
// is, a cancelled task is the person's own doing, and bytes moving are heard.

import AtelierKit
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import Atelier

final class WinnowTransportTests: XCTestCase {
    private let base = "https://w.example"

    private func client(_ transport: URLSessionWinnowTransport, auth: WinnowAuth = .token("tok")) -> WinnowClient {
        WinnowClient(config: WinnowConfig(baseUrl: base, auth: auth), transport: transport.transport)
    }

    func testTheRequestGoesOutVerbatimWithTheBearerAndNoCookie() async throws {
        SourcesStubProtocol.answer { _ in .init(headers: ["Content-Type": "application/json"], body: Data(#"{"docs":[]}"#.utf8)) }
        let rows = try await client(SourcesStubProtocol.transport()).listDocs(docsApp, "roll")
        XCTAssertEqual(rows, [])
        let seen = try XCTUnwrap(SourcesStubProtocol.seen.first).request
        XCTAssertEqual(seen.httpMethod, "GET")
        XCTAssertEqual(seen.url?.absoluteString, "https://w.example/api/apps/atelier/docs?kind=roll")
        XCTAssertEqual(seen.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        XCTAssertEqual(seen.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertFalse(seen.httpShouldHandleCookies, "a Bearer request never sends a cookie")
    }

    func testAStaleWriteIsAConflictCarryingTheServersCopy() async throws {
        SourcesStubProtocol.answer { _ in
            .init(status: 412, headers: ["Content-Type": "application/json"],
                  body: Data(#"{"error":"changed","etag":"\"e9\"","updated_at":"2026-09-26T12:02:00.000Z"}"#.utf8))
        }
        do {
            _ = try await client(SourcesStubProtocol.transport())
                .putDoc(docsApp, "r1", DocBody(kind: "roll", version: 6, doc: ["name": "Roll"]), ifMatch: "\"e1\"")
            XCTFail("a 412 must throw")
        } catch let error as WinnowError {
            XCTAssertEqual(error.kind, .conflict)
            XCTAssertEqual(error.status, 412)
            XCTAssertEqual(error.theirs, TheirCopy(etag: "\"e9\"", updatedAt: "2026-09-26T12:02:00.000Z"))
        }
        let put = try XCTUnwrap(SourcesStubProtocol.seen.first)
        XCTAssertEqual(put.request.httpMethod, "PUT")
        XCTAssertEqual(put.request.value(forHTTPHeaderField: "If-Match"), "\"e1\"")
        XCTAssertEqual(put.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = JSONValue.parse(try uploadedBody(put))
        XCTAssertEqual(body, ["kind": "roll", "version": 6, "doc": ["name": "Roll"]])
    }

    /// What reached the server as the request's body. URLSession on Apple
    /// hands a `URLProtocol` an upload's body as `httpBodyStream`;
    /// FoundationNetworking (the Linux harness this was first run in) hands
    /// it nothing, so there the byte shape rests on the form spec alone.
    private func uploadedBody(_ seen: SourcesStubProtocol.Seen) throws -> Data {
        if let body = seen.body { return body }
        #if os(Linux)
        throw XCTSkip("FoundationNetworking gives a URLProtocol no upload body")
        #else
        XCTFail("the upload's body did not reach the server")
        return Data()
        #endif
    }

    func testANotModifiedAnswerReachesTheClientAsStillCurrent() async throws {
        SourcesStubProtocol.answer { _ in .init(status: 304, headers: ["ETag": "\"e1\""]) }
        let result = try await client(SourcesStubProtocol.transport()).getDoc(docsApp, "r1", ifNoneMatch: "\"e1\"")
        XCTAssertEqual(result, .notModified)
        XCTAssertEqual(SourcesStubProtocol.seen.first?.request.value(forHTTPHeaderField: "If-None-Match"), "\"e1\"")
    }

    func testAMissingRowIsNotFoundNeverForbidden() async throws {
        SourcesStubProtocol.answer { _ in .init(status: 404, headers: ["Content-Type": "application/json"], body: Data(#"{"error":"x"}"#.utf8)) }
        do {
            try await client(SourcesStubProtocol.transport()).deleteDoc(docsApp, "r1", ifMatch: "\"e1\"")
            XCTFail("a 404 must throw")
        } catch let error as WinnowError {
            XCTAssertEqual(error.kind, .notfound)
        }
    }

    func testAReadWithNoAnswerIsAskedOncePastTheCacheThenSaidUnreachable() async throws {
        SourcesStubProtocol.answer { _ in .init(failure: URLError(.notConnectedToInternet)) }
        do {
            _ = try await client(SourcesStubProtocol.transport()).capabilities()
            XCTFail("no answer must throw")
        } catch let error as WinnowError {
            XCTAssertEqual(error.kind, .unreachable)
            XCTAssertTrue(error.message.contains("even asked again past"), error.message)
        }
        XCTAssertEqual(SourcesStubProtocol.seen.count, 2, "one replay, past the cache")
    }

    func testAWriteWithNoAnswerIsNeverReplayed() async throws {
        SourcesStubProtocol.answer { _ in .init(failure: URLError(.networkConnectionLost)) }
        do {
            _ = try await client(SourcesStubProtocol.transport())
                .putDoc(docsApp, "r1", DocBody(kind: "roll", version: 6, doc: [:]), ifMatch: nil)
            XCTFail("no answer must throw")
        } catch let error as WinnowError {
            XCTAssertEqual(error.kind, .unreachable)
        }
        XCTAssertEqual(SourcesStubProtocol.seen.count, 1, "a write may have landed: never asked twice")
    }

    func testFetchHeadStopsAtTheBytesAsked() async throws {
        let body = Data((0..<10_000).map { UInt8($0 % 251) })
        SourcesStubProtocol.answer { _ in .init(headers: ["Content-Length": "10000"], body: body) }
        let transport = SourcesStubProtocol.transport()
        let head = try await client(transport).fetchHead("\(base)/api/assets/7/download", bytes: 100)
        XCTAssertEqual(head, body.prefix(100))
        XCTAssertEqual(SourcesStubProtocol.seen.first?.request.value(forHTTPHeaderField: "Range"), "bytes=0-99")

        let raw = try await transport.send(WinnowRequest(method: "GET", url: "\(base)/api/assets/7/download",
                                                         path: "/api/assets/7/download", query: [], maxBodyBytes: 100))
        XCTAssertEqual(raw.body.count, 100, "the transport hands back no more than it was asked for")
    }

    func testCancellingTheTaskCancelsTheRequest() async throws {
        SourcesStubProtocol.answer { _ in .init(hang: true) }
        let transport = SourcesStubProtocol.transport()
        let c = client(transport)
        let task = Task { try await c.capabilities() }
        try await Task.sleep(nanoseconds: 100_000_000)
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("a cancelled request must throw")
        } catch {
            XCTAssertTrue(error is CancellationError, "cancelled is the person's doing, never 'unreachable': \(error)")
        }
        XCTAssertEqual(SourcesStubProtocol.seen.count, 1, "a cancel is never replayed")
    }

    func testBytesArrivingAreHeard() async throws {
        let body = Data(repeating: 7, count: 4096)
        SourcesStubProtocol.answer { _ in .init(headers: ["Content-Length": "4096"], body: body) }
        let heard = TransferProgressLog()
        let file = try await WinnowTransfer.$progress.withValue({ heard.add($0) }) {
            try await client(SourcesStubProtocol.transport()).fetchFile("\(base)/api/assets/7/proxy", name: "a.jpg",
                                                                    type: "image/jpeg", lastModified: 0)
        }
        XCTAssertEqual(file.data, body)
        let last = try XCTUnwrap(heard.all.last)
        XCTAssertEqual(last.direction, .download)
        XCTAssertEqual(last.bytes, 4096)
    }

    func testAFinalIsUploadedAsMultipartStreamedFromItsFile() async throws {
        let dir = sourcesScratch()
        let source = dir.appendingPathComponent("final.jpg")
        let bytes = Data((0..<3000).map { UInt8($0 % 256) })
        try bytes.write(to: source)
        SourcesStubProtocol.answer { _ in .init(headers: ["Content-Type": "application/json"], body: Data(#"{"ok":true}"#.utf8)) }

        let answer = try await client(SourcesStubProtocol.transport())
            .upload([UploadItem(name: "final.jpg", contents: .file(path: source.path), path: "Trip/final.jpg")],
                    UploadOptions(originalAssetId: 42))
        XCTAssertEqual(answer, ["ok": true])

        let seen = try XCTUnwrap(SourcesStubProtocol.seen.first)
        XCTAssertEqual(seen.request.httpMethod, "POST")
        let type = try XCTUnwrap(seen.request.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertTrue(type.hasPrefix("multipart/form-data; boundary="), type)
        let boundary = String(type.dropFirst("multipart/form-data; boundary=".count))
        let body = try uploadedBody(seen)
        let expected = MultipartExpectation(boundary: boundary)
            .file(name: "files", filename: "final.jpg", type: "image/jpeg", bytes: bytes)
            .field(name: "paths", value: "Trip/final.jpg")
            .field(name: "original_asset_id", value: "42")
            .end()
        XCTAssertEqual(body, expected)
    }

    func testTheFormIsWrittenPartByPartInOrder() throws {
        let dir = sourcesScratch()
        let source = dir.appendingPathComponent("a.bin")
        let bytes = Data((0..<5000).map { UInt8($0 % 199) })
        try bytes.write(to: source)
        let out = dir.appendingPathComponent("form")
        try MultipartForm(boundary: "B0UND").write([
            .field(name: "paths", value: "x/y.jpg"),
            .file(name: "files", filename: "we\"ird\nname.atelierbytes", contents: .file(path: source.path)),
            .file(name: "files", filename: "b.json", contents: .data(Data("{}".utf8))),
        ], to: out, chunkSize: 1000)
        let expected = MultipartExpectation(boundary: "B0UND")
            .field(name: "paths", value: "x/y.jpg")
            .file(name: "files", filename: "we%22ird%0Aname.atelierbytes", type: "application/octet-stream", bytes: bytes)
            .file(name: "files", filename: "b.json", type: "application/json", bytes: Data("{}".utf8))
            .end()
        XCTAssertEqual(try Data(contentsOf: out), expected)
    }

    func testOnlyAPlainReadOfMediaMayComeFromTheCache() {
        func request(_ method: String, _ path: String, headers: [String: String] = [:], reload: Bool = false) -> WinnowRequest {
            WinnowRequest(method: method, url: base + path, path: path, query: [], headers: headers, reloadCache: reload)
        }
        XCTAssertEqual(WinnowRequestBuilder.cachePolicy(for: request("GET", "/api/assets/7/thumb")), .useProtocolCachePolicy)
        XCTAssertEqual(WinnowRequestBuilder.cachePolicy(for: request("GET", "/api/assets/7/thumb", reload: true)),
                       .reloadIgnoringLocalCacheData, "the replay of a failed read replaces the entry")
        XCTAssertEqual(WinnowRequestBuilder.cachePolicy(for: request("PUT", "/api/apps/atelier/docs/r1")),
                       .reloadIgnoringLocalCacheData)
        XCTAssertEqual(WinnowRequestBuilder.cachePolicy(for: request("GET", "/api/apps/atelier/docs")),
                       .reloadIgnoringLocalCacheData, "a list of documents is never served stale")
        XCTAssertEqual(WinnowRequestBuilder.cachePolicy(for: request("GET", "/api/x", headers: ["If-None-Match": "\"e1\""])),
                       .reloadIgnoringLocalCacheData, "a conditional GET must see its 304")
    }

    func testTheRequestIsBuiltAsTheClientSaidIt() throws {
        let req = WinnowRequest(method: "put", url: "\(base)/api/apps/atelier/docs/r1", path: "/api/apps/atelier/docs/r1",
                                query: [], headers: ["If-Match": "\"e1\"", "Content-Type": "application/json"],
                                body: .text("{}"), credentials: .omit)
        let prepared = try WinnowRequestBuilder.prepare(req)
        XCTAssertEqual(prepared.request.httpMethod, "PUT")
        XCTAssertEqual(prepared.request.value(forHTTPHeaderField: "If-Match"), "\"e1\"")
        XCTAssertFalse(prepared.request.httpShouldHandleCookies)
        guard case .data(let data) = prepared.body else { return XCTFail("a text body is handed over whole") }
        XCTAssertEqual(data, Data("{}".utf8))
        XCTAssertEqual(prepared.request.httpBody, data, "the request itself carries it")
        XCTAssertNil(prepared.cleanup)
    }
}

/// Progress reports, gathered from the transport's queue.
final class TransferProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [TransferProgress] = []

    func add(_ p: TransferProgress) {
        lock.lock()
        defer { lock.unlock() }
        items.append(p)
    }

    var all: [TransferProgress] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }
}

/// A multipart body as it must come out, byte for byte.
struct MultipartExpectation {
    let boundary: String
    var data = Data()

    init(boundary: String) { self.boundary = boundary }

    func field(name: String, value: String) -> MultipartExpectation {
        var copy = self
        copy.data += Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8)
        return copy
    }

    func file(name: String, filename: String, type: String, bytes: Data) -> MultipartExpectation {
        var copy = self
        copy.data += Data(("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n"
            + "Content-Type: \(type)\r\n\r\n").utf8)
        copy.data += bytes
        copy.data += Data("\r\n".utf8)
        return copy
    }

    func end() -> Data {
        data + Data("--\(boundary)--\r\n".utf8)
    }
}
