// Which BYTES one picture of a run leaves from, found before it is rendered —
// the fetching half of the web's `exportPictures` (`use-roll-export.ts`), over
// the kernel's `sensorSourceFor`, `deliveredSourceFor` and `deliverySummary`
// (`renditions-build.md`, R3b–R4; `develop-originals.md` §7):
//
// 1. The file in hand — a locator, or the proxy the roll fetched — else
//    fetched ON THE SPOT from the instance its ref names, for this picture
//    alone (a picture far from the open one is not kept).
// 2. A picture developed on its RAW leaves from the SENSOR's data: the file
//    itself when it is the RAW, a RAW beside it in its folder (a sibling, in
//    hand — the same siblings the stage was handed, `CaptureSiblings.forRun`),
//    else the proxy's own original or the capture's companion, fetched once
//    and held for the session (`SessionOriginals`, shared with the lightbox).
//    Out of reach, the render leaves instead — `deliver` says so.
// 3. Below the sensor, the file set above the photograph (`RollPicture.
//    rendition`) is the picture's own answer, a sibling or fetched and held
//    the same way.
//
// A capture file that is not the picture's own is decoded under ITS OWN name
// (`sourceName`): a companion ARW read as the HIF it stands beside would be
// decoded as no RAW at all, and its base set aside.
// 4. Where nothing above decided, `Auto`'s arithmetic still does: a proxy's
//    original is fetched only where the proxy could not fill the LARGEST
//    target's frame — a RAW original through the render inside it, its size
//    read from a megabyte of its head, never assumed.
// 5. The EXIF is the ORIGINAL's whatever the pixels came from: a fetched
//    original's own head, else the original's head alone (a quarter of a
//    megabyte), else what the instance parsed at ingest.
//
// *Proxies only, for this run* skips 2–4. Every fetch is a TASK with its bytes
// and a Cancel; the run's own Cancel ends one in flight (the run's work is
// cancelled, and the transfer with it).

import Foundation
import ImageIO
import AtelierKit

/// The bytes one picture leaves from, and what they are vouched for with.
struct RunPictureSource {
    var source: PictureBytesSource?
    /// The name the source's own file goes by, when it is not the picture's
    /// (a sibling, a fetched original or companion) — what it is decoded as.
    var sourceName: String?
    /// The ORIGINAL's head, when the source is not the original itself.
    var exifHead: Data?
    /// What the instance parsed at ingest — the last resort for the EXIF.
    var vouchedExif: ExifData?
    var failures: [String] = []
    /// Files fetched for this picture alone, deleted once it is delivered.
    var temporary: [URL] = []
}

@MainActor
enum RunFetch {
    static func resolve(
        _ picture: RollPicture,
        step: String,
        given: PictureBytesSource?,
        identity known: WinnowIdentity?,
        rollId: String,
        store: RollStore,
        editor: RollEditor?,
        connections: ConnectionStore?,
        export: RollExport,
        proxiesOnly: Bool,
        siblings: [CaptureSiblingFile] = [],
        say: (String) -> Void
    ) async -> RunPictureSource {
        var out = RunPictureSource()
        var identity = known
        out.source = given
        // A file the roll fetched and let go since (its editor closed while
        // the run went on) is fetched again.
        if case .file(let url)? = given, !FileManager.default.fileExists(atPath: url.path) { out.source = nil }
        let label = picture.ref.name

        // 1. The file in hand, else fetched for this picture alone.
        if out.source == nil, RollStore.isRemote(picture.ref), let connections {
            say("Fetching \(step)…")
            let fetched: FetchedStill?
            if let editor {
                fetched = await editor.fetchPicture(picture, keep: false)
            } else {
                fetched = try? await RollWinnow.fetchStill(picture.ref, connections: connections, scope: picture.id)
            }
            guard let fetched else {
                if !Task.isCancelled {
                    out.failures.append("\(label) could not be found — not on this device, and no connected instance holds it")
                }
                return out
            }
            out.source = .file(fetched.url)
            identity = fetched.identity
            // Kept by the roll's pool, or by the Library: not this run's to delete.
            let pooled = store.sessionFile(rollId, picture.id) == fetched.url
            if fetched.owned && !pooled { out.temporary.append(fetched.url) }
        }
        guard let base = out.source else { return out }
        out.vouchedExif = identity?.exif
        let origin = identity?.origin
        let assetId = identity?.assetId
        let client = clientFor(assetId, connections)
        if proxiesOnly { return await withOriginalHead(out, identity, client) }

        // 2. A RAW develop leaves from the sensor's data.
        var decided = false
        let beside = siblings.map(\.ref)
        if isRawDevelop(picture.develop), let sensor = sensorSourceFor(picture.ref, origin, beside, assetId) {
            switch sensor.reach {
            case .file:
                decided = true
            case .sibling:
                if let file = sibling(sensor.name, siblings) {
                    out.source = file.source
                    out.sourceName = file.ref.name
                    return out
                }
                decided = true
            case .original, .companion:
                if let url = await fetchCapture(sensor, identity: identity, client: client, step: step, say: say) {
                    out.source = .file(url)
                    out.sourceName = sensor.name
                    return out
                }
                // Out of reach: `deliver` says the render left instead.
            }
        }

        // 3. The file set above the photograph.
        if !decided, let chosen = deliveredSourceFor(picture.rendition, picture.ref, origin, beside, assetId) {
            switch chosen.reach {
            case .file:
                decided = true
            case .sibling:
                if let file = sibling(chosen.name, siblings) {
                    out.source = file.source
                    out.sourceName = file.ref.name
                    return out
                }
                decided = true
            case .original, .companion:
                if let url = await fetchCapture(chosen, identity: identity, client: client, step: step, say: say) {
                    out.source = .file(url)
                    out.sourceName = chosen.name
                    return out
                }
                if Task.isCancelled { return out }
                out.failures.append("\(label): \(chosen.name) could not be fetched — what is in hand left instead")
                decided = true
            }
        }

        // 4. `Auto`: the proxy's original, where the largest target asks for it.
        if !decided, origin?.fidelity == .proxy,
           let originalUrl = identity?.originalUrl, let client, case .file(let proxy) = base,
           let size = pixelSize(proxy) {
            var render: PixelSize?
            if isProxyOverRaw(origin) {
                say("Reading the RAW’s head \(step)…")
                if let head = try? await client.fetchHead(originalUrl, bytes: rawProbeBytes) {
                    let sizes = rawSizesFrom([UInt8](head))
                    render = sizes.render.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                    out.exifHead = head
                }
            }
            let ratio = pictureAspectRatio(picture.aspect, size.width, size.height)
            let settings = DeliverySettings(size: largestSize(export.targets), pixels: .auto)
            let summary = deliverySummary(size, true, originalOf(origin, render), picture.framing, ratio,
                                          readBorder(picture.carried["border"]), settings)
            if summary.from == .original, let name = origin?.name {
                let wanted = SensorSource(reach: .original, name: name, bytes: origin?.bytes, key: assetId, held: nil,
                                          fetch: .original)
                if let url = await fetchCapture(wanted, identity: identity, client: client, step: step, say: say) {
                    out.source = .file(url)
                    out.sourceName = name
                    out.exifHead = nil
                    return out
                }
            }
        }
        return await withOriginalHead(out, identity, client)
    }

    /// Where the source is still a proxy, the EXIF is read from its ORIGINAL's
    /// head — the original held for the session when it is, else its first
    /// quarter of a megabyte.
    private static func withOriginalHead(_ found: RunPictureSource, _ identity: WinnowIdentity?,
                                         _ client: WinnowClient?) async -> RunPictureSource {
        var out = found
        guard out.exifHead == nil, identity?.origin?.fidelity == .proxy else { return out }
        if let key = identity?.assetId, let held = SessionOriginals.shared.url(key),
           let handle = try? FileHandle(forReadingFrom: held) {
            out.exifHead = try? handle.read(upToCount: exifSliceBytes)
            try? handle.close()
            return out
        }
        if let url = identity?.originalUrl, let client {
            out.exifHead = try? await client.fetchHead(url, bytes: exifSliceBytes)
        }
        return out
    }

    /// One of the capture's files: held for the session when it is, else
    /// fetched — a task with its bytes and a Cancel, scoped to the capture —
    /// and held under its own key.
    private static func fetchCapture(_ source: SensorSource, identity: WinnowIdentity?, client: WinnowClient?,
                                     step: String, say: (String) -> Void) async -> URL? {
        if let key = source.key, let held = SessionOriginals.shared.url(key) { return held }
        guard let client else { return nil }
        let url: String?
        switch source.fetch {
        case .original?:
            url = identity?.originalUrl
        case .companion?:
            url = identity?.origin?.companion.flatMap { client.originalUrl(of: $0) }
        case nil:
            url = nil
        }
        guard let url else { return nil }
        let weight = source.bytes.map { " · \(formatBytes($0))" } ?? ""
        say("Fetching \(source.name) \(step)\(weight)…")
        let name = source.name
        do {
            let file = try await TaskCenter.tracked("Fetching \(name)", scope: source.key, bytes: source.bytes.map { Int64($0) }) {
                try await client.fetchFile(url, name: name, type: "", lastModified: 0)
            }
            return SessionOriginals.shared.hold(source.key ?? url, name: name, data: file.data)
        } catch {
            return nil
        }
    }

    /// The sibling a source names, by its file name.
    private static func sibling(_ name: String, _ siblings: [CaptureSiblingFile]) -> CaptureSiblingFile? {
        let wanted = name.lowercased()
        return siblings.first { $0.ref.name.lowercased() == wanted }
    }

    /// The instance an asset id names, as a client — only a connected one.
    private static func clientFor(_ assetId: String?, _ connections: ConnectionStore?) -> WinnowClient? {
        guard let connections, let host = splitAssetId(assetId)?.host, let conn = connections.connection(host) else { return nil }
        return connections.client(for: conn)
    }

    /// A file's pixels as it is SHOWN, read from its header — nothing decoded.
    private static func pixelSize(_ url: URL) -> AtelierKit.Size? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Double,
              let h = props[kCGImagePropertyPixelHeight] as? Double, w > 0, h > 0 else { return nil }
        let turned = [5, 6, 7, 8].contains(props[kCGImagePropertyOrientation] as? Int ?? 1)
        return turned ? AtelierKit.Size(h, w) : AtelierKit.Size(w, h)
    }
}
