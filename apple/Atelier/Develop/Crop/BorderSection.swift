// Borders — a subsection under Crop in the same tab (the maintainer's call:
// the tab keeps the name Crop). Port of `src/tools/develop/BorderSection.tsx`
// over the kernel's `BorderLayout.swift` (`RollBorder`, `borderSwatches`,
// `borderMarginMax`). Off, the file is exactly the crop. On: the FILE's format
// (Free is the crop plus its margins), the fill (four swatches, any colour, or
// the picture itself blurred) and the two margins, linked by default. Every
// change is written to the roll at once, like the aspect; turning it back on
// restores the last border this picture wore in this visit — off and on is a
// comparison, not a reset.

import CoreGraphics
import SwiftUI
import AtelierKit

struct BorderSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    /// Free, then the named aspects from the tallest to the widest.
    static let fileFormats: [CropSection.Format] = {
        let named = aspectPresets.sorted { $0.w / $0.h < $1.w / $1.h }
            .map { CropSection.Format(id: $0.id, label: $0.id, title: $0.label) }
        return [CropSection.Format(id: "free", label: "Free", title: "The crop and its margins, whatever shape that makes")] + named
    }()

    var body: some View {
        let border = editor.picture?.border
        VStack(alignment: .leading, spacing: 0) {
            DeliveredPreview(editor: editor)
            DevelopSection(id: "border", title: "Borders", info: BorderSection.info, marked: border != nil,
                           defaultOpen: false, actions: {
                Toggle("Borders", isOn: Binding(get: { editor.picture?.border != nil },
                                                set: { editor.setBorderOn($0) }))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .tint(palette.accent)
            }) {
                if let b = border {
                    rows(b)
                } else {
                    Text("Off — the file is exactly the crop.")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                }
            }
            CropApplyFold.border(editor)
        }
    }

    // MARK: - the rows

    private func rows(_ b: RollBorder) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            field("File") { fileGrid(b) }
            field("Fill") { fills(b) }
            DevelopRangeSlider("Left · right", value: b.margin.x, in: 0...borderMarginMax, step: 0.005,
                               reset: RollBorder.default.margin.x, printed: percent(b.margin.x)) { marginTo(b, x: $0) }
            HStack(alignment: .bottom, spacing: 6) {
                DevelopRangeSlider("Top · bottom", value: b.margin.y, in: 0...borderMarginMax, step: 0.005,
                                   reset: RollBorder.default.margin.y, printed: percent(b.margin.y)) { marginTo(b, y: $0) }
                linkButton(b)
            }
        }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .frame(width: 70, alignment: .leading)
            HStack(spacing: 8) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func fileGrid(_ b: RollBorder) -> some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
        let lit = b.aspect ?? "free"
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(BorderSection.fileFormats) { format in
                Button {
                    set(b) { $0.aspect = format.id == "free" ? nil : format.id }
                } label: {
                    Text(format.label)
                        .font(Brand.mono(11))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 26)
                        .foregroundStyle(lit == format.id ? palette.accentInk : palette.inkSoft)
                        .background(lit == format.id ? palette.accentWash : palette.paper,
                                    in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7)
                            .stroke(lit == format.id ? palette.accent : palette.lineStrong, lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(format.title)
                .accessibilityLabel("File format: \(format.title)")
                .accessibilityAddTraits(lit == format.id ? .isSelected : [])
            }
        }
    }

    private func fills(_ b: RollBorder) -> some View {
        let custom = b.fill != borderBlurFill && !borderSwatches.contains { $0.fill == b.fill }
        return HStack(spacing: 6) {
            ForEach(borderSwatches, id: \.id) { swatch in
                Button {
                    set(b) { $0.fill = swatch.fill }
                } label: {
                    Circle()
                        .fill(Color(cgColor: CSSColor.parse(swatch.fill) ?? CSSColor.black))
                        .frame(width: 26, height: 26)
                        .overlay(Circle().stroke(b.fill == swatch.fill ? palette.ink : palette.lineStrong, lineWidth: 1))
                        .padding(2)
                        .overlay(Circle().stroke(b.fill == swatch.fill ? palette.accent : .clear, lineWidth: 2))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .help(swatch.label)
                .accessibilityLabel("Fill: \(swatch.label)")
                .accessibilityAddTraits(b.fill == swatch.fill ? .isSelected : [])
            }
            ColorPicker("Fill: any colour", selection: Binding(
                get: { CSSColor.parse(b.fill == borderBlurFill ? "#000000" : b.fill) ?? CSSColor.black },
                set: { colour in set(b) { $0.fill = hexOf(colour) } }
            ), supportsOpacity: false)
            .labelsHidden()
            .padding(2)
            .overlay(Circle().stroke(custom ? palette.accent : .clear, lineWidth: 2))
            .help("Any colour")
            Button {
                set(b) { $0.fill = borderBlurFill }
            } label: {
                Text("Blur")
                    .font(Brand.mono(10))
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .foregroundStyle(b.isBlur ? palette.ink : palette.inkSoft)
                    .overlay(Capsule().stroke(b.isBlur ? palette.accent : palette.lineStrong, lineWidth: b.isBlur ? 2 : 1))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .help("The picture itself, softened and slightly darkened — made here, nothing is fetched")
            .accessibilityAddTraits(b.isBlur ? .isSelected : [])
        }
    }

    private func linkButton(_ b: RollBorder) -> some View {
        let linked = editor.borderMarginsLinked
        return Button {
            editor.setBorderMarginsLinked(!linked)
            // Linking puts the second margin on the first.
            if !linked && b.margin.y != b.margin.x {
                set(b) { $0.margin = RollBorder.Margin(x: b.margin.x, y: b.margin.x) }
            }
        } label: {
            Image(systemName: "link")
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(linked ? palette.accentInk : palette.muted)
        .help(linked ? "The same margin everywhere — click to set them apart" : "Set the same margin everywhere")
        .accessibilityLabel(linked ? "Margins linked" : "Margins apart")
        .accessibilityAddTraits(linked ? .isSelected : [])
        .padding(.bottom, 2)
    }

    // MARK: - writing

    private func set(_ b: RollBorder, _ change: (inout RollBorder) -> Void) {
        var next = b
        change(&next)
        editor.borderBinding.wrappedValue = next
    }

    private func marginTo(_ b: RollBorder, x: Double) {
        let linked = editor.borderMarginsLinked
        set(b) { $0.margin = RollBorder.Margin(x: x, y: linked ? x : b.margin.y) }
    }

    private func marginTo(_ b: RollBorder, y: Double) {
        let linked = editor.borderMarginsLinked
        set(b) { $0.margin = RollBorder.Margin(x: linked ? y : b.margin.x, y: y) }
    }

    /// `5%` — JavaScript's `Math.round`.
    private func percent(_ v: Double) -> String {
        "\(Int(DevelopNumbers.jsRound(v * 100)))%"
    }

    /// `#rrggbb`, lower case, in sRGB.
    private func hexOf(_ colour: CGColor) -> String {
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)
        let converted = srgb.flatMap { colour.converted(to: $0, intent: .defaultIntent, options: nil) } ?? colour
        let parts = converted.components ?? [0, 0, 0]
        let r = parts.count >= 3 ? parts[0] : (parts.first ?? 0)
        let g = parts.count >= 3 ? parts[1] : (parts.first ?? 0)
        let bl = parts.count >= 3 ? parts[2] : (parts.first ?? 0)
        func byte(_ v: CGFloat) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(bl))
    }

    // MARK: - the standing prose

    static let info = [
        "A canvas round the crop: bars to reach a format (a landscape picture on a 4:5 post), or margins like a print’s. Off, the file is exactly the crop.",
        "The margins are a share of the crop’s short side, so they look the same whatever size the file is written at. Blur fills the canvas with the picture itself, softened and slightly darkened — made here, nothing is fetched.",
    ]
}

#Preview("Borders") {
    DevelopPreviewState(true) { _ in
        BorderSectionPreview()
    }
}

private struct BorderSectionPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        return BorderSection(editor: editor)
    }
}
