// Choosing the pictures an opener flashes, pins or pops — the maintainer's
// own gesture: show what was shot over a span of the trip, take it all at
// once, untick what does not belong. The native twin of the web's
// `HookPicturesModal.tsx`; its state and rules are `OpenerPicturesModel`.
//
// Presented by the Look tab's picker when an opener's panel asks
// (`\.chooseOpenerPictures`), in the darkroom. It takes the model alone: the
// request the panel left (`OpenerPictureAsk` — what to tick, how to open,
// where the kept pictures go) is read once, when it appears; with none, it
// opens on the open opener's whole list (`OpenerPicturesRequest.forOpener`).
//
// - The span: the two dates (bounded by the trip) and the one-press spans,
//   widest first; moving one end past the other drags the other along.
// - The count of what is ticked, "left off" for a picture the opener will not
//   use, all / none, what is still being read or asked, the clips left out,
//   and the ways to add pictures from this device — Photos and Files.
// - The grid in day groups, each with its own all / none; a tile's whole face
//   ticks and unticks it, its corner looks at it large (the lightbox, with
//   the tick in its footer) — the picker grammar the suite settled on.
// - The instance's problem said with "Sign in there"; nothing found said with
//   what to do next.
// - Escape cancels, Return keeps.

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct OpenerPicturesSheet: View {
    let model: PieceEditorModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @Environment(LibraryStore.self) private var libraryInScope: LibraryStore?
    @Environment(ConnectionStore.self) private var connectionsInScope: ConnectionStore?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    /// What the panel asked for, read once.
    @State private var request: OpenerPicturesRequest?
    @State private var chooser: OpenerPicturesModel?
    @State private var started = false
    @State private var importing = false
    @State private var photoItems: [PhotosPickerItem] = []

    init(model: PieceEditorModel) {
        self.model = model
    }

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        Group {
            if let chooser, let request {
                chooserBody(chooser, request)
            } else if started {
                nothingToChoose
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(palette.surface)
        .onAppear(perform: start)
        .onDisappear {
            if let request { OpenerPictureAsk.forget(request.id, for: model.postId) }
        }
        .presentationDetents([.large])
        #if os(macOS)
        .frame(minWidth: 720, idealWidth: 920, minHeight: 560, idealHeight: 760)
        #endif
    }

    /// Read the request and build the chooser — once.
    private func start() {
        guard !started else { return }
        started = true
        guard let asked = OpenerPictureAsk.request(for: model.postId) ?? OpenerPicturesRequest.forOpener(model),
              let ctx = model.hookState?.ctx else { return }
        request = asked
        chooser = OpenerPicturesModel(ctx: ctx, request: asked, library: libraryInScope ?? .shared,
                                      connections: connectionsInScope ?? .shared)
    }

    /// An opener with nothing to pick for, said — never an empty sheet.
    private var nothingToChoose: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(verbatim: "Pictures for the sweep")
                .font(Brand.display(24))
                .foregroundStyle(palette.ink)
            OpenerNote(model.hookVariant?.id == mapVariant.id
                       ? "Add a stop first — an itinerary’s picture belongs to a stop."
                       : "This opener shows no pictures of its own.", tone: .muted)
            HStack {
                Spacer()
                Button("Close") { dismiss() }
                    .buttonStyle(StagesButtonStyle(small: false))
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - the chooser

    private func chooserBody(_ c: OpenerPicturesModel, _ request: OpenerPicturesRequest) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(c)
            spanRows(c)
            countRow(c)
            if let problem = c.problem { problemLine(problem, c) }
            OpenerPictureGrid(chooser: c, compact: compact)
            Hairline()
            footer(c, request)
        }
        .padding(.horizontal, compact ? 16 : 24)
        .padding(.top, compact ? 16 : 24)
        .padding(.bottom, compact ? 12 : 20)
        .task { await c.readDates() }
        .task(id: c.rowsKey) { await c.loadRows() }
        .onChange(of: libraryKey) { _, _ in
            c.recompute()
            Task { await c.readDates() }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task { await c.addPhotos(items) }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { c.addFiles(urls) }
        }
        .lightboxCover(isPresented: looking(c)) {
            OpenerPictureLook(chooser: c)
        }
    }

    /// What the Library holds, as one value a change can be heard on.
    private var libraryKey: String {
        let library = libraryInScope ?? .shared
        return "\(library.entries.count)|\(library.entries.filter { $0.ref.hash != nil }.count)"
    }

    private func looking(_ c: OpenerPicturesModel) -> Binding<Bool> {
        Binding(get: { c.looking != nil }, set: { if !$0 { c.looking = nil } })
    }

    private func header(_ c: OpenerPicturesModel) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "Pictures for the sweep")
                .font(Brand.display(compact ? 22 : 26))
                .foregroundStyle(palette.ink)
            Text(verbatim: "Everything shot over these days in \(c.whereWords), plus anything you add from \(OpenerWords.device). All of it is taken — untick what does not belong. They are shown in the order they were shot.")
                .font(Brand.sans(13))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - the span

    @ViewBuilder
    private func spanRows(_ c: OpenerPicturesModel) -> some View {
        if let span = c.span, let bounds = c.bounds {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    datePicker("From", span.from, StagesDate.range(bounds.from, bounds.to)) { c.setFrom($0) }
                    Text(verbatim: "→")
                        .font(Brand.mono(12))
                        .foregroundStyle(palette.faint)
                        .accessibilityHidden(true)
                    datePicker("To", span.to, StagesDate.range(bounds.from, bounds.to)) { c.setTo($0) }
                    Spacer(minLength: 0)
                }
                .environment(\.timeZone, StagesDate.utc)
                StagesFlow(spacing: 6) {
                    ForEach(c.quick, id: \.id) { q in
                        quickChip(q, on: q.from == span.from && q.to == span.to) {
                            c.changeSpan(DateSpan(from: q.from, to: q.to))
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Quick spans")
            }
        } else {
            OpenerNote("This piece is dated outside its trip — there are no days to choose from.", tone: .danger)
        }
    }

    private func datePicker(_ title: String, _ value: IsoDate, _ range: ClosedRange<Date>?,
                            _ write: @escaping (IsoDate) -> Void) -> some View {
        let binding = Binding<Date>(get: { StagesDate.date(value) ?? Date() }, set: { write(StagesDate.iso($0)) })
        return Group {
            if let range {
                DatePicker(title, selection: binding, in: range, displayedComponents: .date)
            } else {
                DatePicker(title, selection: binding, displayedComponents: .date)
            }
        }
        .labelsHidden()
        .accessibilityLabel(title)
    }

    private func quickChip(_ q: QuickSpan, on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: q.label)
                .font(Brand.sans(12))
                .foregroundStyle(on ? palette.ink : palette.inkSoft)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(on ? palette.accentWash : palette.paper))
                .overlay(Capsule().strokeBorder(on ? palette.accent : palette.line, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - the count

    private func countRow(_ c: OpenerPicturesModel) -> some View {
        let ticked = c.ticked
        let later = ticked.filter { c.leftOff($0.candidate.date) }.count
        return VStack(alignment: .leading, spacing: 8) {
            Hairline()
            StagesFlow(spacing: 10) {
                Text(verbatim: "\(ticked.count) of \(c.pool.count) \(c.pool.count == 1 ? "photo" : "photos")".uppercased())
                    .font(Brand.mono(10))
                    .kerning(1.2)
                    .foregroundStyle(palette.muted)
                if later > 0 {
                    Text(verbatim: "\(later) shot after this piece’s day — the opener leaves \(later == 1 ? "it" : "them") off")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.accentInk)
                }
                allNone(on: true) { c.toggle(c.pool.map(\.id), on: true) }
                allNone(on: false) { c.toggle(c.pool.map(\.id), on: false) }
                if c.loading {
                    Text(verbatim: c.reading > 0 ? "reading \(c.reading) dates…" : "asking \(c.connection?.id ?? "")…")
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.muted)
                }
                if c.clipsLeftOut > 0 {
                    Text(verbatim: "\(c.clipsLeftOut) \(c.clipsLeftOut == 1 ? "clip" : "clips") left out — photos only")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.faint)
                }
            }
            addRow(c)
        }
    }

    private func allNone(on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(on ? "ALL" : "NONE", action: action)
            .font(Brand.mono(9))
            .kerning(1)
            .buttonStyle(.plain)
            .foregroundStyle(palette.muted)
    }

    /// Photographs from this device: they join the Library and are kept in
    /// the grid whatever day they were shot.
    private func addRow(_ c: OpenerPicturesModel) -> some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            PhotosPicker(selection: $photoItems, matching: .images) {
                Text(verbatim: c.adding ? "Opening…" : "Add from Photos…")
            }
            .buttonStyle(StagesButtonStyle(small: true))
            .disabled(c.adding)
            Button("Add from Files…") { importing = true }
                .buttonStyle(StagesButtonStyle(small: true))
                .disabled(c.adding)
        }
    }

    private func problemLine(_ problem: RowsProblem, _ c: OpenerPicturesModel) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: problem.text)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let login = problem.login, let url = URL(string: login) {
                Link("Sign in there", destination: url)
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(palette.danger)
                Button("Ask again") { c.reload() }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    // MARK: - the footer

    private func footer(_ c: OpenerPicturesModel, _ request: OpenerPicturesRequest) -> some View {
        let n = c.ticked.count
        let keep = c.busy ? "Keeping…" : n == 0 ? "Use no picture" : "Use \(n) \(n == 1 ? "picture" : "pictures")"
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                footerNote(c, request)
                footerButtons(c, request, keep)
            }
            VStack(alignment: .leading, spacing: 10) {
                footerNote(c, request)
                footerButtons(c, request, keep)
            }
        }
    }

    private func footerNote(_ c: OpenerPicturesModel, _ request: OpenerPicturesRequest) -> some View {
        let text: String
        if !c.added.isEmpty {
            let n = c.added.count
            text = "\(n) \(n == 1 ? "picture" : "pictures") added from \(OpenerWords.device) — they are in the Library now, whatever day they were shot."
        } else if !request.selected.isEmpty {
            text = "Only what is ticked in these days is kept."
        } else {
            text = "Nothing is downloaded to choose: a picture is fetched when the sweep draws it."
        }
        return OpenerNote(text, tone: .muted)
    }

    private func footerButtons(_ c: OpenerPicturesModel, _ request: OpenerPicturesRequest, _ keep: String) -> some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)
            Button("Cancel") { dismiss() }
                .buttonStyle(StagesButtonStyle(kind: .ghost))
                .keyboardShortcut(.cancelAction)
            Button(keep) { confirm(c, request) }
                .buttonStyle(StagesButtonStyle(kind: .primary))
                .keyboardShortcut(.defaultAction)
                .disabled(c.busy || c.span == nil)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func confirm(_ c: OpenerPicturesModel, _ request: OpenerPicturesRequest) {
        guard !c.busy, c.span != nil else { return }
        Task {
            let picked = await c.confirm()
            request.settle(picked)
            dismiss()
        }
    }
}

#Preview("Pictures for the sweep") {
    let model = OpenerFixtures.model(scrubVariant.id)
    return Color.clear
        .sheet(isPresented: .constant(true)) {
            OpenerPicturesSheet(model: model)
                .environment(LibraryFixtures.library)
                .environment(ConnectionStore.preview())
                .darkroom()
        }
}
