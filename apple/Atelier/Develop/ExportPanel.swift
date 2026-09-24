// Delivering the open picture: the format, the cap and the quality are the
// ROLL's (`RollExport`, as on the web); the panel says what will really leave
// before a byte moves.

import SwiftUI
import AtelierKit

struct ExportPanel: View {
    @Bindable var editor: RollEditor
    let onExport: () -> Void
    let onSaveToPhotos: () -> Void
    let busy: Bool
    @Environment(\.palette) private var palette

    private let edges: [(label: String, size: ExportSize?)] = [
        ("Source size", nil),
        ("1080 px", ExportSize(mode: .long, value: 1080)),
        ("2048 px", ExportSize(mode: .long, value: 2048)),
        ("4096 px", ExportSize(mode: .long, value: 4096)),
    ]

    var body: some View {
        let export = editor.roll?.export ?? .default
        let target = export.primary
        // A size the web set in another mode (a short edge, megapixels) is
        // offered as itself, so the picker never shows nothing.
        let offered = edges.contains { $0.size == target.size } ? edges : edges + [(describeSize(target.size), target.size)]
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow("Format")
            Picker("Format", selection: $editor.exportFormat) {
                ForEach(ExportFormat.allCases) { format in
                    Text(format.title).tag(format)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Eyebrow("Long edge")
                .padding(.top, 6)
            Picker("Long edge", selection: Binding(get: { target.size }, set: { size in editor.setExport { $0.primary.size = size } })) {
                ForEach(offered, id: \.label) { edge in
                    Text(edge.label).tag(edge.size)
                }
            }
            .labelsHidden()

            Eyebrow("Quality")
                .padding(.top, 6)
            HStack {
                Slider(
                    value: Binding(get: { target.quality }, set: { q in editor.setExport { $0.primary.quality = q } }),
                    in: qualityLimits.min...qualityLimits.max,
                    step: 0.01
                )
                Text("\(Int((target.quality * 100).rounded())) %")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.ink)
                    .frame(width: 48, alignment: .trailing)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Delivers \(editor.exportFileName)")
                if let size = editor.deliveredSize {
                    Text("\(size.width) × \(size.height) · \(describeDevelop(editor.picture?.develop))")
                }
                if export.targets.count > 1 {
                    Text("The roll has \(export.targets.count) targets; this app writes the first. The others are kept for the web app.")
                }
                if !editor.unrenderedStages.isEmpty {
                    Text("Not rendered here yet: \(editor.unrenderedStages.joined(separator: ", ")). The web app delivers them.")
                        .foregroundStyle(palette.warn)
                }
            }
            .font(Brand.mono(11))
            .foregroundStyle(palette.muted)
            .padding(.top, 6)

            HStack(spacing: 8) {
                Button {
                    onExport()
                } label: {
                    Label("Export…", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.borderedProminent)
                Button {
                    onSaveToPhotos()
                } label: {
                    Label("Save to Photos", systemImage: "photo.badge.plus")
                }
                .buttonStyle(.bordered)
                if busy {
                    ProgressView().controlSize(.small)
                }
            }
            .disabled(busy || editor.picture == nil)
            .padding(.top, 6)
        }
    }
}
