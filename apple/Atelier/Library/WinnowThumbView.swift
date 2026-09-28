// One tile's thumbnail from a Winnow, which RETRIES instead of staying black —
// the native twin of `src/shared/sources/winnow/WinnowThumb.tsx`, and every
// Winnow thumbnail of the app comes from here (`architecture.md`, «A thumbnail
// retries»: the fix was paid three times on the web by grids that drew their
// own bare image).
//
// The schedule is the kernel's (`Library/ThumbRetry.swift`): attempt 0 is the
// plain URL, answered from the platform's cache when it can be; its failure
// HEALS the entry — one request past the cache that replaces it — and asks the
// plain URL again, or a discriminated `?retry=N` URL at once when the heal
// says the instance is not answering; later failures wait `attempt × 400 ms`;
// past three retries the tile draws its label. On the web the heal cures a
// cache entry stored without its CORS headers; URLSession has no CORS, so here
// it cures a stale or truncated entry — the same one request, once per URL
// per session (`LibraryHeal`).
//
// The attempt count lives in the tile, so a failing tile re-renders itself and
// never the grid; a tile that leaves cancels what it had pending.

import CoreGraphics
import Foundation
import ImageIO
import SwiftUI
import AtelierKit

/// Replacing a cache entry past the cache, once per URL per session — the
/// web's `cache-heal.ts`.
@MainActor
enum LibraryHeal {
    private static var attempts: [String: Task<Bool, Never>] = [:]

    /// Ask for `url` again past the cache; true when the entry now holds
    /// something worth asking for again (a 2xx), false for anything else.
    static func heal(_ url: String, client: WinnowClient, transport: @escaping WinnowTransport) async -> Bool {
        if let held = attempts[url] { return await held.value }
        var headers: [String: String] = [:]
        var credentials = WinnowCredentials.include
        if case .token(let token) = client.config.auth {
            headers["Authorization"] = "Bearer \(token)"
            credentials = .omit
        }
        let path = URLComponents(string: url)?.path ?? "/"
        let request = WinnowRequest(method: "GET", url: url, path: path.isEmpty ? "/" : path, query: [],
                                    headers: headers, credentials: credentials, reloadCache: true)
        let attempt = Task { () -> Bool in
            guard let answer = try? await transport(request) else { return false }
            return answer.ok
        }
        attempts[url] = attempt
        return await attempt.value
    }
}

/// Decoded thumbnails kept for the session, by URL — a tile scrolled back into
/// view draws at once.
final class WinnowThumbCache: @unchecked Sendable {
    static let shared = WinnowThumbCache()
    private let cache = NSCache<NSString, CGImage>()

    init() {
        cache.countLimit = 600
    }

    func image(_ key: String) -> CGImage? {
        cache.object(forKey: key as NSString)
    }

    func store(_ image: CGImage, _ key: String) {
        cache.setObject(image, forKey: key as NSString)
    }
}

struct WinnowThumbView: View {
    let client: WinnowClient
    /// The asset's id on that instance.
    let id: Int
    /// What the tile says when the picture will not come — `photo`, `video`.
    let label: String

    @Environment(\.palette) private var palette
    @State private var image: CGImage?
    @State private var attempt = 0

    var body: some View {
        ZStack {
            palette.frame
            if let image {
                Image(decorative: image, scale: 1, orientation: .up)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if thumbGaveUp(attempt) {
                Text(label.uppercased())
                    .font(Brand.mono(9))
                    .kerning(0.6)
                    .foregroundStyle(palette.muted)
            }
        }
        .clipped()
        .task(id: "\(client.config.baseUrl)/\(id)") { await load() }
    }

    private func load() async {
        let key = "\(client.config.baseUrl)/\(id)"
        if let held = WinnowThumbCache.shared.image(key) {
            image = held
            return
        }
        image = nil
        var tried = 0
        attempt = 0
        while !thumbGaveUp(tried) {
            if Task.isCancelled { return }
            if let got = await fetch(client.thumbRetryUrl(id, tried)) {
                WinnowThumbCache.shared.store(got, key)
                image = got
                return
            }
            if Task.isCancelled { return }
            switch thumbAfterFailure(tried) {
            case .heal:
                let healed = await LibraryHeal.heal(client.thumbUrl(id), client: client,
                                                    transport: ConnectionStore.shared.transport)
                tried = thumbAfterHeal(healed)
            case .retry(let next, let afterMs):
                try? await Task.sleep(nanoseconds: UInt64(afterMs * 1_000_000))
                tried = next
            }
            attempt = tried
        }
    }

    private func fetch(_ url: String) async -> CGImage? {
        guard let file = try? await client.fetchFile(url, name: "thumb", type: "image/webp", lastModified: 0),
              let source = CGImageSourceCreateWithData(file.data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}

#Preview("A tile that gives up") {
    WinnowThumbView(client: LibraryFixtures.refusingClient, id: 42, label: "photo")
        .frame(width: 74, height: 74)
}
