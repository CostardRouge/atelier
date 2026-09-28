// The Library panel — the native twin of the web's `AssetSidebar.tsx`, drawn
// as a COLUMN beside the tool (`docked`, an iPad or a Mac) or as the body of
// the phone's SHEET (`sheet`, a picker: tiles rather than rows).
//
// With a Winnow connected it has TWO tabs that never mix (the maintainer's
// *"pas de mélange"*): **Local**, the pool of files opened from this device,
// and **the instance**, a VIEW of what it holds for the span the active tool
// is on (`LibraryInstanceModel`). What a tile fetches lands in the pool as an
// ordinary asset, filed under that tab and never under Local; one the span
// does not list is shown below the tiles ("Also in the library"), so nothing
// the pool holds is ever invisible. The tab and the half are remembered
// (`atelier.library.tab`, `atelier.library.winnow.half`); no instance, no
// second tab, whatever was remembered.
//
// A click on an instance's tile means what the TOOL says (`MediaScope.intent`):
// `pick` fetches it and makes it active, anything else shows it large first.
// The filter narrows by file name — and, on the instance's tab, by Winnow's
// own culling, read and never written (`WinnowCullMark.swift`) — and the SAME
// filtered list is what the grid draws and the lightbox pages through, so an
// index means one thing.

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

enum LibraryVariant {
    /// The column beside the tool, with its own frame and its collapse.
    case docked
    /// The body of the phone's sheet, which draws the frame and the title.
    case sheet
}

/// What the importers are asked for — ONE file importer, two kinds.
enum LibraryImport: Equatable {
    case files, folder
}

extension View {
    /// The Library's ways in — files or a folder from Files or the Finder,
    /// pictures and clips from Photos — each landing in the pool.
    func libraryImporters(_ kind: Binding<LibraryImport?>, photos: Binding<Bool>,
                          items: Binding<[PhotosPickerItem]>, library: LibraryStore) -> some View {
        fileImporter(isPresented: Binding(get: { kind.wrappedValue != nil }, set: { if !$0 { kind.wrappedValue = nil } }),
                     allowedContentTypes: kind.wrappedValue == .folder ? [.folder] : InstrumentFileTypes.media,
                     allowsMultipleSelection: kind.wrappedValue != .folder) { result in
            kind.wrappedValue = nil
            if case .success(let urls) = result { library.add(urls: urls) }
        }
        .photosPicker(isPresented: photos, selection: items, maxSelectionCount: 200,
                      matching: .any(of: [.images, .videos]), preferredItemEncoding: .current)
        .onChange(of: items.wrappedValue) { _, picked in
            guard !picked.isEmpty else { return }
            Task { @MainActor in
                await library.add(photos: picked)
                items.wrappedValue = []
            }
        }
    }
}

struct LibraryView: View {
    let variant: LibraryVariant
    /// What the tool on screen accepts, and its name for "Use in …".
    let accepts: [AssetKind]
    let toolLabel: String
    /// Collapse the docked column to its rail.
    var onCollapse: (() -> Void)? = nil

    @Environment(LibraryStore.self) private var library
    @Environment(ConnectionStore.self) private var connections
    @State private var model: LibraryInstanceModel?

    var body: some View {
        Group {
            if let model {
                LibraryPanel(model: model, variant: variant, accepts: accepts, toolLabel: toolLabel, onCollapse: onCollapse)
            } else {
                Color.clear
            }
        }
        .onAppear {
            if model == nil { model = LibraryInstanceModel(library: library, connections: connections) }
        }
    }
}

/// A day rolled onto from the lightbox: reopen it on its first or last picture
/// once its rows are not the ones left behind.
private struct LibraryRoll: Equatable {
    let first: Bool
    let left: [Int]?
}

private struct LibraryPanel: View {
    let model: LibraryInstanceModel
    let variant: LibraryVariant
    let accepts: [AssetKind]
    let toolLabel: String
    let onCollapse: (() -> Void)?

    @Environment(LibraryStore.self) private var library
    @Environment(ConnectionStore.self) private var connections
    @Environment(MediaPublications.self) private var bus: MediaPublications?
    @Environment(\.palette) private var palette
    @Environment(\.shellNavigate) private var navigate
    @Environment(\.dismiss) private var dismiss
    @AppStorage("atelier.library.tab") private var tabKey = "local"
    /// Winnow's culling filter over the instance's rows (`cullFilterKey`).
    @AppStorage("atelier.library.winnow.cull") private var cullKey = "all"
    @State private var query = ""
    @State private var preview: Int?
    @State private var viewing: Int?
    @State private var rolling: LibraryRoll?
    @State private var importing: LibraryImport?
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var dropping = false

    private var asSheet: Bool { variant == .sheet }
    private var host: String? { model.connection?.id }
    private var remoteTab: Bool { tabKey == "remote" && host != nil }
    private var q: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

    private var cullFilter: CullFilter { readCullFilter(.string(cullKey)) }

    /// The instance's rows past both filters — what the grid draws and the lightbox pages.
    private var remoteShown: [WinnowAssetRow] {
        let filter = cullFilter
        return (model.rows ?? []).filter { row in
            let named = q.isEmpty || row.filename.lowercased().contains(q)
            return named && passesCull(cullingFromRow(row), filter)
        }
    }

    /// What Winnow said of the span's rows, all of them — before any filter.
    private var cullCounts: CullCounts {
        countCulling((model.rows ?? []).map { cullingFromRow($0) })
    }

    private var remoteAssets: [Asset] {
        guard let host else { return [] }
        return library.bySource.assets(of: host)
    }

    /// Pool assets from the instance that the span does not list.
    private var outOfScope: [Asset] {
        guard let host else { return [] }
        guard let rows = model.rows else { return remoteAssets }
        let listed = Set(rows.map { "\(host)/\($0.id)" })
        return remoteAssets.filter { asset in
            guard let rid = assetRemoteId(asset) else { return true }
            return !listed.contains(rid)
        }
    }

    private var tabPool: [Asset] { remoteTab ? remoteAssets : library.bySource.local }

    private var shown: [Asset] {
        (remoteTab ? outOfScope : library.bySource.local).filter { q.isEmpty || $0.baseName.lowercased().contains(q) }
    }

    private var viewable: [Asset] {
        shown.filter { $0.parts.image != nil || $0.parts.video != nil }
    }

    /// What resets an open preview: another span, tab, filter or half.
    private var listKey: String {
        let s = model.span
        return "\(s.from)|\(s.to)|\(remoteTab)|\(q)|\(model.half?.rawValue ?? "all")|\(cullKey)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if host != nil { tabs }
            if !remoteTab { addRow }
            if remoteTab { instanceControls }
            if tabPool.count > 0 || remoteTab { filterRow }
            ScrollView {
                content
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
            }
            .lightboxCover(isPresented: Binding(get: { viewing != nil }, set: { if !$0 { viewing = nil } })) {
                poolLightbox
                    .environment(library)
                    .environment(connections)
                    .environment(bus)
            }
            if !asSheet { footerLine }
        }
        .background(asSheet ? Color.clear : palette.surface)
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: Brand.paperRadius)
                    .strokeBorder(palette.accent, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(palette.accentWash.opacity(0.4))
                    .allowsHitTesting(false)
            }
        }
        .dropDestination(for: URL.self) { urls, _ in
            library.add(urls: urls)
            return true
        } isTargeted: { dropping = $0 }
        .libraryImporters($importing, photos: $showPhotos, items: $photoItems, library: library)
        .task(id: model.rowsKey(enabled: remoteTab)) { await model.loadRows(enabled: remoteTab) }
        .task(id: model.neighboursKey(enabled: remoteTab && preview != nil)) {
            await model.loadNeighbours(enabled: remoteTab && preview != nil)
        }
        .onChange(of: bus?.scope, initial: true) { _, scope in model.published = scope }
        .onChange(of: listKey) { _, _ in
            if rolling == nil { preview = nil }
            viewing = nil
        }
        .onChange(of: model.rows) { _, rows in
            guard let roll = rolling, let rows, rows.map(\.id) != roll.left else { return }
            rolling = nil
            preview = roll.first ? 0 : max(0, remoteShown.count - 1)
        }
        .lightboxCover(isPresented: Binding(get: { preview != nil }, set: { if !$0 { preview = nil } })) {
            instanceLightbox
                .environment(library)
                .environment(connections)
                .environment(bus)
        }
    }

    // MARK: header and tabs

    private var header: some View {
        HStack(spacing: 8) {
            if !asSheet {
                Text("Library")
                    .font(Brand.display(20))
                    .foregroundStyle(palette.ink)
            }
            Spacer(minLength: 0)
            if host == nil {
                Button { goToSources() } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "gearshape")
                        if asSheet { Text("SOURCES").font(Brand.mono(10)).kerning(1) }
                    }
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, asSheet ? 10 : 6)
                    .padding(.vertical, 4)
                    .overlay(Capsule().stroke(palette.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .help("Sources — connect a Winnow instance")
            }
            if let onCollapse, !asSheet {
                Button(action: onCollapse) {
                    Text("COLLAPSE ⟨")
                        .font(Brand.mono(9))
                        .kerning(1)
                        .foregroundStyle(palette.muted)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .overlay(Capsule().stroke(palette.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Collapse asset library")
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, asSheet ? 6 : 12)
        .padding(.bottom, 8)
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            tabButton("local", "Local", library.bySource.local.count, "Files opened from this device")
            if let host {
                // The instance goes by its first label; the full host is in its help.
                tabButton("remote", shortHost(host), remoteAssets.count, host)
            }
            Button { goToSources() } label: {
                Image(systemName: "gearshape")
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
            }
            .buttonStyle(.plain)
            .help("Sources — \(host ?? "") and anything else you connect")
            .accessibilityLabel("Sources — connect and manage Winnow instances")
        }
        .padding(4)
        .background(palette.paper.opacity(0.6), in: Capsule())
        .overlay(Capsule().stroke(palette.line, lineWidth: 1))
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    private func tabButton(_ key: String, _ label: String, _ count: Int, _ hint: String) -> some View {
        let on = (key == "remote") == remoteTab
        return Button { tabKey = key } label: {
            HStack(spacing: 4) {
                Text(label.uppercased()).lineLimit(1)
                if count > 0 { Text("\(count)").opacity(0.7) }
            }
            .font(Brand.mono(10))
            .kerning(1)
            .foregroundStyle(on ? palette.paper : palette.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(on ? palette.ink : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: adding

    @ViewBuilder
    private var addRow: some View {
        if asSheet {
            // Dropping is a desktop gesture: on a phone the ways in are one line.
            HStack(spacing: 10) {
                Text("ADD").font(Brand.eyebrow).kerning(1.4).foregroundStyle(palette.muted)
                linkButton("files") { importing = .files }
                linkButton("a folder") { importing = .folder }
                linkButton("photos") { showPhotos = true }
                Spacer(minLength: 0)
                if host == nil { linkButton("connect a Winnow") { goToSources() } }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        } else {
            VStack(spacing: 6) {
                Text("Drop files or a folder")
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.inkSoft)
                HStack(spacing: 8) {
                    Button(library.busy ? "opening…" : "Add files") { importing = .files }
                        .buttonStyle(.plain)
                        .font(Brand.sans(13, weight: .semibold))
                        .foregroundStyle(palette.accentInk)
                        .underline()
                        .disabled(library.busy)
                    Text("or").font(Brand.sans(11)).foregroundStyle(palette.faint)
                    Button("a folder") { importing = .folder }
                        .buttonStyle(.plain)
                        .font(Brand.sans(13, weight: .semibold))
                        .foregroundStyle(palette.accentInk)
                        .underline()
                    Text("·").foregroundStyle(palette.faint)
                    Button("Photos") { showPhotos = true }
                        .buttonStyle(.plain)
                        .font(Brand.sans(13, weight: .semibold))
                        .foregroundStyle(palette.accentInk)
                        .underline()
                }
                if host == nil {
                    Button("or connect a Winnow") { goToSources() }
                        .buttonStyle(.plain)
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.faint)
                        .underline()
                        .help("Connect a Winnow instance as a source")
                }
                if let notice = library.notice {
                    Text(notice).font(Brand.sans(11)).foregroundStyle(palette.danger)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(palette.paper.opacity(0.4), in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.paperRadius)
                    .strokeBorder(dropping ? palette.accent : palette.lineStrong, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
            )
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
    }

    private func linkButton(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .font(Brand.sans(13))
            .foregroundStyle(palette.muted)
            .underline()
    }

    // MARK: the instance's span

    private var instanceControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text((model.published.map { "\($0.label) · \($0.publisher)" } ?? "A day").uppercased())
                    .font(Brand.eyebrow)
                    .kerning(1.4)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .help(model.published.map {
                        "\($0.label) — what \($0.publisher) has open. The arrows look at another day without moving it."
                    } ?? "A day, picked here")
                Spacer(minLength: 0)
            }
            let viewed = model.viewed
            LibraryDayStepper(
                span: model.span,
                onDay: { model.goToDay($0) },
                published: viewed.anchor == nil ? nil : model.published,
                overridden: viewed.overridden,
                onReset: { model.resetOverride() },
                asking: model.rows == nil && model.problem == nil,
                count: model.rows?.count,
                client: model.client,
                host: host ?? "",
                half: model.half
            )
            halfPicker
            // Only where a row answered: an older instance says nothing of
            // culling, and a filter over nothing would be a control that lies.
            let counts = cullCounts
            if counts.known > 0 || cullFilter != .all {
                LibraryCullLine(counts: counts, filter: cullFilter,
                                onFilter: { cullKey = cullFilterKey($0) },
                                shown: cullFilter == .all ? nil : remoteShown.count)
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 10)
    }

    /// `All · Incoming · Gallery`, in Winnow's own words.
    private var halfPicker: some View {
        HStack(spacing: 0) {
            ForEach(Array(libraryHalves.enumerated()), id: \.offset) { at, option in
                let on = option.half == model.half
                if at > 0 { Rectangle().fill(palette.line).frame(width: 1) }
                Button { model.setHalf(option.half) } label: {
                    Text(option.label.uppercased())
                        .font(Brand.mono(9))
                        .kerning(1)
                        .foregroundStyle(on ? palette.ink : palette.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(on ? palette.paper2 : Color.clear)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(option.hint)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .frame(height: 28)
        .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .clipShape(RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Which half of the library to list")
    }

    // MARK: the filter

    private var filterRow: some View {
        HStack(spacing: 8) {
            TextField(remoteTab ? "Filter by file name…" : "Filter \(tabPool.count) asset\(tabPool.count == 1 ? "" : "s")…",
                      text: $query)
                .textFieldStyle(.plain)
                .font(Brand.sans(13))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(palette.surface, in: Capsule())
                .overlay(Capsule().stroke(palette.line, lineWidth: 1))
            if !tabPool.isEmpty {
                let all = tabPool.allSatisfy { library.selection.contains($0.id) }
                Button(all ? "NONE" : "ALL") { library.select(tabPool.map(\.id), on: !all) }
                    .buttonStyle(.plain)
                    .font(Brand.mono(9))
                    .kerning(1)
                    .foregroundStyle(palette.muted)
                    .help(remoteTab
                          ? "\(all ? "Deselect" : "Select") every asset from \(host ?? "")"
                          : "\(all ? "Deselect" : "Select") every local asset")
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    // MARK: what the tab lists

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            if remoteTab { instanceGrid }
            if remoteTab && !shown.isEmpty {
                Text("ALSO IN THE LIBRARY · \(shown.count)")
                    .font(Brand.eyebrow)
                    .kerning(1.4)
                    .foregroundStyle(palette.muted)
                    .padding(.top, 6)
            }
            if !remoteTab && tabPool.isEmpty {
                Text("Nothing here yet. Add some assets above — they stay on this device.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            } else if asSheet {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), spacing: 6) {
                    ForEach(shown, id: \.id) { asset in
                        LibraryAssetTile(asset: asset, active: library.activeId == asset.id, usable: usable(asset),
                                         onActivate: { activate(asset.id) }, onPreview: previewAction(asset))
                    }
                }
            } else {
                LazyVStack(spacing: 4) {
                    ForEach(shown, id: \.id) { asset in
                        LibraryAssetRow(asset: asset, selected: library.selection.contains(asset.id),
                                        active: library.activeId == asset.id, usable: usable(asset),
                                        onToggle: { library.toggle(asset.id) }, onActivate: { activate(asset.id) },
                                        onPreview: previewAction(asset), onRemove: { library.remove(asset.id) })
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var instanceGrid: some View {
        if let client = model.client, let host {
            let problem = model.pickProblem ?? model.problem
            let inLibrary = model.inLibrary
            let looks = bus?.scope?.intent != .pick
            VStack(alignment: .leading, spacing: 8) {
                if model.rows == nil && model.problem == nil {
                    // Skeleton tiles, not an empty grid: a blank pane reads as "nothing here".
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 6)], spacing: 6) {
                        ForEach(0..<8, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 6).fill(palette.paper2).frame(height: 74)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(palette.line, lineWidth: 1))
                        }
                    }
                    .accessibilityLabel("asking \(host)…")
                } else if remoteShown.isEmpty, let rows = model.rows, !rows.isEmpty {
                    Text("Nothing here matches the filter.")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                } else if !remoteShown.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 6)], spacing: 6) {
                        ForEach(Array(remoteShown.enumerated()), id: \.element.id) { at, row in
                            let have = inLibrary["\(host)/\(row.id)"]
                            LibraryInstanceTile(
                                row: row, client: client, host: host, have: have != nil,
                                active: have != nil && have == library.activeId,
                                fetching: model.fetching == row.id, disabled: model.fetching != nil, looks: looks,
                                dragItem: instanceDragItem(row, host: host, have: have != nil),
                                onTap: {
                                    if looks {
                                        preview = at
                                    } else {
                                        Task { _ = await model.pick(row) }
                                    }
                                }
                            )
                        }
                    }
                }
                if let problem {
                    LibraryProblemLine(problem: problem, onRetry: { model.reload() })
                }
            }
        }
    }

    // MARK: the footer line

    private var footerLine: some View {
        let usableSelected = selectedUsableAssets(accepts, library.assets, library.selection).count
        return VStack(alignment: .leading, spacing: 2) {
            Rectangle().fill(palette.line).frame(height: 1)
            HStack(spacing: 4) {
                Text("\(library.selection.count) selected").font(Brand.sans(11, weight: .semibold)).foregroundStyle(palette.ink)
                Text("· \(usableSelected) usable by \(toolLabel)").font(Brand.sans(11)).foregroundStyle(palette.inkSoft)
                Spacer(minLength: 0)
                Image(systemName: "info.circle")
                    .font(.system(size: 11))
                    .foregroundStyle(palette.faint)
                    .help(remoteTab
                          ? "Proxies, fetched one at a time — nothing at launch."
                          : "Handles only — nothing uploaded, nothing decoded yet.")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .background(palette.paper.opacity(0.4))
    }

    // MARK: verbs

    private func usable(_ asset: Asset) -> Bool {
        assetUsableBy(accepts, asset)
    }

    /// A click on a row puts it to work: selected, and the tool's active one.
    private func activate(_ id: String) {
        library.activate(id)
    }

    private func previewAction(_ asset: Asset) -> (() -> Void)? {
        guard asset.parts.image != nil || asset.parts.video != nil else { return nil }
        return {
            if let at = viewable.firstIndex(where: { $0.id == asset.id }) { viewing = at }
        }
    }

    private func instanceDragItem(_ row: WinnowAssetRow, host: String, have: Bool) -> AssetDragItem {
        let store = self.library
        let instance = self.model
        return AssetDragItem(
            key: instanceDragKey(host, row.id),
            label: fileBaseName(row.filename),
            origin: have ? .library : .instance,
            sourceLabel: shortHost(host),
            resolve: {
                guard let id = await instance.pick(row), let asset = store.asset(id) else { return nil }
                return store.dropped(asset)
            }
        )
    }

    private func goToSources() {
        if asSheet { dismiss() }
        navigate(.sources)
    }

    // MARK: the two lightboxes

    @ViewBuilder
    private var instanceLightbox: some View {
        LibraryLightboxHost(isPresent: preview != nil) {
            InstanceLightbox(
                model: model,
                rows: remoteShown,
                index: Binding(get: { preview ?? 0 }, set: { preview = $0 }),
                filtered: !q.isEmpty || cullFilter != .all,
                onRoll: { side, day in
                    rolling = LibraryRoll(first: side == .after, left: model.rows?.map(\.id))
                    model.goToDay(day)
                },
                onClose: { preview = nil }
            )
        }
    }

    @ViewBuilder
    private var poolLightbox: some View {
        LibraryLightboxHost(isPresent: viewing != nil) {
            PoolLightbox(
                assets: viewable,
                index: Binding(get: { viewing ?? 0 }, set: { viewing = $0 }),
                toolLabel: toolLabel,
                onActivate: { activate($0) },
                onClose: { viewing = nil }
            )
        }
    }
}

/// A lightbox's content, drawn only while it is up.
private struct LibraryLightboxHost<Content: View>: View {
    let isPresent: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        if isPresent { content() }
    }
}

extension View {
    /// A lightbox over everything: full screen on a phone or an iPad, a large
    /// sheet on the Mac.
    func lightboxCover<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(iOS)
        return fullScreenCover(isPresented: isPresented, content: content)
        #else
        return sheet(isPresented: isPresented, content: content)
        #endif
    }
}

#Preview("Library, docked, local") {
    LibraryView(variant: .docked, accepts: [.photo], toolLabel: "Develop")
        .frame(width: 300, height: 640)
        .environment(LibraryFixtures.library)
        .environment(ConnectionStore.preview())
        .environment(MediaPublications())
}

#Preview("Library, sheet, an instance") {
    LibraryView(variant: .sheet, accepts: [.photo], toolLabel: "Develop")
        .frame(width: 390, height: 720)
        .environment(LibraryFixtures.library)
        .environment(LibraryFixtures.connections)
        .environment(MediaPublications())
}
