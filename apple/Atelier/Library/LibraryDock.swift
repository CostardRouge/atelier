// Where the Library LIVES in the shell (`frontend.md`): docked at the LEFT of
// the tool everywhere but a phone — collapsed to its rail by default below
// 1180 pt, the maintainer's call, which is what leaves a tablet's tool its
// width — and, on a phone, a SHEET at its tallest rest opened from the bottom
// bar's first cell (the dock that gave it half the height was tried on the
// web and reversed: neither half was enough).
//
// - The collapse is remembered PER SIZE (`atelier.library.collapsed`,
//   `atelier.library.collapsed.medium` — absent meaning collapsed there, the
//   rail being that size's default). An EMPTY Library with no instance starts
//   as the rail whatever the preference: a column of "0 selected" is a fifth
//   of the screen for a fact the rail's `0` already says; opening it once is
//   the wish, remembered, and the first file lets the preference rule again.
// - The rail carries its own Add menu (files, a folder, Photos, and the way
//   to a Winnow while none is connected), so the way in never waits for the
//   panel.
// - Any screen can ask for the Library (`\.openLibrary`): the phone's sheet,
//   a wide screen's column expanded. An editor that hides the tab bar puts
//   `LibraryButton` in its own bar.
// - The instruments read the SAME pool: an asset put to work while an
//   instrument is on screen is handed to their shelf (`LibraryShelfBridge`),
//   as the web's instrument pages read the one Library.

import PhotosUI
import SwiftUI
import AtelierKit

// MARK: - what each place accepts

extension Tool {
    /// The asset kinds the tool reads from the Library — the web registry's
    /// `accepts`. Sources is not a tool that takes media: no Library there.
    var accepts: [AssetKind] {
        switch self {
        case .develop: return [.photo]
        case .trips: return [.photo, .videoTelemetry, .video]
        case .studio: return [.videoTelemetry, .video, .photo]
        case .sources: return []
        }
    }
}

extension ShellPlace {
    /// What the place reads from the Library.
    var libraryAccepts: [AssetKind] {
        switch self {
        case .tool(let tool): return tool.accepts
        case .instrument(let instrument): return instrument.accepts
        }
    }

    /// Its name, for "Use in …" and "usable by …".
    var libraryLabel: String {
        switch self {
        case .tool(let tool): return tool.title
        case .instrument(let instrument): return instrument.title
        }
    }
}

extension View {
    /// This place with the Library docked at its left — nothing for a place
    /// that reads no media.
    func libraryDocked(accepts: [AssetKind], toolLabel: String, windowWidth: CGFloat) -> some View {
        LibraryDock(accepts: accepts, toolLabel: toolLabel, windowWidth: windowWidth) { self }
    }
}

// MARK: - asking for the Library

/// Open the Library from any screen — the phone's sheet, the wide screen's column.
struct OpenLibrary {
    let open: () -> Void

    func callAsFunction() { open() }
}

private struct OpenLibraryKey: EnvironmentKey {
    static let defaultValue = OpenLibrary {}
}

extension EnvironmentValues {
    var openLibrary: OpenLibrary {
        get { self[OpenLibraryKey.self] }
        set { self[OpenLibraryKey.self] = newValue }
    }
}

/// The Library's verb in a screen's own bar — where the tab bar is hidden.
struct LibraryButton: View {
    @Environment(\.openLibrary) private var openLibrary
    @Environment(LibraryStore.self) private var library: LibraryStore?

    var body: some View {
        Button { openLibrary() } label: {
            Label("Library", systemImage: "photo.stack")
        }
        .help("The Library — \(library?.assets.count ?? 0) asset\(library?.assets.count == 1 ? "" : "s")")
    }
}

// MARK: - the wide screen's column

struct LibraryDock<Content: View>: View {
    let accepts: [AssetKind]
    let toolLabel: String
    /// The window's width, which decides the size's rules.
    let windowWidth: CGFloat
    let content: Content

    init(accepts: [AssetKind], toolLabel: String, windowWidth: CGFloat, @ViewBuilder content: () -> Content) {
        self.accepts = accepts
        self.toolLabel = toolLabel
        self.windowWidth = windowWidth
        self.content = content()
    }

    @Environment(LibraryStore.self) private var library
    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    @AppStorage("atelier.library.collapsed") private var collapsedWide = false
    @AppStorage("atelier.library.collapsed.medium") private var collapsedMedium = true
    @State private var peeked = false

    private var railByDefault: Bool { modeForWidth(Double(windowWidth)) != .expanded }
    private var empty: Bool { library.assets.isEmpty && connections.first == nil }
    private var collapsed: Bool {
        (empty && !peeked) || (railByDefault ? collapsedMedium : collapsedWide)
    }

    var body: some View {
        HStack(spacing: 0) {
            if !accepts.isEmpty {
                if collapsed {
                    LibraryRail(onExpand: toggle)
                } else {
                    LibraryView(variant: .docked, accepts: accepts, toolLabel: toolLabel, onCollapse: toggle)
                        .frame(width: 288)
                        .transition(.move(edge: .leading))
                }
                Rectangle().fill(palette.line).frame(width: 1)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .environment(\.openLibrary, OpenLibrary { expand() })
        .onChange(of: empty) { _, isEmpty in if !isEmpty { peeked = false } }
    }

    private func toggle() {
        withAnimation(.easeOut(duration: 0.2)) {
            if collapsed { expand() } else { setCollapsed(true) }
        }
    }

    private func expand() {
        if empty && !peeked { peeked = true }
        setCollapsed(false)
    }

    private func setCollapsed(_ value: Bool) {
        if railByDefault { collapsedMedium = value } else { collapsedWide = value }
    }
}

/// The collapsed Library: 64 pt, its first control on the bar's line.
struct LibraryRail: View {
    let onExpand: () -> Void

    @Environment(LibraryStore.self) private var library
    @Environment(ConnectionStore.self) private var connections
    @Environment(\.palette) private var palette
    @Environment(\.shellNavigate) private var navigate
    @State private var importing: LibraryImport?
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []

    var body: some View {
        let empty = library.assets.isEmpty
        VStack(spacing: 10) {
            Button(action: onExpand) {
                Image(systemName: "chevron.right")
                    .frame(width: 34, height: 34)
                    .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.inkSoft)
            .help("Expand asset library")
            .accessibilityLabel("Expand asset library")
            Menu {
                Button("Add files") { importing = .files }
                Button("Add a folder") { importing = .folder }
                Button("From Photos") { showPhotos = true }
                if connections.first == nil {
                    Divider()
                    Button("Connect a Winnow") { navigate(.sources) }
                }
            } label: {
                Image(systemName: "plus")
                    .frame(width: 34, height: 34)
                    .foregroundStyle(empty ? palette.paper : palette.inkSoft)
                    .background(empty ? palette.ink : Color.clear, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                    .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .disabled(library.busy)
            .help(library.busy ? "Opening…" : "Add…")
            Text("\(library.assets.count)")
                .font(Brand.mono(10))
                .foregroundStyle(empty ? palette.muted : palette.paper)
                .frame(width: 34, height: 34)
                .background(empty ? palette.paper2 : palette.ink, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                .help("\(library.assets.count) assets")
            Text("LIBRARY")
                .font(Brand.mono(9))
                .kerning(1.6)
                .foregroundStyle(palette.faint)
                .fixedSize()
                .rotationEffect(.degrees(90))
                .frame(width: 20, height: 70)
            Spacer(minLength: 0)
        }
        .padding(.top, 10)
        .frame(width: 64)
        .frame(maxHeight: .infinity, alignment: .top)
        .libraryImporters($importing, photos: $showPhotos, items: $photoItems, library: library)
        .dropDestination(for: URL.self) { urls, _ in
            library.add(urls: urls)
            return true
        }
    }
}

// MARK: - the phone's sheet

/// The Library as a sheet over the tool, at its tallest rest — the sheet
/// draws the title and the way out, the panel inside draws neither.
struct LibrarySheet: View {
    let accepts: [AssetKind]
    let toolLabel: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Library")
                    .font(Brand.display(22))
                    .foregroundStyle(palette.ink)
                Spacer()
                Button("Done") { dismiss() }
                    .font(Brand.sans(15, weight: .semibold))
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)
            LibraryView(variant: .sheet, accepts: accepts, toolLabel: toolLabel)
        }
        .background(palette.paper)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - the instruments read the same pool

/// An asset put to work while an instrument is on screen goes onto the
/// instruments' shelf (`InstrumentShelf`) — read where it is, as the shelf
/// reads a file pointed at. A file inside a folder is reached under the
/// folder's scope, held open for the session.
@MainActor
enum LibraryShelfBridge {
    private static var folders: [LibraryLocation: OpenedFile] = [:]

    static func hand(_ asset: Asset, from library: LibraryStore) {
        let shelf = InstrumentShelf.shared
        var urls: [URL] = []
        for ref in assetFiles(asset.parts) {
            guard let location = library.location(of: ref) else { continue }
            switch location {
            case .session(let path):
                urls.append(URL(fileURLWithPath: path))
            case .bookmark(let bookmark):
                if let url = try? RollStore.resolveBookmark(bookmark) { urls.append(url) }
            case .folder(let bookmark, let path):
                let key = LibraryLocation.bookmark(bookmark)
                if folders[key] == nil, let folder = try? RollStore.resolveBookmark(bookmark) {
                    let scoped = folder.startAccessingSecurityScopedResource()
                    folders[key] = OpenedFile(url: folder, close: { if scoped { folder.stopAccessingSecurityScopedResource() } })
                }
                if let folder = folders[key]?.url { urls.append(folder.appendingPathComponent(path)) }
            }
        }
        guard !urls.isEmpty else { return }
        shelf.add(urls: urls)
        shelf.activeId = asset.id
    }
}

#Preview("Dock, collapsed") {
    LibraryDock(accepts: [.photo], toolLabel: "Develop", windowWidth: 1000) {
        Color.gray.opacity(0.1)
    }
    .frame(width: 1000, height: 640)
    .environment(LibraryStore.preview())
    .environment(ConnectionStore.preview())
    .environment(MediaPublications())
}
