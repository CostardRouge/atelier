// The roll's WATERMARK — the web's Watermark section of `ExportPanel.tsx`
// (`develop-output.md`): the STYLE is the roll's, whether it is drawn is each
// target's (the copy that goes online signed, the archive left clean). The
// line is a template over what the files are already signed with —
// `{creator}`, `{year}` (the year the picture was TAKEN), `{title}` — and a
// line that names its author before a name is set is not drawn at all.
//
// The line is typed into a draft and written when the field is left or on
// Return — one undo step, not one per keystroke — while *Reads* follows the
// draft as it is typed.

import SwiftUI
import AtelierKit

struct ExportWatermarkSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette
    @State private var draft = ""
    @FocusState private var typing: Bool

    static let info = [
        "A line of text drawn on the file, in a corner or along the bottom edge. The style is the roll’s; each target above says whether it carries it, so the copy that goes online can be signed and the one kept for the archive left clean.",
        "The line is a template: {creator} is the name set under Metadata, {year} the year the picture was TAKEN, {title} the picture’s own. A line that names its author before a name is set is not drawn. Its size is a share of the file’s short side, so a 1080 px copy and the full picture carry the same mark, and it is drawn after the screen sharpening.",
    ]

    static let positions: [(position: WatermarkPosition, label: String)] = [
        (.bottomRight, "Bottom right"),
        (.bottomLeft, "Bottom left"),
        (.bottom, "Bottom, centred"),
        (.topRight, "Top right"),
        (.topLeft, "Top left"),
    ]

    var body: some View {
        let mark = editor.watermarkStyle
        DevelopSection(id: "watermark", title: "Watermark", info: ExportWatermarkSection.info) {
            ExportRow("Line") {
                TextField(Watermark.default.text, text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(13))
                    .focused($typing)
                    .onSubmit { commit() }
                    .accessibilityLabel("Watermark line")
            }
            ExportRow("Reads") {
                reads
            }
            ExportRow("Where") {
                Picker("Watermark position", selection: Binding(get: { mark.position }, set: { position in
                    var next = editor.watermarkStyle
                    next.position = position
                    editor.setWatermark(next)
                })) {
                    ForEach(WatermarkPosition.allCases, id: \.self) { position in
                        Text(ExportWatermarkSection.label(position)).tag(position)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .fixedSize()
            }
            DevelopRangeSlider("Size", value: mark.size, in: WatermarkLimits.size.min...WatermarkLimits.size.max, step: 0.5,
                               reset: Watermark.default.size, printed: String(format: "%.1f %%", mark.size)) { size in
                var next = editor.watermarkStyle
                next.size = size
                editor.setWatermark(next)
            }
            DevelopRangeSlider("Opacity", value: mark.opacity, in: WatermarkLimits.opacity.min...WatermarkLimits.opacity.max,
                               step: 0.05, reset: Watermark.default.opacity,
                               printed: "\(Int((mark.opacity * 100).rounded())) %") { opacity in
                var next = editor.watermarkStyle
                next.opacity = opacity
                editor.setWatermark(next)
            }
            ExportRow("Tone") {
                Picker("Watermark tone", selection: Binding(get: { mark.tone }, set: { tone in
                    var next = editor.watermarkStyle
                    next.tone = tone
                    editor.setWatermark(next)
                })) {
                    Text("Light").tag(WatermarkTone.light)
                    Text("Dark").tag(WatermarkTone.dark)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }
            ExportRow("Drawn on") {
                drawnOn
            }
        }
        .onAppear { draft = mark.text }
        .onChange(of: mark.text) { _, stored in
            // An undo, or another device, moves the stored line: follow it while idle.
            if !typing { draft = stored }
        }
        .onChange(of: typing) { _, now in
            editor.textEditing = now
            if !now { commit() }
        }
    }

    /// The line on the picture in hand, as the run will draw it.
    @ViewBuilder
    private var reads: some View {
        let creator = editor.deliveryIdentity.creator
        let line = resolveWatermarkText(draft, creator: creator, year: editor.openCaptureYear, title: editor.picture?.title)
        if line.isEmpty {
            let waiting = draft.contains("{creator}") && creator.trimmingCharacters(in: .whitespaces).isEmpty
            Text(waiting ? "nothing yet — set a creator under Metadata" : "nothing — the line is empty")
                .font(Brand.mono(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(line)
                .font(Brand.mono(12))
                .foregroundStyle(palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var drawnOn: some View {
        let targets = editor.exportSettings.targets
        var marked: [String] = []
        for (i, t) in targets.enumerated() where t.watermark {
            marked.append(i == 0 ? "the chosen folder" : "\(targetFolder(t.name, index: i))/")
        }
        let text = marked.isEmpty ? "no target yet — switch it on under a target above" : marked.joined(separator: " · ")
        return Text(text)
            .font(Brand.mono(11))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func commit() {
        var next = editor.watermarkStyle
        let text = String(draft.prefix(120))
        guard text != next.text else { return }
        next.text = text
        editor.setWatermark(next)
    }

    static func label(_ position: WatermarkPosition) -> String {
        positions.first { $0.position == position }?.label ?? position.rawValue
    }
}

#Preview("Watermark") {
    ScrollView {
        ExportWatermarkSection(editor: ExportPreview.editor())
            .padding(14)
    }
    .frame(width: 360, height: 600)
    .darkroom()
}
