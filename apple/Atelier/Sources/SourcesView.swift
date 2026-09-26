// The Sources tab — the one screen where a remote source enters this app, is
// looked at, and leaves it. The native twin of the web's `SourcesScreen.tsx`
// (`#/sources`, `#/connect`): connecting and managing are the SAME screen
// (the maintainer's call, 2026-09-08), a row per source over a connect form.
//
// Three rules it holds (`architecture.md`, «Connecting and managing a source
// are ONE screen»):
// - Connecting is the person's act: nothing is sent until they press Allow.
// - Opening this screen re-asks every connected instance what it can do and
//   STORES the answer (`ConnectionStore.checkAll`): the screen that reports a
//   stale capabilities sheet is the screen that refreshes it. Pull to
//   refresh (⌘R on the Mac) asks again.
// - A source that cannot be reached is greyed with the reason, never hidden;
//   and a forget COUNTS before it asks ("3 rolls came from it").
//
// The words are the web's, with "this browser" said as "this device"
// (`deviceWords`) and the one fix a native client has for a refused
// credential — a new token, pasted with Reconnect — where the web links to
// the instance's sign-in page.

import SwiftUI
import AtelierKit

struct SourcesView: View {
    @Environment(ConnectionStore.self) private var store
    @Environment(\.palette) private var palette
    /// Where the documents counted by the ledger live; a preview passes its own.
    var ledgerRoot: URL = DocumentStore<RollDoc>.defaultRoot

    @State private var counts: [String: DocCount] = [:]
    @State private var forgetting: WinnowConnection?
    @State private var address = ""
    @State private var tokenFocus = 0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    VStack(spacing: 8) {
                        localRow
                        ForEach(store.connections, id: \.id) { conn in
                            connectionRow(conn) {
                                address = conn.baseUrl
                                tokenFocus += 1
                                withAnimation { proxy.scrollTo("connect", anchor: .bottom) }
                            }
                        }
                    }
                    ConnectView(address: $address, tokenFocus: tokenFocus, onConnected: recount)
                        .id("connect")
                }
                .frame(maxWidth: 736, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
        }
        .background(palette.paper)
        .navigationTitle("Sources")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await askAgain() }
                } label: {
                    Label("Ask every instance again", systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(store.connections.isEmpty)
            }
        }
        .task { await askAgain() }
        .refreshable { await askAgain() }
        .confirmationDialog(
            forgetting.map { "Forget \($0.id)?" } ?? "",
            isPresented: Binding(get: { forgetting != nil }, set: { if !$0 { forgetting = nil } }),
            titleVisibility: .visible,
            presenting: forgetting
        ) { conn in
            Button("Forget it", role: .destructive) {
                store.forget(conn.id)
                recount()
            }
            Button("Keep", role: .cancel) {}
        } message: { conn in
            Text(deviceWords(forgetWarning(conn.id, counts[conn.id] ?? noDocs)))
        }
    }

    private func askAgain() async {
        recount()
        await store.checkAll()
    }

    /// What each source holds, so a forget can say it before it asks. Read
    /// per visit — the folders are local and small.
    private func recount() {
        counts = DocumentLedger.counts(root: ledgerRoot)
    }

    // MARK: - the page

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Where your work lives")
                .font(Brand.display(32))
                .foregroundStyle(palette.ink)
            Text("A project, a trip and its media belong to exactly one source. Nothing is sent anywhere — connecting is your click, and only ever to the address you name.")
                .font(Brand.sans(14))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var localRow: some View {
        let count = counts[localSource.id] ?? noDocs
        return SourceRow(glyph: "FS", name: localSource.label, aside: "this device · the files and pictures you open") {
            StatePill(text: "always on", tone: .ok)
        } facts: {
            Fact(label: "projects", value: String(count.projects))
            Fact(label: "trips", value: String(count.trips))
            Fact(label: "rolls", value: String(count.rolls))
            Fact(label: "media", value: "Files · Photos")
            Fact(label: "documents", value: "Application Support")
            Fact(label: "scheduling", value: "—")
        } note: {
            EmptyView()
        }
    }

    private func connectionRow(_ conn: WinnowConnection, reconnect: @escaping () -> Void) -> some View {
        let health = store.healthOf(conn.id)
        let caps = conn.capabilities
        let count = counts[conn.id] ?? noDocs
        let readAt = conn.refreshedAt ?? conn.connectedAt
        let now = nowMillis()
        let down = health.state == .unreachable || health.state == .signin
        let unrecognised = store.tokenUnrecognised(conn)
        let aside: String
        if let viewer = caps?.viewer {
            aside = "\(viewer.username ?? "?") · \(viewer.role ?? "?")"
        } else {
            aside = "read \(describeAgo(now - readAt))"
        }
        let held = count.projects + count.trips + count.rolls
        let api = caps?.api?.version.map { "v" + plainNumber($0) } ?? "—"
        let video = caps?.media?.videoProxy?.height.map { plainNumber($0) + "p" } ?? "—"
        let photo = caps?.media?.photoProxy?.size.map { plainNumber($0) + "px" } ?? "—"
        let reasonText: String? = health.reason.map { reason in
            held > 0
                ? reason + " " + describeDocs(count) + " came from it — the copies on this device still open, they just cannot save back."
                : reason
        }
        return SourceRow(glyph: String(conn.id.prefix(1)).uppercased(), remote: true, name: conn.id, aside: aside, dim: down) {
            HealthPill(health: health)
            if health.state == .signin || unrecognised {
                Button("Reconnect", action: reconnect)
                    .buttonStyle(SourceButtonStyle(kind: .solid))
            }
            Button(health.state == .reachable ? "Refresh" : "Retry") {
                Task { await store.check(conn.id) }
            }
            .buttonStyle(SourceButtonStyle(kind: .ghost))
            .disabled(health.state == .checking)
            .help("Ask \(conn.id) what it can do, and store the answer")
            Button("Forget") { forgetting = conn }
                .buttonStyle(SourceButtonStyle(kind: .danger))
        } facts: {
            if let caps {
                Fact(label: "api", value: api)
                Fact(label: "proxies", value: video + " / " + photo)
                Fact(label: "sidecars", value: caps.media?.sidecars == true ? "srt" : "—")
                Fact(label: "documents", value: documentsFact(caps))
                Fact(label: "here", value: describeDocs(count))
                Fact(label: "read", value: describeAgo(now - readAt))
            } else {
                Fact(label: "capabilities", value: "never read")
            }
        } note: {
            if let reasonText {
                Note(text: reasonText, tone: health.state == .signin ? .warn : .danger)
            }
            if unrecognised && health.state == .reachable {
                Note(text: "\(conn.id) answered without naming an account, so it may not know this token yet — what it keeps for an account (your documents, your media) will be refused until it does.",
                     tone: .warn)
            }
        }
        .contextMenu {
            Button("Refresh") { Task { await store.check(conn.id) } }
            Button("Reconnect…", action: reconnect)
            Button("Forget…", role: .destructive) { forgetting = conn }
        }
    }

    private func documentsFact(_ caps: WinnowCapabilities) -> String {
        guard let documents = caps.documents, documents.bucket else { return "—" }
        return (documents.kinds ?? ["on"]).joined(separator: " · ")
    }
}

/// `1080` rather than `1080.0` — how the web prints a number it was sent.
private func plainNumber(_ x: Double) -> String {
    x == x.rounded() && abs(x) < 1e15 ? String(Int64(x)) : String(x)
}

// MARK: - the row, every source drawn the same way

private struct SourceRow<Status: View, Facts: View, NoteContent: View>: View {
    let glyph: String
    var remote = false
    let name: String
    let aside: String?
    var dim = false
    @ViewBuilder var status: Status
    @ViewBuilder var facts: Facts
    @ViewBuilder var note: NoteContent

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    glyphView
                    title
                    Spacer(minLength: 8)
                    SourceFlow(spacing: 6, lineSpacing: 6) { status }
                }
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        glyphView
                        title
                    }
                    SourceFlow(spacing: 6, lineSpacing: 6) { status }
                }
            }
            SourceFlow(spacing: 16, lineSpacing: 4) { facts }
                .padding(.leading, 44)
                .opacity(dim ? 0.7 : 1)
            note
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: Brand.paperRadius)
                .fill(dim ? palette.paper.opacity(0.5) : palette.surface)
        )
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(palette.line, lineWidth: 1))
    }

    private var glyphView: some View {
        Text(glyph)
            .font(Brand.mono(11, weight: .bold))
            .foregroundStyle(remote ? palette.accentInk : palette.inkSoft)
            .frame(width: 32, height: 32)
            .background(RoundedRectangle(cornerRadius: 10).fill(remote ? palette.accentWash : palette.paper2))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(remote ? palette.danger.opacity(0.3) : palette.line))
            .accessibilityHidden(true)
    }

    private var title: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name)
                .font(Brand.mono(14, weight: .medium))
                .foregroundStyle(dim ? palette.muted : palette.ink)
                .textSelection(.enabled)
            if let aside {
                Text(aside)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
        }
    }
}

/// One fact, monospaced — the row's facts read as a data strip.
private struct Fact: View {
    let label: String
    let value: String
    @Environment(\.palette) private var palette

    var body: some View {
        (Text(label).foregroundStyle(palette.muted) + Text(" " + value).foregroundStyle(palette.inkSoft).fontWeight(.medium))
            .font(Brand.mono(11))
            .monospacedDigit()
    }
}

private enum Tone { case ok, warn, danger, neutral }

private func toneColor(_ tone: Tone, _ palette: Palette) -> Color {
    switch tone {
    case .ok: return palette.ok
    case .warn: return palette.warn
    case .danger: return palette.danger
    case .neutral: return palette.faint
    }
}

/// A dot and a few words, in the tone of the state.
private struct StatePill: View {
    let text: String
    let tone: Tone
    var pulsing = false
    @Environment(\.palette) private var palette

    var body: some View {
        let color = toneColor(tone, palette)
        HStack(spacing: 6) {
            if pulsing {
                Circle().fill(color).frame(width: 7, height: 7)
                    .phaseAnimator([1.0, 0.3]) { view, phase in view.opacity(phase) }
            } else {
                Circle().fill(color).frame(width: 7, height: 7)
            }
            Text(text)
                .font(Brand.mono(11))
                .kerning(0.4)
        }
        .foregroundStyle(tone == .neutral ? palette.inkSoft : color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Capsule().fill(tone == .neutral ? palette.surface : color.opacity(0.12)))
        .overlay(Capsule().strokeBorder(tone == .neutral ? palette.lineStrong : color.opacity(0.35), lineWidth: 1))
    }
}

/// The four shapes an instance can be in.
private struct HealthPill: View {
    let health: SourceHealth

    var body: some View {
        switch health.state {
        case .reachable:
            StatePill(text: health.latencyMs.map { "reachable · \(Int($0.rounded())) ms" } ?? "reachable", tone: .ok)
        case .signin:
            StatePill(text: "sign-in needed", tone: .warn)
        case .unreachable:
            StatePill(text: "unreachable", tone: .danger)
        case .checking:
            StatePill(text: "asking…", tone: .neutral, pulsing: true)
        }
    }
}

/// A sentence in a box of its tone — a reason, a warning.
private struct Note: View {
    let text: String
    let tone: Tone
    @Environment(\.palette) private var palette

    var body: some View {
        let color = toneColor(tone, palette)
        Text(text)
            .font(Brand.sans(12))
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(color.opacity(0.1)))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).strokeBorder(color.opacity(0.35), lineWidth: 1))
    }
}

/// The row's verbs: solid (the fix), ghost (ask again), danger (forget).
struct SourceButtonStyle: ButtonStyle {
    enum Kind { case solid, ghost, danger }
    let kind: Kind
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        return configuration.label
            .font(Brand.sans(12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .foregroundStyle(foreground(pressed))
            .background(Capsule().fill(background(pressed)))
            .overlay(Capsule().strokeBorder(border(pressed), lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Capsule())
    }

    private func foreground(_ pressed: Bool) -> Color {
        switch kind {
        case .solid: return palette.paper
        case .ghost: return pressed ? palette.accentInk : palette.ink
        case .danger: return palette.danger
        }
    }

    private func background(_ pressed: Bool) -> Color {
        switch kind {
        case .solid: return pressed ? palette.accent : palette.ink
        case .ghost: return .clear
        case .danger: return pressed ? palette.danger.opacity(0.12) : .clear
        }
    }

    private func border(_ pressed: Bool) -> Color {
        switch kind {
        case .solid: return pressed ? palette.accent : palette.ink
        case .ghost: return pressed ? palette.accent : palette.lineStrong
        case .danger: return palette.danger.opacity(0.45)
        }
    }
}

/// Children laid out left to right, wrapping onto a new line when the row is full.
private struct SourceFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let limit = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var line: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > limit {
                x = 0
                y += line + lineSpacing
                line = 0
            }
            widest = max(widest, x + size.width)
            x += size.width + spacing
            line = max(line, size.height)
        }
        return CGSize(width: min(widest, limit), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + lineSpacing
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

// MARK: - previews

#Preview("Connected") {
    NavigationStack {
        SourcesView(ledgerRoot: FileManager.default.temporaryDirectory)
    }
    .environment(ConnectionStore.preview(connections: [(host: "winnow.steeve.website", sheet: ConnectionStore.previewSheet)]))
}

#Preview("Unreachable") {
    NavigationStack {
        SourcesView(ledgerRoot: FileManager.default.temporaryDirectory)
    }
    .environment(ConnectionStore.preview(
        connections: [(host: "winnow.example", sheet: ConnectionStore.previewSheet)],
        transport: { _ in throw URLError(.notConnectedToInternet) }
    ))
}

#Preview("Nothing connected") {
    NavigationStack {
        SourcesView(ledgerRoot: FileManager.default.temporaryDirectory)
    }
    .environment(ConnectionStore.preview())
}
