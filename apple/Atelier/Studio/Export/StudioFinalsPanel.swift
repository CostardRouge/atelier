// After an export whose media came from a Winnow: send the finals HOME — the
// web's `SendFinalsPanel.tsx` (`src/shared/sources/winnow/`), so the
// instance's lineage records that this capture has been told.
//
// Opt-in, one press, and it says exactly what will leave: the files, their
// weight, the host. It refuses BEFORE a byte moves when the plan is unsound
// (`finalsPlan`: a picture from another instance, a file over the upload
// limit) or the account is a viewer (`canWriteBack`) — failing at 90 % of a
// 400 MB upload is the worst way to learn any of that. Files go one request
// at a time (the body limit is per request), each with its own capture's id,
// then one reconcile links them; each upload is a task with its bytes and a
// Cancel on the pill. Only ever to an instance connected here, only what was
// just rendered. The web's words, "browser" read as "device".

import SwiftUI
import AtelierKit

struct StudioFinalsPanel: View {
    let model: StudioExportModel
    let target: StudioFinalsTarget
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let connection = ConnectionStore.shared.connection(target.sourceId) {
            let plan = finalsPlan(FinalsInput(
                files: model.delivered.map { FinalCandidate(name: $0.name, size: $0.bytes) },
                assetId: target.assetId,
                targetSourceId: target.sourceId,
                // Neither editor knows which chapter a media belongs to: the
                // asset row carries none. Finals land at the root, and
                // Winnow's own reconcile places them by lineage.
                chapterId: nil,
                maxUploadBytes: connection.capabilities?.limits?.maxUploadBytes
            ))
            box(plan, writable: canWriteBack(connection.capabilities))
        } else {
            Text("This media came from \(target.sourceId), which is not connected here any more — reconnect it to send the finals back.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func box(_ plan: FinalsPlan, writable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("back to \(target.sourceId)".uppercased())
                .font(Brand.mono(9))
                .kerning(1)
                .foregroundStyle(palette.muted)
            if writable {
                sendable(plan)
            } else {
                Text("Your account on \(target.sourceId) is a viewer; it cannot receive files. Sign in there as an editor and reconnect.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: Brand.paperRadius).fill(palette.surface))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Send to \(target.sourceId)")
    }

    @ViewBuilder
    private func sendable(_ plan: FinalsPlan) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(plan.items, id: \.path) { item in
                Text(verbatim: "\(item.path) · \(formatBytes(item.bytes))")
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        ForEach(plan.problems, id: \.self) { problem in
            Text(verbatim: problem)
                .font(Brand.sans(12))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(plan.notes, id: \.self) { note in
            Text(verbatim: note)
                .font(Brand.sans(12))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        if case .done(let sent) = model.sending {
            Text(verbatim: StudioFinalsPanel.doneSentence(sent, plan.originalAssetId, target.sourceId))
                .font(Brand.sans(12))
                .foregroundStyle(palette.ok)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            verb(plan)
        }
    }

    @ViewBuilder
    private func verb(_ plan: FinalsPlan) -> some View {
        let count = plan.items.count
        let busy: Int? = {
            if case .sending(let index) = model.sending { return index }
            return nil
        }()
        let label = busy.map { "Sending \($0 + 1)/\(count)…" }
            ?? "Send \(count) file\(count == 1 ? "" : "s") to \(target.sourceId) · \(formatBytes(plan.totalBytes))"
        Button {
            model.sendFinals(plan, to: target)
        } label: {
            Label(label, systemImage: "arrow.up.circle")
        }
        .buttonStyle(DevelopPillButtonStyle())
        .disabled(busy != nil || !plan.problems.isEmpty)
        .help("Upload the finals into this Winnow's finals root and link them to their captures")
        if case .failed(let message, let login, let sent) = model.sending {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: (sent > 0 ? "\(sent) sent, then: " : "") + message)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
                if let login, let url = URL(string: login) {
                    Button("Sign in there") { openURL(url) }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
    }

    /// `✓ 2 files sent and linked to capture #412 on winnow.example.`
    static func doneSentence(_ sent: Int, _ capture: Int?, _ host: String) -> String {
        let files = "\(sent) file\(sent == 1 ? "" : "s")"
        let linked = capture.map { " to capture #\($0)" } ?? ""
        return "✓ \(files) sent and linked\(linked) on \(host)."
    }
}
