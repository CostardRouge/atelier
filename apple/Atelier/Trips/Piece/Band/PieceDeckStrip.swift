// The band itself — «Aiguille»: the needle never moves, the piece slides
// under it. The web's `DeckStrip.tsx`, its strip half (the row above it is
// `PieceTransportRow`).
//
// Every slide sits end to end on one clock, a clip as wide as its cut and a
// still as wide as the seconds its inspector gives it, laid out by the
// kernel's `stripLayout` (42 points a second, 30 on a phone, a 26-point floor
// so a half-second slide is still something a finger lands on — the mapping
// is piecewise, so time and x only ever convert through the cells). The slide
// under the needle IS the open slide: dragging the band scrubs the piece and
// picks the slide in one gesture.
//
// Rules kept (`roadtrip.md`, «the deck and its transport are ONE band»):
// - Each cell TILES its thumbnail along its length — a clip's tiles split by
//   dark rules (frames), a still's by paper (the same picture held) — each
//   tile sized on the cell's real inner height so it keeps the piece's aspect.
//   The label reads `Hook 5s`, `2 3s · 2×`, `End 3s`; the open cell is ringed,
//   and wears the repeat-one mark while playback loops the slide; the frames a
//   slide's pictures are placed at are accent diamonds along its bottom.
// - While a finger holds the band, the band draws where the FINGER is, and
//   the editor hears about it at most once a turn of the run loop.
// - A tap (under 5 points of travel) opens the slide under the finger on its
//   start; a tap on the open slide leaves the piece where it is.
// - A flick keeps going and slows down (×0.93 every 16 ms), then lands on a
//   slide's edge when it stops within 10 points of one. A finger that stopped
//   before it lifted threw nothing; under Reduce Motion nothing glides.
// - A horizontal wheel (a trackpad sweep, or Shift + wheel) scrubs; a
//   vertical one is left alone. The Mac's alone: SwiftUI hands a view no
//   wheel event, so a transparent view claims scroll events and nothing else.
// - The keys are the band's while the keyboard is on it (`handleBandKey`):
//   ← / → step slides (Shift ±0.5 s), Home / End, Space. A press or a drag
//   puts the keyboard on it, as a click does on the web's `role="slider"`;
//   the focus ring shows only when the keyboard itself brought it there.
// - VoiceOver reads it as the web's slider: its label, the slide and the
//   time as its value, and an adjustment steps a slide.

import SwiftUI
import AtelierKit
#if os(macOS)
import AppKit
#endif

/// The strip's geometry — the web's constants.
enum PieceStripMetrics {
    static let bandHeight: CGFloat = 56
    /// The 56-point band less its 1-point border and the cells' 10/6 insets.
    static let cellHeight: CGFloat = 38
    static let cellTop: CGFloat = 11
    static let minCell = 26.0
    static let gap = 2.0
    static let tapSlop = 5.0
    static let snap = 10.0

    static func pxPerSecond(compact: Bool) -> Double { compact ? 30 : 42 }
}

// MARK: - the hand on the band

/// What a finger (or a pointer, or a wheel) does to the band: where it holds
/// the piece, the flick that glides on, the scrubs coalesced to one a turn.
@MainActor
@Observable
final class PieceStripDriver {
    /// Where the band is drawn while a finger holds it or a flick glides —
    /// nil when it follows the editor's clock.
    var held: Double?

    @ObservationIgnored weak var model: PieceEditorModel?
    @ObservationIgnored var pxPerSecond = 42.0
    @ObservationIgnored private var drag: Drag?
    @ObservationIgnored private var glide: Task<Void, Never>?
    @ObservationIgnored private var pending: Double?
    @ObservationIgnored private var queued = false

    private struct Drag {
        var x0: Double
        var stripX: Double
        var lastX: Double
        var lastAt: Date
        /// Points per millisecond, as the web measures it.
        var velocity: Double
        var moved: Bool
    }

    var dragging: Bool { drag != nil }

    /// The strip at the band's own scale.
    var layout: StripLayout {
        stripLayout(model?.lengths ?? [], pxPerSecond, PieceStripMetrics.minCell, PieceStripMetrics.gap)
    }

    /// Where the band is: the finger's, else the editor's.
    var shown: Double { held ?? model?.deck.time ?? 0 }

    // MARK: - a drag

    func began(at x: Double, time: Date) {
        glide?.cancel()
        glide = nil
        drag = Drag(x0: x, stripX: xAtTime(layout, shown), lastX: x, lastAt: time, velocity: 0, moved: false)
    }

    func moved(to x: Double, time: Date) {
        guard var d = drag else { return }
        let dx = x - d.x0
        if !d.moved && abs(dx) < PieceStripMetrics.tapSlop { return }
        d.moved = true
        let dt = time.timeIntervalSince(d.lastAt) * 1000
        if dt > 0 { d.velocity = (x - d.lastX) / dt }
        d.lastX = x
        d.lastAt = time
        drag = d
        let t = timeAtX(layout, d.stripX - dx)
        held = t
        scrub(t)
    }

    /// The finger lifted at `x` on a band `width` wide.
    func ended(at x: Double, width: Double, time: Date, reduceMotion: Bool) {
        guard let d = drag else { return }
        drag = nil
        let l = layout
        if !d.moved {
            // A tap opens the slide under the finger, on its start.
            // Read where the band is DRAWN (a glide the press stopped), then
            // hand it back to the editor's clock.
            let stripX = xAtTime(l, shown) + (x - width / 2)
            held = nil
            guard let model else { return }
            let under = locate(l, timeAtX(l, stripX)).index
            if under != model.slideIndex { model.deck.goTo(under, 0) }
            return
        }
        let from = d.stripX - (d.lastX - d.x0)
        // A finger that stopped before it lifted threw nothing.
        let stale = time.timeIntervalSince(d.lastAt) * 1000 > 80
        let v = stale || reduceMotion ? 0 : d.velocity
        if abs(v) < 0.08 {
            settle(from)
            return
        }
        glideOn(from: from, velocity: v)
    }

    /// The system took the gesture away (a sheet, a system swipe): a drag that
    /// had moved settles where it is, throwing nothing.
    func cancelled() {
        guard let d = drag else { return }
        drag = nil
        guard d.moved else { return }
        settle(d.stripX - (d.lastX - d.x0))
    }

    /// A horizontal wheel sweep of `dx` points.
    func wheel(_ dx: Double) {
        glide?.cancel()
        glide = nil
        held = nil
        let l = layout
        // From the moment still on its way to the editor, when there is one.
        let from = pending ?? model?.deck.time ?? 0
        scrub(timeAtX(l, xAtTime(l, from) + dx))
    }

    /// The band went away: nothing glides on behind it.
    func stop() {
        glide?.cancel()
        glide = nil
        drag = nil
        held = nil
        pending = nil
    }

    // MARK: - the glide

    private func glideOn(from start: Double, velocity: Double) {
        glide = Task { [weak self] in
            var x = start
            var v = velocity
            var last = Date()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 16_000_000)
                guard let self, !Task.isCancelled else { return }
                let now = Date()
                let dt = now.timeIntervalSince(last) * 1000
                last = now
                x -= v * dt
                v *= pow(0.93, dt / 16)
                let l = self.layout
                if x <= 0 || x >= l.width {
                    x = max(0, min(l.width, x))
                    v = 0
                }
                let t = timeAtX(l, x)
                self.held = t
                self.scrub(t)
                if abs(v) < 0.02 {
                    self.settle(x)
                    return
                }
            }
        }
    }

    /// Land on a slide's edge when close enough to one, and hand the band
    /// back to the editor's clock.
    private func settle(_ x: Double) {
        let l = layout
        flush(snapToEdge(l, timeAtX(l, x), PieceStripMetrics.snap))
    }

    // MARK: - the editor hears about it

    /// Go to `t` — at most once a turn of the run loop, the latest winning.
    private func scrub(_ t: Double) {
        pending = t
        guard !queued else { return }
        queued = true
        Task { [weak self] in
            guard let self else { return }
            self.queued = false
            guard let t = self.pending else { return }
            self.pending = nil
            self.model?.scrubPiece(t)
        }
    }

    /// Go to `t` now, and follow the editor's clock again.
    private func flush(_ t: Double) {
        pending = nil
        model?.scrubPiece(t)
        held = nil
    }
}

// MARK: - the strip

struct PieceDeckStrip: View {
    let model: PieceEditorModel
    let compact: Bool
    let driver: PieceStripDriver
    let thumbs: PieceRailThumbs

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: Bool
    /// The keyboard is on the band because a press put it there.
    @State private var byPointer = false
    @GestureState private var pressing = false

    var body: some View {
        let layout = self.layout
        let offset = CGFloat(xAtTime(layout, shown))
        return keyed(accessible(framed(GeometryReader { geo in
            content(layout, offset: offset, width: geo.size.width)
        })))
    }

    /// The strip at this shell's scale.
    private var layout: StripLayout {
        stripLayout(model.lengths, PieceStripMetrics.pxPerSecond(compact: compact), PieceStripMetrics.minCell,
                    PieceStripMetrics.gap)
    }

    /// Where the band is drawn: the finger's, else the editor's clock.
    private var shown: Double { driver.held ?? model.deck.time }

    // MARK: - what is drawn

    private func content(_ layout: StripLayout, offset: CGFloat, width: CGFloat) -> some View {
        let half = width / 2
        return ZStack(alignment: .topLeading) {
            cells(layout)
                .offset(x: half - offset, y: PieceStripMetrics.cellTop)
            fades(width)
            PieceNeedle()
                .frame(width: 10, height: PieceStripMetrics.bandHeight - 4)
                .offset(x: half - 5, y: 1)
                .allowsHitTesting(false)
        }
        .frame(width: width, height: PieceStripMetrics.bandHeight, alignment: .topLeading)
        .contentShape(Rectangle())
        .gesture(hand(width))
        .onChange(of: pressing) { _, now in
            guard !now else { return }
            // After `onEnded` has had its turn: a drag still open was taken away.
            Task { @MainActor in driver.cancelled() }
        }
    }

    private func cells(_ layout: StripLayout) -> some View {
        let slides = model.slides
        let lengths = model.lengths
        let open = model.slideIndex
        let loopsSlide = model.loopScope == .slide
        let openerSeconds = model.hookState?.hook.seconds ?? 0
        let aspect = CGFloat(model.aspect)
        return ZStack(alignment: .topLeading) {
            ForEach(Array(layout.cells.enumerated()), id: \.offset) { i, cell in
                if i < slides.count {
                    let slide = slides[i]
                    let length = i < lengths.count ? lengths[i] : 0
                    let opener = slide.kind == .hook ? openerSeconds : 0
                    PieceStripCell(
                        width: CGFloat(cell.width),
                        label: PieceStripCell.label(slide, length),
                        video: slide.medium == .video,
                        open: i == open,
                        loopMark: loopsSlide && i == open,
                        marks: PieceStripCell.marks(slide, length, opener, width: CGFloat(cell.width)),
                        thumb: thumbs.image(slide),
                        aspect: aspect
                    )
                    .equatable()
                    .offset(x: CGFloat(cell.left))
                }
            }
        }
        .frame(width: CGFloat(max(1, layout.width)), height: PieceStripMetrics.cellHeight, alignment: .topLeading)
    }

    /// The band's two ends fade into its ground.
    private func fades(_ width: CGFloat) -> some View {
        HStack(spacing: 0) {
            LinearGradient(colors: [palette.paper2, palette.paper2.opacity(0)], startPoint: .leading, endPoint: .trailing)
                .frame(width: 32)
            Spacer(minLength: 0)
            LinearGradient(colors: [palette.paper2.opacity(0), palette.paper2], startPoint: .leading, endPoint: .trailing)
                .frame(width: 32)
        }
        .frame(width: width, height: PieceStripMetrics.bandHeight)
        .allowsHitTesting(false)
    }

    // MARK: - the hand

    private func hand(_ width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .updating($pressing) { _, state, _ in state = true }
            .onChanged { value in
                let x = Double(value.location.x)
                if !driver.dragging {
                    driver.model = model
                    driver.pxPerSecond = PieceStripMetrics.pxPerSecond(compact: compact)
                    // A press puts the keyboard on the band, as a click does on the web.
                    byPointer = true
                    focused = true
                    driver.began(at: Double(value.startLocation.x), time: value.time)
                }
                driver.moved(to: x, time: value.time)
            }
            .onEnded { value in
                driver.ended(at: Double(value.location.x), width: Double(width), time: value.time,
                             reduceMotion: reduceMotion)
            }
    }

    // MARK: - the frame, the keys, the reader

    private func framed(_ content: some View) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        return content
            .frame(height: PieceStripMetrics.bandHeight)
            .background(shape.fill(palette.paper2))
            .clipShape(shape)
            .overlay(shape.strokeBorder(palette.line, lineWidth: 1))
            .overlay {
                if focused && !byPointer {
                    shape.stroke(palette.accent, lineWidth: 2)
                }
            }
            #if os(macOS)
            .overlay(PieceBandWheel { dx in
                driver.model = model
                driver.pxPerSecond = PieceStripMetrics.pxPerSecond(compact: compact)
                driver.wheel(dx)
            })
            .onHover { inside in
                if inside { NSCursor.openHand.push() } else { NSCursor.pop() }
            }
            #endif
            .onDisappear { driver.stop() }
    }

    private func keyed(_ content: some View) -> some View {
        content
            .focusable()
            .focusEffectDisabled()
            .focused($focused)
            .onChange(of: focused) { _, on in if !on { byPointer = false } }
            .onKeyPress(phases: [.down, .repeat]) { press in
                let mods = press.modifiers
                if mods.contains(.command) || mods.contains(.control) || mods.contains(.option) { return .ignored }
                if press.key == .home || press.key == .end {
                    driver.stop()
                    return model.handleBandKey(press.key) ? .handled : .ignored
                }
                guard let key = EditorKeyPress(press) else { return .ignored }
                if model.handleBandKey(key) {
                    driver.stop()
                    return .handled
                }
                // Everything else is the editor's (I / O, L, M).
                return model.handleKey(key) ? .handled : .ignored
            }
    }

    private func accessible(_ content: some View) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("The piece — drag to move through it")
            .accessibilityValue(readout)
            .accessibilityAdjustableAction { direction in
                let l = stripLayout(model.lengths, 1, 0, 0)
                let t = stepSlide(l, model.deck.time, direction == .increment ? 1 : -1)
                model.scrubPiece(min(l.seconds, max(0, t)))
            }
    }

    /// `Picture 2, 0:04.20 of 0:12.00`.
    private var readout: String {
        guard let slide = model.slide else { return "" }
        return "\(PieceTransportRow.slideName(slide)), \(formatTimecode(shown)) of \(formatTimecode(model.deck.seconds))"
    }
}

// MARK: - one cell

/// One slide on the band: its thumbnail tiled along its length, its label,
/// its motion marks, the ring when open. Equatable, so the band sliding under
/// the needle moves the cells without redrawing them.
struct PieceStripCell: View, Equatable {
    let width: CGFloat
    let label: String
    let video: Bool
    let open: Bool
    let loopMark: Bool
    /// The marks' x, in the cell's points.
    let marks: [CGFloat]
    let thumb: CGImage?
    let aspect: CGFloat

    @Environment(\.palette) private var palette

    static func == (a: PieceStripCell, b: PieceStripCell) -> Bool {
        a.width == b.width && a.label == b.label && a.video == b.video && a.open == b.open
            && a.loopMark == b.loopMark && a.marks == b.marks && a.thumb === b.thumb && a.aspect == b.aspect
    }

    /// `Hook 5s`, `2 3s · 2×`, `End 3s`.
    static func label(_ slide: DeckSlide, _ length: Double) -> String {
        let name: String
        switch slide.kind {
        case .hook: name = "Hook"
        case .cta: name = "End"
        case .content: name = String(slide.position)
        }
        let speed = slide.speed != 1 ? " · \(PieceTransportRow.speedWord(slide.speed))×" : ""
        return "\(name) \(PieceTransportRow.secondsWord(length))\(speed)"
    }

    /// Where slide's pictures have frames placed, as x along a cell `width`
    /// wide — kept 4 points inside its ends.
    static func marks(_ slide: DeckSlide, _ length: Double, _ openerSeconds: Double, width: CGFloat) -> [CGFloat] {
        guard length > 0 else { return [] }
        return slideMotionMarks(slide, length, openerSeconds).map { at in
            let x = CGFloat(max(0, min(1, at / length))) * width
            return max(4, min(width - 4, x))
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6)
        let h = PieceStripMetrics.cellHeight
        return ZStack(alignment: .topLeading) {
            shape.fill(video ? palette.frame : palette.paper)
            if let thumb {
                tiles(thumb)
            }
            if !video {
                shape.strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
            }
            Text(label)
                .font(Brand.mono(9.3))
                .foregroundStyle(palette.onMedia)
                .shadow(color: .black.opacity(0.85), radius: 1, x: 0, y: 1)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 4)
                .padding(.top, 2)
                .frame(width: width, alignment: .leading)
            ForEach(Array(marks.enumerated()), id: \.offset) { _, x in
                PieceMotionMark()
                    .position(x: x, y: h - 2 - 3)
            }
            if loopMark {
                Image(systemName: "repeat.1")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(palette.onMedia)
                    .frame(width: 16, height: 16)
                    .background(Circle().fill(palette.accent))
                    .position(x: width - 2 - 8, y: h - 2 - 8)
            }
        }
        .frame(width: width, height: h, alignment: .topLeading)
        .clipShape(shape)
        .overlay {
            if open {
                shape.inset(by: -1).stroke(palette.accent, lineWidth: 2)
            }
        }
    }

    /// The picture again and again along the cell: a clip's frames split by
    /// dark rules, a still's copies by paper, each at the piece's aspect on
    /// the height inside the cell (a still's dashed border takes a point).
    private func tiles(_ thumb: CGImage) -> some View {
        let inset: CGFloat = video ? 0 : 1
        let tile = max(12, ((PieceStripMetrics.cellHeight - inset * 2) * aspect).rounded())
        let rule = video ? Color.black.opacity(0.55) : palette.paper
        return Canvas { context, size in
            let image = context.resolve(Image(decorative: thumb, scale: 1, orientation: .up))
            let height = size.height - inset * 2
            var x: CGFloat = 0
            while x < size.width {
                context.draw(image, in: CGRect(x: x + inset, y: inset, width: tile, height: height))
                context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(rule))
                x += tile
            }
        }
        .frame(width: width, height: PieceStripMetrics.cellHeight)
        .allowsHitTesting(false)
    }
}

/// A frame placed along a slide — an accent diamond with a light rim.
private struct PieceMotionMark: View {
    @Environment(\.palette) private var palette

    var body: some View {
        Rectangle()
            .fill(palette.accent)
            .overlay(Rectangle().stroke(Color.white.opacity(0.8), lineWidth: 1))
            .frame(width: 6, height: 6)
            .rotationEffect(.degrees(45))
    }
}

/// The needle: where the piece is, always in the middle — a line with a
/// small head pointing down at the band.
private struct PieceNeedle: View {
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack(alignment: .top) {
            Rectangle()
                .fill(palette.ink)
                .frame(width: 2)
                .padding(.top, 4)
            Path { p in
                p.move(to: CGPoint(x: 0, y: 0))
                p.addLine(to: CGPoint(x: 10, y: 0))
                p.addLine(to: CGPoint(x: 5, y: 6))
                p.closeSubpath()
            }
            .fill(palette.ink)
            .frame(width: 10, height: 6)
        }
    }
}

// MARK: - the Mac's wheel

#if os(macOS)
/// A transparent view over the band that claims ONLY scroll-wheel events, so
/// every click and drag still reaches the band under it; a sideways sweep
/// (or Shift + wheel) is handed over in the web's pixels, a vertical one
/// passed on.
struct PieceBandWheel: NSViewRepresentable {
    let onSweep: (Double) -> Void

    func makeNSView(context: Context) -> SweepView {
        let view = SweepView()
        view.onSweep = onSweep
        return view
    }

    func updateNSView(_ view: SweepView, context: Context) {
        view.onSweep = onSweep
    }

    final class SweepView: NSView {
        var onSweep: ((Double) -> Void)?

        override var isFlipped: Bool { true }

        override func hitTest(_ point: NSPoint) -> NSView? {
            guard NSApp.currentEvent?.type == .scrollWheel else { return nil }
            return super.hitTest(point)
        }

        override func scrollWheel(with event: NSEvent) {
            // A line-based wheel (a mouse) is in lines; the web reads pixels.
            let scale: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 16
            let deltaX = Double(-event.scrollingDeltaX * scale)
            let deltaY = Double(-event.scrollingDeltaY * scale)
            let shift = event.modifierFlags.contains(.shift)
            let dx = shift && deltaX == 0 ? deltaY : deltaX
            guard abs(dx) > abs(shift ? 0 : deltaY), let onSweep else {
                super.scrollWheel(with: event)
                return
            }
            onSweep(dx)
        }
    }
}
#endif
