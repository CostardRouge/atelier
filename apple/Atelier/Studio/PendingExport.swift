// The Studio's Export tab — ONE PLACEHOLDER, replaced whole by the export
// task, which builds the web's Output · Variants · Export sections
// (`StudioEditor.tsx`) over the native pipeline (`Video/VideoExport.swift`'s
// `exportProcessedVideo` with a processor that grades and burns in, the
// outro as its tail, `variantOutputSize` / `variantFileName` from the
// kernel). Until it lands, the tab says so, and shows — read-only — the
// matrix the project already holds, with the names each file would take, so
// nothing here pretends to export.
//
// What the export task reads from the editor (`StudioEditor`):
//   edit.variants · edit.exportFileName · edit.outro · edit.elements (and
//   `stageElements` for a still) · edit.theme · edit.timeShift · edit.scenes ·
//   edit.film · stageCube (the look + the media's develop, one cube) ·
//   cues · range / `exportTrim(range, playback.duration)` · active /
//   activeVideo / activeImage and `library.url(for:)` · clipWidth / clipHeight
//   / photoSize · clipFps · realtimeRate / `deliveredSpeedChoices` ·
//   playback.pause() before a run; and it writes the matrix through
//   `update { $0.variants = … }`.

import SwiftUI
import AtelierKit

struct StudioExportPanel: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette

    var body: some View {
        DevelopSection(id: "studio.export.pending", title: "Export", foldable: false) {
            Text("Rendering the variants — MP4s for a clip, JPEGs for a still, overlays burnt in and the outro appended — arrives with the native export. The web app delivers them today.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        DevelopSection(id: "studio.export.matrix", title: "Variants", badge: "\(editor.edit.variants.count)",
                       remember: .local) {
            ForEach(Array(editor.edit.variants.enumerated()), id: \.element.id) { index, variant in
                VStack(alignment: .leading, spacing: 4) {
                    Text("Variant \(index + 1)")
                        .font(Brand.sans(13, weight: .medium))
                        .foregroundStyle(palette.ink)
                    Text(describe(variant))
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.muted)
                    Text(fileName(variant))
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.faint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(palette.line).frame(width: 2) }
            }
        }
    }

    private func describe(_ variant: ExportVariant) -> String {
        var parts = [variant.aspectId == "source" ? "Source frame" : variant.aspectId]
        switch variant.resolution {
        case .source: parts.append("Source")
        case .shortSide(let px): parts.append("\(Int(px.rounded()))p")
        }
        if !editor.isPhoto {
            parts.append(describeFrameRate(variant.frameRate))
            if let speed = describeSpeed(variant.speed) { parts.append(speed) }
        }
        parts.append(variant.overlays ? "overlays" : "clean")
        return parts.joined(separator: " · ")
    }

    private func fileName(_ variant: ExportVariant) -> String {
        let custom = editor.edit.exportFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = custom.isEmpty ? (editor.active?.baseName ?? "export") : custom
        return variantFileName(base, variant, editor.isPhoto ? .photo : .video)
    }
}
