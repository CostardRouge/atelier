// One camera-plate LAYOUT drawn with the picture's REAL facts — the web's
// `LayoutTile` in `panels/CameraPanel.tsx`: through the very elements the
// badge makes (`plateTileElements`, the kernel's) and the very renderer the
// stage and the export paint with (`OverlayPainter`), so a layout is seen
// before it is adopted and never in made-up numbers. Where the picture
// records none of the facts ticked, the tile says so.
//
// Also here: the plate's 3 × 3 cell grid (the web's Place row), which marks
// the cell the badge itself is anchored in.

import SwiftUI
import AtelierKit

struct CameraPlateTile: View {
    let option: PlateLayoutOption
    let facts: CameraFacts
    let fields: [CameraField]
    let words: CameraWords
    let theme: StyleTheme?
    let pressed: Bool
    let onPick: () -> Void
    /// One painter per tile: it keeps grain masks across redraws.
    @State private var painter = OverlayPainter()
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: onPick) {
            VStack(alignment: .leading, spacing: 4) {
                picture
                Text(verbatim: option.label)
                    .font(Brand.sans(11, weight: .medium))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .padding(.horizontal, 2)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 9).fill(palette.paper))
            .overlay(frameStroke)
            .contentShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .help(option.hint)
        .accessibilityLabel(option.label)
        .accessibilityHint(option.hint)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }

    private var frameStroke: some View {
        RoundedRectangle(cornerRadius: 9)
            .stroke(pressed ? palette.accent : palette.lineStrong, lineWidth: pressed ? 2 : 1)
    }

    /// The layout on a stand-in for a picture — centred and as large as the
    /// tile holds: a tile shows the layout's type, the stage shows where it goes.
    private var picture: some View {
        let elements = plateTileElements(facts, fields, words, option.id)
        let painter = self.painter
        let theme = self.theme
        return ZStack {
            LinearGradient(colors: [palette.line, palette.frame], startPoint: .top, endPoint: .bottom)
            if elements.isEmpty {
                // The reason, not a blank: nothing ticked is recorded by this picture.
                Text(verbatim: plateTileNothing)
                    .font(Brand.mono(10, weight: .medium))
                    .foregroundStyle(palette.onMedia.opacity(0.55))
            } else {
                Canvas(opaque: false, rendersAsynchronously: false) { context, size in
                    context.withCGContext { cg in
                        painter.drawOverlays(in: cg, size: size, elements: elements, cue: nil, time: 0, theme: theme)
                    }
                }
            }
        }
        .aspectRatio(plateTileAspect, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .accessibilityHidden(true)
    }
}

/// Where the plate sits when it is not under the badge: one cell of the
/// frame's 3 × 3 grid. The cell the badge is anchored in is shaded, so a
/// plate put there reads as overlapping before the hint says it.
struct CameraCellGrid: View {
    let selection: PlatePlace
    let badgeAnchor: OverlayAnchor
    let onPick: (OverlayAnchor) -> Void
    @Environment(\.palette) private var palette

    private static let rows: [[OverlayAnchor]] = [
        [.topLeft, .topCenter, .topRight],
        [.centerLeft, .center, .centerRight],
        [.bottomLeft, .bottomCenter, .bottomRight],
    ]

    var body: some View {
        Grid(horizontalSpacing: 4, verticalSpacing: 4) {
            ForEach(0..<3, id: \.self) { r in
                GridRow {
                    ForEach(CameraCellGrid.rows[r], id: \.self) { anchor in
                        cell(anchor)
                    }
                }
            }
        }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Camera cell")
    }

    private func cell(_ anchor: OverlayAnchor) -> some View {
        let on = selection == .cell(anchor)
        let badge = anchor == badgeAnchor
        let fill = on ? palette.accent : (badge ? palette.paper2 : palette.paper)
        let words = anchor.rawValue.replacingOccurrences(of: "-", with: " ")
        return Button {
            onPick(anchor)
        } label: {
            RoundedRectangle(cornerRadius: 5)
                .fill(fill)
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
                .frame(width: 26, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(badge ? "The badge’s own cell" : words)
        .accessibilityLabel("Camera in the \(words) cell")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

#Preview("Plate tiles") {
    let facts = cameraFacts(ExifData(make: "SONY", model: "ILCE-7CM2", lensModel: "FE 24-70mm F2.8 GM II", iso: 200,
                                     exposureTime: 1.0 / 500, fNumber: 4, focalLength: 35, focalLength35: 35,
                                     exposureBias: -0.3))
    let fields: [CameraField] = [.body, .lens, .focal35, .aperture, .shutter, .iso, .ev]
    VStack(alignment: .leading, spacing: 12) {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
            ForEach(plateLayouts, id: \.id) { option in
                CameraPlateTile(option: option, facts: facts, fields: fields, words: defaultCameraWords, theme: nil,
                                pressed: option.id == .tiers, onPick: {})
            }
        }
        CameraCellGrid(selection: .cell(.bottomRight), badgeAnchor: .bottomLeft, onPick: { _ in })
    }
    .frame(width: 320)
    .padding(16)
    .darkroom()
}
