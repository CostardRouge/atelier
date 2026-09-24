// The crop, v0: an aspect, a straighten, a mirror — the parts of the web's
// classic crop that need no zone drawn on the stage. The document is the
// web's (`aspect` + a cover `Framing`), so a crop made here reads there.

import SwiftUI
import AtelierKit

struct CropPanel: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow("Aspect")
            Picker("Aspect", selection: Binding(get: { editor.picture?.aspect ?? "original" }, set: { editor.setAspect($0) })) {
                ForEach(AspectOption.all) { option in
                    Text(option.id == "original" ? "Original" : "\(option.id) · \(option.label)").tag(option.id)
                }
            }
            .labelsHidden()

            Eyebrow("Straighten")
                .padding(.top, 6)
            HStack {
                Slider(
                    value: Binding(get: { editor.framing.rotation }, set: { degrees in editor.setFraming { $0.rotation = wrapDegrees(degrees) } }),
                    in: -45...45,
                    step: 0.1
                )
                Text(String(format: "%+.1f°", editor.framing.rotation))
                    .font(Brand.mono(12))
                    .foregroundStyle(editor.framing.rotation == 0 ? palette.muted : palette.ink)
                    .frame(width: 56, alignment: .trailing)
            }

            Eyebrow("Mirror")
                .padding(.top, 6)
            HStack(spacing: 8) {
                Button {
                    editor.setFraming { $0 = flipFraming($0, axis: "x") }
                } label: {
                    Label("Left ↔ right", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                }
                Button {
                    editor.setFraming { $0 = flipFraming($0, axis: "y") }
                } label: {
                    Label("Top ↔ bottom", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down")
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            HStack {
                Spacer()
                Button("Reset crop") { editor.resetCrop() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(editor.picture?.framing == nil && (editor.picture?.aspect ?? "original") == "original")
            }
            .padding(.top, 6)

            if let size = editor.deliveredSize {
                Text("Delivers \(size.width) × \(size.height)")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
            }
        }
    }
}
