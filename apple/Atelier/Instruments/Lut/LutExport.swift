// LUT Studio's export — the web's results list and bottom bar
// (`LutStudio.tsx`): every clip that entered the run with its state
// (Queued · 42% · Exported · Failed and why), then `Exporting 2/5` with the
// run's bar and a Cancel while it runs, or the tally and `Export 5 MP4s`
// when it does not. The folder is asked for AT THE CLICK, before a frame is
// rendered — the web's rule for any picker.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct LutExportResults: View {
    let model: LutStudioModel
    @Environment(\.palette) private var palette

    var body: some View {
        if !model.reports.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(model.reports) { report in
                        row(report)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .frame(maxHeight: 176)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
            .accessibilityLabel("Export results")
        }
    }

    private func row(_ report: LutStudioModel.ClipReport) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Image(systemName: symbol(report.status))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tint(report.status))
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(report.name)
                    .font(Brand.sans(12, weight: .medium))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Text(state(report))
                    .font(Brand.mono(12))
                    .monospacedDigit()
                    .foregroundStyle(palette.muted)
            }
            if report.status == .error, let error = report.error {
                Text(error)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .padding(.leading, 24)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func symbol(_ status: LutStudioModel.ExportStatus) -> String {
        switch status {
        case .done: return "checkmark"
        case .error: return "xmark"
        case .exporting: return "ellipsis"
        case .queued: return "circle.fill"
        }
    }

    private func tint(_ status: LutStudioModel.ExportStatus) -> Color {
        switch status {
        case .done: return palette.ok
        case .error: return palette.danger
        default: return palette.muted
        }
    }

    private func state(_ report: LutStudioModel.ClipReport) -> String {
        switch report.status {
        case .queued: return "Queued"
        case .exporting: return report.ratio.map { "\(Int(($0 * 100).rounded()))%" } ?? "Exporting…"
        case .done: return "Exported"
        case .error: return "Failed"
        }
    }
}

struct LutExportBar: View {
    let model: LutStudioModel
    /// The clips on the shelf — the export set.
    let clipCount: Int
    /// A photo is on the shelf too: said, since the run leaves it out.
    let hasPhoto: Bool
    let onExport: (URL) -> Void
    @State private var pickingFolder = false
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Hairline()
            HStack(spacing: 14) {
                if model.exporting {
                    let done = model.doneCount
                    Text("Exporting \(min(done + 1, model.batchTotal))/\(model.batchTotal)")
                        .font(Brand.mono(12))
                        .monospacedDigit()
                        .foregroundStyle(palette.inkSoft)
                    ProgressView(value: model.overallRatio)
                        .tint(palette.accent)
                    Button("Cancel") { model.cancelExport() }
                        .buttonStyle(.plain)
                        .font(Brand.sans(14, weight: .semibold))
                        .foregroundStyle(palette.accentInk)
                        .underline()
                        .keyboardShortcut(.cancelAction)
                } else {
                    tally
                    Spacer(minLength: 0)
                    Button {
                        pickingFolder = true
                    } label: {
                        Text("Export \(clipCount == 0 ? "" : "\(clipCount) ")MP4\(clipCount == 1 ? "" : "s")")
                            .font(Brand.sans(14, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .tint(palette.ink)
                    .disabled(clipCount == 0)
                    .help("Render graded copies of the clips (H.264 MP4) into a folder you pick")
                }
            }
            if hasPhoto, !model.exporting {
                Text("Photos are previewed here; a graded photograph is delivered from Develop.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
        }
        .fileImporter(isPresented: $pickingFolder, allowedContentTypes: [.folder]) { result in
            if case .success(let folder) = result { onExport(folder) }
        }
    }

    @ViewBuilder
    private var tally: some View {
        let done = model.doneCount
        let failed = model.errorCount
        if let note = model.note {
            Text(note)
                .font(Brand.sans(12))
                .foregroundStyle(palette.inkSoft)
        } else if done > 0 || failed > 0 {
            HStack(spacing: 4) {
                if done > 0 {
                    Text("\(done) exported").foregroundStyle(palette.ok)
                }
                if done > 0 && failed > 0 {
                    Text("·").foregroundStyle(palette.inkSoft)
                }
                if failed > 0 {
                    Text("\(failed) failed").foregroundStyle(palette.danger)
                }
            }
            .font(Brand.sans(12, weight: .semibold))
        }
    }
}

#Preview("Export bar") {
    VStack {
        LutExportResults(model: LutStudioModel())
        LutExportBar(model: LutStudioModel(), clipCount: 3, hasPhoto: true) { _ in }
    }
    .padding()
}
