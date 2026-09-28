// Every write the stage and the tabs make to the OPEN slide — the collage's
// cells, the framing and the card of a move it writes into, the badge's
// block, the opener's drawing, a shade's centre, a clip's cut and speed. The
// web's `writeLead` / `patchCell` / `placeFraming` / `moveBlockTo` /
// `moveHook` / `moveShadeCentre` / `setClipRange` / `setClipSpeed`.
//
// Rules kept (`roadtrip.md`):
// - The lead and the collage are written in ONE go, on the hook's badge or on
//   the carousel picture's slide — the split every per-picture field makes.
// - A framing written from the stage and one written from the Picture tab go
//   through ONE writer (`placeFraming`): into the CARD in hand when the
//   picture moves, as it always was when it holds still. A gesture between
//   two cards writes nothing and is SAID on the picture ("Tap a card to
//   reframe it"), never placed in silence; on a cell that is not the one
//   selected it writes that cell's composition, the frame shown.
// - A flip mirrors the rest AND every frame of the move.
// - The BLOCK moves, never one piece; soft-snapped unless Option is held.
// - A cut writes the in point and the SCREEN seconds; a new speed keeps the
//   footage and re-times the screen seconds, read from the stretch the stage
//   really shows; a stored in point past a shorter clip is reset to 0.

import Foundation
import AtelierKit

extension PieceEditorModel {
    // MARK: - the lead and the collage

    /// Write the open slide's lead and collage in one go.
    func writeLead(_ next: CollageLead, _ nextCollage: SlideCollage?) {
        guard let slide else { return }
        if slide.kind == .hook {
            updatePost { post in
                post.media = next.media
                post.badge.framing = next.framing
                post.badge.develop = next.develop
                post.badge.motion = next.motion
                post.badge.collage = nextCollage
            }
        } else if let id = slide.slideId {
            updatePost { post in
                guard let i = post.slides.firstIndex(where: { $0.id == id }) else { return }
                post.slides[i].media = next.media
                post.slides[i].framing = next.framing
                post.slides[i].develop = next.develop
                post.slides[i].motion = next.motion
                post.slides[i].collage = nextCollage
            }
        }
    }

    /// A new layout (or nil: "One picture" hands the frame back to the lead).
    func setCollage(_ next: SlideCollage?) {
        writeLead(lead, next)
    }

    /// Write one field of cell `i` (the lead when it is 0, and without a
    /// collage the slide itself, written the way it always was).
    func patchCell(_ i: Int, _ patch: CollageCellPatch) {
        guard let collage else {
            var next = lead
            if let media = patch.media { next.media = media }
            if let framing = patch.framing { next.framing = framing }
            if let develop = patch.develop { next.develop = develop }
            if let motion = patch.motion { next.motion = motion }
            writeLead(next, nil)
            return
        }
        let write = withCollageCell(lead, collage, i, patch)
        writeLead(write.lead, write.collage)
    }

    /// Two cells' pictures exchanged — a hold or an Option-drag onto another
    /// cell; the places belong to the slots and stay.
    func swapCells(_ a: Int, _ b: Int) {
        guard let collage else { return }
        let write = swapCollageCells(lead, collage, a, b)
        writeLead(write.lead, write.collage)
    }

    /// A print dragged on a free layout: fractions of the frame, incremental.
    func moveCell(_ i: Int, dx: Double, dy: Double) {
        guard let collage else { return }
        let from = collageCellAt(lead, collage, i).place
        let place = normaliseCellPlace(CellPlace(dx: from.dx + dx, dy: from.dy + dy, rotation: from.rotation).json)
        patchCell(i, CollageCellPatch(place: place))
    }

    /// A picture written to the SELECTED cell of the open slide.
    func setSlideMedia(_ ref: SavedMediaRef?) {
        patchCell(cellIndex, CollageCellPatch(media: .some(ref)))
    }

    /// "Use the ticked picture" — the Library's tick into the selected cell.
    func useActiveInCell() {
        guard let active = library?.active else { return }
        let at = cellIndex
        Task { [weak self] in
            guard let self else { return }
            let ref = await self.storedRef(active)
            self.patchCell(at, CollageCellPatch(media: .some(ref)))
        }
    }

    /// "Empty this cell".
    func clearCell() {
        patchCell(cellIndex, CollageCellPatch(media: .some(nil)))
    }

    // MARK: - the framing and the card it writes into

    /// How long the open slide holds the screen.
    var slideSeconds: Double {
        let all = lengths
        return all.indices.contains(slideIndex) ? all[slideIndex] : 0
    }

    /// A picture's span: the slide, less what its move waits for the opener.
    func spanOf(_ motion: FramingMotion?) -> Double {
        guard let motion, hasMotion(motion) else { return slideSeconds }
        return slideSeconds - motionOffset(motion, slideSeconds, openerSeconds)
    }

    /// Where the view arrives on each card, in the slide's seconds; a still
    /// picture arrives at once.
    func arrivalsOf(_ framing: Framing, _ motion: FramingMotion?) -> [Double] {
        hasMotion(motion) ? arrivalMarks(framing, motion, slideSeconds, openerSeconds) : [0]
    }

    /// The selected picture's move read as its cards.
    var cellCards: MotionCards { readCards(cellFraming, cellMotion, spanOf(cellMotion)) }
    var cellArrivals: [Double] { arrivalsOf(cellFraming, cellMotion) }
    var cardCount: Int { cellCards.cards.count }

    /// The picked card as an index into the row, or nil between two cards.
    var cardIndex: Int? {
        let count = cardCount
        switch cardPick {
        case .between: return nil
        case .end: return count - 1
        case .index(let i): return min(i, count - 1)
        }
    }

    func setCardPick(_ next: PieceCardPick) {
        guard next != cardPick else { return }
        cardPick = next
        requestRender()
    }

    /// A picture's framing as the stage shows it: the move at the needle while
    /// playing, else the card in hand — another cell of a collage rests on its
    /// composition while this one is worked.
    func shownFraming(_ framing: Framing, _ motion: FramingMotion?, own: Bool) -> Framing {
        guard let motion, hasMotion(motion) else { return framing }
        let u = motionProgress(motion, deck.local, slideSeconds, openerSeconds)
        if stagePlaying { return framingAtProgress(framing, motion, u) }
        if !own { return framing }
        guard let index = cardIndex else { return framingAtProgress(framing, motion, u) }
        let cards = readCards(framing, motion, spanOf(motion)).cards
        return cards.indices.contains(index) ? cards[index] : framing
    }

    /// Cell `i`'s framing as the stage shows it (0 = the lead).
    func stageFraming(_ i: Int) -> Framing {
        guard let collage else {
            return shownFraming(slide?.framing ?? .default, slide?.motion, own: true)
        }
        let c = collageCellAt(lead, collage, i)
        return shownFraming(c.framing, c.motion, own: i == cellIndex)
    }

    /// Every drawn cell's framing as shown, the lead first.
    var stageFramings: [Framing] {
        (0..<cellCount).map { stageFraming($0) }
    }

    /// Write cell `i`'s framing (0 = the slide's own) as a gesture or a
    /// control left it — the ONE writer (see the header).
    func placeFraming(_ i: Int, _ next: Framing) {
        let current: (framing: Framing, motion: FramingMotion?)
        if let collage {
            let c = collageCellAt(lead, collage, i)
            current = (c.framing, c.motion)
        } else {
            current = (lead.framing, lead.motion)
        }
        guard let motion = current.motion, hasMotion(motion) else {
            patchCell(i, CollageCellPatch(framing: next))
            return
        }
        let count = readCards(current.framing, motion, spanOf(motion)).cards.count
        var index: Int?
        if i != cellIndex {
            index = count - 1
        } else if stagePlaying {
            holdTheNeedle()
            index = cardAtNeedle(arrivalsOf(current.framing, motion), deck.local, keySnapSeconds)
            setCardPick(.of(index, count: count))
        } else {
            index = cardIndex
        }
        guard let index else {
            refuse()
            return
        }
        let placed = writeCard(current.framing, motion, index, next)
        patchCell(i, CollageCellPatch(framing: placed.framing, motion: .some(placed.motion)))
    }

    /// Mirror cell `i` — its rest AND every frame of its move.
    func flipPicture(_ i: Int, axis: Character) {
        let current: (framing: Framing, motion: FramingMotion?)
        if let collage {
            let c = collageCellAt(lead, collage, i)
            current = (c.framing, c.motion)
        } else {
            current = (lead.framing, lead.motion)
        }
        patchCell(i, CollageCellPatch(framing: flipFraming(current.framing, axis: axis),
                                      motion: .some(flipMotion(current.motion, axis: axis))))
    }

    /// The selected picture's move, written whole.
    func setCellMotion(_ motion: FramingMotion?) {
        patchCell(cellIndex, CollageCellPatch(motion: .some(motion)))
    }

    /// A gesture on a moving slide stops it: the card it writes is the one
    /// the needle is on.
    func holdTheNeedle() {
        if deck.playing { deck.setPlaying(false) }
        setClipPlaying(false)
    }

    /// Pick a card: the stage shows it, and the needle goes to where the view
    /// arrives on it.
    func selectCard(_ i: Int) {
        holdTheNeedle()
        let arrivals = cellArrivals
        let count = arrivals.count
        setCardPick(.of(i, count: count))
        let at = arrivals.isEmpty ? 0 : arrivals[max(0, min(i, count - 1))]
        deck.goTo(slideIndex, min(slideSeconds, at))
    }

    /// Write a rewritten row — a card added or taken off — and pick the card it names.
    func writeCards(_ out: CardWrite?) {
        guard let out else { return }
        holdTheNeedle()
        patchCell(cellIndex, CollageCellPatch(framing: out.framing, motion: .some(out.motion)))
        let arrivals = arrivalsOf(out.framing, out.motion)
        setCardPick(.of(out.selected, count: arrivals.count))
        let at = arrivals.isEmpty ? 0 : arrivals[max(0, min(out.selected, arrivals.count - 1))]
        deck.goTo(slideIndex, min(slideSeconds, at))
    }

    /// The card under the needle once the needle moved on its own — a scrub, a pause.
    func followNeedle(_ local: Double) {
        let arrivals = cellArrivals
        setCardPick(.of(cardAtNeedle(arrivals, local, keySnapSeconds), count: arrivals.count))
    }

    /// Say on the picture, for a moment, why a gesture did nothing.
    func refuse() {
        let until = Date().addingTimeInterval(1.8)
        refusedUntil = until
        requestRender()
        tasks["refuse"]?.cancel()
        tasks["refuse"] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            guard let self, !Task.isCancelled, self.refusedUntil == until else { return }
            self.refusedUntil = nil
        }
    }

    /// What the stage says in its corner about the selected picture's move.
    var stageCaption: PieceStageCaption? {
        if stagePlaying || isCta { return nil }
        if let until = refusedUntil, until > Date() {
            return PieceStageCaption(text: "Tap a card to reframe it", tone: .accent)
        }
        guard hasMotion(cellMotion) else { return nil }
        let count = cardCount
        let prefix = collage != nil && cellIndex > 0 ? "Cell \(cellIndex + 1) · " : ""
        guard let index = cardIndex else {
            let local = deck.local
            let arrived = cellArrivals.filter { $0 <= local + 1e-6 }.count - 1
            let a = max(0, arrived)
            let b = min(count - 1, a + 1)
            let seconds = String(format: "%.1f", local)
            return PieceStageCaption(
                text: "\(prefix)Between \(cardLabel(a, count)) and \(cardLabel(b, count)) · \(seconds) s", tone: .muted)
        }
        let last = index == count - 1
        return PieceStageCaption(text: "\(prefix)\(cardLabel(index, count))\(last ? " · the composition" : "")",
                                 tone: last ? .plain : .accent)
    }

    // MARK: - the badge's block and the opener's drawing

    /// The badge block's anchor, when this slide has one to move — only the
    /// hook's; a caption and the closing card sit at fixed positions.
    var blockAnchor: AtelierKit.Point? {
        guard isHook, let layout = post?.badge.layout else { return nil }
        return AtelierKit.Point(layout.x, layout.y)
    }

    /// Where a drag of the block lands it.
    func moveBlock(to point: AtelierKit.Point) {
        guard isHook else { return }
        patchBadge { badge in
            badge.layout.x = point.x
            badge.layout.y = point.y
        }
    }

    /// Whether the opener's drawing may be dragged.
    var hookMovable: Bool { isHook && hookVariant?.moveBy != nil }

    /// A drag of the opener: fractions of the frame, incremental; the variant clamps.
    func moveHook(dx: Double, dy: Double) {
        guard isHook, let moveBy = hookVariant?.moveBy else { return }
        let options = moveBy(hookOptions, dx, dy)
        patchBadge { $0.hook = setHookOptions($0.hook, options) }
    }

    // MARK: - a shade's centre

    /// The shade whose centre is being placed, where it is, and the axis it
    /// may move on — nil unless on the hook, on the Look tab, with a shade
    /// that still has a centre to move.
    var shadeHandle: (x: Double, y: Double, axis: ShadeCentreAxis)? {
        guard let id = placingShade, isHook, tab == .look,
              let shade = post?.badge.shades.first(where: { $0.id == id && $0.enabled != false }),
              let axis = centreMovable(resolvedDirection(shade, hookState?.block), shadeFollow(shade)) else { return nil }
        let centre = shadeCentre(shade)
        return (centre.x, centre.y, axis)
    }

    /// Place a shade's centre on the picture, or stop (nil). On a phone the
    /// inspector steps aside — it is a sheet over the very picture.
    func placeShade(_ id: String?, compact: Bool) {
        placingShade = id
        if id != nil && compact { inspectorOpen = false }
        requestRender()
    }

    /// The placed centre, in frame fractions.
    func moveShadeCentre(x: Double, y: Double) {
        guard let id = placingShade else { return }
        patchBadge { badge in
            guard let i = badge.shades.firstIndex(where: { $0.id == id }) else { return }
            badge.shades[i].center = AtelierKit.Point(x, y)
        }
    }

    // MARK: - the clip's cut and speed

    /// A cut on the bar: the in point and the screen time are what it writes.
    func setClipRange(_ range: TrimRange) {
        guard let slide else { return }
        let seconds = screenSecondsOf(range, slide.speed)
        if slide.kind == .hook {
            patchBadge { badge in
                badge.videoTimeSeconds = range.start
                badge.hookSeconds = seconds
            }
        } else {
            patchSlide { s in
                s.videoTimeSeconds = range.start
                s.seconds = seconds
            }
        }
    }

    /// A new speed keeps the footage and moves the screen time, read from the
    /// stretch the stage really shows.
    func setClipSpeed(_ speed: Double) {
        guard let slide else { return }
        let seconds = retimedScreenSeconds(screenSecondsOf(clipRange, slide.speed), slide.speed, speed)
        if slide.kind == .hook {
            patchBadge { badge in
                badge.videoSpeed = speed
                badge.hookSeconds = seconds
            }
        } else {
            patchSlide { s in
                s.videoSpeed = speed
                s.seconds = seconds
            }
        }
    }

    /// A clip's in point stays inside the clip: switching to a shorter video
    /// would otherwise leave the badge pinned past the end.
    func keepInPointInside() {
        guard let slide, isVideo, duration > 0, slide.videoTimeSeconds > duration else { return }
        if slide.kind == .hook {
            patchBadge { $0.videoTimeSeconds = 0 }
        } else {
            patchSlide { $0.videoTimeSeconds = 0 }
        }
    }
}
