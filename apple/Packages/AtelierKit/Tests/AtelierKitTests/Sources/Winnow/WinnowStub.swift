// A stub instance for the Winnow specs — what `vi.fn(fetch)` is to the web's:
// it answers each request from a closure (told how many calls came before)
// and keeps every request it was handed, so a spec can read the route, the
// query, the headers and the body the client built.

import Foundation
@testable import AtelierKit

let winnowBase = "https://winnow.example"

/// What a thrown `fetch` is — a CORS refusal, a DNS miss, being offline.
struct WinnowFetchFailed: Error {}

final class WinnowStub: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [WinnowRequest] = []
    private let answer: @Sendable (WinnowRequest, Int) throws -> WinnowResponse

    init(_ answer: @escaping @Sendable (WinnowRequest, Int) throws -> WinnowResponse) {
        self.answer = answer
    }

    /// Every call answered with the same JSON.
    convenience init(json: JSONValue) {
        self.init { _, _ in .json(json) }
    }

    /// Every call answered with the same status and an empty body.
    convenience init(status: Int, headers: [String: String] = [:], text: String = "") {
        self.init { _, _ in WinnowResponse(status: status, headers: headers, text: text) }
    }

    var requests: [WinnowRequest] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }

    var transport: WinnowTransport {
        { [self] request in
            lock.lock()
            let index = seen.count
            seen.append(request)
            lock.unlock()
            return try answer(request, index)
        }
    }

    func client(auth: WinnowAuth = .cookie, now: @escaping @Sendable () -> Double = { 0 }) -> WinnowClient {
        WinnowClient(config: WinnowConfig(baseUrl: winnowBase, auth: auth), transport: transport, now: now)
    }
}

/// The error an async call threw, or nil when it did not throw.
func winnowThrown<T>(_ body: () async throws -> T) async -> Error? {
    do {
        _ = try await body()
        return nil
    } catch {
        return error
    }
}

/// A `WinnowError` an async call threw, or nil.
func winnowError<T>(_ body: () async throws -> T) async -> WinnowError? {
    await winnowThrown(body) as? WinnowError
}
