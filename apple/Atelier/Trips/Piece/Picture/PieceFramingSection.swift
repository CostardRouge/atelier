// Where the SELECTED picture sits inside its frame — the Framing rows of the
// web's `src/tools/roadtrip/panels/PictureTab.tsx` (`roadtrip.md`, «A picture
// is reframed inside its frame»): Fill or Whole, the zoom, the rotation, the
// quarter turns, the two flips and Reset.
//
// Rules kept:
// - the rows show the framing AS SHOWN — the card in hand of a move — and
//   write through the model's ONE writer (`placeFraming`), so a row and a
//   gesture on the stage can never disagree about which card they write;
// - a new fit starts centred at its own scale 1: a zoom and a pan chosen to
//   crop mean something else once the bars are allowed;
// - a flip mirrors what the FRAME shows at any rotation, the rest AND every
//   frame of the move (`flipPicture`);
// - Reset puts the picture back where it started INSIDE the fit chosen —
//   asking for the whole picture is not a crop to undo;
// - a picture with a linked Studio project says a reel is framed there.

import SwiftUI
import AtelierKit

struct PieceFramingSection: View {
    let model: PieceEditorModel
    /// "Cell 2" when the inspector is about a later cell of a collage.
    let badge: String?

    private var framing: Framing { model.shownFraming(model.cellFraming, model.cellMotion, own: true) }

    private var info: [String] {
        var out = [
            "Where the picture sits inside the frame. Drag it on the stage to move it, pinch (or the wheel, or a trackpad pinch) to zoom; the badge keeps first claim on a press, so grab the picture where no text is.",
            "Fill covers the frame and crops what does not fit: it can never be zoomed out past covering or dragged off an edge. Whole shows all of the picture with black bars where it falls short of the frame; drag it to slide it along its bars.",
            "The flips mirror what the frame shows, whatever the picture’s rotation.",
        ]
        if model.post?.projectId != nil {
            out.append("A reel exported from the linked Studio project is framed there, over that project's own footage — this reframes the PNG deck and the hook clip.")
        }
        return out
    }

    private static let fits: [OverlayPanelOption<Fit>] = [
        OverlayPanelOption(.cover, "Fill"),
        OverlayPanelOption(.contain, "Whole"),
    ]

    var body: some View {
        let f = framing
        DevelopSection(id: "piece.framing", title: "Framing", badge: badge, info: info, remember: .local,
                       actions: { resetAction(f) }) {
            fitRow(f)
            DevelopRangeSlider("Zoom", value: f.scale, in: 1...maxFramingScale, step: 0.01, reset: 1,
                               printed: String(format: "%.2f×", f.scale)) { scale in
                var next = f
                next.scale = scale
                place(next)
            }
            DevelopRangeSlider("Rotation", value: f.rotation, in: -180...180, step: 0.5, reset: 0,
                               printed: "\(Int(DevelopNumbers.jsRound(f.rotation)))°") { rotation in
                var next = f
                next.rotation = rotation
                place(next)
            }
            turnRow(f)
            flipRow
        }
    }

    /// The picture departs from where its fit starts — pan, zoom, turn or flip.
    private static func departs(_ f: Framing) -> Bool {
        var asCover = f
        asCover.fit = .cover
        return !isDefaultFraming(asCover)
    }

    @ViewBuilder
    private func resetAction(_ f: Framing) -> some View {
        if PieceFramingSection.departs(f) {
            Button("Reset") {
                var next = Framing.default
                next.fit = f.fit
                place(next)
            }
            .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    private func fitRow(_ f: Framing) -> some View {
        OverlayPanelRow("Fit") {
            Picker("Fit", selection: Binding(get: { f.fit }, set: { fit in
                guard fit != f.fit else { return }
                var next = f
                next.fit = fit
                next.scale = 1
                next.x = 0
                next.y = 0
                place(next)
            })) {
                ForEach(Self.fits) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .help(f.fit == .cover ? "Cover the frame; the excess is cropped"
                  : "Show the whole picture, with black bars where it falls short")
        }
    }

    private func turnRow(_ f: Framing) -> some View {
        OverlayPanelRow("Turn") {
            Button("−90°") {
                var next = f
                next.rotation = wrapDegrees(f.rotation - 90)
                place(next)
            }
            .buttonStyle(DevelopPillButtonStyle())
            .help("Turn a quarter anticlockwise")
            Button("+90°") {
                var next = f
                next.rotation = wrapDegrees(f.rotation + 90)
                place(next)
            }
            .buttonStyle(DevelopPillButtonStyle())
            .help("Turn a quarter clockwise")
            Button("Straight") {
                var next = f
                next.rotation = 0
                place(next)
            }
            .buttonStyle(DevelopLinkButtonStyle())
            .disabled(f.rotation == 0)
        }
    }

    private var flipRow: some View {
        OverlayPanelRow("Flip") {
            Button {
                model.flipPicture(model.cellIndex, axis: "x")
            } label: {
                Label("Horizontal", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
            }
            .buttonStyle(DevelopPillButtonStyle())
            .help("Mirror the picture left to right")
            Button {
                model.flipPicture(model.cellIndex, axis: "y")
            } label: {
                Label("Vertical", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down")
            }
            .buttonStyle(DevelopPillButtonStyle())
            .help("Mirror the picture top to bottom")
        }
    }

    private func place(_ next: Framing) {
        model.placeFraming(model.cellIndex, next)
    }
}

#Preview("Framing") {
    DevelopPreviewState(0) { _ in
        PieceFramingSection(model: PieceEditorFixtures.model(), badge: nil)
    }
}
