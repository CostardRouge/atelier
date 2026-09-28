// The Trips tool's front door — the web's `TripGallery.tsx`: the trips,
// GROUPED BY THE SOURCE they are kept on (`local` first, one group even while
// it is the only one, so a trip kept on a Winnow lands in a section of its
// own instead of reshaping the page), each showing how much of it has been
// told. On paper; the darkroom is the piece editor's.
//
// A connected instance's list is asked for beside the mirrors and merged by
// id: a trip mirrored here is one card, a trip only there a greyed card that
// pulls on open. While the instance answers the header says `checking…`;
// when it cannot, it says why (with Sign in) and the mirrors stay — never
// hidden. An instance whose bucket does not keep trips is SAID
// (`AbsentSourceNotes`), never dropped in silence.
//
// Two views, Cards (the default, with the cover) and Bands (progress rows
// under the trip you were on) — a reading preference of this device, never on
// the document; a phone always gets two columns of cards. New trip and
// Import are the navigation bar's on a wide screen, and on a phone they sit
// in the bottom bar, where a thumb reaches them, as the web's shell cells do.
// Import asks WHERE only when there is a choice, and always makes a NEW trip.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct TripGallery: View {
    @Environment(TripsShell.self) private var shell
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var creating = false
    @State private var importing = false
    @State private var importTarget = defaultSourceId
    @State private var choosingImportSource = false
    /// The trip whose cover is being chosen.
    @State private var covering: TripDoc?
    /// The trip file being saved.
    @State private var exporting: TripFileDocument?
    /// The hook pictures the covers draw.
    @State private var covers = TripCoverThumbs()

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    private var store: TripsStore { shell.store }
    private var gallery: DocumentGalleryModel<TripDoc> { shell.gallery }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !compact { heading }
                if let notice = gallery.notice {
                    Text(notice)
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                AbsentSourceNotes(absent: gallery.absent)
                content
            }
            .padding(.horizontal, compact ? 12 : 24)
            .padding(.vertical, compact ? 12 : 20)
        }
        .background(palette.paper)
        .navigationTitle("Trips")
        #if os(iOS)
        .navigationBarTitleDisplayMode(compact ? .inline : .automatic)
        #endif
        .toolbar { toolbar }
        .task { await shell.refresh() }
        .refreshable { await shell.refresh() }
        .task(id: coverKey) {
            await covers.load(coverIds, from: store.thumbs, version: store.thumbsVersion)
        }
        .sheet(isPresented: $creating) {
            // The seed row waits on the timeline sheet (map task -07) and on
            // the kernel's `timelineSyncEnabled`, off today: without a handler
            // it is not drawn.
            TripDetailsSheet(sources: gallery.documentSources, seedSources: shell.seedSources, onSeedFrom: nil,
                             onCancel: { creating = false },
                             onSubmit: { details in
                                 creating = false
                                 Task { await shell.create(details) }
                             })
        }
        .sheet(isPresented: Binding(get: { covering != nil }, set: { if !$0 { covering = nil } })) {
            if let covering {
                TripCoverSheet(trip: shell.current(covering), thumbs: store.thumbs, version: store.thumbsVersion,
                               onCancel: { self.covering = nil },
                               onSave: { cover in
                                   self.covering = nil
                                   Task { await shell.setCover(covering, cover) }
                               })
            }
        }
        // The two file panels each on a view of their own: panels chained on
        // ONE view answer only the last.
        .background {
            Color.clear
                .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                    guard case .success(let url) = result else { return }
                    let target = importTarget
                    Task { await shell.importFile(url, to: target) }
                }
        }
        .background {
            Color.clear
                .fileExporter(isPresented: Binding(get: { exporting != nil }, set: { if !$0 { exporting = nil } }),
                              document: exporting, contentType: .json,
                              defaultFilename: exporting?.fileName ?? tripFileName("trip")) { _ in
                    exporting = nil
                }
        }
        .confirmationDialog("Import a trip file", isPresented: $choosingImportSource, titleVisibility: .visible) {
            ForEach(gallery.documentSources, id: \.id) { source in
                Button(source.id == defaultSourceId ? "This device (local)" : source.label) {
                    importTarget = source.id
                    importing = true
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Creates a new trip from an exported \(tripFileExtension) backup — it never overwrites one you already have.")
        }
    }

    // MARK: - the bar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        // The open trip's pill, when it is kept on an instance: its verbs
        // (Save now, the conflict's two answers) stay reachable from here.
        if store.sync.showsPill {
            ToolbarItem(placement: .navigation) {
                DocumentSyncPill(sync: store.sync)
            }
        }
        #if os(iOS)
        if compact {
            ToolbarItemGroup(placement: .bottomBar) {
                importButton
                Spacer()
                newButton
            }
        } else {
            ToolbarItemGroup(placement: .primaryAction) {
                importButton
                newButton
            }
        }
        #else
        ToolbarItemGroup(placement: .primaryAction) {
            importButton
            newButton
        }
        #endif
    }

    private var importButton: some View {
        Button {
            startImport()
        } label: {
            Label("Import", systemImage: "square.and.arrow.down")
        }
        .help("Create a trip from an exported file (\(tripFileExtension))")
    }

    private var newButton: some View {
        Button {
            creating = true
        } label: {
            Label("New trip", systemImage: "plus")
        }
        #if os(iOS)
        // The Mac's ⌘N is the File menu's.
        .keyboardShortcut("n", modifiers: [.command])
        #endif
    }

    /// With one source there is nothing to ask: the file dialog opens at once.
    private func startImport() {
        if gallery.documentSources.count > 1 {
            choosingImportSource = true
        } else {
            importTarget = defaultSourceId
            importing = true
        }
    }

    // MARK: - the page

    /// The masthead's name, the count and the view — a wide screen's row; on
    /// a phone the bar already says Trips.
    private var heading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("Trips")
                .font(Brand.display(30))
                .foregroundStyle(palette.ink)
                .accessibilityHidden(true)
            if let docs = gallery.docs {
                Text("\(docs.count)")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
            }
            Spacer(minLength: 0)
            Picker("How the trips are shown", selection: Binding(get: { shell.mode }, set: { shell.choose($0) })) {
                Text("Cards").tag(TripGalleryMode.cards)
                Text("Bands").tag(TripGalleryMode.bands)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .help(shell.mode == .cards ? "Each trip as a card with its cover"
                                       : "Progress rows, the trip you were on first")
        }
    }

    @ViewBuilder
    private var content: some View {
        if gallery.docs == nil {
            HStack(spacing: 10) {
                ProgressView()
                Text("Loading trips…")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 40)
        } else if gallery.nothingAnywhere && gallery.allListed {
            emptyState
        } else {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(gallery.groups, id: \.id) { group in
                    section(group)
                }
            }
            .padding(.bottom, 16)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No trips yet", systemImage: "map")
        } description: {
            Text("Give a trip its two dates and every photo you post from it knows which day it belongs to — and the grid shows the days you have never told.")
        } actions: {
            Button("Create the first one") { creating = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: - one source

    private func section(_ group: AtelierKit.DocumentGroup<TripDoc>) -> some View {
        let known = gallery.connections.registry.sourceById(group.id)
        let items = group.items.map { shell.current($0) }
        let count = items.count + group.remoteOnly.count
        let moveTargets = gallery.documentSources.filter { $0.id != group.id }
        return VStack(alignment: .leading, spacing: 12) {
            sectionHeader(group.list, label: known?.label ?? group.id, known: known != nil, count: count)
            if count == 0 {
                Text("Nothing kept here yet.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.faint)
            } else if shell.mode == .bands && !compact {
                bands(items, remoteOnly: group.remoteOnly, moveTargets: moveTargets)
            } else {
                cards(items, remoteOnly: group.remoteOnly, moveTargets: moveTargets)
            }
        }
    }

    private func sectionHeader(_ list: RemoteList<RemoteDocRow<TripDoc>>?, label: String, known: Bool,
                               count: Int) -> some View {
        HStack(spacing: 0) {
            Eyebrow("source: \(label)")
            dot
            Eyebrow("\(count) trip\(count == 1 ? "" : "s")")
            if !known {
                Text(" · NOT CONNECTED — SHOWING WHAT THIS DEVICE HOLDS")
                    .font(Brand.eyebrow)
                    .foregroundStyle(palette.faint)
            }
            listStatus(list)
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    private var dot: some View {
        Text(" · ").font(Brand.eyebrow).foregroundStyle(palette.faint)
    }

    @ViewBuilder
    private func listStatus(_ list: RemoteList<RemoteDocRow<TripDoc>>?) -> some View {
        switch list {
        case .loading?:
            Text(" · CHECKING…").font(Brand.eyebrow).foregroundStyle(palette.faint)
        case .failed(let text, let login)?:
            Text(" · \(text)").font(Brand.sans(11)).foregroundStyle(palette.faint)
            if let login, let url = URL(string: login) {
                Text(" ")
                Link("Sign in", destination: url)
                    .font(Brand.sans(11, weight: .semibold))
                    .foregroundStyle(palette.accentInk)
            }
        default:
            EmptyView()
        }
    }

    // MARK: - cards

    /// Two columns on a phone — a column of single cards wastes the half of
    /// the screen a trip's cover does not need; above that, as many 260 pt
    /// columns as fit.
    private var columns: [GridItem] {
        compact
            ? [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
            : [GridItem(.adaptive(minimum: 260), spacing: 20)]
    }

    private func cards(_ items: [TripDoc], remoteOnly: [RemoteDocRow<TripDoc>], moveTargets: [SourceInfo]) -> some View {
        let openId = store.open?.id
        return LazyVGrid(columns: columns, alignment: .leading, spacing: compact ? 12 : 20) {
            ForEach(items, id: \.id) { trip in
                TripCard(trip: trip, isOpen: trip.id == openId,
                         lastOpened: openId == nil && trip.id == shell.lastOpenedId,
                         remoteOnly: false, moveTargets: moveTargets, busy: shell.busyLine(trip.id), covers: covers,
                         compact: compact, actions: actions(for: trip))
            }
            ForEach(remoteOnly, id: \.doc.id) { row in
                TripCard(trip: row.doc, isOpen: false, lastOpened: false, remoteOnly: true, moveTargets: [],
                         busy: shell.busyLine(row.doc.id), covers: covers, compact: compact,
                         actions: remoteActions(for: row))
            }
        }
    }

    // MARK: - bands

    private func bands(_ items: [TripDoc], remoteOnly: [RemoteDocRow<TripDoc>], moveTargets: [SourceInfo]) -> some View {
        let openId = store.open?.id
        // The trip you were on leads — open, else opened last — and the rest
        // follow as rows.
        let lastOpened = shell.lastOpenedId
        let lead = items.first(where: { $0.id == openId }) ?? items.first(where: { $0.id == lastOpened })
        let rest = items.filter { $0.id != lead?.id }
        return VStack(alignment: .leading, spacing: 0) {
            if let lead {
                TripResumeBand(trip: lead, isOpen: lead.id == openId, moveTargets: moveTargets,
                               busy: shell.busyLine(lead.id), covers: covers, actions: actions(for: lead))
            }
            VStack(spacing: 0) {
                ForEach(rest, id: \.id) { trip in
                    TripBandRow(trip: trip, isOpen: false, remoteOnly: false, moveTargets: moveTargets,
                                busy: shell.busyLine(trip.id), actions: actions(for: trip))
                }
                ForEach(remoteOnly, id: \.doc.id) { row in
                    TripBandRow(trip: row.doc, isOpen: false, remoteOnly: true, moveTargets: [],
                                busy: shell.busyLine(row.doc.id), actions: remoteActions(for: row))
                }
            }
            .overlay(alignment: .top) { Hairline() }
        }
    }

    // MARK: - the verbs

    private func actions(for trip: TripDoc) -> TripCardActions {
        TripCardActions(
            open: { shell.open(trip) },
            export: { exporting = shell.exportFile(trip) },
            delete: { Task { await shell.delete(trip) } },
            move: { target in Task { await shell.move(trip, to: target) } },
            chooseCover: { covering = trip }
        )
    }

    /// A trip only there: opening pulls it first, a delete carries the
    /// revision the list answered with, and there is nothing here to move.
    private func remoteActions(for row: RemoteDocRow<TripDoc>) -> TripCardActions {
        TripCardActions(
            open: { shell.openRemote(row) },
            export: { exporting = shell.exportFile(row.doc) },
            delete: { Task { await shell.delete(row.doc, etagHint: row.etag) } },
            move: { _ in },
            chooseCover: { covering = row.doc }
        )
    }

    // MARK: - the covers' pictures

    /// Every trip the page draws.
    private var drawnTrips: [TripDoc] {
        var out: [TripDoc] = []
        for group in gallery.groups {
            out.append(contentsOf: group.items.map { shell.current($0) })
            out.append(contentsOf: group.remoteOnly.map(\.doc))
        }
        return out
    }

    /// Only the CANDIDATES, never a trip's whole list of pieces.
    private var coverIds: [String] {
        var ids: [String] = []
        for trip in drawnTrips { ids.append(contentsOf: coverCandidateIds(trip, tripCoverage(trip))) }
        return ids
    }

    private var coverKey: String {
        "\(store.thumbsVersion)|" + drawnTrips.map { "\($0.id):\($0.updatedAt)" }.joined(separator: ",")
    }
}

#Preview("Trips") {
    NavigationStack { TripGallery() }
        .environment(TripsShell.shared)
}
