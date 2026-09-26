// The ± pill of the stage — `− 100% +`, drawn at EVERY width, phone included:
// a pinch can be taken away, the pill always answers (`frontend.md`, «Where
// a pinch is best-effort, the pill is not optional»). What depends on the
// zoom hangs off the percentage — a label of FIXED width, so nothing is ever
// inserted in the bar and a second press of `+` lands on `+`
// (`develop-roll.md`, «The stage bar: four controls, and nothing inserted»):
// Fit, 100 % (one of the picture's pixels per pixel of this screen, the
// landmark), Smooth / Pixels as pixels (how a magnified pixel is drawn), and
// Crop to this view (⇧C, the crop task's).

import SwiftUI
import AtelierKit

struct StageZoomPill: View {
    @Bindable var zoom: LookingZoom
    /// Make what the zoomed view shows the crop — nil where it would change nothing.
    var cropToView: (() -> Void)?
    var large = false
    @Environment(\.palette) private var palette

    var body: some View {
        let height: CGFloat = large ? 34 : 28
        HStack(spacing: 0) {
            Button {
                zoom.zoomOut()
            } label: {
                Image(systemName: "minus").frame(width: height, height: height)
            }
            .disabled(!zoom.zoomed)
            .accessibilityLabel("Zoom out")
            Menu {
                Button { zoom.fit() } label: { row(!zoom.zoomed, "Fit", "the whole picture, in the room it has") }
                    .disabled(!zoom.zoomed)
                Button { zoom.zoom(to: zoom.onePixel) } label: {
                    row(abs(zoom.view.scale - zoom.onePixel) < 0.005, "100 %", "one of the picture’s pixels per pixel of this screen")
                }
                Divider()
                Button { zoom.setPixelView(.smooth) } label: {
                    row(zoom.pixelView == .smooth, "Smooth", "past 100 %, the gradients between pixels are the system’s, not the picture’s")
                }
                Button { zoom.setPixelView(.pixels) } label: {
                    row(zoom.pixelView == .pixels, "Pixels as pixels", "past 100 %, nothing is invented between them")
                }
                Divider()
                Button { cropToView?() } label: { row(false, "Crop to this view", "what the screen shows becomes the crop · ⇧C") }
                    .disabled(cropToView == nil)
            } label: {
                Text(zoom.label)
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .frame(width: 52, height: height)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("wheel, pinch, or Z")
            Button {
                zoom.zoomIn()
            } label: {
                Image(systemName: "plus").frame(width: height, height: height)
            }
            .disabled(zoom.view.scale >= zoom.ceiling - 1e-6)
            .accessibilityLabel("Zoom in")
        }
        .buttonStyle(.plain)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.inkSoft)
        .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    private func row(_ marked: Bool, _ title: String, _ hint: String) -> some View {
        VStack(alignment: .leading) {
            Text(marked ? "· \(title)" : title)
            Text(hint).font(Brand.sans(12))
        }
    }
}
