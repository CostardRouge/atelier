// The kernel's `WinnowTransport` over `URLSession` — the ONE thing the app
// writes for the Winnow client (`AtelierKit.WinnowClient`), which builds every
// request and maps every answer itself. The web injects `fetch`; this is its
// native twin, and it holds only what `fetch` did for free:
//
// - A request goes out VERBATIM: method, URL, headers, body. JSON and bytes
//   are handed over whole; a multipart form (the finals upload) is written
//   to a temporary file part by part — a file part STREAMED from disk in
//   chunks, never read whole — and uploaded from that file, so a 200 MB final
//   costs a copy on disk and no memory.
// - Bytes moving are REPORTED to whoever asked (`WinnowTransfer.progress`, a
//   task-local set around the client call), up and down — what the task pill
//   and a media's edge draw.
// - `maxBodyBytes` STOPS the transfer: once that many bytes have arrived the
//   task is cancelled and the answer handed back truncated — what reading an
//   original's EXIF head costs, where Winnow ignores `Range`.
// - `reloadCache` is `.reloadIgnoringLocalCacheData`: past the cache, and the
//   answer replaces the entry. The web needed that to heal a CORS-poisoned
//   entry (`cache-heal.ts`); URLSession has no CORS, so here it only covers
//   the one replay the client makes of a READ that got no answer.
// - A document request (the bucket, a conditional GET, any write) never
//   consults the cache at all: a 304 must reach the client as a 304, and a
//   stale list of documents is a lie about what the instance holds.
// - A cancelled Swift task cancels the URLSession task and throws
//   `CancellationError` — the person's own doing, which the client rethrows
//   untouched and never maps to "unreachable".
// - `credentials: .omit` (a Bearer token) sends no cookie. The native app is
//   a genuinely FOREIGN client of an instance (`docs/winnow-bridge.md` §3.3):
//   no same-site cookie can reach it, so its credential is the token the
//   person pasted, kept in the Keychain (`Keychain.swift`).
//
// It THROWS only when there is no answer at all — any status is an answer.

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif
import AtelierKit

// MARK: - progress

/// Bytes moving, as a transfer reports them.
struct TransferProgress: Equatable, Sendable {
    enum Direction: String, Sendable {
        case upload, download
    }

    var direction: Direction
    var bytes: Int64
    /// Nil when the other side did not say how long the body is.
    var total: Int64?

    /// 0…1, or nil when the length is unknown — a sweep rather than a fill.
    var fraction: Double? {
        guard let total, total > 0 else { return nil }
        return min(1, Double(bytes) / Double(total))
    }
}

enum WinnowTransfer {
    typealias Handler = @Sendable (TransferProgress) -> Void

    /// Set around a client call to hear its bytes move:
    ///
    ///     try await WinnowTransfer.$progress.withValue({ p in … }) {
    ///         try await client.upload(items)
    ///     }
    ///
    /// Called on the transport's own queue, never the main actor.
    @TaskLocal static var progress: Handler?
}

// MARK: - the request, as URLSession takes it

/// A `WinnowRequest` made into what URLSession sends. Pure but for the one
/// temporary file a multipart body is written to.
struct PreparedRequest {
    enum Body {
        case none
        case data(Data)
        /// A file to upload from — the multipart body, written to disk.
        case file(URL)
    }

    var request: URLRequest
    var body: Body
    /// A temporary file to remove once the exchange is over.
    var cleanup: URL?
}

enum WinnowRequestBuilder {
    /// Whether a request may be answered from the platform's cache. Only a
    /// plain GET of a URL the instance serves as immutable media may: a
    /// document is never served stale, a conditional GET must see its 304, and
    /// the replay of a failed read goes past the cache on purpose.
    static func cachePolicy(for req: WinnowRequest) -> URLRequest.CachePolicy {
        let method = req.method.uppercased()
        if req.reloadCache || (method != "GET" && method != "HEAD") { return .reloadIgnoringLocalCacheData }
        if req.header("If-None-Match") != nil || req.header("If-Match") != nil { return .reloadIgnoringLocalCacheData }
        if req.path.hasPrefix("/api/apps/") { return .reloadIgnoringLocalCacheData }
        return .useProtocolCachePolicy
    }

    static func prepare(_ req: WinnowRequest, temporaryDirectory: URL = FileManager.default.temporaryDirectory) throws -> PreparedRequest {
        guard let url = URL(string: req.url) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = req.method.uppercased()
        request.cachePolicy = cachePolicy(for: req)
        request.httpShouldHandleCookies = req.credentials == .include
        for (name, value) in req.headers { request.setValue(value, forHTTPHeaderField: name) }

        switch req.body {
        case nil:
            return PreparedRequest(request: request, body: .none, cleanup: nil)
        case .text(let text)?:
            request.httpBody = Data(text.utf8)
            return PreparedRequest(request: request, body: .data(Data(text.utf8)), cleanup: nil)
        case .bytes(let data)?:
            request.httpBody = data
            return PreparedRequest(request: request, body: .data(data), cleanup: nil)
        case .form(let parts)?:
            let form = MultipartForm()
            let file = temporaryDirectory.appendingPathComponent("atelier-upload-\(UUID().uuidString).multipart")
            try form.write(parts, to: file)
            request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
            if let size = (try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber {
                request.setValue(size.stringValue, forHTTPHeaderField: "Content-Length")
            }
            // Streamed from the file as it is sent — never read whole.
            request.httpBodyStream = InputStream(url: file)
            return PreparedRequest(request: request, body: .file(file), cleanup: file)
        }
    }
}

// MARK: - multipart/form-data

/// The web's `FormData`, written to a file in order: each field as text, each
/// file part streamed from its source in chunks.
struct MultipartForm {
    let boundary: String

    init(boundary: String = "AtelierFormBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))") {
        self.boundary = boundary
    }

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    /// A name or a file name inside a `Content-Disposition` quote — the HTML
    /// spec's escaping, what a browser sends for `FormData`.
    static func quoted(_ s: String) -> String {
        var out = ""
        for ch in s.unicodeScalars {
            switch ch {
            case "\"": out += "%22"
            case "\r": out += "%0D"
            case "\n": out += "%0A"
            default: out.unicodeScalars.append(ch)
            }
        }
        return "\"\(out)\""
    }

    /// The type a browser would give a `File` of that name.
    static func mimeType(forFileName name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        #if canImport(UniformTypeIdentifiers)
        if !ext.isEmpty, let type = UTType(filenameExtension: ext)?.preferredMIMEType { return type }
        #endif
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "json": return "application/json"
        default: return "application/octet-stream"
        }
    }

    func write(_ parts: [WinnowFormPart], to url: URL, chunkSize: Int = 1 << 20) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
        guard fm.createFile(atPath: url.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        let out = try FileHandle(forWritingTo: url)
        defer { try? out.close() }
        func text(_ s: String) throws { try out.write(contentsOf: Data(s.utf8)) }

        for part in parts {
            try text("--\(boundary)\r\n")
            switch part {
            case .field(let name, let value):
                try text("Content-Disposition: form-data; name=\(Self.quoted(name))\r\n\r\n")
                try text(value)
            case .file(let name, let filename, let contents):
                try text("Content-Disposition: form-data; name=\(Self.quoted(name)); filename=\(Self.quoted(filename))\r\n")
                try text("Content-Type: \(Self.mimeType(forFileName: filename))\r\n\r\n")
                switch contents {
                case .data(let data):
                    try out.write(contentsOf: data)
                case .file(let path):
                    let source = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
                    defer { try? source.close() }
                    while let chunk = try source.read(upToCount: chunkSize), !chunk.isEmpty {
                        try out.write(contentsOf: chunk)
                    }
                }
            }
            try text("\r\n")
        }
        try text("--\(boundary)--\r\n")
    }
}

// MARK: - the transport

/// URLSession under the kernel's client. One instance serves the whole app
/// (`shared`); a test builds its own over a configuration whose
/// `protocolClasses` answer in place of an instance.
final class URLSessionWinnowTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let shared = URLSessionWinnowTransport()

    /// The session's configuration: the platform's defaults, cookies accepted
    /// only where a request asks for them (a Bearer request never does).
    static func defaultConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.default
        configuration.httpAdditionalHeaders = ["User-Agent": "Atelier (native)"]
        return configuration
    }

    /// One request in flight. Guarded by `lock`.
    private final class Exchange {
        var continuation: CheckedContinuation<WinnowResponse, Error>?
        /// An answer that arrived before the continuation was installed.
        var result: Result<WinnowResponse, Error>?
        var response: HTTPURLResponse?
        var body = Data()
        let limit: Int?
        var stoppedAtLimit = false
        let progress: WinnowTransfer.Handler?
        let cleanup: URL?

        init(limit: Int?, progress: WinnowTransfer.Handler?, cleanup: URL?) {
            self.limit = limit; self.progress = progress; self.cleanup = cleanup
        }
    }

    private let lock = NSLock()
    private var exchanges: [Int: Exchange] = [:]
    private var session: URLSession!
    private let temporaryDirectory: URL

    init(configuration: URLSessionConfiguration = URLSessionWinnowTransport.defaultConfiguration(),
         temporaryDirectory: URL = FileManager.default.temporaryDirectory) {
        self.temporaryDirectory = temporaryDirectory
        super.init()
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "website.steeve.atelier.winnow"
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }

    /// The closure the kernel's client takes.
    var transport: WinnowTransport {
        { request in try await self.send(request) }
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    func send(_ req: WinnowRequest) async throws -> WinnowResponse {
        try Task.checkCancellation()
        let prepared = try WinnowRequestBuilder.prepare(req, temporaryDirectory: temporaryDirectory)
        // One kind of task for every body: the request carries it (`httpBody`,
        // or `httpBodyStream` over the multipart file), and a data task still
        // reports every byte sent (`didSendBodyData`).
        let task = session.dataTask(with: prepared.request)
        let exchange = Exchange(limit: req.maxBodyBytes, progress: WinnowTransfer.progress, cleanup: prepared.cleanup)
        let id = task.taskIdentifier
        locked { exchanges[id] = exchange }

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<WinnowResponse, Error>) in
                let early: Result<WinnowResponse, Error>? = locked {
                    if let result = exchange.result {
                        exchanges[id] = nil
                        return result
                    }
                    exchange.continuation = continuation
                    return nil
                }
                if let early {
                    continuation.resume(with: early)
                } else {
                    task.resume()
                }
            }
        } onCancel: {
            task.cancel()
        }
    }

    /// Hand the answer over, now or once the continuation is installed.
    private func finish(_ id: Int, _ result: Result<WinnowResponse, Error>) {
        let taken: (CheckedContinuation<WinnowResponse, Error>, URL?)? = locked {
            guard let exchange = exchanges[id] else { return nil }
            guard let continuation = exchange.continuation else {
                exchange.result = result
                return nil
            }
            exchanges[id] = nil
            return (continuation, exchange.cleanup)
        }
        guard let (continuation, cleanup) = taken else { return }
        if let cleanup { try? FileManager.default.removeItem(at: cleanup) }
        continuation.resume(with: result)
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        locked { exchanges[dataTask.taskIdentifier]?.response = response as? HTTPURLResponse }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        var report: (WinnowTransfer.Handler, TransferProgress)?
        var stop = false
        locked {
            guard let exchange = exchanges[dataTask.taskIdentifier], !exchange.stoppedAtLimit else { return }
            exchange.body.append(data)
            if let limit = exchange.limit, exchange.body.count >= limit {
                exchange.stoppedAtLimit = true
                stop = true
            }
            if let handler = exchange.progress {
                let known: URLResponse? = exchange.response ?? dataTask.response
                let expected = known?.expectedContentLength ?? -1
                let total: Int64? = exchange.limit.map(Int64.init) ?? (expected > 0 ? expected : nil)
                report = (handler, TransferProgress(direction: .download, bytes: Int64(exchange.body.count), total: total))
            }
        }
        if let (handler, progress) = report { handler(progress) }
        if stop { dataTask.cancel() }
    }

    /// A streamed body asked for again (a redirect, an authentication round):
    /// the multipart file is read from its start once more.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    needNewBodyStream completionHandler: @escaping (InputStream?) -> Void) {
        let file = locked { exchanges[task.taskIdentifier]?.cleanup }
        completionHandler(file.flatMap { InputStream(url: $0) })
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64,
                    totalBytesExpectedToSend: Int64) {
        guard let handler = locked({ exchanges[task.taskIdentifier]?.progress }) else { return }
        handler(TransferProgress(direction: .upload, bytes: totalBytesSent,
                                 total: totalBytesExpectedToSend > 0 ? totalBytesExpectedToSend : nil))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let snapshot: (HTTPURLResponse?, Data, Int?, Bool)? = locked {
            guard let exchange = exchanges[task.taskIdentifier] else { return nil }
            return (exchange.response, exchange.body, exchange.limit, exchange.stoppedAtLimit)
        }
        guard let (heard, body, limit, stopped) = snapshot else { return }
        // The task's own record of the answer, should the SDK's response
        // callback (whose completion handler's attributes move between SDKs)
        // not be the one this class implements.
        let response = heard ?? task.response as? HTTPURLResponse
        let result: Result<WinnowResponse, Error>
        if stopped, let response {
            let head = limit.map { Data(body.prefix($0)) } ?? body
            result = .success(Self.answer(response, head))
        } else if let error {
            if (error as? URLError)?.code == .cancelled {
                result = .failure(CancellationError())
            } else {
                result = .failure(error)
            }
        } else if let response {
            result = .success(Self.answer(response, body))
        } else {
            result = .failure(URLError(.badServerResponse))
        }
        finish(task.taskIdentifier, result)
    }

    private static func answer(_ response: HTTPURLResponse, _ body: Data) -> WinnowResponse {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            headers[name] = value as? String ?? "\(value)"
        }
        return WinnowResponse(status: response.statusCode, headers: headers, body: body)
    }
}
