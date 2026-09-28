// The row of CARDS — the web's `src/tools/roadtrip/panels/MotionCards.tsx`
// (`roadtrip.md`, «Built as cards», `docs/picture-motion-ui.md` §6.3): one
// thumbnail per frame the view rests on, the glide's seconds on the arrow
// between two, a hold at a card's foot, the picked card ringed.
//
// Rules kept:
// - a tap picks a card — the stage then shows it and a gesture there writes
//   it (`PieceEditorModel.selectCard`);
// - every card is drawn through `drawFramed`, the transform every other
//   surface draws a framing with, from ONE picture decoded within a small
//   budget — the frame as it will really leave, only small and UNGRADED;
// - another file's picture is never drawn under this one's cards while the
//   new one decodes: the row stays dark for that moment rather than wrong;
// - a still picture is one card, the composition, with a dashed Start ghost
//   before it that gives it a move;
// - the picked card is brought into view when the row is wider than the panel.

import SwiftUI
import AtelierKit

struct PieceMotionCardsRow: View {
    /// The frames the view rests on, in order, the composition last (`readCards`).
    let cards: [Framing]
    /// Where the view arrives on each, in the slide's seconds.
    let arrivals: [Double]
    /// How long it holds on each, as read back.
    let holdSeconds: Double
    /// The card the stage shows; nil between two cards.
    let selected: Int?
    /// The picture the cards are drawn from; nil until it is decoded.
    let picture: PaintPicture?
    /// The frame's width over its height — a cell's, for a collage.
    let aspect: Double
    let onSelect: (Int) -> Void
    /// Give a still picture a Start: the ghost card before its composition.
    let onStart: () -> Void

    @Environment(\.palette) private var palette

    /// A card's height on screen; its width follows the frame's shape.
    static let cardHeight: CGFloat = 84

    private var cardWidth: CGFloat {
        let a = aspect > 0 && aspect.isFinite ? aspect : 9.0 / 16
        return CGFloat(DevelopNumbers.jsRound(min(132, max(40, Double(PieceMotionCardsRow.cardHeight) * a))))
    }

    var body: some View {
        let still = cards.count <= 1
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 0) {
                    if still {
                        ghost
                        arrow(nil)
                    }
                    ForEach(Array(cards.enumerated()), id: \.offset) { i, framing in
                        if i > 0 { arrow(glide(i)) }
                        card(i, framing, still: still)
                            .id(i)
                    }
                }
                // Room for the picked card's ring on every side: a row that
                // scrolls clips whatever leaves it.
                .padding(4)
            }
            .onChange(of: selected) { _, next in
                guard let next else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(next) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("The frames the picture rests on, in order")
    }

    // MARK: - a card

    private func card(_ i: Int, _ framing: Framing, still: Bool) -> some View {
        let on = i == selected
        let label = cardLabel(i, cards.count)
        let hold = !still && holdSeconds > 0 && i < cards.count - 1 ? "hold \(Self.seconds(holdSeconds))" : ""
        let shape = RoundedRectangle(cornerRadius: 6)
        return Button {
            onSelect(i)
        } label: {
            VStack(spacing: 4) {
                PieceCardThumbnail(picture: picture, framing: framing)
                    .frame(width: cardWidth, height: PieceMotionCardsRow.cardHeight)
                    .clipShape(shape)
                    .overlay(shape.stroke(on ? palette.accent : palette.lineStrong, lineWidth: on ? 2 : 1))
                Text(label.uppercased())
                    .font(Brand.mono(9))
                    .kerning(0.5)
                    .foregroundStyle(on ? palette.accentInk : palette.muted)
                    .lineLimit(1)
                Text(hold)
                    .font(Brand.mono(9))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
                    .frame(height: 11)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(label) — the stage shows it, a drag or a pinch writes it")
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// The dashed Start before a still picture's one card.
    private var ghost: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        return Button(action: onStart) {
            VStack(spacing: 4) {
                shape
                    .stroke(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .frame(width: cardWidth, height: PieceMotionCardsRow.cardHeight)
                    .overlay(Image(systemName: "plus").font(.system(size: 18, weight: .regular)))
                Text("START")
                    .font(Brand.mono(9))
                    .kerning(0.5)
            }
            .foregroundStyle(palette.muted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Give the picture a start a touch closer, and a move to its composition")
        .accessibilityLabel("Start")
    }

    /// The arrow between two cards, with the glide's seconds under it.
    private func arrow(_ label: String?) -> some View {
        VStack(spacing: 2) {
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
            Text(label ?? "")
                .font(Brand.mono(9))
                .monospacedDigit()
                .fixedSize()
        }
        .foregroundStyle(palette.muted)
        .frame(width: 32)
        .padding(.top, PieceMotionCardsRow.cardHeight / 2 - 8)
        .accessibilityHidden(true)
    }

    /// The seconds the glide into card `i` takes — its arrival less the last
    /// one's, less the pause.
    private func glide(_ i: Int) -> String {
        let at = arrivals.indices.contains(i) ? arrivals[i] : 0
        let before = arrivals.indices.contains(i - 1) ? arrivals[i - 1] : 0
        return Self.seconds(max(0, at - before - (holdSeconds > 0 ? holdSeconds : 0)))
    }

    /// `1.2 s`.
    static func seconds(_ v: Double) -> String {
        String(format: "%.1f s", max(0, v))
    }
}

/// One card: the frame's black, and the picture drawn into it under `framing`
/// through the one transform every surface draws a framing with.
struct PieceCardThumbnail: View {
    let picture: PaintPicture?
    let framing: Framing
    @Environment(\.palette) private var palette

    var body: some View {
        let ground = palette.frame
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(ground))
            guard let picture, picture.width > 0, picture.height > 0 else { return }
            ctx.withCGContext { cg in
                CellPainter.drawFramed(in: cg, size: size, picture, framing)
            }
        }
        .accessibilityHidden(true)
    }
}

#Preview("Cards") {
    let rest = Framing(scale: 1.4, x: 0.05)
    let start = Framing(scale: 1.15)
    return DevelopPreviewState(Optional(0)) { selected in
        PieceMotionCardsRow(cards: [start, Framing(scale: 1.3, x: -0.1), rest], arrivals: [0, 1.4, 2.9],
                            holdSeconds: 0.4, selected: selected.wrappedValue, picture: nil, aspect: 4.0 / 5,
                            onSelect: { selected.wrappedValue = $0 }, onStart: {})
        PieceMotionCardsRow(cards: [rest], arrivals: [], holdSeconds: 0, selected: 0, picture: nil, aspect: 9.0 / 16,
                            onSelect: { _ in }, onStart: {})
    }
}
