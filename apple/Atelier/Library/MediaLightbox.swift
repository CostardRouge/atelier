// ONE media, large, with hands — the native twin of the web's
// `MediaLightbox.tsx` + `use-media-viewer.ts`, the one lightbox for every
// source (`architecture.md`; `frontend.md`, «Looking at ONE picture is the
// ONLY other zoom»): the Library's own files and an instance's rows go through
// the same deck, gestures and chrome, and only the source and the footer
// differ.
//
// - A deck of three slots — previous · current · next — moved as one, so a
//   swipe reveals the neighbour progressively; the neighbours are LOADED
//   while hidden, which is what makes a swipe land on a picture already
//   there (a clip mounts its player only in the middle).
// - Fit to 8× (`maxViewZoom`), every zoom keeping the point under the hand
//   still (`zoomAbout`); a drag PANS once zoomed and SWIPES when not
//   (`swipeCommit`: far enough or fast enough); a double tap and `Z` toggle;
//   at the fit the arrows page, zoomed they pan (40 pt, 200 with ⇧) — the web's
//   `zoom-keys.ts`. On a Mac the wheel zooms and a sideways trackpad sweep
//   PAGES the moment it crosses its line and swallows its momentum
//   (`sweepCommit`, `sweepRestarts`).
// - The cheap STILL is drawn at once under the full picture, which fades in
//   over it; a hairline says the sharp one is still coming. An instance's
//   proxy is fetched as a task scoped to its row (`TaskCenter.tracked`), so
//   its bar and its Cancel are the deck's edge instead.
// - The capture's FILES as chips (R6 of `docs/capture-renditions.md`): view
//   state only, owned by the caller so a verb can read it; a chip that will
//   fetch says `↓` before the click, `…` while it does, and the fetch is a
//   task (`TaskCenter.tracked`) drawn on the deck's edge (`TaskEdge`) with
//   its own Cancel here (`TaskCancelLink`), since the pill is behind the sheet.
//   Under another file of the capture the still is only a placeholder — it
//   leaves as that file lands, never two pictures at once.

import AVKit
import CoreGraphics
import Foundation
import ImageIO
import Observation
import SwiftUI
import AtelierKit

// MARK: - what a slot draws

/// A picture's pixels, compared by an id — a `CGImage` is not `Equatable`.
struct LightboxPixels: Hashable {
    let id: String
    let image: CGImage

    static func == (l: LightboxPixels, r: LightboxPixels) -> Bool { l.id == r.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// Where a slot's picture comes from — the sheet never learns more.
enum LightboxSource: Hashable {
    /// Pixels already in hand — a cover the Library built.
    case pixels(LightboxPixels)
    /// A file of this device; a RAW is drawn through the render inside it.
    case local(LibraryLocation, raw: Bool)
    /// A file this session holds (a fetched original).
    case file(URL, raw: Bool)
    /// An instance's URL, asked through its client.
    case remote(String)
}

/// One media to look at, whatever holds it.
struct LightboxItem: Identifiable {
    enum Kind {
        case photo, video
    }

    let id: String
    var title: String
    /// The one line of facts under the title.
    var facts: String
    /// The exposure line — body, lens, focal length, aperture, shutter, ISO.
    var camera: String? = nil
    /// That line is still being read.
    var cameraPending = false
    var kind: Kind = .photo
    /// What the middle slot draws. Nil while it cannot be drawn.
    var source: LightboxSource? = nil
    /// The cheap rendition, drawn under the full one.
    var still: LightboxSource? = nil
    /// The media's own pixel size, when the caller already knows it.
    var natural: CGSize? = nil
    /// Why there is nothing to draw.
    var unavailable: String? = nil
    /// A card that is not a media (a day's edge): paged to, never counted.
    var uncounted = false
    /// Where fetching its full picture from an instance is a TASK — the row's
    /// scope, `<host>/<id>`; nil for a file already on this device.
    var taskScope: String? = nil
}

/// One FILE of the capture the open item is — a chip.
struct LightboxFile: Identifiable {
    /// The rendition's id, what a verb carries away.
    let id: String
    /// `Proxy`, else the file's name.
    let label: String
    /// What it is, its pixels, its weight.
    let facts: String
    /// Where to draw it from, once in hand.
    var source: LightboxSource? = nil
    var natural: CGSize? = nil
    /// Why it cannot be shown here.
    var unavailable: String? = nil
    /// Bring the bytes in — fetched, or sliced out of a RAW.
    var load: (@MainActor () async throws -> LightboxSource)? = nil
    /// Choosing it will fetch from an instance — said on the chip before the click.
    var fetches = false
}

// MARK: - decoding

/// Pictures decoded for the sheet, at a size a screen can use, kept while the
/// session lasts so a page back draws at once.
enum LightboxPictures {
    private final class Cache: @unchecked Sendable {
        let images = NSCache<NSString, CGImage>()
        init() { images.countLimit = 24 }
    }

    private static let cache = Cache()
    /// The long edge a lightbox decodes to: 8× a phone's fitted width is past
    /// this, but a picture is not decoded whole to be looked at.
    static let edge = 3000

    static func key(_ source: LightboxSource) -> String {
        switch source {
        case .pixels(let p): return "px:\(p.id)"
        case .local(let location, let raw): return "loc:\(location.hashValue):\(raw)"
        case .file(let url, let raw): return "file:\(url.path):\(raw)"
        case .remote(let url): return "remote:\(url)"
        }
    }

    /// A fetch that is a task: its words, and the media it is scoped to.
    struct Tracking {
        let label: String
        let scope: String
    }

    static func image(_ source: LightboxSource?, client: WinnowClient?, tracking: Tracking? = nil) async -> CGImage? {
        guard let source else { return nil }
        if case .pixels(let p) = source { return p.image }
        let key = key(source) as NSString
        if let hit = cache.images.object(forKey: key) { return hit }
        let decoded: CGImage?
        switch source {
        case .pixels(let p):
            decoded = p.image
        case .local(let location, let raw):
            decoded = await Task.detached(priority: .userInitiated) { () -> CGImage? in
                guard let opened = try? LibraryFiles.open(location) else { return nil }
                defer { opened.close() }
                return LightboxPictures.decode(opened.url, raw: raw)
            }.value
        case .file(let url, let raw):
            decoded = await Task.detached(priority: .userInitiated) { LightboxPictures.decode(url, raw: raw) }.value
        case .remote(let url):
            guard let client, let data = await remoteBytes(url, client: client, tracking: tracking) else { return nil }
            decoded = await Task.detached(priority: .userInitiated) { LightboxPictures.decode(data) }.value
        }
        if let decoded { cache.images.setObject(decoded, forKey: key) }
        return decoded
    }

    /// An instance's bytes, through its client — which already replays a
    /// failed read once past the cache (the web's `cache-heal`) — and, where
    /// the caller named one, as a TASK with a Cancel (`TaskCenter.tracked`,
    /// the web's `trackedFetch`), its bar on the row's edge.
    private static func remoteBytes(_ url: String, client: WinnowClient, tracking: Tracking?) async -> Data? {
        let fetch: () async throws -> WinnowFile = {
            try await client.fetchFile(url, name: "picture", type: "", lastModified: 0)
        }
        guard let tracking else { return try? await fetch().data }
        let file = try? await TaskCenter.tracked(tracking.label, scope: tracking.scope, fetch)
        return file?.data
    }

    /// A file at the sheet's size, turned upright; a RAW through the render
    /// its camera wrote inside it, else whatever the system can draw of it.
    static func decode(_ url: URL, raw: Bool) -> CGImage? {
        if raw {
            let size = InstrumentImages.size(url)
            if let render = try? extractRawPreview(fileSize: size, read: { try InstrumentImages.range(url, $0) }),
               let image = decode(Data(render)) {
                return image
            }
        }
        return InstrumentImages.thumbnail(url, maxPixel: edge)
    }

    static func decode(_ data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: edge,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}

// MARK: - the view zoom

/// Looking closer — fit to 8×, never writing anything; the kernel's arithmetic,
/// and the `ZoomTarget` the Mac's wheel drives.
@MainActor
@Observable
final class LightboxZoom: ZoomTarget {
    private(set) var view: ViewState = .fitted
    /// Animate the next change (a button, a key), never a finger.
    private(set) var settling = false
    @ObservationIgnored private(set) var viewport = AtelierKit.Size(0, 0)
    @ObservationIgnored private(set) var content = AtelierKit.Size(0, 0)
    /// A sideways sweep at the fit that earned a page: `1` next, `−1` previous.
    @ObservationIgnored var onSweep: ((Int) -> Void)?
    @ObservationIgnored private var swept = 0.0
    @ObservationIgnored private var sweepLast = 0.0
    @ObservationIgnored private var swallowing = false

    let ceiling = maxViewZoom

    var zoomed: Bool { view.scale > 1.0001 }

    /// The slot and the picture fitted in it (`containedSize`).
    func layout(viewport: CGSize, natural: CGSize?) {
        self.viewport = AtelierKit.Size(Double(viewport.width), Double(viewport.height))
        let known = natural.map { AtelierKit.Size(Double($0.width), Double($0.height)) }
        content = containedSize(known, self.viewport)
        let next = clampView(view, viewport: self.viewport, content: content, ceiling)
        if next != view { view = next }
    }

    func reset() {
        settling = false
        view = .fitted
        swept = 0
    }

    func fit() {
        settling = true
        view = .fitted
    }

    func zoomIn(about anchor: CGPoint? = nil) {
        settling = true
        apply(stepViewZoom(view.scale, 1, ceiling), anchor)
    }

    func zoomOut(about anchor: CGPoint? = nil) {
        settling = true
        apply(stepViewZoom(view.scale, -1, ceiling), anchor)
    }

    /// `Z` and a double tap: closer, or back to the fit.
    func toggle(about anchor: CGPoint? = nil) {
        if zoomed { fit() } else { zoomIn(about: anchor) }
    }

    func pinch(from start: Double, ratio: Double, anchor: CGPoint) {
        settling = false
        apply(zoomByPinchRatio(start, ratio, ceiling), anchor)
    }

    func pan(dx: Double, dy: Double) {
        settling = false
        let moved = ViewState(scale: view.scale, x: view.x + dx, y: view.y + dy)
        view = clampView(moved, viewport: viewport, content: content, ceiling)
    }

    /// `anchor` in the slot's own coordinates (top-left origin), or its centre.
    private func apply(_ scale: Double, _ anchor: CGPoint?) {
        let centred = anchor.map {
            AtelierKit.Point(Double($0.x) - viewport.width / 2, Double($0.y) - viewport.height / 2)
        } ?? AtelierKit.Point(0, 0)
        view = zoomAbout(view, scale, anchor: centred, viewport: viewport, content: content, ceiling)
    }

    /// A sideways wheel sweep at the fit: a page once it crosses its line, the
    /// momentum after it swallowed until the fingers land again.
    private func sweep(_ dx: Double) {
        if swallowing {
            guard sweepRestarts(sweepLast, dx) else {
                sweepLast = dx
                return
            }
            swallowing = false
            swept = 0
        }
        swept += dx
        sweepLast = dx
        let page = sweepCommit(swept, viewport.width)
        guard page != 0 else { return }
        swept = 0
        swallowing = true
        onSweep?(page)
    }

    // MARK: ZoomTarget

    nonisolated func scaleAt(_ at: AtelierKit.Point) -> Double {
        MainActor.assumeIsolated { view.scale }
    }

    nonisolated func zoomTo(_ scale: Double, anchor: AtelierKit.Point, by: ZoomBy) {
        MainActor.assumeIsolated {
            settling = false
            apply(scale, CGPoint(x: anchor.x, y: anchor.y))
        }
    }

    nonisolated func panBy(_ dx: Double, _ dy: Double, at: AtelierKit.Point, by: PanBy) {
        MainActor.assumeIsolated {
            if !zoomed && by == .wheel {
                sweep(dx)
            } else {
                pan(dx: dx, dy: dy)
            }
        }
    }
}

// MARK: - the sheet

struct MediaLightbox<Footer: View>: View {
    let items: [LightboxItem]
    @Binding var index: Int
    /// What the sheet is, for a screen reader: "from winnow.example".
    let from: String
    /// The capture's files behind the OPEN item, first the one it draws.
    let files: [LightboxFile]
    /// Which of them is on screen — nil for the first.
    @Binding var viewing: String?
    /// The open capture's task scope: a chip's fetch draws on the deck's edge.
    let taskScope: String?
    /// Asks an instance's URLs; nil for a sheet over local files.
    let client: WinnowClient?
    /// What Return does, when the caller has one obvious action.
    let onConfirm: (() -> Void)?
    let onClose: () -> Void
    let footer: () -> Footer

    init(items: [LightboxItem], index: Binding<Int>, from: String, files: [LightboxFile] = [],
         viewing: Binding<String?> = .constant(nil), taskScope: String? = nil, client: WinnowClient? = nil,
         onConfirm: (() -> Void)? = nil, onClose: @escaping () -> Void, @ViewBuilder footer: @escaping () -> Footer) {
        self.items = items
        _index = index
        self.from = from
        self.files = files
        _viewing = viewing
        self.taskScope = taskScope
        self.client = client
        self.onConfirm = onConfirm
        self.onClose = onClose
        self.footer = footer
    }

    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var zoom = LightboxZoom()
    @State private var deckOffset: CGFloat = 0
    @State private var deckWidth: CGFloat = 0
    @State private var paging = false
    @State private var pinchStart: Double?
    @State private var panLast: CGSize?
    @State private var measured: [String: CGSize] = [:]
    @State private var ready = true
    @State private var loading: String?
    @State private var failed: [String: String] = [:]
    @State private var loaded: [String: LightboxSource] = [:]
    @FocusState private var focused: Bool

    private let gap: CGFloat = 16

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    private var item: LightboxItem? {
        items.indices.contains(index) ? items[index] : nil
    }

    /// The file of the capture on screen: the one asked for, else the first.
    private var shownFile: LightboxFile? {
        guard !files.isEmpty else { return nil }
        return files.first { $0.id == viewing } ?? files[0]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if let item {
                Text(item.facts)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(item.facts)
            }
            if files.count > 1 { chips }
            if items.contains(where: { ($0.camera?.isEmpty == false) || $0.cameraPending }) { exposureLine }
            deck
            footer()
        }
        .padding(compact ? 12 : 16)
        .background(palette.surface)
        #if os(macOS)
        .frame(minWidth: 760, idealWidth: 1024, minHeight: 560, idealHeight: 780)
        #endif
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in handle(press) }
        .onAppear {
            focused = true
            zoom.onSweep = { direction in pageBy(direction) }
        }
        .onChange(of: index) { _, _ in
            zoom.reset()
            failed = [:]
        }
        .task(id: shownFile?.id) { await loadShownFile() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(item?.title ?? ""), \(from)")
    }

    // MARK: header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(item?.title ?? "")
                .font(Brand.display(compact ? 20 : 24))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            if let item, !item.uncounted {
                let counted = items.filter { !$0.uncounted }
                let position = items.prefix(index + 1).filter { !$0.uncounted }.count
                Text("\(position) / \(counted.count)")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            if !compact { zoomPill }
            Button(action: onClose) {
                Text("CLOSE ✕")
                    .font(Brand.mono(10, weight: .medium))
                    .kerning(1.2)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .overlay(Capsule().stroke(palette.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel("Close")
        }
    }

    private var zoomPill: some View {
        HStack(spacing: 2) {
            Button { zoom.zoomOut() } label: { Image(systemName: "minus").frame(width: 24, height: 24) }
                .disabled(!zoom.zoomed)
            Button { if zoom.zoomed { zoom.fit() } } label: {
                Text(zoomLabel(zoom.view.scale))
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .frame(minWidth: 46)
            }
            Button { zoom.zoomIn() } label: { Image(systemName: "plus").frame(width: 24, height: 24) }
                .disabled(zoom.view.scale >= zoom.ceiling - 0.0001)
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.inkSoft)
        .padding(4)
        .overlay(Capsule().stroke(palette.line, lineWidth: 1))
        .help("Zoom — wheel, pinch, or Z")
    }

    // MARK: the capture's files

    private var chips: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { at, file in
                        chip(file, first: at == 0)
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            if let shown = shownFile {
                Text(failed[shown.id] ?? shown.facts)
                    .font(Brand.sans(11))
                    .foregroundStyle(failed[shown.id] == nil ? palette.muted : palette.danger)
                    .lineLimit(1)
                    .help(shown.facts)
            }
            // The shell's pill is behind the sheet: the sheet carries its own Cancel.
            TaskCancelLink(scope: taskScope)
        }
    }

    private func chip(_ file: LightboxFile, first: Bool) -> some View {
        let on = file.id == shownFile?.id
        let suffix = loading == file.id ? "…" : (file.fetches && !on ? " ↓" : "")
        return Button {
            failed[file.id] = nil
            viewing = first ? nil : file.id
        } label: {
            Text((file.label + suffix).uppercased())
                .font(Brand.mono(10))
                .kerning(1)
                .foregroundStyle(on ? palette.paper : palette.inkSoft)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(on ? palette.ink : palette.paper, in: Capsule())
                .overlay(Capsule().stroke(on ? palette.ink : palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(file.unavailable != nil)
        .opacity(file.unavailable != nil ? 0.5 : 1)
        .help(file.unavailable ?? file.facts)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// Bring the shown file's bytes in, when it is not in hand yet.
    private func loadShownFile() async {
        guard let file = shownFile, file.source == nil, loaded[file.id] == nil, file.unavailable == nil,
              failed[file.id] == nil, let load = file.load else { return }
        loading = file.id
        do {
            let source = try await load()
            loaded[file.id] = source
        } catch is CancellationError {
            // The person's own doing — nothing to report.
        } catch {
            failed[file.id] = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
        }
        if loading == file.id { loading = nil }
    }

    private var exposureLine: some View {
        let camera = item?.camera ?? ""
        let pending = camera.isEmpty && (item?.cameraPending ?? false)
        return Text(pending ? "reading exposure…" : camera)
            .font(Brand.mono(11))
            .foregroundStyle(palette.faint)
            .lineLimit(1)
            .frame(height: 14, alignment: .leading)
            .opacity(pending ? 0.6 : 1)
    }

    // MARK: the deck

    /// One place of the deck: which item, and where it sits against the open one.
    private struct DeckSlot: Identifiable {
        let id: String
        let at: Int
        let offset: Int
    }

    /// The slots around the open item: previous · current · next.
    private var slots: [DeckSlot] {
        let n = items.count
        guard n > 0, items.indices.contains(index) else { return [] }
        if n == 1 { return [DeckSlot(id: items[index].id, at: index, offset: 0)] }
        let prev = (index - 1 + n) % n
        let next = (index + 1) % n
        // With two media both neighbours ARE the same one: the previous slot
        // takes a suffix, so the middle and the next keep the bare id.
        let prevKey = n == 2 ? "\(items[prev].id):prev" : items[prev].id
        return [
            DeckSlot(id: prevKey, at: prev, offset: -1),
            DeckSlot(id: items[index].id, at: index, offset: 0),
            DeckSlot(id: items[next].id, at: next, offset: 1),
        ]
    }

    /// Another file of the capture drawn in the middle slot instead of the item's own.
    private var swapped: (source: LightboxSource?, unavailable: String?, pending: Bool, natural: CGSize?)? {
        guard let file = shownFile, let first = files.first, file.id != first.id else { return nil }
        let source = loaded[file.id] ?? file.source
        return (source, file.unavailable ?? failed[file.id], loading == file.id, file.natural)
    }

    private var deck: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack {
                ForEach(slots) { slot in
                    slotView(slot.at, offset: slot.offset)
                        .frame(width: width, height: geo.size.height)
                        .offset(x: CGFloat(slot.offset) * (width + gap) + deckOffset)
                }
            }
            .frame(width: width, height: geo.size.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(dragGesture(width))
            .simultaneousGesture(pinchGesture)
            .simultaneousGesture(SpatialTapGesture(count: 2).onEnded { value in
                withAnimation(.easeOut(duration: 0.25)) { zoom.toggle(about: value.location) }
            })
            .onAppear { layoutZoom(geo.size) }
            .onChange(of: geo.size) { _, size in layoutZoom(size) }
            .onChange(of: index) { _, _ in layoutZoom(geo.size) }
            .onChange(of: measured) { _, _ in layoutZoom(geo.size) }
            .overlay(alignment: .top) {
                // Once the fetch is a task its edge says it: one surface, not two.
                if !ready && TaskCenter.shared.scoped(taskScope).isEmpty {
                    LibrarySweepBar().frame(height: 2)
                        .accessibilityLabel("Loading the full picture")
                }
            }
            // The capture's own tasks — a chip's fetch — on the deck's bottom edge.
            .overlay { TaskEdge(scope: taskScope) }
            .overlay { arrows }
            #if os(macOS)
            .overlay { WheelCatcher(target: zoom, enabled: item?.kind == .photo) }
            #endif
        }
        .background(palette.frame, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func slotView(_ at: Int, offset: Int) -> some View {
        let item = items[at]
        let active = offset == 0
        let swap = active ? swapped : nil
        LightboxSlot(
            item: item,
            source: swap.map { $0.source } ?? item.source,
            unavailable: swap.map { $0.unavailable } ?? item.unavailable,
            pending: swap?.pending ?? false,
            overridden: swap != nil,
            active: active,
            zoom: zoom,
            client: client,
            onMeasured: { size in
                if measured[item.id] != size { measured[item.id] = size }
            },
            onReady: { isReady in if active { ready = isReady } }
        )
    }

    private func layoutZoom(_ size: CGSize) {
        deckWidth = size.width
        let natural = swapped?.natural ?? item?.natural ?? item.flatMap { measured[$0.id] }
        zoom.layout(viewport: size, natural: natural)
    }

    @ViewBuilder
    private var arrows: some View {
        if items.count > 1 && !compact {
            HStack {
                arrow("Previous", "chevron.left", -1)
                Spacer()
                arrow("Next", "chevron.right", 1)
            }
            .padding(.horizontal, 8)
        }
    }

    private func arrow(_ label: String, _ symbol: String, _ direction: Int) -> some View {
        Button { pageBy(direction) } label: {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(palette.inkSoft)
                .frame(width: 36, height: 36)
                .background(palette.surface.opacity(0.86), in: Circle())
                .overlay(Circle().stroke(palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help("\(label) (\(direction < 0 ? "←" : "→"))")
        .accessibilityLabel(label)
    }

    // MARK: gestures

    private func dragGesture(_ width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                guard pinchStart == nil, !paging else { return }
                if zoom.zoomed {
                    let last = panLast ?? .zero
                    zoom.pan(dx: Double(value.translation.width - last.width), dy: Double(value.translation.height - last.height))
                    panLast = value.translation
                } else if items.count > 1 {
                    deckOffset = value.translation.width
                } else {
                    deckOffset = CGFloat(rubberBand(Double(value.translation.width), Double(width)))
                }
            }
            .onEnded { value in
                panLast = nil
                guard !zoom.zoomed, !paging else { return }
                let velocity = Double(value.velocity.width) / 1000
                let direction = items.count > 1 ? swipeCommit(Double(value.translation.width), Double(width), velocity) : 0
                if direction != 0 {
                    pageBy(direction)
                } else {
                    withAnimation(.easeOut(duration: 0.22)) { deckOffset = 0 }
                }
            }
    }

    private var pinchGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = pinchStart ?? zoom.view.scale
                if pinchStart == nil { pinchStart = start }
                zoom.pinch(from: start, ratio: Double(value.magnification), anchor: value.startLocation)
            }
            .onEnded { _ in pinchStart = nil }
    }

    /// One page, the deck sliding the whole way before the index moves.
    private func pageBy(_ direction: Int) {
        let n = items.count
        guard n > 1, !paging else { return }
        paging = true
        let width = max(deckWidth, 1)
        withAnimation(.easeOut(duration: 0.28)) {
            deckOffset = CGFloat(-direction) * (width + gap)
        } completion: {
            var still = Transaction()
            still.disablesAnimations = true
            withTransaction(still) {
                index = (index + direction + n) % n
                deckOffset = 0
            }
            paging = false
        }
    }

    // MARK: keys

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        if press.modifiers.contains(.command) || press.modifiers.contains(.option) || press.modifiers.contains(.control) {
            return .ignored
        }
        let step = press.modifiers.contains(.shift) ? 200.0 : 40.0
        switch press.key {
        case .leftArrow:
            if zoom.zoomed { zoom.pan(dx: step, dy: 0) } else { pageBy(-1) }
        case .rightArrow:
            if zoom.zoomed { zoom.pan(dx: -step, dy: 0) } else { pageBy(1) }
        case .upArrow:
            guard zoom.zoomed else { return .ignored }
            zoom.pan(dx: 0, dy: step)
        case .downArrow:
            guard zoom.zoomed else { return .ignored }
            zoom.pan(dx: 0, dy: -step)
        case .escape:
            onClose()
        case .return:
            guard let onConfirm else { return .ignored }
            onConfirm()
        default:
            guard press.characters.lowercased() == "z" else { return .ignored }
            withAnimation(.easeOut(duration: 0.25)) { zoom.toggle() }
        }
        return .handled
    }
}

// MARK: - one slot

private struct LightboxSlot: View {
    let item: LightboxItem
    let source: LightboxSource?
    let unavailable: String?
    let pending: Bool
    /// Another file of the capture is drawn here: the still only holds the place.
    let overridden: Bool
    let active: Bool
    let zoom: LightboxZoom
    let client: WinnowClient?
    let onMeasured: (CGSize) -> Void
    let onReady: (Bool) -> Void

    @Environment(\.palette) private var palette
    @State private var still: CGImage?
    @State private var full: CGImage?
    @State private var fullKey: LightboxSource?

    var body: some View {
        ZStack {
            if let unavailable {
                Text(unavailable)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(24)
            } else if item.kind == .video, let source {
                if let still, !active { picture(still) }
                if active { LightboxVideo(source: source, client: client) }
            } else {
                if let still { picture(still).opacity(overridden && full != nil ? 0 : 1) }
                if let full, fullKey == source { picture(full).transition(.opacity) }
                if still == nil && source == nil && !pending {
                    Text("nothing to show")
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.muted)
                }
            }
        }
        .task(id: item.still) {
            still = await LightboxPictures.image(item.still, client: client)
        }
        .task(id: source) { await loadFull() }
        .onChange(of: active, initial: true) { _, isActive in
            if isActive { onReady(isReadyNow) }
        }
    }

    private var isReadyNow: Bool {
        if unavailable != nil { return true }
        if item.kind == .video { return true }
        if source == nil { return !pending }
        return full != nil && fullKey == source
    }

    private func loadFull() async {
        guard item.kind == .photo, let source else {
            if active { onReady(isReadyNow) }
            return
        }
        if active { onReady(false) }
        // The item's own picture from an instance is a task on its row; a
        // capture's other file brought in by its chip was one already.
        let tracking = overridden ? nil : item.taskScope.map {
            LightboxPictures.Tracking(label: "Fetching \(item.title)", scope: $0)
        }
        let image = await LightboxPictures.image(source, client: client, tracking: tracking)
        if Task.isCancelled { return }
        withAnimation(.easeIn(duration: 0.2)) {
            full = image
            fullKey = source
        }
        if active {
            if let image { onMeasured(CGSize(width: image.width, height: image.height)) }
            onReady(true)
        }
    }

    private func picture(_ image: CGImage) -> some View {
        Image(decorative: image, scale: 1, orientation: .up)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .scaleEffect(active ? zoom.view.scale : 1)
            .offset(x: active ? zoom.view.x : 0, y: active ? zoom.view.y : 0)
            .animation(active && zoom.settling ? .easeOut(duration: 0.25) : nil, value: zoom.view)
    }
}

/// A clip in the middle slot — its player mounted only there, let go when it leaves.
private struct LightboxVideo: View {
    let source: LightboxSource
    let client: WinnowClient?
    @State private var player: AVPlayer?
    @State private var opened: OpenedFile?

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView()
            }
        }
        .task(id: source) { start() }
        .onDisappear { stop() }
    }

    private func start() {
        stop()
        switch source {
        case .local(let location, _):
            guard let file = try? LibraryFiles.open(location) else { return }
            opened = file
            player = AVPlayer(url: file.url)
        case .file(let url, _):
            player = AVPlayer(url: url)
        case .remote(let text):
            guard let url = URL(string: text) else { return }
            var headers: [String: String] = [:]
            if case .token(let token)? = client?.config.auth { headers["Authorization"] = "Bearer \(token)" }
            // The header key AVFoundation reads for a request's own headers —
            // how a Bearer instance's proxy streams without being downloaded.
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
            player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        case .pixels:
            break
        }
    }

    private func stop() {
        player?.pause()
        player = nil
        opened?.close()
        opened = nil
    }
}

/// The hairline that says the full picture is still coming.
struct LibrarySweepBar: View {
    @Environment(\.palette) private var palette
    @State private var moving = false

    var body: some View {
        GeometryReader { geo in
            palette.accent
                .frame(width: geo.size.width / 4, height: 2)
                .offset(x: moving ? geo.size.width : -geo.size.width / 4)
                .onAppear {
                    withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { moving = true }
                }
        }
        .clipped()
        .allowsHitTesting(false)
    }
}

#Preview("Lightbox, three pictures") {
    LibraryFixtures.LightboxPreview()
}
