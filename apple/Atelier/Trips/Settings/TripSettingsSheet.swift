// ⚙ TRIP — everything shared by the WHOLE trip, in one sheet. Port of
// `src/tools/roadtrip/TripSettingsModal.tsx`.
//
// Rules kept (`roadtrip.md`, `frontend.md`):
// - These controls are the TRIP's, not the piece's: one ⚙ in the piece's bar,
//   and the inspector is about the piece again. The trip's title style is
//   deliberately not here (it is chosen constantly while composing, on the
//   Look tab), nor are the stages (the overview's).
// - A rail of sections beside ONE pane, never one long scroll: the areas have
//   nothing to do with each other. On a phone the sheet is the whole screen
//   and shows one pane at a time — the rail, then the section, with a way
//   back — a drill-down, never a stack in a height that cannot grow. Here that
//   is a `NavigationSplitView`: two columns on an iPad and the Mac, collapsed
//   to a push on a phone, opening on the pane asked for.
// - Nothing is applied on a button: the trip is written through
//   `store.change` on every keystroke (one undo step per burst, labelled by
//   pane), so the sheet's primary action IS closing it — Done, Return on the
//   Mac, Escape too.
// - A click on the closing card on the stage opens the sheet AT that card,
//   whether or not it was already up (`section` changing re-opens the pane),
//   and focuses the line's field (`cta:<role>`, or the element id itself).
// - "Back up the trip" writes the whole trip as `.roadtrip.json` (a backup,
//   and how it reaches another machine) through the kernel's own writer.
//
// On the web the House style section exists on the dev server alone; here it
// is drawn READ-ONLY and says why (`HouseStylePane`).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// Which pane of ⚙ Trip is open — the web's `TripSettingsSection`.
enum TripSettingsSection: String, CaseIterable, Identifiable, Hashable {
    case words, cta, defaults, car, house

    var id: String { rawValue }

    var label: String {
        switch self {
        case .words: return "Words"
        case .cta: return "Closing card"
        case .defaults: return "New pieces"
        case .car: return "Car"
        case .house: return "House style"
        }
    }

    var symbol: String {
        switch self {
        case .words: return "textformat.abc"
        case .cta: return "qrcode"
        case .defaults: return "square.on.square"
        case .car: return "car"
        case .house: return "house"
        }
    }

    /// What an opener asked for, read.
    struct Request: Equatable {
        var section: TripSettingsSection
        /// The closing card's line whose field takes the focus.
        var focus: CtaRole?
    }

    /// A section's own name, or a closing-card line — `cta:<role>`, or the
    /// element id `cta:<role>:<line>` a tap on the card hands over — which
    /// opens the card on that line. Nil, or anything else, opens Words.
    static func request(_ raw: String?) -> Request {
        guard let raw else { return Request(section: .words, focus: nil) }
        if raw.hasPrefix("cta:") {
            let parts = raw.split(separator: ":", omittingEmptySubsequences: false)
            let role = parts.count > 1 ? CtaRole(rawValue: String(parts[1])) : nil
            return Request(section: .cta, focus: role)
        }
        return Request(section: TripSettingsSection(rawValue: raw) ?? .words, focus: nil)
    }
}

struct TripSettingsSheet: View {
    let store: TripsStore
    let tripId: String
    /// The pane asked for (`TripSettingsSection.request`); nil opens Words.
    var section: String?
    /// The piece the sheet was opened from: the kind a new-piece default is
    /// filed under, and the frame the closing card is previewed in. Nil: no
    /// piece in hand, and the New pieces pane says what that leaves out.
    var postId: String?

    @Environment(\.dismiss) private var dismiss
    @State private var selection: TripSettingsSection?
    /// The pane on screen — kept when a phone's back button clears the selection.
    @State private var shown: TripSettingsSection
    @State private var compactColumn: NavigationSplitViewColumn = .detail
    @State private var focus: CtaRole?
    @State private var backup: TripBackupFile?
    @State private var backupProblem: String?

    init(store: TripsStore, tripId: String, section: String? = nil, postId: String? = nil) {
        self.store = store
        self.tripId = tripId
        self.section = section
        self.postId = postId
        let request = TripSettingsSection.request(section)
        _selection = State(initialValue: request.section)
        _shown = State(initialValue: request.section)
        _focus = State(initialValue: request.focus)
    }

    var body: some View {
        Group {
            if let trip = store.trip(tripId) {
                split(trip)
            } else {
                NavigationStack {
                    TripSettingsAbsent(text: "This trip is not on this device any more — there is nothing to set.")
                        .navigationTitle("Trip settings")
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { dismiss() }
                            }
                        }
                }
            }
        }
        .environment(\.palette, .paper)
        .tint(Palette.paper.accent)
        .modifier(TripSheetSizing(minWidth: 820, minHeight: 580))
        .onChange(of: section) { _, next in open(next) }
        .onChange(of: selection) { _, next in
            if let next { shown = next }
        }
        #if os(macOS)
        .onExitCommand { dismiss() }
        #endif
    }

    private func split(_ trip: TripDoc) -> some View {
        let post = postId.flatMap { id in trip.posts.first { $0.id == id } }
        return NavigationSplitView(preferredCompactColumn: $compactColumn) {
            TripSettingsRail(trip: trip, selection: $selection)
                .navigationTitle("Trip settings")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .navigationSplitViewColumnWidth(min: 180, ideal: 212, max: 260)
        } detail: {
            TripSettingsPane(store: store, trip: trip, post: post, section: shown, focus: focus)
                .navigationTitle(shown.label)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
        }
        .navigationSplitViewStyle(.balanced)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            TripSettingsFooter(problem: backupProblem, onBackUp: { backUp(trip) }, onDone: { dismiss() })
        }
        .fileExporter(isPresented: Binding(get: { backup != nil }, set: { if !$0 { backup = nil } }),
                      document: backup, contentType: .json,
                      defaultFilename: backup?.name ?? tripFileName(trip.name)) { result in
            if case .failure(let error) = result, (error as? CocoaError)?.code != .userCancelled {
                backupProblem = "The backup was not written: \(error.localizedDescription)"
            }
            backup = nil
        }
    }

    /// A new request while the sheet is up: that pane, on top, its line focused.
    private func open(_ raw: String?) {
        let request = TripSettingsSection.request(raw)
        selection = request.section
        shown = request.section
        focus = request.focus
        compactColumn = .detail
    }

    /// The whole trip on disk — a backup, and how it reaches another machine.
    private func backUp(_ trip: TripDoc) {
        backupProblem = nil
        backup = TripBackupFile(text: serializeTripFile(toTripFile(trip)), name: tripFileName(trip.name))
    }
}

// MARK: - the rail

private struct TripSettingsRail: View {
    let trip: TripDoc
    @Binding var selection: TripSettingsSection?
    @Environment(\.palette) private var palette

    var body: some View {
        List(selection: $selection) {
            Section {
                ForEach(TripSettingsSection.allCases) { section in
                    NavigationLink(value: section) {
                        Label(section.label, systemImage: section.symbol)
                            .font(Brand.sans(14))
                    }
                }
            } header: {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow("Shared by the whole trip")
                    Text(verbatim: TripSettingsRail.facts(trip))
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.muted)
                        .lineLimit(2)
                }
                .textCase(nil)
                .padding(.bottom, 4)
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.paper2)
    }

    /// `Australie · 61 days · 12 pieces` — the web's header line.
    static func facts(_ trip: TripDoc) -> String {
        var parts = [trip.name]
        if let days = spanLength(trip.startDate, trip.endDate) {
            parts.append("\(days) day\(days == 1 ? "" : "s")")
        }
        let pieces = trip.posts.count
        parts.append("\(pieces) piece\(pieces == 1 ? "" : "s")")
        return parts.joined(separator: " · ")
    }
}

// MARK: - the pane

private struct TripSettingsPane: View {
    let store: TripsStore
    let trip: TripDoc
    let post: TripPost?
    let section: TripSettingsSection
    let focus: CtaRole?
    @Environment(\.palette) private var palette

    /// Writes land on the OPEN trip only (`store.change`).
    private var editable: Bool { store.open?.id == trip.id }

    /// The frame the closing card is previewed in — the piece's, else a carousel's.
    private var aspect: Double { post.map { pieceAspect($0) } ?? 4.0 / 5 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !editable {
                Text("This trip is not the one open in Trips, so nothing here is written. Open the trip to change its settings.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.warn)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
            }
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.surface)
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .words:
            scrolling { TripWordsPane(trip: trip, write: write("trip:words")) }
        case .cta:
            scrolling { TripCtaPane(trip: trip, aspect: aspect, focusRole: focus, write: write("trip:cta")) }
        case .defaults:
            scrolling {
                NewPiecesPane(trip: trip, post: post, write: write("trip:defaults"),
                              writePost: { store.updatePost($0) })
            }
        case .car:
            // A definite height: wide, the garage keeps the car in view beside
            // its own scrolling choices; narrow, it stacks and scrolls itself.
            CarGaragePanelView(value: trip.car, onChange: { car in
                var next = trip
                next.car = car
                store.change(next, label: "trip:car")
            }) {
                TripSettingsLegend("Car", paragraphs: [
                    "The car every Virée of this trip drives — one car, every piece — and it travels in the trip’s backup. A piece only chooses how big it is drawn and how the camera looks at it.",
                    "Drag the car to turn it. The angle here is only a look: it is never kept, and never becomes a piece’s camera.",
                ])
            }
            .padding(24)
        case .house:
            scrolling { HouseStylePane(trip: trip) }
        }
    }

    private func scrolling<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            content()
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    /// Every write of a pane, labelled by it: typing in one pane never merges
    /// into one undo step with a change made in another.
    private func write(_ label: String) -> (TripDoc) -> Void {
        { next in store.change(next, label: label) }
    }
}

// MARK: - the footer

private struct TripSettingsFooter: View {
    let problem: String?
    let onBackUp: () -> Void
    let onDone: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            Hairline()
            HStack(spacing: 12) {
                Button(action: onBackUp) {
                    Label("Back up the trip", systemImage: "arrow.down.doc")
                }
                .buttonStyle(DevelopPillButtonStyle())
                .help("The whole trip as a \(tripFileExtension) file — a backup, and how it reaches another machine")
                if let problem {
                    Text(verbatim: problem)
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.danger)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Button("Done", action: onDone)
                    .buttonStyle(TripSettingsDoneStyle())
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(palette.surface)
    }
}

/// The sheet's one strong verb: ink on paper, the accent when pressed.
private struct TripSettingsDoneStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        DoneBody(configuration: configuration)
    }

    private struct DoneBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.palette) private var palette

        var body: some View {
            let pressed = configuration.isPressed
            configuration.label
                .font(Brand.sans(14, weight: .semibold))
                .foregroundStyle(palette.paper)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(Capsule().fill(pressed ? palette.accent : palette.ink))
                .contentShape(Capsule())
        }
    }
}

// MARK: - the backup, as the exporter carries it

/// A `.roadtrip.json` — the kernel's own bytes (`serializeTripFile`).
private struct TripBackupFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    let text: String
    let name: String

    init(text: String, name: String) {
        self.text = text
        self.name = name
    }

    init(configuration: ReadConfiguration) throws {
        text = String(decoding: configuration.file.regularFileContents ?? Data(), as: UTF8.self)
        name = configuration.file.filename ?? tripFileName("trip")
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

// MARK: - shared by the two sheets

/// Big on a desktop, a page on an iPad: the Car pane holds the rail, the
/// turning car and its choices side by side (the web's 80rem × 54rem).
struct TripSheetSizing: ViewModifier {
    var minWidth: CGFloat
    var minHeight: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(macOS)
        content.frame(minWidth: minWidth, idealWidth: minWidth * 1.3, minHeight: minHeight,
                      idealHeight: minHeight * 1.3)
        #else
        if #available(iOS 18.0, *) {
            content.presentationSizing(.page)
        } else {
            content
        }
        #endif
    }
}

/// What a sheet says when the trip it was opened on is gone.
struct TripSettingsAbsent: View {
    let text: String
    @Environment(\.palette) private var palette

    var body: some View {
        Text(verbatim: text)
            .font(Brand.sans(14))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(palette.surface)
    }
}

// MARK: - previews

#Preview("⚙ Trip, on the closing card's headline") {
    let store = TripSettingsFixtures.store()
    return Color.clear.sheet(isPresented: .constant(true)) {
        TripSettingsSheet(store: store, tripId: TripSettingsFixtures.tripId, section: "cta:headline:0",
                          postId: TripSettingsFixtures.postId)
    }
}

#Preview("⚙ Trip, the car") {
    let store = TripSettingsFixtures.store()
    return TripSettingsSheet(store: store, tripId: TripSettingsFixtures.tripId, section: "car",
                             postId: TripSettingsFixtures.postId)
}

#Preview("⚙ Trip, with no piece") {
    let store = TripSettingsFixtures.store()
    return TripSettingsSheet(store: store, tripId: TripSettingsFixtures.tripId, section: "defaults")
}
