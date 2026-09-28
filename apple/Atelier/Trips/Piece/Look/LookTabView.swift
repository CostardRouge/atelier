// The piece editor's LOOK tab — port of `src/tools/roadtrip/panels/LookTab.tsx`:
// how the badge LOOKS. The opener first (it decides what the hook IS), the
// trip's title style, this piece's departure from it, the one cascaded
// entrance, where the block sits and how long the hook holds, and the shades
// that lift the text off a bright sky.
//
// Rules kept (`roadtrip.md`):
// - Two scopes, deliberately. The TRIP owns the title style — a badge that
//   varies per post stops being the signature that makes a post
//   recognisable in a feed — while one piece of one post may depart from
//   that theme where a particular picture needs it. The preset cards keep
//   their own preview: a style you cannot see before adopting is adopted by
//   trial. The engine-level panel is the Studio's own (`StylePanelView`).
// - The trip's WORDS live in its settings sheet (⚙ Trip): copy for every
//   piece of the journey, not a property of the one on the stage.
// - The badge exists only on the hook, and so does everything here but the
//   title style: a caption and the closing card keep a fixed look, and SAY so.
// - Every write goes through the model's one funnel (`patchBadge`,
//   `changeTrip`), so a slider dragged is one undo step.
// - The cascade is ONE entrance for the whole badge, spread over the pieces by
//   where they sit (`Overlay/Stagger.swift`) — no delay typed per piece, so
//   its step shows no Delay row; a piece's EXIT stays its own.
// - Picking an anchor MOVES the block to that anchor's default position
//   (`badgeLayoutAnchored`); the drag on the picture is the fine tool.

import SwiftUI
import AtelierKit

struct LookTabView: View {
    let model: PieceEditorModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if model.isHook {
                DevelopSection(id: "piece.opener", title: "Opener", info: LookTabView.openerInfo, remember: .local) {
                    OpenerPickerView(model: model)
                }
            }
            LookTitleStyleSection(model: model)
            if model.isHook {
                LookDepartureSection(model: model)
                LookCascadeSection(model: model)
                LookPlacementSection(model: model)
                LookShadesSection(model: model)
            } else {
                DevelopSection(id: "piece.slide-look", title: "This slide", foldable: false, remember: .local) {
                    OverlayPanelNote("A caption and the closing card keep a fixed look; per-piece styling, placement and shades belong to the badge on the hook.")
                }
            }
        }
    }

    static let openerInfo = [
        "What draws the first slide. The badge is the plain one — the counter and the place over the picture. Another variant may bring its own drawing, its own animation and its own sound, and says so on its card.",
    ]
}

// MARK: - the title style (the trip's)

private struct LookTitleStyleSection: View {
    let model: PieceEditorModel

    var body: some View {
        DevelopSection(id: "piece.title-style", title: "Title style", badge: "Trip", info: [
            "The whole trip wears this — it is what makes a piece recognisable in a feed before a word of it is read. Each card shows the style itself rather than its name, so a look is chosen by seeing it.",
        ], remember: .local) {
            StylePanelView(theme: theme, heading: nil)
            OverlayPanelRow("Words") {
                Button("The trip’s words and closing card…") {
                    model.tripSheet = "words"
                }
                .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    /// The trip's theme, written trip-wide — nil is Off.
    private var theme: Binding<StyleTheme?> {
        Binding(get: { model.trip?.theme }, set: { next in
            model.changeTrip { $0.theme = next }
        })
    }
}

// MARK: - this piece's departures

private struct LookDepartureSection: View {
    let model: PieceEditorModel

    var body: some View {
        let piece = model.piece
        let style = model.post?.badge.pieceStyles[piece] ?? BadgePieceStyle()
        let departs = pieceStyleDeparts(style)
        DevelopSection(id: "piece.departs", title: "This piece", info: [
            "Colour, panel, casing and animation for the piece in hand only. A piece departs from the theme by writing its own value; everything left alone follows the trip.",
        ], marked: departs, remember: .local, actions: {
            if departs {
                Button("Back to the trip’s") { write(BadgePieceStyle(), for: piece) }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }) {
            PieceStyleRows(style: style) { next in write(next, for: piece) }
        }
    }

    /// One piece's style written — the web's `{ ...pieceStyles, [piece]: style }`.
    private func write(_ style: BadgePieceStyle, for piece: BadgePiece) {
        model.patchBadge { $0.pieceStyles[piece] = style }
    }
}

// MARK: - the cascade

private struct LookCascadeSection: View {
    let model: PieceEditorModel
    private typealias P = OverlayPanels

    var body: some View {
        let cascade = model.post?.badge.cascade
        DevelopSection(id: "piece.cascade", title: "Cascade", badge: cascade != nil ? "on" : nil, info: [
            "One entrance shared by every piece of the badge, the pieces arriving one rank after another in the order chosen — top to bottom, the numeral first, shuffled… The delays follow from where the pieces sit, so nothing is typed per piece and nothing goes stale when the badge changes.",
            "While it is on it replaces each piece’s own entrance; an exit a piece has stays its own. A still is taken once the last piece has landed.",
        ], remember: .local) {
            OverlayPanelRow("Cascade") {
                OverlayPanelToggle("Cascade the pieces", isOn: cascade != nil) { on in
                    model.patchBadge { $0.cascade = on ? defaultCascade() : nil }
                }
            }
            if let cascade {
                rows(cascade)
            }
        }
    }

    @ViewBuilder
    private func rows(_ cascade: BadgeCascade) -> some View {
        let each = cascade.stagger.each
        PieceStepRows(which: .entrance, step: cascade.step, hideDelay: true) { step in
            write { cascadeWithStep($0, step) }
        }
        OverlayPanelPicker("Order", selection: cascade.stagger.order, options: LookCascadeSection.orders) { order in
            write { current in
                var next = current
                next.stagger = P.sceneStaggerOrdered(current.stagger, order)
                return next
            }
        }
        DevelopRangeSlider("Each", value: each, in: 0...0.6, step: 0.01, reset: defaultCascade().stagger.each,
                           printed: "\(P.fixed(each, 2)) s") { v in
            write { current in
                var next = current
                next.stagger.each = v
                return next
            }
        }
        .accessibilityHint("Seconds between two ranks")
        if cascade.stagger.order == .random {
            OverlayPanelRow("Shuffle") {
                Button("Shuffle again") {
                    write { current in
                        var next = current
                        next.stagger.seed = newStaggerSeed()
                        return next
                    }
                }
                .buttonStyle(DevelopPillButtonStyle())
            }
        }
    }

    /// The cascade rewritten, while there is one.
    private func write(_ change: (BadgeCascade) -> BadgeCascade) {
        model.patchBadge { badge in
            guard let current = badge.cascade else { return }
            badge.cascade = change(current)
        }
    }

    /// `Centre out — From the middle of the frame outwards`.
    private static let orders: [OverlayPanelOption<StaggerOrder>] = staggerOrders.map {
        OverlayPanelOption($0.id, OverlayPanels.staggerOrderLabel($0))
    }
}

// MARK: - the placement

private struct LookPlacementSection: View {
    let model: PieceEditorModel
    private typealias P = OverlayPanels

    var body: some View {
        let layout = model.post?.badge.layout ?? defaultBadgeLayout
        let duration = model.post?.badge.durationSeconds ?? defaultBadgeDuration
        DevelopSection(id: "piece.placement", title: "Placement", info: [LookPlacementSection.info],
                       remember: .local) {
            OverlayPanelRow("Anchor", alignTop: true) {
                OverlayAnchorGrid(selection: layout.anchor) { anchor in
                    model.patchBadge { $0.layout = badgeLayoutAnchored($0.layout, anchor) }
                }
            }
            DevelopRangeSlider("Numeral", value: layout.sizeFrac, in: 0.05...0.4, step: 0.005,
                               reset: defaultBadgeLayout.sizeFrac, printed: P.percent(layout.sizeFrac)) { v in
                model.patchBadge { $0.layout.sizeFrac = v }
            }
            .accessibilityHint("Numeral size")
            VStack(alignment: .leading, spacing: 4) {
                DevelopRangeSlider("Duration", value: duration, in: 1...15, step: 0.5, reset: defaultBadgeDuration,
                                   printed: "\(P.fixed(duration, 1)) s") { v in
                    model.patchBadge { $0.durationSeconds = v }
                }
                .accessibilityHint("Hook duration")
                OverlayPanelHint("How long the hook lasts — what an exit animation lands on.")
            }
        }
    }

    /// The fine tool is the drag on the picture; the snap is skipped with
    /// Option, which a phone does not have.
    private static var info: String {
        #if os(macOS)
        return "The grid is the coarse tool; drag the badge on the picture to place it exactly — hold Option to skip the snap."
        #else
        return "The grid is the coarse tool; drag the badge on the picture to place it exactly."
        #endif
    }
}

// MARK: - the shades

private struct LookShadesSection: View {
    let model: PieceEditorModel
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    #else
    private var compact: Bool { false }
    #endif

    var body: some View {
        DevelopSection(id: "piece.shades", title: "Shades", info: [
            "One stack of shades does both jobs — a vignette and the scrim under the badge. Each has a direction, a reach and a strength.",
        ], remember: .local) {
            ShadesPanelView(shades: model.post?.badge.shades ?? [],
                            anchor: model.post?.badge.layout.anchor,
                            placing: model.placingShade,
                            onChange: { next in model.patchBadge { $0.shades = next } },
                            onPlace: { id in model.placeShade(id, compact: compact) })
        }
    }
}

// MARK: - previews

#Preview("Look — the hook") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        LookTabView(model: model)
            .padding(16)
    }
    .frame(width: 360, height: 760)
    .darkroom()
}

#Preview("Look — a content slide") {
    let model = PieceEditorFixtures.model()
    ScrollView {
        LookTabView(model: model)
            .padding(16)
    }
    .frame(width: 360, height: 520)
    .darkroom()
    .onAppear { model.openSlide(1) }
}
