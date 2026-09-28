// One LOOK in the gallery's grid — the web's `Tile` (`LutGalleryModal.tsx`):
// the whole tile is the pick (or the aim, where a scene answers), and the ★
// in its corner is the ONE thing on it that is not — two buttons side by
// side, never a button inside a button, so the star is reachable from a
// keyboard and from VoiceOver. The star is drawn at every width, never on
// hover: a phone has none.

import SwiftUI
import AtelierKit

struct LookTileView: View {
    let name: String
    /// The picture the tile shows — a shipped tile, or one baked here.
    let image: CGImage?
    /// Its lattice could not be read: said, never a blank square.
    var failed = false
    /// The look the picture wears now.
    let selected: Bool
    /// The look the scene is showing (the worn one where there is no scene).
    let aimed: Bool
    var favourite = false
    /// A phone's tiles are taller: the grid is what the screen is for.
    var compact = false
    let onPick: () -> Void
    /// Nil for "No look (original)", which is the absence of a look, not one.
    var onToggleFavourite: (() -> Void)?

    @Environment(\.palette) private var palette

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Button(action: onPick) {
                VStack(alignment: .leading, spacing: 4) {
                    tile
                        .frame(height: compact ? 92 : 74)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(name)
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.inkSoft)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(name)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .help(name)
            if let onToggleFavourite {
                Button(action: onToggleFavourite) {
                    Text(favourite ? "★" : "☆")
                        .font(.system(size: 13))
                        .foregroundStyle(favourite ? palette.accentInk : palette.onMedia)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(favourite ? palette.accentWash : palette.frame.opacity(0.35)))
                        .opacity(favourite ? 1 : 0.8)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(6)
                .accessibilityLabel(favourite ? "Remove \(name) from favourites" : "Add \(name) to favourites")
                .accessibilityAddTraits(favourite ? .isSelected : [])
                .help(favourite ? "In your favourites" : "Add to favourites")
            }
        }
        .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.controlRadius)
                .stroke(aimed || selected ? palette.accent : palette.line, lineWidth: aimed ? 2 : 1)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Brand.controlRadius + 3)
                .stroke(palette.accent.opacity(aimed ? 0.35 : 0), lineWidth: 3)
                .padding(-3)
        )
    }

    @ViewBuilder
    private var tile: some View {
        if let image {
            Image(decorative: image, scale: 1, orientation: .up)
                .resizable()
                .interpolation(.medium)
                .scaledToFill()
        } else if failed {
            ZStack {
                palette.paper2
                Text("failed")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.danger)
            }
        } else {
            ZStack {
                palette.paper2
                ProgressView().controlSize(.small)
            }
        }
    }
}

#Preview("Tiles") {
    HStack(spacing: 8) {
        LookTileView(name: "No look (original)", image: LookFixtures.chart, selected: true, aimed: false, onPick: {})
        LookTileView(name: "Warm", image: LookFixtures.warmChart, selected: false, aimed: true, favourite: true,
                     onPick: {}, onToggleFavourite: {})
        LookTileView(name: "AUTHENTIC · One Click", image: nil, failed: true, selected: false, aimed: false,
                     onPick: {}, onToggleFavourite: {})
    }
    .frame(width: 340)
    .padding()
}
