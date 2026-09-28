// The picture's pan and zoom over its slide, edited as CARDS — the web's
// `src/tools/roadtrip/panels/PanZoomSection.tsx` (`roadtrip.md`, «A picture
// moves in its frame», «Built as cards»; `docs/picture-motion-ui.md` §6):
// a row of the frames the view rests on — Start, stops, End — each a
// thumbnail one taps. The stage then shows that card and the drag, the pinch
// and the wheel that already frame a picture write it, and no other; a card
// is never placed by a gesture in silence. The time between cards is not set
// by hand: it is shared by how far each glide travels, with one pause for
// every card. This section holds the row, the verbs on it, the pause, the
// quick moves, the tour's map and how the picture travels.
//
// Rules kept:
// - every quick move is DRAWN, disabled with its reason said under the six —
//   a disabled button shows no tooltip, and a move refused in silence reads
//   as a broken one; one line per reason, naming the buttons it holds back;
// - "+ Stop" is refused past `maxCards`, and says so; End cannot be removed;
// - a pause needs a second card — the slider is disabled with that sentence;
// - "Starts" is offered only where the opener has seconds to wait for;
// - the cards and the map are drawn from ONE picture decoded within half a
//   megapixel, and another file's picture is never drawn under this one's.

import SwiftUI
import AtelierKit

struct PiecePanZoomSection: View {
    let model: PieceEditorModel
    /// "Cell 2" when the inspector is about a later cell of a collage.
    let badge: String?

    @State private var touring = false
    @State private var picture: PaintPicture?
    @State private var pictureKey: String?
    @Environment(\.palette) private var palette

    /// The thumbnails' decode budget: a whole row is drawn from one small picture.
    private static let cardPixels = 500_000.0

    private static let info = [
        "The picture moves inside its frame over the slide — slow to leave and slow to arrive, like a camera over a print. It comes to rest on End, the composition, which is also what the PNG and the grid show.",
        "Every frame it rests on is a card. Tap one: the stage shows it, and dragging or zooming the picture there reframes that card and no other. + Stop adds a card after the one picked, a touch closer, for you to frame. The time between cards shares itself by how far each glide travels; Pause is how long the view holds on each.",
        "A quick move writes Start and End in one tap — a pan from one edge of the picture to the other, a push in or a pull out — over your composition, and plays it. A tour places stops on a map of the whole picture. Both are only ways of writing cards.",
        "A slide that moves leaves as a video under Auto. The zoom it reaches decides whether the original is fetched for the export, not the zoom it rests at.",
    ]

    var body: some View {
        let thumb = model.cardThumb
        DevelopSection(id: "piece.panzoom", title: "Pan & zoom", badge: badge, info: Self.info, remember: .local) {
            content(thumb)
        }
        .task(id: thumb?.decodeKey) { await load(thumb) }
    }

    @ViewBuilder
    private func content(_ thumb: PieceCardThumb?) -> some View {
        let motion = model.cellMotion
        let moving = hasMotion(motion)
        let row = model.cellCards
        let count = row.cards.count
        let selected = model.cardIndex
        moveRow(moving: moving, count: count)
        PieceMotionCardsRow(cards: row.cards, arrivals: model.cellArrivals, holdSeconds: row.holdSeconds,
                            selected: selected, picture: shown(thumb), aspect: aspectOf(thumb),
                            onSelect: { model.selectCard($0) },
                            onStart: { model.setMotionFromSection(starterMotion(model.cellFraming)) })
        if moving {
            cardsRow(count: count, selected: selected)
            pauseRow(count: count, hold: row.holdSeconds)
        }
        quickMoves
        tourRow
        if touring, let plan = model.tourPlan {
            tourRows(plan, selected: selected, thumb: thumb)
        }
        if let motion, moving {
            PiecePanZoomTravel(model: model, motion: motion)
        }
    }

    // MARK: - the move

    private func moveRow(moving: Bool, count: Int) -> some View {
        let playing = model.stagePlaying
        return OverlayPanelRow("Move") {
            Button {
                model.playMove()
            } label: {
                Label(playing ? "Pause" : "Play", systemImage: playing ? "pause.fill" : "play.fill")
            }
            .buttonStyle(DevelopPillButtonStyle())
            .disabled(!moving)
            .help(playing ? "Pause" : "Play the slide from its first frame")
            .accessibilityLabel(playing ? "Pause the move" : "Play the move")
            Text(moving ? "\(count) cards" : "Holds still")
                .font(Brand.mono(12))
                .foregroundStyle(moving ? palette.inkSoft : palette.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
            if moving {
                Button("Hold still") { model.setMotionFromSection(nil) }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Take the move off — the picture holds still on its composition")
            }
        }
    }

    private func cardsRow(count: Int, selected: Int?) -> some View {
        let canRemove = selected.map { $0 < count - 1 } ?? false
        let hint: String?
        if count >= maxCards {
            hint = "\(maxCards) cards at most — past that a slide is a slideshow of blurs."
        } else if selected == nil {
            hint = "The needle is between two cards: pick one to reframe it, or add one after it."
        } else {
            hint = nil
        }
        return OverlayPanelRow("Cards", hint: hint) {
            Button {
                model.addCard()
            } label: {
                Label("Stop", systemImage: "plus")
            }
            .buttonStyle(DevelopPillButtonStyle())
            .disabled(count >= maxCards)
            .help("A card after the one picked, a touch closer — frame it on the stage")
            Button("Remove") { model.dropCard() }
                .buttonStyle(DevelopLinkButtonStyle())
                .disabled(!canRemove)
                .help(selected == count - 1 ? "End cannot go — it is the picture’s framing" : "Take the picked card off")
        }
    }

    @ViewBuilder
    private func pauseRow(count: Int, hold: Double) -> some View {
        DevelopRangeSlider("Pause", value: hold, in: 0...2, step: 0.05, reset: 0,
                           printed: String(format: "%.2f s", hold)) { model.setHold($0) }
            .disabled(count < 2)
            .accessibilityHint("How long the view holds on each card")
        if count < 2 {
            OverlayPanelHint("A pause needs a second card.")
        }
    }

    // MARK: - the quick moves

    private var quickMoves: some View {
        let rows = model.motionPresetRows
        return OverlayPanelRow("Quick move", hint: PiecePanZoomSection.presetHint(rows), alignTop: true) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(rows) { row in
                    let words = PiecePanZoomSection.words(row.preset)
                    Button {
                        model.writePreset(row.preset)
                    } label: {
                        Text(words.label).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(row.problem != nil)
                    .help(row.problem ?? words.title)
                }
            }
        }
    }

    /// What each preset is called, and what it does, from the camera's side.
    static func words(_ preset: MotionPreset) -> (label: String, title: String) {
        switch preset {
        case .panLeft: return ("Pan ←", "The view travels left across the picture, from its right edge to its left")
        case .panRight: return ("Pan →", "The view travels right across the picture, from its left edge to its right")
        case .panUp: return ("Pan ↑", "The view travels up the picture, from its foot to its top")
        case .panDown: return ("Pan ↓", "The view travels down the picture, from its top to its foot")
        case .pushIn: return ("Push in", "The view starts wider and moves in on the middle of your framing")
        case .pullOut: return ("Pull out", "The view starts close on the middle and pulls back to your framing")
        }
    }

    /// Why the disabled presets are disabled, one line per reason naming the
    /// buttons it holds back — the web's `presetHint`.
    static func presetHint(_ rows: [PieceMotionPresetRow]) -> String? {
        var order: [String] = []
        var byReason: [String: [String]] = [:]
        for row in rows {
            guard let problem = row.problem else { continue }
            if byReason[problem] == nil { order.append(problem) }
            byReason[problem, default: []].append(words(row.preset).label)
        }
        if order.isEmpty { return nil }
        return order.map { "\((byReason[$0] ?? []).joined(separator: ", ")): \($0)" }.joined(separator: " ")
    }

    // MARK: - the tour

    private var tourRow: some View {
        let plan = model.tourPlan
        return OverlayPanelRow("Tour") {
            Button(touring ? "Close the map" : "Plan a tour…") {
                withAnimation(.easeOut(duration: 0.2)) { touring.toggle() }
            }
            .buttonStyle(DevelopPillButtonStyle(on: touring))
            .disabled(plan == nil)
            .help(plan != nil ? "Visit points of the picture one after the other" : "The picture is still being read")
            if let plan {
                Text("\(plan.stops.count) \(plan.stops.count == 1 ? "stop" : "stops")")
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
            }
        }
    }

    /// The open map: every card as the window it shows on the whole picture,
    /// and the picked card's zoom — written through the same card verbs as the
    /// row, so the two can never disagree.
    @ViewBuilder
    private func tourRows(_ plan: PieceTourPlan, selected: Int?, thumb: PieceCardThumb?) -> some View {
        let zoom = model.pickedCardZoom
        VStack(alignment: .leading, spacing: 6) {
            PieceTourMap(picture: shown(thumb), plan: plan, selected: selected, zoom: zoom,
                         onSelect: { model.selectCard($0) }, onAdd: { model.mapAdd($0) },
                         onMove: { model.mapMove($0, $1) }, onZoomBy: { model.zoomCardBy($0) })
            Text("Tap the picture to add a card after the last (\(maxCards) at most) — it becomes the End —, drag a dot to move that card, pinch or scroll to zoom the picked one. A card looks where the view can really centre at its zoom.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        DevelopRangeSlider("Zoom", value: zoom ?? 1, in: 1...maxFramingScale, step: 0.05, reset: 1,
                           printed: String(format: "%.2f×", zoom ?? 1)) { model.zoomCard($0) }
            .disabled(zoom == nil)
            .accessibilityHint("The picked card’s zoom")
        if zoom == nil {
            OverlayPanelHint("Pick a card to zoom it.")
        }
    }

    // MARK: - the picture the cards are drawn from

    /// The decoded picture — only while it is THIS file's.
    private func shown(_ thumb: PieceCardThumb?) -> PaintPicture? {
        guard let thumb, pictureKey == thumb.decodeKey else { return nil }
        return picture
    }

    private func aspectOf(_ thumb: PieceCardThumb?) -> Double {
        guard let thumb, thumb.dstH > 0 else { return 9.0 / 16 }
        return thumb.dstW / thumb.dstH
    }

    /// Decode the selected picture ONCE, small and as shot; a clip at the
    /// frame its thumbnails are taken from. A picture this device cannot draw
    /// leaves the cards dark — the stage already says why.
    private func load(_ thumb: PieceCardThumb?) async {
        guard let thumb else {
            picture = nil
            pictureKey = nil
            return
        }
        let key = thumb.decodeKey
        let url = thumb.url
        let name = thumb.name
        let seconds = thumb.isVideo ? thumb.videoSeconds : 0
        let budget = PiecePanZoomSection.cardPixels
        let decoded = await Task.detached(priority: .utility) { () -> (image: CGImage, width: Double, height: Double)? in
            guard let source = try? await BadgeSources.load(url, name: name, videoSeconds: seconds, budget: budget),
                  let drawn = source.picture(grader: nil) else { return nil }
            return (drawn.image, drawn.width, drawn.height)
        }.value
        guard !Task.isCancelled else { return }
        picture = decoded.map { PaintPicture($0.image, width: $0.width, height: $0.height) }
        pictureKey = key
    }
}

/// How the picture travels between cards — the curve, its steps, and when the
/// move starts against the opener.
struct PiecePanZoomTravel: View {
    let model: PieceEditorModel
    let motion: FramingMotion

    private static let easings: [OverlayPanelOption<EasingId>] =
        easingIds.map { OverlayPanelOption($0, OverlayPanels.easingLabel($0)) }

    var body: some View {
        OverlayPanelPicker("Easing", selection: motion.easing, options: Self.easings) { easing in
            var next = motion
            next.easing = easing
            next.steps = easing == .steps ? (motion.steps ?? defaultSteps) : nil
            model.setMotionFromSection(next)
        }
        .accessibilityHint("How the picture travels between cards")
        if motion.easing == .steps {
            let steps = Double(motion.steps ?? defaultSteps)
            DevelopRangeSlider("Steps", value: steps, in: Double(minSteps)...Double(maxSteps), step: 1,
                               reset: Double(defaultSteps), printed: DevelopNumbers.plain(steps)) { v in
                var next = motion
                next.steps = Int(v)
                model.setMotionFromSection(next)
            }
            .accessibilityHint("Steps between two cards")
        }
        if model.openerSeconds > 0 {
            startsRow
        }
    }

    private var startsRow: some View {
        let opener = String(format: "%.1f", model.openerSeconds)
        return OverlayPanelRow("Starts") {
            Picker("When the picture starts moving", selection: Binding(get: { motion.start }, set: { start in
                var next = motion
                next.start = start
                model.setMotionFromSection(next)
            })) {
                Text("With the slide").tag(MotionStart.slide)
                Text("After the opener").tag(MotionStart.afterOpener)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .help(motion.start == .slide ? "The move runs over the whole slide"
                  : "The move waits the opener’s \(opener) s — a sweep or a drive that covers the frame")
        }
    }
}

#Preview("Pan & zoom") {
    DevelopPreviewState(0) { _ in
        PiecePanZoomSection(model: PieceEditorFixtures.model(), badge: nil)
    }
}
