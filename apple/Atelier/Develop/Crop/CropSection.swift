// The Crop fold of the Crop tab — port of `src/tools/develop/CropPanel.tsx`.
// The zone itself is drawn on the stage (`CropStageOverlay`); here are its
// FORMAT (Free, the picture's own, the suite's named aspects — choosing one
// keeps the zone's centre and takes the largest zone of that shape that fits
// there), its shape and the portrait ↔ landscape swap, the fine straighten,
// Level, the quarter turns and the flips. Every verb is the editor's
// (`RollEditor+Crop.swift`), so the stage and this panel cannot disagree
// about what "the zone" is.
//
// What D8 had and this has not (the web's own note): Zoom (the zone's size IS
// the zoom), the Shape slider (a handle is the shape) and Fit — Whole was a
// way to see the whole picture, which the stage now always shows; the bars it
// made are the Borders' job.

import SwiftUI
import AtelierKit

struct CropSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    /// Free, Original, then the named aspects from the tallest to the widest.
    struct Format: Identifiable {
        let id: String
        let label: String
        let title: String
    }

    static let formats: [Format] = {
        let named = aspectPresets.sorted { $0.w / $0.h < $1.w / $1.h }.map { Format(id: $0.id, label: $0.id, title: $0.label) }
        return [
            Format(id: "free", label: "Free", title: "Any shape — draw it on the picture, or drag the handles"),
            Format(id: "original", label: "Original", title: "The picture’s own shape, as shot"),
        ] + named
    }()

    var body: some View {
        let touched = editor.cropTouched
        let fine = splitRotation(editor.cropFraming.rotation).fine
        DevelopSection(id: "crop", title: "Crop", info: CropSection.info, marked: touched, actions: {
            if touched {
                Button("Reset") { editor.cropReset() }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }) {
            VStack(alignment: .leading, spacing: 10) {
                row("Format") { formatGrid }
                row("Shape") { shape }
                DevelopRangeSlider("Straighten", value: fine, in: -45...45, step: 0.1,
                                   printed: String(format: "%.1f°", fine)) { editor.cropStraighten($0) }
                row("Level") {
                    Button(editor.cropLevelling ? "Draw the line…" : "Level") {
                        editor.cropSetLevelling(!editor.cropLevelling)
                    }
                    .buttonStyle(DevelopPillButtonStyle(on: editor.cropLevelling))
                    .help("Draw a line along the horizon, or along something that should stand upright")
                    .accessibilityAddTraits(editor.cropLevelling ? .isSelected : [])
                    if fine != 0 {
                        Button("Straight") { editor.cropStraighten(0) }
                            .buttonStyle(DevelopLinkButtonStyle())
                    }
                }
                row("Turn") {
                    Button("−90°") { editor.cropQuarterTurn(-1) }
                        .buttonStyle(DevelopPillButtonStyle())
                        .help("Turn a quarter anticlockwise")
                    Button("+90°") { editor.cropQuarterTurn(1) }
                        .buttonStyle(DevelopPillButtonStyle())
                        .help("Turn a quarter clockwise")
                }
                row("Flip") {
                    Button { editor.cropFlip("x") } label: {
                        Label("Horizontal", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .help("Mirror the picture left to right")
                    Button { editor.cropFlip("y") } label: {
                        Label("Vertical", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down")
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .help("Mirror the picture top to bottom")
                }
            }
            // The zone is measured on the decoded picture: nothing to hold yet.
            .disabled(editor.cropSrc == nil)
        }
    }

    // MARK: - rows

    private func row<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .frame(width: 70, alignment: .leading)
            HStack(spacing: 8) { content() }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var formatGrid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
        let lit = editor.cropChip
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(CropSection.formats) { format in
                Button {
                    editor.cropSetChip(format.id)
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
                .accessibilityLabel(format.title)
                .accessibilityAddTraits(lit == format.id ? .isSelected : [])
            }
        }
        .sensoryFeedback(DevelopHaptics.snap, trigger: lit)
    }

    private var shape: some View {
        HStack(spacing: 8) {
            Group {
                if let zone = editor.cropZone {
                    Text(describeAspect(zone.w / zone.h))
                        + Text(editor.cropLock == nil ? " · free" : "").foregroundStyle(palette.faint)
                } else {
                    Text("—")
                }
            }
            .font(Brand.mono(12))
            .monospacedDigit()
            .foregroundStyle(palette.inkSoft)
            Button {
                editor.cropSwap()
            } label: {
                Image(systemName: "rectangle.portrait.rotate")
                    .frame(width: 26, height: 26)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.inkSoft)
            .help("Swap portrait and landscape (X)")
            .accessibilityLabel("Swap portrait and landscape")
        }
    }

    // MARK: - the standing prose

    static var info: [String] {
        #if os(macOS)
        let gestures = "The whole picture stays on the stage; what the crop cuts away is darkened. Drag inside the zone to move it, on the picture to draw a new one, a handle to move that edge or corner — the opposite one stays put. Double-click for the largest zone of the format; the arrow keys nudge it once the stage has been touched (Shift for ten)."
        let free = "Free is any shape, Shift holding the one you have — and where a picture nobody has cropped yet opens, so the first drag needs no click first. A named format holds its shape from the opposite corner; X or the turn button swaps portrait and landscape."
        #else
        let gestures = "The whole picture stays on the stage; what the crop cuts away is darkened. Drag inside the zone to move it, on the picture to draw a new one, a handle to move that edge or corner — the opposite one stays put. Double-tap for the largest zone of the format; with a keyboard, the arrow keys nudge it once the stage has been touched (Shift for ten)."
        let free = "Free is any shape — and where a picture nobody has cropped yet opens, so the first drag needs no tap first. A named format holds its shape from the opposite corner; X or the turn button swaps portrait and landscape."
        #endif
        return [
            gestures,
            free,
            "Straighten turns the picture under the zone, which shrinks just enough to keep clear of the corners — and grows back to what you drew when you straighten back. Level: draw a line along the horizon (or an upright) and the angle is corrected by it. The quarter turns take the zone with the picture.",
            "The flips mirror what the frame shows, whatever the picture’s rotation.",
        ]
    }
}

#Preview("Crop") {
    DevelopPreviewState(true) { _ in
        CropSectionPreview()
    }
}

private struct CropSectionPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        return CropSection(editor: editor)
    }
}
