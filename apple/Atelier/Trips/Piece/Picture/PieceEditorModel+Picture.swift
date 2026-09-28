// The Picture tab's verbs over the SELECTED picture — the half of the web's
// `PostEditor.tsx` the Picture tab, the Pan & zoom section, the cards row and
// the tour map call: the in point, the frame the picture sits in (`frameBox`,
// `presetBox`), the quick moves (`presets`, `writePreset`), the card verbs
// (`addCard`, `dropCard`, `setHold`, `playMove`, `setMotionFromSection`), the
// map (`tour`, `mapAdd`, `mapMove`, `zoomCard`) and what the cards are drawn
// from (`cardThumb`). Everything writes through the model's own funnel
// (`patchCell`, `writeCards`), one undo step per gesture.
//
// Rules kept (`roadtrip.md`, «Built as cards», «The tour»):
// - A card is written by `writeCard` at the instants it already has; only
//   adding or taking off a card, or the pause, re-shares the time.
// - A tap on the map APPENDS a card looking there at the picked card's zoom,
//   which becomes the End; a dot dragged moves that card at its own zoom; the
//   pinch, the wheel and the Zoom slider zoom the PICKED card about the point
//   it looks at.
// - A quick move writes Start and End, picks Start and PLAYS.
// - Turning the move on from the section lands on its Start; holding still
//   puts the stage back on the composition.
// - The picture's shape is the one the stage measured from the FILES in hand
//   (`pictureSizes`), never the last slide's; the row's thumbnails need only
//   the frame's shape, so a card is never dark for want of a report.

import Foundation
import AtelierKit

/// What the cards row and the map draw their picture from: the selected
/// picture's file, and the frame each card sits in — the web's `CardThumbSource`.
struct PieceCardThumb: Equatable {
    let url: URL
    let name: String
    let isVideo: Bool
    /// Where a clip's frame is taken for the thumbnails.
    let videoSeconds: Double
    /// The frame's shape — a cell's, for a collage — in any consistent pixels.
    let dstW: Double
    let dstH: Double

    /// What a decode is keyed on: the file and the moment, never the frame.
    var decodeKey: String { "\(url.absoluteString)|\(name)|\(isVideo ? videoSeconds : 0)" }
}

/// One quick move, and why it cannot be written here when it cannot.
struct PieceMotionPresetRow: Identifiable, Equatable {
    let preset: MotionPreset
    let problem: String?
    var id: String { preset.rawValue }
}

/// The map of the selected picture: every card's point and the window it
/// shows, read out of the same row the section draws.
struct PieceTourPlan: Equatable {
    let stops: [TourStop]
    let windows: [[AtelierKit.Point]]
    /// The picture's width over its height.
    let aspect: Double
}

extension PieceEditorModel {
    // MARK: - the in point

    /// The filmstrip's write: the in point of the open slide's clip — its
    /// length is kept, the whole stretch slides along the clip.
    func setInPoint(_ seconds: Double) {
        if isHook {
            patchBadge { $0.videoTimeSeconds = seconds }
        } else {
            patchSlide { $0.videoTimeSeconds = seconds }
        }
    }

    // MARK: - the frame the picture sits in

    /// The frame the selected picture sits in — the slide's, or its cell's —
    /// at a nominal width (the web's `frameBox`).
    var pictureFrameBox: (dstW: Double, dstH: Double)? {
        let w = 1080.0
        let h = (1080 / aspect).rounded()
        guard let collage else { return (w, h) }
        let cells = resolveCollage(collage, w, h)
        guard cells.indices.contains(cellIndex) else { return nil }
        return (cells[cellIndex].width, cells[cellIndex].height)
    }

    /// The selected picture in its frame (or its cell), for a preset to
    /// measure a pan's room and the map to place its stops; nil until the
    /// picture's shape is known.
    var presetBox: PictureBox? {
        guard pictureSizes.indices.contains(cellIndex), let src = pictureSizes[cellIndex],
              let frame = pictureFrameBox else { return nil }
        return PictureBox(srcW: src.width, srcH: src.height, dstW: frame.dstW, dstH: frame.dstH)
    }

    /// What the cards row draws its thumbnails from: the selected picture, in
    /// the frame it sits in.
    var cardThumb: PieceCardThumb? {
        guard let ref = cellRef, let frame = pictureFrameBox, let url = url(for: ref) else { return nil }
        let seconds = cellIndex == 0 ? (slide?.videoTimeSeconds ?? 0) : 0
        return PieceCardThumb(url: url, name: ref.name, isVideo: BadgeSources.isClip(ref.name),
                              videoSeconds: seconds, dstW: frame.dstW, dstH: frame.dstH)
    }

    // MARK: - the quick moves

    /// The six one-tap moves, each with the reason it cannot be written here.
    var motionPresetRows: [PieceMotionPresetRow] {
        let framing = cellFraming
        let box = presetBox
        return motionPresets.map { PieceMotionPresetRow(preset: $0, problem: presetProblem($0, framing, box)) }
    }

    /// Write a one-tap move over the selected picture — Start and End — and play it.
    func writePreset(_ preset: MotionPreset) {
        guard let out = applyPreset(preset, cellFraming, cellMotion, presetBox) else { return }
        let motion: FramingMotion? = out.motion
        patchCell(cellIndex, CollageCellPatch(framing: out.framing, motion: .some(motion)))
        setCardPick(.index(0))
        deck.goTo(slideIndex, 0)
        deck.setPlaying(true)
    }

    // MARK: - the card verbs

    /// A card after the picked one (or after the last while between two), a
    /// touch closer — to be framed on the stage.
    func addCard() {
        let cards = cellCards
        let after = cardIndex ?? (cards.cards.count - 1)
        writeCards(insertCard(cellFraming, cellMotion, cards.cards, cards.holdSeconds, spanOf(cellMotion), after))
    }

    /// The picked card off — never the last, which is the framing.
    func dropCard() {
        guard let index = cardIndex else { return }
        let cards = cellCards
        writeCards(removeCard(cellFraming, cellMotion, cards.cards, cards.holdSeconds, spanOf(cellMotion), index))
    }

    /// How long the view holds on each card; the glides share what is left.
    func setHold(_ seconds: Double) {
        let cards = cellCards
        guard let out = cardsMotion(cellFraming, cellMotion, cards.cards, seconds, spanOf(cellMotion)) else { return }
        patchCell(cellIndex, CollageCellPatch(framing: out.framing, motion: .some(out.motion)))
    }

    /// The section's own play: the slide from its first frame, or a pause.
    func playMove() {
        if trimOpen || stagePlaying {
            togglePlay()
            return
        }
        deck.goTo(slideIndex, 0)
        deck.setPlaying(true)
    }

    /// The section's motion writes: a starter turns the move on, on its Start;
    /// nil holds still on the composition.
    func setMotionFromSection(_ motion: FramingMotion?) {
        let wasMoving = hasMotion(cellMotion)
        setCellMotion(motion)
        if motion == nil {
            setCardPick(.end)
        } else if !wasMoving {
            setCardPick(.index(0))
            deck.goTo(slideIndex, 0)
        }
    }

    // MARK: - the map

    /// Every card as the window it shows on the whole picture and the point it
    /// looks at; nil until the picture's shape is known.
    var tourPlan: PieceTourPlan? {
        guard let box = presetBox, box.srcH > 0 else { return nil }
        let cards = cellCards.cards
        return PieceTourPlan(stops: cards.map { stopOf($0, box) },
                             windows: cards.map { framingWindow($0, box) },
                             aspect: box.srcW / box.srcH)
    }

    /// The picked card's zoom; nil between two cards.
    var pickedCardZoom: Double? {
        guard let index = cardIndex else { return nil }
        let cards = cellCards.cards
        return cards.indices.contains(index) ? cards[index].scale : nil
    }

    /// A tap on the map: a card looking at that point, at the picked card's
    /// zoom, after the last — the new End.
    func mapAdd(_ stop: TourStop) {
        guard let box = presetBox else { return }
        let row = cellCards
        let from = cardIndex ?? (row.cards.count - 1)
        let zoom = row.cards.indices.contains(from) ? row.cards[from].scale : cellFraming.scale
        let cards = row.cards + [framingOn(cellFraming, stop, zoom, box)]
        guard let out = cardsMotion(cellFraming, cellMotion, cards, row.holdSeconds, spanOf(cellMotion)) else { return }
        writeCards(CardWrite(framing: out.framing, motion: out.motion, selected: cards.count - 1))
    }

    /// A card's dot dragged: it looks at the point, at its own zoom, at the
    /// instants it has.
    func mapMove(_ index: Int, _ stop: TourStop) {
        let cards = cellCards.cards
        guard let box = presetBox, cards.indices.contains(index) else { return }
        let placed = framingOn(cellFraming, stop, cards[index].scale, box)
        let out = writeCard(cellFraming, cellMotion, index, placed)
        patchCell(cellIndex, CollageCellPatch(framing: out.framing, motion: .some(out.motion)))
    }

    /// The map's pinch and wheel: the picked card's zoom times `factor`, read
    /// from the document as it is NOW (a document lags the hand; a factor on a
    /// render's copy would drift).
    func zoomCardBy(_ factor: Double) {
        guard let zoom = pickedCardZoom else { return }
        zoomCard(scaleFramingBy(zoom, factor))
    }

    /// The picked card's zoom, absolute, about the point it looks at — the
    /// Zoom slider under the map, and the pinch through `zoomCardBy`.
    func zoomCard(_ zoom: Double) {
        let cards = cellCards.cards
        guard let box = presetBox, let index = cardIndex, cards.indices.contains(index) else { return }
        holdTheNeedle()
        let placed = framingOn(cellFraming, stopOf(cards[index], box), zoom, box)
        let out = writeCard(cellFraming, cellMotion, index, placed)
        patchCell(cellIndex, CollageCellPatch(framing: out.framing, motion: .some(out.motion)))
    }
}
