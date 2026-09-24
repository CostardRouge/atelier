// The develop's sliders — the eleven numbers of `DevelopSettings`, in the order
// every panel of the suite draws them — and the two Auto verbs, written
// through to the roll on every tick.

import SwiftUI
import AtelierKit

struct DevelopPanel: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    private let light: [DevelopKey] = [.exposure, .brightness, .contrast, .highlights, .shadows, .whites, .blacks]
    private let colour: [DevelopKey] = [.temperature, .tint, .saturation, .vibrance]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow("Light")
            ForEach(light, id: \.self) { key in
                DevelopSliderRow(key: key, editor: editor)
            }
            Eyebrow("Colour")
                .padding(.top, 6)
            ForEach(colour, id: \.self) { key in
                DevelopSliderRow(key: key, editor: editor)
            }
            Eyebrow("Auto")
                .padding(.top, 6)
            HStack(spacing: 8) {
                Button("Tone") { editor.applyAutoTone() }
                Button("Colour") { editor.applyAutoColour() }
                Spacer()
                Button("Reset") { editor.resetDevelop() }
                    .disabled(editor.picture?.develop == nil)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Text(describeDevelop(editor.picture?.develop))
                .font(Brand.mono(11))
                .foregroundStyle(palette.muted)
                .padding(.top, 4)
        }
    }
}

struct DevelopSliderRow: View {
    let key: DevelopKey
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        let range = DevelopRange.of(key)
        let value = editor.value(key)
        VStack(spacing: 2) {
            HStack {
                Text(key.label)
                    .font(.subheadline)
                    .foregroundStyle(palette.inkSoft)
                Spacer()
                Text(valueText(value, range))
                    .font(Brand.mono(12))
                    .foregroundStyle(value == 0 ? palette.muted : palette.ink)
            }
            Slider(
                value: Binding(get: { editor.value(key) }, set: { editor.set(key, $0) }),
                in: range.min...range.max,
                step: range.step
            )
            .tint(value == 0 ? palette.faint : palette.accent)
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { editor.set(key, 0) }
        .accessibilityLabel(key.label)
    }

    private func valueText(_ value: Double, _ range: DevelopRange) -> String {
        if key == .exposure {
            return "\(String(format: "%+.2f", value)) \(range.unit)"
        }
        return signed(value)
    }
}
