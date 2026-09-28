// The Library's two callers of the ONE lightbox (`MediaLightbox`) — the pool's
// own files (the web's `MediaLightbox` inside `AssetSidebar.tsx`) and an
// instance's rows before anything is fetched (`WinnowLightbox.tsx`). What
// differs between them is only where the pixels come from and the footer.
//
// Both draw the capture's FILES as chips (R6, `renditions-build.md`): the
// kernel lists them (`renditionsOf`, `viewableRenditions`, `viewLabel`,
// `viewFacts`), a chip that has to fetch does so on its click — a task, held
// for the session (`SessionOriginals`) — and nothing is written by looking.
// The `Develop` verb under the picture is what carries the file on screen
// onto a roll (`MediaAction.run(view)`, `viewedRendition`).
//
// The instance's deck is `[before, …pictures, after]` (`day-walk`): two cards
// naming the nearest day WITH media each way; landing on one in the direction
// it points moves the tab to that day — the sidebar's own override, visible
// behind the sheet — and the deck reopens on its first picture, or its last
// going back.

import Foundation
import SwiftUI
import AtelierKit

// MARK: - fetching one of a capture's files

/// One file of a capture fetched from its instance for a chip: a task with a
/// Cancel (`TaskCenter.tracked`, its bar following the bytes against the
/// weight the instance stated), scoped to the capture, held for the session
/// under its asset id.
@MainActor
enum CaptureFileFetch {
    static func fetch(_ url: String, name: String, bytes: Int?, assetId: String, scope: String?,
                      client: WinnowClient, lastModified: Double) async throws -> LightboxSource {
        if let held = SessionOriginals.shared.url(assetId) {
            return .file(held, raw: isRawImage(name))
        }
        let weight: Int64? = bytes.map { Int64($0) }
        let file = try await TaskCenter.tracked("Fetching \(name)", scope: scope, bytes: weight) {
            try await client.fetchFile(url, name: name, type: "", lastModified: lastModified)
        }
        guard let kept = SessionOriginals.shared.hold(assetId, name: name, data: file.data) else {
            throw CocoaError(.fileWriteUnknown)
        }
        return .file(kept, raw: isRawImage(name))
    }
}

// MARK: - the pool's own files

struct PoolLightbox: View {
    /// The assets there is something to look AT — a picture or a clip.
    let assets: [Asset]
    @Binding var index: Int
    /// The tool the Library serves, for "Use in <tool>".
    let toolLabel: String
    let onActivate: (String) -> Void
    let onClose: () -> Void

    @Environment(LibraryStore.self) private var library
    @Environment(MediaPublications.self) private var bus: MediaPublications?
    @Environment(ConnectionStore.self) private var connections: ConnectionStore?
    @Environment(\.palette) private var palette
    @State private var viewing: String?
    @State private var exposures: [String: String] = [:]
    @State private var siblings: [String: SiblingFacts] = [:]

    private var open: Asset? {
        assets.indices.contains(index) ? assets[index] : nil
    }

    var body: some View {
        let rows = renditions
        MediaLightbox(items: items, index: $index, from: "in your library", files: files(rows),
                      viewing: $viewing, taskScope: open.map { "library:\($0.id)" },
                      client: connections?.firstClient, onConfirm: { use() }, onClose: onClose) {
            footer(rows)
        }
        .task(id: exposureKey) { await readExposures() }
        .task(id: open?.id) { await readSiblings() }
        .onChange(of: index) { _, _ in viewing = nil }
    }

    // MARK: items

    private var items: [LightboxItem] {
        assets.map { asset in
            let cover = library.covers[asset.id]
            let image = asset.parts.image
            let main = image ?? asset.parts.video
            let location = main.flatMap { library.location(of: $0) }
            var item = LightboxItem(id: asset.id, title: asset.baseName, facts: assetFactsLine(asset, cover?.facts))
            item.kind = image == nil && asset.parts.video != nil ? .video : .photo
            item.source = location.map { LightboxSource.local($0, raw: image.map { isRawImage($0.name) } ?? false) }
            item.still = cover?.thumbnail.map { LightboxSource.pixels(LightboxPixels(id: "cover:\(asset.id)", image: $0)) }
            if let w = cover?.facts.width, let h = cover?.facts.height, w > 0, h > 0 {
                item.natural = CGSize(width: w, height: h)
            }
            if let line = exposures[asset.id] {
                item.camera = line
            } else if image != nil {
                item.cameraPending = true
            }
            if location == nil { item.unavailable = "This device no longer reaches the file." }
            return item
        }
    }

    /// The open one and its neighbours, whose exposure lines are read.
    private var exposureKey: String {
        guard !assets.isEmpty else { return "" }
        let n = assets.count
        let ids = [0, 1, -1].map { assets[(index + $0 + n) % n].id }
        return ids.joined(separator: "|")
    }

    private func readExposures() async {
        let n = assets.count
        guard n > 0 else { return }
        for d in [0, 1, -1] {
            let asset = assets[(index + d + n) % n]
            if exposures[asset.id] != nil { continue }
            let main = asset.parts.image ?? asset.parts.video
            guard let ref = main, let entry = library.entry(for: ref) else { continue }
            let vouched = vouchedExif(entry.origin, entry.exif)
            guard asset.parts.image != nil else {
                // A clip has no EXIF to find; only what its source vouched for.
                exposures[asset.id] = exposureSummary(vouched?.exif)
                continue
            }
            let location = entry.location
            let head = await Task.detached(priority: .utility) { LibraryFiles.head(location, count: exifSliceBytes) }.value
            exposures[asset.id] = exposureSummary(readEffectiveExif(head, vouched).exif)
        }
    }

    // MARK: the capture's files

    private var renditions: [Rendition] {
        _ = SessionOriginals.shared.version
        guard let asset = open, let image = asset.parts.image, let entry = library.entry(for: image) else { return [] }
        let cover = library.covers[asset.id]?.facts
        let measured: PixelSize? = {
            guard let w = cover?.width, let h = cover?.height, w > 0, h > 0 else { return nil }
            return PixelSize(width: w, height: h)
        }()
        let origin = entry.origin
        let assetId = image.assetId
        let held = SessionOriginals.shared
        let companion = origin?.companion.map { CaptureFacts.Companion(held: held.isHeld($0.assetId)) }
        let known = (asset.parts.siblings ?? []).compactMap { file -> CaptureFacts.Sibling? in
            siblings[fileIdentity(file)].map { CaptureFacts.Sibling(file: file, facts: $0) }
        }
        let facts = CaptureFacts(
            file: image, origin: origin, measured: measured, sensor: nil,
            original: CaptureFacts.Original(assetId: assetId, held: assetId.map { held.isHeld($0) } ?? false),
            companion: companion, siblings: known
        )
        return renditionsOf(captureInput(facts))
    }

    private func files(_ rows: [Rendition]) -> [LightboxFile] {
        guard let asset = open, let image = asset.parts.image else { return [] }
        let entry = library.entry(for: image)
        return viewableRenditions(rows).map { row in
            var file = LightboxFile(id: row.id, label: viewLabel(row), facts: viewFacts(row) { formatBytes($0) })
            file.unavailable = row.blocked
            let named = { (ref: SavedMediaRef) in ref.name.lowercased() == row.name.lowercased() }
            if row.role == .proxy || (named(image) && entry?.origin == nil) {
                file.source = entry.map { LightboxSource.local($0.location, raw: isRawImage(image.name)) }
            } else if let sibling = (asset.parts.siblings ?? []).first(where: named), let place = library.location(of: sibling) {
                file.source = .local(place, raw: isRawImage(sibling.name))
            } else if let assetId = row.assetId, let url = fetchUrl(row, entry) {
                file.fetches = !row.here
                let scope = "library:\(asset.id)"
                let name = row.name
                let when = image.lastModified
                if let held = SessionOriginals.shared.url(assetId) {
                    file.source = .file(held, raw: isRawImage(name))
                } else if let client = connections?.firstClient {
                    let weight = row.bytes
                    file.load = {
                        try await CaptureFileFetch.fetch(url, name: name, bytes: weight, assetId: assetId, scope: scope,
                                                         client: client, lastModified: when)
                    }
                } else {
                    file.unavailable = "Connect its instance to fetch it."
                }
            }
            return file
        }
    }

    /// Where a capture's other file is fetched from: the proxy's own original,
    /// or the companion the instance paired with it.
    private func fetchUrl(_ row: Rendition, _ entry: LibraryEntry?) -> String? {
        guard let origin = entry?.origin else { return nil }
        let lower = row.name.lowercased()
        if let companion = origin.companion, companion.name.lowercased() == lower {
            return connections?.firstClient?.originalUrl(of: companion)
        }
        if origin.name?.lowercased() == lower { return entry?.originalUrl }
        return nil
    }

    /// What each sibling's head says — its software tag, a RAW's two sizes.
    private func readSiblings() async {
        guard let asset = open else { return }
        for file in asset.parts.siblings ?? [] {
            let key = fileIdentity(file)
            guard siblings[key] == nil, let location = library.location(of: file) else { continue }
            let raw = isRawImage(file.name)
            let facts = await Task.detached(priority: .utility) { () -> SiblingFacts in
                let head = LibraryFiles.head(location, count: raw ? rawProbeBytes : exifSliceBytes) ?? []
                let software = parseExif(head).software
                if raw {
                    let sizes = rawSizesFrom(head)
                    let render = sizes.render.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                    let sensor = sizes.sensor.map { PixelSize(width: Int($0.width), height: Int($0.height)) }
                    return SiblingFacts(software: software, render: .some(render), sensor: sensor)
                }
                var pixels: PixelSize?
                if let opened = try? LibraryFiles.open(location) {
                    pixels = InstrumentImages.shownSize(opened.url).map { PixelSize(width: $0.width, height: $0.height) }
                    opened.close()
                }
                return SiblingFacts(software: software, pixels: pixels)
            }.value
            siblings[key] = facts
        }
    }

    // MARK: the footer

    @ViewBuilder
    private func footer(_ rows: [Rendition]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let offer = bus?.actions, !offer.actions.isEmpty {
                MediaActionRow(offer: offer, lead: true) { action in
                    let view = MediaView(rendition: viewedRendition(rows, viewing))
                    use()
                    action.run(view)
                }
            } else {
                Button(action: use) {
                    Text("USE IN \(toolLabel.uppercased())")
                        .font(Brand.mono(10, weight: .medium))
                        .kerning(1)
                        .foregroundStyle(palette.paper)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(palette.ink, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(open == nil)
            }
            Text("read from this device — nothing uploaded")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
        }
    }

    /// Make the open asset the tool's and close — what every verb starts from.
    private func use() {
        guard let asset = open else { return }
        onActivate(asset.id)
        onClose()
    }
}

// MARK: - an instance's rows

struct InstanceLightbox: View {
    let model: LibraryInstanceModel
    /// The rows the tab shows, past its filter — the same list the grid draws.
    let rows: [WinnowAssetRow]
    /// Which one is open, an index into `rows`.
    @Binding var index: Int
    /// A file-name filter narrows `rows`.
    let filtered: Bool
    /// Page onto a neighbouring day; the caller moves the tab and reopens.
    let onRoll: (WalkSide, String) -> Void
    let onClose: () -> Void

    @Environment(MediaPublications.self) private var bus: MediaPublications?
    @Environment(\.palette) private var palette
    @State private var onEdge: WalkSide?
    @State private var waiting: WalkSide?
    @State private var viewing: String?

    private var host: String { model.connection?.id ?? "" }
    private var asking: Bool { model.rows == nil && model.problem == nil }

    /// The day's own cards: its pictures, or the one card saying why there are none.
    private var dayCards: [LightboxItem] {
        let span = model.span
        if asking { return [placeholder(span, "asking…")] }
        if rows.isEmpty {
            return [placeholder(span, filtered ? "nothing on this day matches the filter" : "nothing here")]
        }
        guard let client = model.client else { return [] }
        return rows.map { item(from: $0, client) }
    }

    private var bodyIndex: Int {
        max(0, min(index, dayCards.count - 1))
    }

    private var deckItems: [LightboxItem] {
        [edge(.before)] + dayCards + [edge(.after)]
    }

    private var deckIndex: Int {
        switch onEdge {
        case .before?: return 0
        case .after?: return deckItems.count - 1
        case nil: return bodyIndex + 1
        }
    }

    private var row: WinnowAssetRow? {
        guard onEdge == nil, !asking, rows.indices.contains(bodyIndex) else { return nil }
        return rows[bodyIndex]
    }

    var body: some View {
        let renditions = rowRenditions
        let deck = Binding<Int>(get: { deckIndex }, set: { moved($0) })
        MediaLightbox(items: deckItems, index: deck, from: "from \(host)", files: files(renditions),
                      viewing: $viewing, taskScope: row.map { "\(host)/\($0.id)" }, client: model.client,
                      onConfirm: confirm, onClose: onClose) {
            footer(renditions)
        }
        .onChange(of: model.before) { _, _ in follow() }
        .onChange(of: model.after) { _, _ in follow() }
        .onChange(of: index) { _, _ in viewing = nil }
    }

    // MARK: the deck

    private func moved(_ at: Int) {
        let direction = pageDirection(deckIndex, at, deckItems.count)
        switch deckEntry(at, dayCards.count) {
        case .body(let i):
            onEdge = nil
            waiting = nil
            index = i
        case .edge(let side):
            let pointed = (side == .after) == (direction == 1)
            let next = model.neighbour(side)
            if pointed, case .day(let date, _) = next {
                roll(side, date)
                return
            }
            onEdge = side
            waiting = pointed && next == .asking ? side : nil
        }
    }

    /// The day behind a card landed on while it was still being looked for.
    private func follow() {
        guard let side = waiting else { return }
        switch model.neighbour(side) {
        case .day(let date, _): roll(side, date)
        case .asking: break
        default: waiting = nil
        }
    }

    private func roll(_ side: WalkSide, _ day: String) {
        onEdge = nil
        waiting = nil
        onRoll(side, day)
    }

    private func placeholder(_ span: DaySpan, _ why: String) -> LightboxItem {
        LightboxItem(id: "day:\(span.from):\(span.to)", title: placeholderTitle(span), facts: why, unavailable: why,
                     uncounted: true)
    }

    private func edge(_ side: WalkSide) -> LightboxItem {
        let words = edgeCardWords(side, model.neighbour(side), host: host)
        return LightboxItem(id: "edge:\(side.rawValue)", title: words.title, facts: words.facts, unavailable: words.line,
                            uncounted: true)
    }

    private func item(from row: WinnowAssetRow, _ client: WinnowClient) -> LightboxItem {
        // Winnow's own word on it rides the facts, read-only.
        let culled = describeCulling(cullingFromRow(row))
        let facts = culled.isEmpty ? rowFactsLine(row) : "\(rowFactsLine(row)) · Winnow: \(culled)"
        var item = LightboxItem(id: String(row.id), title: row.filename, facts: facts)
        let camera = rowCameraLine(row)
        item.camera = camera.isEmpty ? nil : camera
        item.kind = row.mediaType == .video ? .video : .photo
        // The PROXY — what the pool would hold, so what is on screen is what
        // the editor would get; no original is pulled to look at a day. Its
        // bytes are a task scoped to the row, drawn on the deck's edge.
        item.source = .remote(client.proxyUrl(row.id))
        item.taskScope = "\(host)/\(row.id)"
        item.still = .remote(client.thumbUrl(row.id))
        if let w = row.width, let h = row.height, w > 0, h > 0 { item.natural = CGSize(width: w, height: h) }
        return item
    }

    // MARK: the capture's files

    private var rowRenditions: [Rendition] {
        _ = SessionOriginals.shared.version
        guard let row, row.mediaType == .photo else { return [] }
        let capture = CaptureRow(
            id: row.id, filename: row.filename, width: row.width, height: row.height, fileSize: row.fileSize,
            groupKind: row.groupKind, companionId: row.companionId, companionFilename: row.companionFilename,
            companionFileSize: row.companionFileSize, companionMediaType: row.companionMediaType,
            companionWidth: row.companionWidth, companionHeight: row.companionHeight
        )
        let held = SessionOriginals.shared
        return renditionsOf(rowCaptureInput(capture, host) { held.isHeld($0) })
    }

    private func files(_ renditions: [Rendition]) -> [LightboxFile] {
        guard let row, let client = model.client else { return [] }
        let scope = "\(host)/\(row.id)"
        let when = captureMtime(row, now: nowMillis())
        return viewableRenditions(renditions).map { rendition in
            var file = LightboxFile(id: rendition.id, label: viewLabel(rendition), facts: viewFacts(rendition) { formatBytes($0) })
            file.unavailable = rendition.blocked
            if rendition.role == .proxy {
                file.source = .remote(client.proxyUrl(row.id))
                return file
            }
            guard let assetId = rendition.assetId,
                  let id = Int(assetId[assetId.index(after: assetId.lastIndex(of: "/") ?? assetId.startIndex)...]) else {
                return file
            }
            let name = rendition.name
            let raw = isRawImage(name)
            if let held = SessionOriginals.shared.url(assetId) {
                file.source = .file(held, raw: raw)
            } else {
                file.fetches = true
                let url = client.originalUrl(id)
                let weight = rendition.bytes
                file.load = {
                    try await CaptureFileFetch.fetch(url, name: name, bytes: weight, assetId: assetId, scope: scope,
                                                     client: client, lastModified: when)
                }
            }
            return file
        }
    }

    // MARK: the footer

    private var confirm: (() -> Void)? {
        guard let row, model.inLibrary["\(host)/\(row.id)"] == nil, model.fetching == nil else { return nil }
        return { Task { _ = await model.pick(row) } }
    }

    @ViewBuilder
    private func footer(_ renditions: [Rendition]) -> some View {
        if let row, let client = model.client {
            let have = model.inLibrary["\(host)/\(row.id)"] != nil
            let busy = model.fetching != nil
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    if have {
                        Text("✓ IN THE LIBRARY")
                            .font(Brand.mono(10))
                            .kerning(0.8)
                            .foregroundStyle(palette.muted)
                    } else {
                        Button {
                            Task { _ = await model.pick(row) }
                        } label: {
                            Text(model.fetching == row.id ? "FETCHING…" : "ADD TO LIBRARY")
                                .font(Brand.mono(10, weight: .medium))
                                .kerning(1)
                                .foregroundStyle(palette.paper)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(palette.ink, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                        .opacity(busy ? 0.5 : 1)
                    }
                    // Its SESSION, not the media: Winnow's viewer is local state
                    // and no route carries an asset — the grid it lives in is the
                    // closest a link gets (`client.sessionUrl`).
                    if let link = URL(string: row.sessionId.map { client.sessionUrl($0) } ?? client.proxyUrl(row.id)) {
                        Link(destination: link) {
                            Text("OPEN IN WINNOW ↗")
                                .font(Brand.mono(10, weight: .medium))
                                .kerning(1)
                                .foregroundStyle(palette.ink)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
                        }
                        .help(row.sessionId == nil
                              ? "Open this \(row.mediaType?.rawValue ?? "media") on \(host)"
                              : "Open this \(row.mediaType?.rawValue ?? "media")'s session on \(host)")
                    }
                    Text("the proxy, from \(host) — nothing leaves this device")
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                }
                // Starting something from here brings the picture across on
                // the way, and runs the verb only if it landed.
                MediaActionRow(offer: bus?.actions, busy: busy) { action in
                    let view = MediaView(rendition: viewedRendition(renditions, viewing))
                    Task {
                        guard await model.pick(row) != nil else { return }
                        action.run(view)
                        onClose()
                    }
                }
                if let problem = model.pickProblem {
                    LibraryProblemLine(problem: problem, onRetry: nil)
                }
            }
        }
    }
}

/// A problem said in red, with the sign-in link when that is the answer.
struct LibraryProblemLine: View {
    let problem: RowsProblem
    /// "ask again", when there is something to ask again.
    let onRetry: (() -> Void)?
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(problem.text)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let login = problem.login, let url = URL(string: login) {
                Link("Sign in there", destination: url)
                    .font(Brand.sans(12, weight: .semibold))
            }
            if let onRetry {
                Button("ask again", action: onRetry)
                    .buttonStyle(.plain)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .underline()
            }
        }
        .accessibilityAddTraits(.isStaticText)
    }
}
