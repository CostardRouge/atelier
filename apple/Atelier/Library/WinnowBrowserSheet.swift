// "Browse all" — the Library instance tab's way past the tool's day, the
// native twin of the web's `WinnowBrowser.tsx` (state in `WinnowBrowserModel`).
//
// Two panes side by side — the month, the folders or the legs on the left,
// the chosen one's pictures on the right — and on a phone ONE pane at a time:
// the picker until a day, a folder or a leg is chosen, then its pictures with
// a way back (`frontend.md`: a modal under 820 pt shows one pane, never a
// stack in a fixed height). A tile is TICKED, never fetched; the footer says
// what bringing them costs — proxies by default, originals on request with
// their weight — and "Add N to library" fetches them one by one as tasks,
// with the sheet's own Cancel beside the progress (the pill is behind it).

import SwiftUI
import AtelierKit

struct WinnowBrowserSheet: View {
    @State private var model: WinnowBrowserModel
    let onClose: () -> Void

    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    init(connection: WinnowConnection, client: WinnowClient, library: LibraryStore, onClose: @escaping () -> Void) {
        _model = State(initialValue: WinnowBrowserModel(connection: connection, client: client, library: library))
        self.onClose = onClose
    }

    private var compact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 12 : 16) {
            header
            controls
            if let problem = model.problem {
                LibraryProblemLine(problem: RowsProblem(text: deviceWords(problem.text), login: problem.login), onRetry: nil)
            }
            panes
                .frame(maxHeight: .infinity)
            Rectangle().fill(palette.line).frame(height: 1)
            footer
        }
        .padding(compact ? 16 : 24)
        .background(palette.surface)
        #if os(macOS)
        .frame(minWidth: 820, idealWidth: 900, minHeight: 600, idealHeight: 760)
        #endif
        .task { await model.loadFacets() }
        .task(id: model.calendarKey) { await model.loadCalendar() }
        .task(id: model.sessionsKey) { await model.loadSessions() }
        .task(id: model.chaptersKey) { await model.loadChapters() }
        .task(id: model.rowsKey) { await model.loadRows() }
        .onChange(of: model.stateKey) { _, _ in model.remember() }
        .accessibilityLabel("Add from \(model.host)")
    }

    // MARK: - header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("From \(model.host)")
                .font(Brand.display(compact ? 22 : 26))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            if !compact {
                Text("pick a day, a folder\(model.timelineOffered ? " or a leg" : ""), then the pictures — they arrive as files in the library.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("reconnect") {
                onClose()
                // The web's `#/connect?instance=<its address>`: Sources opens
                // with the address filled in and says a link asked for it.
                AppLinks.shared.propose(SourcesLink(proposed: model.connection.baseUrl, back: ""))
            }
            .buttonStyle(.plain)
            .font(Brand.sans(12))
            .foregroundStyle(palette.faint)
            .underline()
            .help("Sources — refresh what \(model.host) says it can do")
        }
    }

    // MARK: - the view and the filters: one row that narrows everything below

    private var controls: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                viewTab(.day, "by day", disabledWhy: nil)
                viewTab(.session, "by folder", disabledWhy: nil)
                viewTab(.chapter, "by leg",
                        disabledWhy: model.timelineOffered ? nil : "\(model.host) has no timeline yet — reconnect once it does.")
                Rectangle().fill(palette.line).frame(width: 1, height: 20)
                halfMenu
                facetMenu("photos & videos", selected: model.filter.mediaType.map { $0 == .video ? "videos" : "photos" },
                          values: model.facets?.mediaTypes ?? [],
                          word: { $0 == "video" ? "videos" : "photos" }) { value in
                    model.filter.mediaType = value.flatMap { WinnowMediaType(rawValue: $0) }
                }
                facetMenu("any extension", selected: model.filter.ext.map { ".\($0)" },
                          values: model.facets?.extensions ?? [], word: { ".\($0)" }) { value in
                    model.filter.ext = value
                }
                facetMenu("any device", selected: model.filter.device,
                          values: model.facets?.devices ?? [], word: { $0 }) { value in
                    model.filter.device = value
                }
                if model.filter != FilterQuery() {
                    Button("clear") { model.filter = FilterQuery() }
                        .buttonStyle(.plain)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .underline()
                }
            }
        }
    }

    private func viewTab(_ view: BrowseView, _ label: String, disabledWhy: String?) -> some View {
        let on = model.view == view
        return Button { model.view = view } label: {
            Text(label)
                .font(Brand.sans(compact ? 14 : 12))
                .foregroundStyle(on ? palette.paper : palette.inkSoft)
                .padding(.horizontal, 12)
                .padding(.vertical, compact ? 7 : 5)
                .background(on ? palette.ink : palette.paper, in: Capsule())
                .overlay(Capsule().stroke(on ? palette.ink : palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(disabledWhy != nil)
        .opacity(disabledWhy != nil ? 0.4 : 1)
        .help(disabledWhy ?? label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// Which half of the library, in Winnow's own words — a scope rather than
    /// a property of a file, so it comes first. Naming both halves says what
    /// the default really is.
    private var halfMenu: some View {
        let word: String
        switch model.filter.half {
        case .incoming?: word = "incoming · to cull"
        case .final?: word = "gallery · finished"
        case nil: word = "incoming + gallery"
        }
        return Menu {
            Button("incoming + gallery") { model.filter.half = nil }
            Button("incoming · to cull") { model.filter.half = .incoming }
            Button("gallery · finished") { model.filter.half = .final }
        } label: {
            filterPill(word, on: model.filter.half != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Which half of the library")
    }

    /// A filter offering what the library actually holds, each with its count.
    private func facetMenu(_ any: String, selected: String?, values: [ValueCount], word: @escaping (String) -> String,
                           set: @escaping (String?) -> Void) -> some View {
        Menu {
            Button(any) { set(nil) }
            ForEach(Array(values.enumerated()), id: \.offset) { _, facet in
                let text = facetText(facet.value)
                Button("\(word(text)) · \(facet.count)") { set(text) }
            }
        } label: {
            filterPill(selected ?? any, on: selected != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel(any)
    }

    private func filterPill(_ text: String, on: Bool) -> some View {
        HStack(spacing: 4) {
            Text(text).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
        }
        .font(Brand.sans(compact ? 14 : 12))
        .foregroundStyle(on ? palette.accentInk : palette.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, compact ? 7 : 5)
        .background(palette.paper, in: Capsule())
        .overlay(Capsule().stroke(on ? palette.accent : palette.line, lineWidth: 1))
    }

    private func facetText(_ value: JSONValue) -> String {
        if let text = value.stringValue { return text }
        if let n = value.finiteNumber { return n == n.rounded() ? String(Int(n)) : String(n) }
        return value.serialized()
    }

    // MARK: - the two panes

    @ViewBuilder
    private var panes: some View {
        if compact {
            // One pane at a time: the picker, or the pictures of what it chose.
            if model.heading == nil { picker } else { pictures }
        } else {
            HStack(alignment: .top, spacing: 24) {
                picker.frame(width: 288)
                pictures
            }
        }
    }

    @ViewBuilder
    private var picker: some View {
        switch model.view {
        case .day: monthPane
        case .session: sessionList
        case .chapter: chapterList
        }
    }

    // MARK: by day

    private var monthPane: some View {
        let span = monthSpan(model.month)
        var counts: [String: Int] = [:]
        for day in model.calendar?.days ?? [] { counts[day.date, default: 0] += day.count }
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                monthArrow("chevron.left", "Previous month", enabled: model.canPrevMonth) {
                    model.month = shiftMonth(model.month, -1)
                }
                monthMenu
                monthArrow("chevron.right", "Next month", enabled: model.canNextMonth) {
                    model.month = shiftMonth(model.month, 1)
                }
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, letter in
                    Text(letter).font(Brand.mono(9)).foregroundStyle(palette.faint)
                }
                ForEach(0..<span.leading, id: \.self) { _ in Color.clear.frame(height: 1) }
                ForEach(span.days, id: \.self) { iso in
                    dayCell(iso, count: counts[iso] ?? 0)
                }
            }
            Text(monthLine)
                .font(Brand.mono(10))
                .foregroundStyle(palette.muted)
            Spacer(minLength: 0)
        }
    }

    private var monthLine: String {
        if model.calendar == nil && model.problem == nil { return "asking…" }
        if let bounds = model.calendar?.bounds {
            return "\(monthLabel(model.month)) · media from \(bounds.min) to \(bounds.max)"
        }
        return "nothing dated matches these filters"
    }

    private func monthArrow(_ symbol: String, _ label: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 30, height: 30)
                .overlay(Capsule().stroke(palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.inkSoft)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
        .accessibilityLabel(label)
    }

    /// One picker, years as groups: a library spanning fifteen years is two
    /// clicks away, not a hundred arrow presses.
    private var monthMenu: some View {
        Menu {
            ForEach(model.years, id: \.year) { year in
                Section(year.year) {
                    ForEach(year.months, id: \.key) { option in
                        Button("\(option.label) \(year.year)") { model.month = option.key }
                    }
                }
            }
        } label: {
            Text(monthLabel(model.month))
                .font(Brand.display(17))
                .foregroundStyle(palette.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel("Month")
    }

    private func dayCell(_ iso: String, count: Int) -> some View {
        let active = model.day == iso
        let ground: Color = active ? palette.ink : (count > 0 ? palette.accentWash : palette.paper)
        let edge: Color = active ? palette.ink : (count > 0 ? palette.accent.opacity(0.5) : palette.line)
        return Button { model.day = iso } label: {
            VStack(spacing: 1) {
                Text(String(Int(iso.suffix(2)) ?? 0))
                    .font(Brand.mono(compact ? 13 : 11))
                if count > 0 {
                    Text("\(count)").font(Brand.mono(8)).opacity(0.7)
                }
            }
            .monospacedDigit()
            .foregroundStyle(active ? palette.paper : (count > 0 ? palette.ink : palette.faint))
            .frame(maxWidth: .infinity)
            .frame(height: compact ? 52 : 36)
            .background(ground, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(count == 0)
        .help(count > 0 ? "\(iso) · \(count) media" : iso)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    // MARK: by folder, by leg

    private var sessionList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let sessions = model.sessions {
                    if sessions.isEmpty {
                        quiet("No folder matches these filters.")
                    }
                    ForEach(sessions, id: \.id) { folder in
                        listRow(folder.name, sessionFactsLine(folder), active: model.session?.id == folder.id,
                                help: folder.sourcePath) {
                            model.session = folder
                        }
                    }
                } else if model.problem == nil {
                    quiet("asking…")
                }
            }
        }
    }

    private var chapterList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let chapters = model.chapters {
                    if chapters.isEmpty {
                        quiet("No leg matches these filters.")
                    }
                    ForEach(chapters, id: \.id) { leg in
                        listRow(chapterLabel(leg), chapterFactsLine(leg), active: model.chapter?.id == leg.id,
                                help: chapterRoute(leg)) {
                            model.chapter = leg
                        }
                    }
                } else if model.problem == nil {
                    quiet("asking…")
                }
            }
        }
    }

    private func listRow(_ title: String, _ facts: String, active: Bool, help: String,
                         _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Brand.sans(13, weight: .medium))
                    .lineLimit(1)
                Text(facts)
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .opacity(active ? 0.7 : 1)
                    .foregroundStyle(active ? palette.paper : palette.muted)
            }
            .foregroundStyle(active ? palette.paper : palette.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(active ? palette.ink : palette.paper, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(active ? palette.ink : palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help(help.isEmpty ? title : help)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
    }

    // MARK: the pictures of what was chosen

    @ViewBuilder
    private var pictures: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let heading = model.heading {
                if let rows = model.rows {
                    picturesHeader(heading, count: rows.count)
                    if rows.isEmpty {
                        quiet("Nothing here matches these filters.")
                    } else {
                        pictureGrid(rows)
                    }
                } else {
                    HStack(spacing: 10) {
                        backButton
                        Text("reading \(heading)…").font(Brand.mono(11)).foregroundStyle(palette.muted)
                    }
                }
            } else {
                quiet(chooseLine)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var chooseLine: String {
        switch model.view {
        case .day: return "Choose a day on the left."
        case .session: return "Choose a folder on the left."
        case .chapter: return "Choose a leg on the left — its pictures are listed, nothing is downloaded until you add them."
        }
    }

    @ViewBuilder
    private var backButton: some View {
        if compact {
            let back: String = {
                switch model.view {
                case .day: return monthLabel(model.month)
                case .session: return "folders"
                case .chapter: return "legs"
                }
            }()
            Button { model.closeChosen() } label: {
                Text("‹ \(back)")
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.inkSoft)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .overlay(Capsule().stroke(palette.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    private func picturesHeader(_ heading: String, count: Int) -> some View {
        let all = model.checked.count == count && count > 0
        return HStack(spacing: 10) {
            backButton
            Text("\(heading) · \(count) media".uppercased())
                .font(Brand.eyebrow)
                .kerning(1.4)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            if let note = model.legNoteShown {
                Text(note.text)
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .help(note.why)
            }
            Spacer(minLength: 4)
            Button(all ? "NONE" : "ALL") { model.toggleAll() }
                .buttonStyle(.plain)
                .font(Brand.mono(9))
                .kerning(1)
                .foregroundStyle(palette.muted)
                .disabled(count == 0)
        }
    }

    private func pictureGrid(_ rows: [WinnowAssetRow]) -> some View {
        let tall: CGFloat = compact ? 120 : 90
        return ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
                ForEach(rows, id: \.id) { row in
                    pictureTile(row, height: tall)
                }
            }
            .padding(.bottom, 8)
        }
    }

    private func pictureTile(_ row: WinnowAssetRow, height: CGFloat) -> some View {
        let on = model.checked.contains(row.id)
        let label = row.ext.isEmpty ? (row.mediaType == .video ? "video" : "photo") : row.ext
        var name = row.filename
        if row.mediaType == .video { name += " ▶" }
        if row.hasTelemetry { name += " · srt" }
        var help = row.filename
        if row.hasTelemetry { help += " · flight log" }
        if row.derivativeStatus != .ready { help += " · proxy not ready" }
        return Button { model.toggle(row.id) } label: {
            WinnowThumbView(client: model.client, id: row.id, label: label)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .overlay(alignment: .bottom) {
                    Text(name)
                        .font(Brand.mono(9))
                        .foregroundStyle(palette.onMedia)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(0.62))
                }
                .overlay(alignment: .topLeading) {
                    Image(systemName: on ? "checkmark.square.fill" : "square")
                        .font(.system(size: compact ? 20 : 15))
                        .foregroundStyle(on ? palette.accent : palette.onMedia)
                        .shadow(color: .black.opacity(0.4), radius: 1)
                        .padding(6)
                }
                .overlay(alignment: .topTrailing) {
                    WinnowCullMark(culling: cullingFromRow(row), onMedia: true).padding(4)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(on ? palette.accent : palette.line, lineWidth: on ? 2 : 1))
                .overlay { TaskEdge(scope: "\(model.host)/\(row.id)") }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityLabel("Select \(row.filename)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: - what to bring, and go

    private var footer: some View {
        let picked = model.picked.count
        let adding = model.progress != nil
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                bringChoice
                Spacer(minLength: 8)
                go(picked: picked, adding: adding)
            }
            VStack(alignment: .leading, spacing: 10) {
                bringChoice
                go(picked: picked, adding: adding)
            }
        }
    }

    private var bringChoice: some View {
        HStack(spacing: 8) {
            Text("BRING").font(Brand.eyebrow).kerning(1.4).foregroundStyle(palette.muted)
            fidelityButton(.proxy, "proxies", "Winnow's editing rendition: H.264 video, WebP photo — fast, decodes everywhere")
            fidelityButton(.original, "originals", "The full files — every byte through the tunnel")
            Text(browseFidelityLine(model.fidelity, picked: model.picked.count, bytes: model.pickedBytes))
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .lineLimit(2)
        }
    }

    private func fidelityButton(_ fidelity: Fidelity, _ label: String, _ hint: String) -> some View {
        let on = model.fidelity == fidelity
        return Button { model.fidelity = fidelity } label: {
            Text(label)
                .font(Brand.sans(compact ? 14 : 12))
                .foregroundStyle(on ? palette.paper : palette.inkSoft)
                .padding(.horizontal, 12)
                .padding(.vertical, compact ? 7 : 5)
                .background(on ? palette.ink : palette.paper, in: Capsule())
                .overlay(Capsule().stroke(on ? palette.ink : palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help(hint)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func go(picked: Int, adding: Bool) -> some View {
        HStack(spacing: 12) {
            if let progress = model.progress {
                Text(progress)
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                // The pill is behind the sheet: the sheet carries its own Cancel.
                TaskCancelLink(scope: model.running)
            }
            Button("Cancel", action: onClose)
                .buttonStyle(.plain)
                .font(Brand.sans(14))
                .foregroundStyle(palette.muted)
                .underline()
                .keyboardShortcut(.cancelAction)
            Button {
                Task {
                    if await model.add() { onClose() }
                }
            } label: {
                Text("Add \(picked > 0 ? "\(picked) " : "")to library")
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.paper)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 8)
                    .background(palette.ink, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(picked == 0 || adding)
            .opacity(picked == 0 || adding ? 0.4 : 1)
            .keyboardShortcut(.defaultAction)
        }
    }
}

#Preview("Browse all, by day") {
    let connections = LibraryFixtures.connections
    return Group {
        if let connection = connections.first, let client = connections.firstClient {
            WinnowBrowserSheet(connection: connection, client: client, library: LibraryStore.preview(), onClose: {})
        }
    }
    .frame(width: 900, height: 700)
}
