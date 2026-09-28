// The roll's status line, over the filmstrip — the web's progress `<p>` in
// `RollEditor.tsx`: STATE, and the half of it that asks for a tap. How far
// the roll has got (`rollProgress`), how many leave, how many changed since
// they were delivered from THIS device (`export-marks.ts`), how many are
// ignored (with Hide / Show), Winnow's culling and the strip's filter on it
// (read-only — culling stays Winnow's), how many wear a look, the batch
// selection (with Clear), and what could not be reached: pictures being
// fetched from their instance, what it answered badly (with Sign in and Try
// again), what it no longer has, what is kept on an instance this device is
// not connected to (with the way to Sources), a picture of this device whose
// file is not open (reopen its folder) — then the editor's last word. The
// shortcuts are NOT here: they are behind `H` (`ShortcutsSheet`).

import SwiftUI
import AtelierKit

struct ProgressLine: View {
    @Bindable var editor: RollEditor
    /// Reopen a folder — the web's one-click "Reopen …".
    let onReopenFolder: () -> Void
    @Environment(\.palette) private var palette

    private var progress: (total: Int, developed: Int, ignored: Int) {
        editor.roll.map(rollProgress) ?? (total: 0, developed: 0, ignored: 0)
    }

    private var availability: [String: PictureAvailability] {
        var out: [String: PictureAvailability] = [:]
        for p in editor.pictures { out[p.id] = editor.availability(p) }
        return out
    }

    private var changed: Int {
        editor.pictures.filter { !isIgnored($0) && exportState($0, editor.exportMarks) == .changed }.count
    }

    var body: some View {
        let progress = self.progress
        let availability = self.availability
        let ids = editor.pictures.map(\.id)
        let reach = summarizeAvailability(ids, availability)
        let leaving = editor.pictures.filter(delivers).count
        let withLook = editor.pictures.filter { $0.grade != nil }.count
        let selected = editor.visibleSelected.count
        let changed = self.changed
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                Text("\(progress.developed) of \(progress.total) developed").foregroundStyle(palette.muted)
                if leaving > 0 { part("\(leaving) to export") }
                if changed > 0 { part("\(changed) changed since exported") }
                if progress.ignored > 0 {
                    part("\(progress.ignored) ignored ")
                    link(editor.showIgnored ? "Hide" : "Show") { editor.setShowIgnored(!editor.showIgnored) }
                        .help(editor.showIgnored ? "Leave the ignored pictures out of the strip" : "Show the ignored pictures in the strip, dimmed")
                }
                if editor.winnow.cullReachable { RollCullLine(editor: editor) }
                if withLook > 0 { part("\(withLook) with a look") }
                if selected > 0 {
                    part("\(selected) selected ", tone: palette.accentInk)
                    link("Clear") { editor.clearSelection() }
                }
                reachParts(reach, ids: ids, availability: availability)
                if let notice = editor.notice { part(notice, tone: palette.inkSoft) }
            }
            .font(Brand.mono(10))
            .monospacedDigit()
            .lineLimit(1)
        }
    }

    /// What could not be reached, each with the gesture that answers it.
    @ViewBuilder
    private func reachParts(_ reach: AvailabilitySummary, ids: [String],
                            availability: [String: PictureAvailability]) -> some View {
        if reach.fetching > 0 {
            part("fetching \(reach.fetching) from \(fetchingHost(ids, availability))", tone: palette.inkSoft)
        }
        if reach.failed > 0 {
            part("\(reach.failed) could not be fetched — \(reach.problem ?? "") ", tone: palette.danger)
            if let login = reach.loginUrl, let url = URL(string: login) {
                Link(destination: url) { Text("Sign in").underline().foregroundStyle(palette.danger) }
                Text(" ")
            }
            link("Try again", tone: palette.danger) { editor.retryFailed() }
        }
        if reach.gone > 0 {
            part("\(reach.gone) no longer on \(reach.sourceId ?? "its instance")", tone: palette.danger)
        }
        if reach.unconnected > 0 {
            part("\(reach.unconnected) on \(reach.unconnectedSourceId ?? "an instance"), not connected — ", tone: palette.inkSoft)
            link("Sources", accent: true) { editor.winnow.toSources() }
        }
        if reach.local > 0 {
            part("\(reach.local) from this device, not open — ", tone: palette.inkSoft)
            link("Add their folder again", accent: true, action: onReopenFolder)
        }
    }

    private func part(_ text: String, tone: Color? = nil) -> some View {
        HStack(spacing: 0) {
            Text(" · ").foregroundStyle(palette.faint)
            Text(text).foregroundStyle(tone ?? palette.faint)
        }
    }

    private func link(_ text: String, accent: Bool = false, tone: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .underline()
                .foregroundStyle(tone ?? (accent ? palette.accentInk : palette.faint))
        }
        .buttonStyle(.plain)
    }
}

/// Winnow's word on the roll, in the status line — the web's `CullLine`: how
/// many picks and rejects it answered, the strip's filter on them, and a
/// Refresh. Read-only: the filter shows and hides, it never writes to Winnow
/// (item 33 of `docs/lightroom-gaps.md`).
struct RollCullLine: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    private var said: String {
        let counts = editor.cullCounts
        var parts: [String] = []
        if counts.picks > 0 { parts.append("\(counts.picks) pick\(counts.picks == 1 ? "" : "s")") }
        if counts.rejects > 0 { parts.append("\(counts.rejects) rejected") }
        if counts.starred > 0 { parts.append("\(counts.starred) starred") }
        if !parts.isEmpty { return parts.joined(separator: ", ") }
        return editor.winnow.cullAsking && counts.known == 0 ? "asking…" : "nothing culled"
    }

    private var shown: Int? {
        guard editor.cullFiltering else { return nil }
        return editor.pictures.filter { !isIgnored($0) && editor.shownByCull($0) }.count
    }

    var body: some View {
        let filter = editor.winnow.cullFilter
        HStack(spacing: 0) {
            Text(" · ").foregroundStyle(palette.faint)
            Text("Winnow ").foregroundStyle(palette.faint)
            if let problem = editor.winnow.cullProblem {
                Text(problem).foregroundStyle(palette.danger)
            } else {
                Text(said).foregroundStyle(palette.faint)
            }
            Text(" ")
            Menu {
                ForEach(Array(cullFilters.enumerated()), id: \.offset) { _, option in
                    Button {
                        editor.winnow.cullFilter = option
                    } label: {
                        if option == filter {
                            Label(menuLabel(option), systemImage: "checkmark")
                        } else {
                            Text(menuLabel(option))
                        }
                    }
                }
            } label: {
                Text(menuLabel(filter))
                    .underline(pattern: .dot)
                    .foregroundStyle(filter == .all ? palette.muted : palette.accentInk)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Show in the strip, by Winnow's culling — read-only: culling stays Winnow's")
            .accessibilityLabel("Show in the strip, by Winnow's culling")
            if let shown { Text(" (\(shown) shown)").foregroundStyle(palette.faint) }
            Text(" ")
            Button {
                Task { await editor.askCulling(maxAge: 0) }
            } label: {
                Text(editor.winnow.cullAsking ? "asking…" : "Refresh")
                    .underline(!editor.winnow.cullAsking)
                    .foregroundStyle(palette.faint)
            }
            .buttonStyle(.plain)
            .disabled(editor.winnow.cullAsking)
            .help("Ask Winnow again — it is asked by itself when you come back to the app")
        }
    }

    private func menuLabel(_ f: CullFilter) -> String {
        f == .all ? "show all" : "show \(cullFilterLabel(f).lowercased())"
    }
}
