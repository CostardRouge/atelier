// The roll's status line, over the filmstrip — the web's progress `<p>` in
// `RollEditor.tsx`: STATE, and the half of it that asks for a tap. How far
// the roll has got (`rollProgress`), how many leave, how many changed since
// they were delivered from THIS device (`export-marks.ts`), how many are
// ignored (with Hide / Show), how many wear a look, the batch selection
// (with Clear), what could not be reached — a picture of this device whose
// file is not open (reopen its folder), one kept on an instance the app is
// not connected to — and the editor's last word. The shortcuts are NOT here:
// they are behind `H` (`ShortcutsSheet`).

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

    private var reach: AvailabilitySummary {
        var availability: [String: PictureAvailability] = [:]
        for p in editor.pictures { availability[p.id] = editor.availability(p) }
        return summarizeAvailability(editor.pictures.map(\.id), availability)
    }

    private var changed: Int {
        editor.pictures.filter { !isIgnored($0) && exportState($0, editor.exportMarks) == .changed }.count
    }

    var body: some View {
        let progress = self.progress
        let reach = self.reach
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
                if withLook > 0 { part("\(withLook) with a look") }
                if selected > 0 {
                    part("\(selected) selected ", tone: palette.accentInk)
                    link("Clear") { editor.clearSelection() }
                }
                if reach.local > 0 {
                    part("\(reach.local) from this device, not open — ", tone: palette.inkSoft)
                    link("Add their folder again", accent: true, action: onReopenFolder)
                }
                if reach.unconnected > 0 {
                    part("\(reach.unconnected) on \(reach.unconnectedSourceId ?? "an instance"), not connected — Sources come with their own task",
                         tone: palette.inkSoft)
                }
                if let notice = editor.notice { part(notice, tone: palette.inkSoft) }
            }
            .font(Brand.mono(10))
            .monospacedDigit()
            .lineLimit(1)
        }
    }

    private func part(_ text: String, tone: Color? = nil) -> some View {
        HStack(spacing: 0) {
            Text(" · ").foregroundStyle(palette.faint)
            Text(text).foregroundStyle(tone ?? palette.faint)
        }
    }

    private func link(_ text: String, accent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .underline()
                .foregroundStyle(accent ? palette.accentInk : palette.faint)
        }
        .buttonStyle(.plain)
    }
}
