// The overlay renderer's GEOMETRY — the layout half of
// `src/shared/overlay/draw-overlays.ts` (and the arithmetic of `draw-qr.ts`
// and `draw-guides.ts`). The PAINT is the app's
// (`apple/Atelier/Paint/OverlayPainter.swift`, Core Graphics + Core Text);
// everything here decides WHERE and WHETHER, and is shared by the paint and
// by `measureOverlays`, so what the stage lets you grab is exactly what is
// drawn — the web's `layoutElement` rule.
//
// Coordinates are the frame's own pixels, y DOWN, as on a canvas: positions
// are normalised (0..1 of width and height) and a size is a fraction of the
// frame's SHORTER side, so the preview's size and the export's give one
// layout at two scales.
//
// Font metrics are the one thing a kernel cannot know: a text element's box
// needs a measure, which the app hands in (`OverlayGeometry.Measure`, Core
// Text there; any function in a spec). The measure is asked for the ADVANCE
// width, letter spacing included, and the INK ascent and descent above and
// below the alphabetic baseline — the canvas's `measureText().width` and
// `actualBoundingBoxAscent/Descent`.
//
// Names differing from the web: the module's free functions are statics of
// `OverlayGeometry` (a module-wide `hitTest` would collide), the web's
// `DrawOptions` minus its theme and clock is `OverlayDrawOptions`, `Layout`
// is `OverlayGeometry.TextLayout`, `headingFor` is `heading(for:)`, and the
// draw loop's own decisions — which element, which transform — are
// `drawPlan`, which the app's `drawOverlays` walks.

import Foundation

/// What the renderer is told besides the elements, the cue, the clock and the
/// theme — the web's `DrawOptions` without `theme` and `timeSeconds`, which
/// the painter takes as parameters of their own.
public struct OverlayDrawOptions: Sendable {
    /// The project's capture-time correction, applied to every clock, date
    /// and timestamp element at once.
    public var timeShift: TimeShift?
    /// The whole cue list: the heading instruments ease over a window of it.
    public var cues: [Cue]?
    /// The project's scenes (the intro and anything else lending a group one
    /// window, a scrim and the power to hold the rest back).
    public var scenes: [OverlayScene]?
    /// Media time of the FIRST EXPORTED FRAME — windows count from it.
    public var originSeconds: Double
    /// Editor-only: this element is drawn even outside its window, ghosted,
    /// so it stays selectable. Never set on an export path.
    public var ghostId: String?

    public init(timeShift: TimeShift? = nil, cues: [Cue]? = nil, scenes: [OverlayScene]? = nil,
                originSeconds: Double = 0, ghostId: String? = nil) {
        self.timeShift = timeShift; self.cues = cues; self.scenes = scenes
        self.originSeconds = originSeconds; self.ghostId = ghostId
    }
}

/// One run of text measured the way a canvas measures it: the advance width
/// (letter spacing included) and the ink above and below the baseline.
public struct OverlayTextMetrics: Equatable, Sendable {
    public var width: Double
    public var ascent: Double
    public var descent: Double
    public init(width: Double, ascent: Double, descent: Double) {
        self.width = width; self.ascent = ascent; self.descent = descent
    }
}

public enum OverlayGeometry {
    /// Measure `text` in `style`'s face at `fontPx`, with `letterSpacingPx`
    /// added after every character (the canvas's `letterSpacing`).
    public typealias Measure = (_ text: String, _ style: ResolvedStyle, _ fontPx: Double, _ letterSpacingPx: Double) -> OverlayTextMetrics

    /// How visible an out-of-window element is while it is selected in the editor.
    public static let ghostAlpha = 0.35

    /// With the compass ring on, the arrow's half-size `r` grows to this many
    /// `r`: ring edge 2.0, letter centre 2.5, label edge 2.75, padded.
    public static let compassFactor = 2.9

    /// The rotate prompt's phone height and arc radius, as fractions of its
    /// square — chosen so the phone's half-diagonal never reaches the arc.
    public static let defaultPhoneScale = 0.66
    public static let defaultArcScale = 0.44

    /// The frame's shorter side — the reference every `sizeFrac` multiplies.
    public static func refDim(_ vw: Double, _ vh: Double) -> Double {
        min(vw, vh)
    }

    // MARK: - anchors

    private static func split(_ anchor: OverlayAnchor) -> (v: Character, h: Character) {
        switch anchor {
        case .topLeft: return ("t", "l")
        case .topCenter: return ("t", "c")
        case .topRight: return ("t", "r")
        case .centerLeft: return ("c", "l")
        case .center: return ("c", "c")
        case .centerRight: return ("c", "r")
        case .bottomLeft: return ("b", "l")
        case .bottomCenter: return ("b", "c")
        case .bottomRight: return ("b", "r")
        }
    }

    /// Top-left draw origin for a `w`×`h` box whose anchor point sits at
    /// (`ax`, `ay`).
    public static func anchorOrigin(_ anchor: OverlayAnchor, _ ax: Double, _ ay: Double, _ w: Double, _ h: Double) -> Point {
        let (v, hor) = split(anchor)
        var x = ax
        if hor == "c" { x = ax - w / 2 } else if hor == "r" { x = ax - w }
        var y = ay
        if v == "c" { y = ay - h / 2 } else if v == "b" { y = ay - h }
        return Point(x, y)
    }

    /// Where the anchor point sits for a box whose top-left is (`x`, `y`) —
    /// the exact inverse of `anchorOrigin`, which is what re-anchors an
    /// element IN PLACE.
    public static func anchorPoint(_ anchor: OverlayAnchor, _ x: Double, _ y: Double, _ w: Double, _ h: Double) -> Point {
        let (v, hor) = split(anchor)
        var ax = x
        if hor == "c" { ax = x + w / 2 } else if hor == "r" { ax = x + w }
        var ay = y
        if v == "c" { ay = y + h / 2 } else if v == "b" { ay = y + h }
        return Point(ax, ay)
    }

    // MARK: - text elements

    /// One text element laid out: its string as drawn, its size, its tight box
    /// in frame pixels, the baseline's offset from the box top, and the style
    /// the theme resolved it to.
    public struct TextLayout: Equatable, Sendable {
        public var text: String
        public var fontPx: Double
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
        /// Baseline offset from the box top (for an alphabetic baseline).
        public var ascent: Double
        public var style: ResolvedStyle
    }

    /// The web's `layoutElement`: nil for an element with nothing to show
    /// (and for the shape kinds, whose text is empty).
    public static func textLayout(_ el: OverlayElement, _ cue: Cue?, _ vw: Double, _ vh: Double,
                                  theme: StyleTheme?, timeShift: TimeShift?, measure: Measure) -> TextLayout? {
        let raw = renderElementText(el, cue, shift: timeShift)
        if raw.isEmpty { return nil }
        let st = resolveElementStyle(el, theme)
        let text = st.uppercase ? raw.uppercased() : raw
        let fontPx = max(1, st.sizeFrac * refDim(vw, vh))
        let m = measure(text, st, fontPx, st.letterSpacingEm * fontPx)
        let h = m.ascent + m.descent
        let o = anchorOrigin(el.anchor, el.x * vw, el.y * vh, m.width, h)
        return TextLayout(text: text, fontPx: fontPx, x: o.x, y: o.y, w: m.width, h: h, ascent: m.ascent, style: st)
    }

    /// How much of a partly revealed text a typewriter shows: whole CODE
    /// POINTS (the web spreads the string, `[...text]`), rounded half up.
    /// `nil` when the whole text shows.
    public static func typedPrefix(_ text: String, _ reveal: Double) -> String? {
        let scalars = Array(text.unicodeScalars)
        let shown = Int(jsRound(Double(scalars.count) * reveal))
        if shown >= scalars.count { return nil }
        if shown <= 0 { return "" }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars[0..<shown])
        return String(view)
    }

    // MARK: - the heading arrow

    public struct ArrowLayout: Equatable, Sendable {
        /// Centre of the element in frame pixels.
        public var cx: Double
        public var cy: Double
        /// Chevron half-size.
        public var r: Double
        /// `r`, or `r × compassFactor` with the ring on.
        public var halfSize: Double
        /// The bounding square (hit-testing, anchors).
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
    }

    /// The arrow's square. Its size is the ELEMENT's `sizeFrac` (never the
    /// theme's multiplier), as the web's.
    public static func arrowLayout(_ el: OverlayElement, _ vw: Double, _ vh: Double) -> ArrowLayout {
        let r = max(2, el.sizeFrac * refDim(vw, vh) * 0.5)
        let halfSize = el.showCompass == true ? r * compassFactor : r
        let w = halfSize * 2
        let h = halfSize * 2
        let o = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h)
        return ArrowLayout(cx: o.x + halfSize, cy: o.y + halfSize, r: r, halfSize: halfSize, x: o.x, y: o.y, w: w, h: h)
    }

    // MARK: - the heading tape

    public struct TapeLayout: Equatable, Sendable {
        /// Centre of the ribbon (where the sight sits).
        public var cx: Double
        public var cy: Double
        public var halfW: Double
        public var fontPx: Double
        /// Major tick height; minors are 55 % of it.
        public var tickH: Double
        /// Bounding box, caption included.
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
        /// Offset from the box top to the ribbon's centre line.
        public var ribbonDy: Double
    }

    public static func tapeLayout(_ el: OverlayElement, _ st: ResolvedStyle, _ vw: Double, _ vh: Double) -> TapeLayout {
        let fontPx = max(4, st.sizeFrac * refDim(vw, vh))
        let halfW = max(fontPx, ((el.tapeWidthFrac ?? 0.5) * vw) / 2)
        let tickH = max(2, fontPx * (el.tapeTickScale ?? 1))
        let place = el.tapeLabel ?? .above
        // Ribbon band: ticks hang below the rule, labels sit under them.
        let bandH = tickH + fontPx * 1.35
        // A caption above/below adds a line; left/right widen instead.
        let capH = place == .above || place == .below ? fontPx * 1.5 : 0
        let capW = place == .left || place == .right ? fontPx * 6 : 0
        let w = halfW * 2 + capW
        let h = bandH + capH
        let o = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h)
        let ribbonTop = place == .above ? o.y + capH : o.y
        let cx = place == .left ? o.x + capW + halfW : o.x + halfW
        return TapeLayout(cx: cx, cy: ribbonTop, halfW: halfW, fontPx: fontPx, tickH: tickH,
                          x: o.x, y: o.y, w: w, h: h, ribbonDy: ribbonTop - o.y)
    }

    // MARK: - the battery

    public struct BatteryLayout: Equatable, Sendable {
        /// Top-left of the cell itself (the caption sits outside it).
        public var cellX: Double
        public var cellY: Double
        public var cellW: Double
        public var cellH: Double
        public var fontPx: Double
        /// Bounding box, caption included.
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
    }

    /// Where the gauge's caption sits: none when the percentage is off.
    public static func batteryPlace(_ el: OverlayElement) -> LabelPlacement {
        el.batteryShowPercent == false ? .none : (el.batteryLabel ?? .right)
    }

    public static func batteryLayout(_ el: OverlayElement, _ st: ResolvedStyle, _ vw: Double, _ vh: Double) -> BatteryLayout {
        let fontPx = max(4, st.sizeFrac * refDim(vw, vh))
        let cellH = fontPx * 1.15
        let cellW = cellH * max(1.2, el.batteryAspect ?? 2.1)
        // The nub on the positive end reads as a battery at any size.
        let nub = cellW * 0.07
        let place = batteryPlace(el)
        let capW = place == .left || place == .right ? fontPx * 2.8 : 0
        let capH = place == .above || place == .below ? fontPx * 1.35 : 0
        let w = cellW + nub + capW
        let h = cellH + capH
        let o = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h)
        return BatteryLayout(cellX: place == .left ? o.x + capW : o.x, cellY: place == .above ? o.y + capH : o.y,
                             cellW: cellW, cellH: cellH, fontPx: fontPx, x: o.x, y: o.y, w: w, h: h)
    }

    // MARK: - the rotate-device prompt

    public struct RotateLayout: Equatable, Sendable {
        /// Bounding box, caption included.
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
        /// Centre of the square the phone tips inside.
        public var cx: Double
        public var cy: Double
        /// The square's side.
        public var side: Double
        public var phoneW: Double
        public var phoneH: Double
        public var arcRadius: Double
        public var arcWeight: Double
        public var fontPx: Double
        public var caption: String
        public var place: LabelPlacement
        public var gap: Double
    }

    /// The pictogram's geometry: a SQUARE of the phone's height, so the
    /// element never jumps around its anchor mid-turn. The side caption is
    /// measured WITHOUT letter spacing, as the web measures it (it paints it
    /// with).
    public static func rotateLayout(_ el: OverlayElement, _ st: ResolvedStyle, _ vw: Double, _ vh: Double,
                                    measure: Measure) -> RotateLayout {
        let side = max(8, st.sizeFrac * refDim(vw, vh))
        let phoneH = side * (el.rotatePhoneScale ?? defaultPhoneScale)
        let phoneW = phoneH * 0.52
        let arcRadius = side * (el.rotateArcScale ?? defaultArcScale)
        let arcWeight = max(0.8, side * 0.028)
        let fontPx = max(4, side * 0.15)
        let own = el.text ?? ""
        let caption = st.uppercase ? own.uppercased() : own
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let place: LabelPlacement = trimmed.isEmpty ? .none : (el.rotateLabel ?? .below)
        let gap = side * 0.08

        var capW = 0.0
        if place == .left || place == .right {
            capW = measure(caption, st, fontPx, 0).width + gap
        }
        let capH = place == .above || place == .below ? fontPx * 1.35 + gap : 0

        let w = side + capW
        let h = side + capH
        let o = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h)
        let sqX = place == .left ? o.x + capW : o.x
        let sqY = place == .above ? o.y + capH : o.y
        return RotateLayout(x: o.x, y: o.y, w: w, h: h, cx: sqX + side / 2, cy: sqY + side / 2, side: side,
                            phoneW: phoneW, phoneH: phoneH, arcRadius: arcRadius, arcWeight: arcWeight,
                            fontPx: fontPx, caption: caption, place: place, gap: gap)
    }

    // MARK: - the heading the instruments draw

    public struct HeadingReading: Equatable, Sendable {
        /// The bearing to draw, or nil (hovering, no data, or too stale).
        public var heading: Double?
        /// How strongly: 1 live; a stale bearing in `dim` mode fades to 0.25.
        public var alpha: Double
    }

    /// The web's `headingFor`: the eased bearing over the cue list, or the
    /// cue's own raw reading when no list was supplied (the legacy page).
    /// `time` is MEDIA time — the smoothing reads the cues' own clock.
    public static func heading(for el: OverlayElement, cue: Cue?, time: Double, cues: [Cue]?) -> HeadingReading {
        let early = el.earlyValues != false
        let raw = motionAt(cue, early: early).heading
        guard let cues, !cues.isEmpty else { return HeadingReading(heading: raw, alpha: 1) }
        let gap = el.headingGap ?? .dim
        let hold = gap == .hide ? 0 : (el.headingHoldSeconds ?? 2)
        let out = smoothHeading(cues, time, tauSeconds: el.headingSmoothing ?? 0.6, holdSeconds: hold, early: early)
        guard let heading = out.heading else { return HeadingReading(heading: nil, alpha: 1) }
        // Live data always draws at full strength; only a stale bearing
        // fades, and only in `dim` mode. `hold` shows it plainly until the
        // window runs out.
        if out.confidence <= 0 { return HeadingReading(heading: nil, alpha: 1) }
        return HeadingReading(heading: heading, alpha: gap == .dim ? max(0.25, out.confidence) : 1)
    }

    // MARK: - what is drawn, and how

    /// Seconds since the first exported frame — what windows count from.
    public static func elapsed(time: Double, originSeconds: Double) -> Double {
        max(0, time - originSeconds)
    }

    /// The stagger every scene adds to its members' entrances, by element id.
    public static func sceneDelays(_ scenes: [OverlayScene]?, _ elements: [OverlayElement], aspect: Double) -> [String: Double] {
        var out: [String: Double] = [:]
        guard let scenes else { return out }
        for scene in scenes where scene.staggerValue != nil {
            for (id, delay) in sceneStaggerDelays(scene, elements, aspect) { out[id] = delay }
        }
        return out
    }

    /// One element the paint loop draws, with the transform it draws under.
    public struct DrawItem: Equatable, Sendable {
        public var element: OverlayElement
        public var transform: OverlayTransform
        /// Seconds since the element's window opened — the rotate prompt's
        /// own cycle starts there, so the phone always starts upright.
        public var localSeconds: Double
    }

    public struct DrawPlan: Equatable, Sendable {
        /// The scene veil under every element, when one is up.
        public var scrim: SceneScrimRender?
        public var elapsed: Double
        public var items: [DrawItem]
    }

    /// The decisions of the web's `drawOverlays` loop: which elements draw, in
    /// order, under which transform — the scene solo's hold-back folded into
    /// the alpha, an out-of-window element skipped unless it is the editor's
    /// ghost.
    public static func drawPlan(_ elements: [OverlayElement], _ vw: Double, _ vh: Double,
                                time: Double, options: OverlayDrawOptions) -> DrawPlan {
        let elapsed = self.elapsed(time: time, originSeconds: options.originSeconds)
        let layer = resolveScenes(options.scenes, elapsed)
        let delays = sceneDelays(options.scenes, elements, aspect: vw / vh)
        var items: [DrawItem] = []
        for el in elements where el.visible {
            let scene = findScene(options.scenes, el.sceneId)
            let win = resolveWindow(el, scene)
            var tf = transformAt(staggeredAnimation(el.animation, delays[el.id] ?? 0), win, elapsed)
            if scene == nil && layer.outsideAlpha < 1 {
                tf.alpha *= layer.outsideAlpha
            }
            if isHidden(tf) {
                // Out of its window: not drawn — unless the editor is pointing
                // at it, in which case a ghost keeps it selectable.
                if options.ghostId != el.id { continue }
                tf = OverlayTransform(alpha: ghostAlpha, dx: 0, dy: 0, scale: 1, reveal: 1, revealSteps: false)
            }
            items.append(DrawItem(element: el, transform: tf, localSeconds: elapsed - (win?.start ?? 0)))
        }
        return DrawPlan(scrim: layer.scrim, elapsed: elapsed, items: items)
    }

    /// Whether an element is on screen at this instant — the same answer the
    /// draw plan acts on, so hit boxes never outlive what is painted.
    public static func isOnScreen(_ el: OverlayElement, options: OverlayDrawOptions, elapsed: Double,
                                  outsideAlpha: Double, extraDelay: Double = 0) -> Bool {
        if options.ghostId == el.id { return true }
        let scene = findScene(options.scenes, el.sceneId)
        // Held back by a solo scene counts as off screen: during an intro that
        // hides the HUD, a click must not land on an invisible readout.
        if scene == nil && outsideAlpha <= 0 { return false }
        return !isHidden(transformAt(staggeredAnimation(el.animation, extraDelay), resolveWindow(el, scene), elapsed))
    }

    // MARK: - boxes

    /// One element's box in frame pixels — for hit-testing and the selection
    /// outline.
    public struct ElementBox: Equatable, Sendable {
        public var id: String
        public var x: Double
        public var y: Double
        public var w: Double
        public var h: Double
        public init(id: String, x: Double, y: Double, w: Double, h: Double) {
            self.id = id; self.x = x; self.y = y; self.w = w; self.h = h
        }
    }

    private static func padded(_ id: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ margin: Double) -> ElementBox {
        ElementBox(id: id, x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2)
    }

    /// Boxes for every visible element, in draw order (the last is topmost).
    /// A box covers the legibility padding (and a glow's bleed) plus a small
    /// hit margin, and is measured WITHOUT the animation's transform — a title
    /// mid-slide would otherwise squirm away from the pointer. Frame corners
    /// have none: they span the frame and would swallow every click.
    public static func measureOverlays(_ elements: [OverlayElement], _ cue: Cue?, _ vw: Double, _ vh: Double,
                                       time: Double, theme: StyleTheme?, options: OverlayDrawOptions,
                                       measure: Measure) -> [ElementBox] {
        let elapsed = self.elapsed(time: time, originSeconds: options.originSeconds)
        let outsideAlpha = resolveScenes(options.scenes, elapsed).outsideAlpha
        let delays = sceneDelays(options.scenes, elements, aspect: vw / vh)
        var boxes: [ElementBox] = []
        for el in elements where el.visible {
            if el.kind == .frameCorners { continue }
            if !isOnScreen(el, options: options, elapsed: elapsed, outsideAlpha: outsideAlpha,
                           extraDelay: delays[el.id] ?? 0) { continue }
            switch el.kind {
            case .rotateDevice:
                let lay = rotateLayout(el, resolveElementStyle(el, theme), vw, vh, measure: measure)
                boxes.append(padded(el.id, lay.x, lay.y, lay.w, lay.h, max(2, lay.fontPx * 0.3)))
            case .headingArrow:
                let lay = arrowLayout(el, vw, vh)
                boxes.append(padded(el.id, lay.x, lay.y, lay.w, lay.h, max(2, lay.r * 0.15)))
            case .headingTape, .battery:
                let st = resolveElementStyle(el, theme)
                let margin = max(2, st.sizeFrac * refDim(vw, vh) * 0.3)
                if el.kind == .headingTape {
                    let lay = tapeLayout(el, st, vw, vh)
                    boxes.append(padded(el.id, lay.x, lay.y, lay.w, lay.h, margin))
                } else {
                    let lay = batteryLayout(el, st, vw, vh)
                    boxes.append(padded(el.id, lay.x, lay.y, lay.w, lay.h, margin))
                }
            default:
                guard let lay = textLayout(el, cue, vw, vh, theme: theme, timeShift: options.timeShift, measure: measure) else {
                    continue
                }
                boxes.append(padded(el.id, lay.x, lay.y, lay.w, lay.h, textMargin(lay)))
            }
        }
        return boxes
    }

    /// A text element's grab margin: everything painted — the legibility
    /// padding and outline, and a glow's bleed — never under a fifth of an em.
    public static func textMargin(_ lay: TextLayout) -> Double {
        let leg = lay.style.legibility
        let border = leg.mode == .box ? (leg.borderWidthFrac ?? 0) * lay.fontPx * 0.5 : 0
        let glow = lay.style.glow.map { $0.bleedRadiusFrac * lay.fontPx * 0.5 } ?? 0
        return max(leg.padFrac * lay.fontPx + border, lay.fontPx * 0.2, glow)
    }

    /// Topmost box containing (`px`, `py`), edges inclusive; boxes are in draw
    /// order, so the search runs back to front.
    public static func hitTest(_ boxes: [ElementBox], _ px: Double, _ py: Double) -> String? {
        for b in boxes.reversed() where px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h {
            return b.id
        }
        return nil
    }

    /// One element's box, for its selection outline.
    public static func boxForId(_ boxes: [ElementBox], _ id: String) -> ElementBox? {
        boxes.first { $0.id == id }
    }

    /// Re-anchor an element to `anchor` keeping its rendered box where it is:
    /// the normalised (x, y) the new anchor needs. Nil when there is nothing
    /// to measure (frame corners, an empty text) — then just swap the anchor.
    public static func reanchorInPlace(_ el: OverlayElement, _ cue: Cue?, _ vw: Double, _ vh: Double, _ anchor: OverlayAnchor,
                                       theme: StyleTheme?, timeShift: TimeShift?, measure: Measure) -> Point? {
        let box: (x: Double, y: Double, w: Double, h: Double)
        switch el.kind {
        case .frameCorners:
            return nil
        case .headingArrow:
            let lay = arrowLayout(el, vw, vh)
            box = (lay.x, lay.y, lay.w, lay.h)
        case .headingTape:
            let lay = tapeLayout(el, resolveElementStyle(el, theme), vw, vh)
            box = (lay.x, lay.y, lay.w, lay.h)
        case .battery:
            let lay = batteryLayout(el, resolveElementStyle(el, theme), vw, vh)
            box = (lay.x, lay.y, lay.w, lay.h)
        case .rotateDevice:
            let lay = rotateLayout(el, resolveElementStyle(el, theme), vw, vh, measure: measure)
            box = (lay.x, lay.y, lay.w, lay.h)
        default:
            guard let lay = textLayout(el, cue, vw, vh, theme: theme, timeShift: timeShift, measure: measure) else { return nil }
            box = (lay.x, lay.y, lay.w, lay.h)
        }
        let p = anchorPoint(anchor, box.x, box.y, box.w, box.h)
        return Point(p.x / vw, p.y / vh)
    }

    // MARK: - the glow's grain

    /// Side of the grain tile.
    public static let grainTileSize = 128

    /// The glow's noise tile, grey values row by row — the web's LCG to the
    /// bit, JavaScript's arithmetic included: `seed * 1103515245` is a DOUBLE
    /// product that loses its low bits past 2^53, then `& 0x7fffffff` takes
    /// ToInt32 of it. So the tile is mostly 0 with sparse 64s and 128s — what
    /// the web draws, kept rather than "fixed" on one side only.
    public static func grainTile() -> [UInt8] {
        let n = grainTileSize * grainTileSize
        var out = [UInt8](repeating: 0, count: n)
        var seed = 987654321.0
        for i in 0..<n {
            // Two roundings, as JavaScript does them: the product, then the sum.
            let product = seed * 1103515245
            let sum = product + 12345
            var m = sum.truncatingRemainder(dividingBy: 4294967296)
            if m < 0 { m += 4294967296 }
            let int32 = UInt32(m) & 0x7fffffff
            seed = Double(int32)
            out[i] = UInt8(int32 % 256)
        }
        return out
    }

    /// Where the grain's noise field starts at media time `time`: stepped ten
    /// times a second, so the preview and the export grain alike.
    public static func grainOffset(_ time: Double) -> (x: Int, y: Int) {
        let step = Int((time * 10).rounded(.down))
        return ((step * 53) % grainTileSize, (step * 97) % grainTileSize)
    }

    /// The whole-pixel box the grain of `lay` is composed in: the text's box
    /// grown by the bleed and a third of an em.
    public static func grainBox(_ lay: TextLayout, _ glow: GlowLayers) -> (x: Double, y: Double, w: Double, h: Double) {
        let reach = glow.bleedRadiusFrac * lay.fontPx + lay.fontPx * 0.3
        let x = (lay.x - reach).rounded(.down)
        let y = (lay.y - reach).rounded(.down)
        let w = (lay.w + reach * 2).rounded(.up)
        let h = (lay.h + reach * 2).rounded(.up)
        return (x, y, w, h)
    }

    // MARK: - the QR square (`draw-qr.ts`)

    /// A QR square snapped so every module is a whole number of pixels, its
    /// four-module quiet zone included, centred on where it was put.
    public struct QrPlacement: Equatable, Sendable {
        public var left: Double
        public var top: Double
        /// One module's side, whole pixels, at least 1.
        public var module: Double
        /// The whole square drawn, quiet zone included.
        public var drawn: Double
    }

    /// The quiet zone, in modules, on every side.
    public static let qrQuietModules = 4

    public static func qrPlacement(_ w: Double, _ h: Double, _ qr: QrDraw) -> QrPlacement {
        let side = qr.sizeFrac * min(w, h)
        let total = Double(qr.matrix.size + qrQuietModules * 2)
        let module = max(1, (side / total).rounded(.down))
        let drawn = module * total
        // Centre what the rounding left over, so the square stays where it was put.
        let left = jsRound(qr.x * w + (side - drawn) / 2)
        let top = jsRound(qr.y * h + (side - drawn) / 2)
        return QrPlacement(left: left, top: top, module: module, drawn: drawn)
    }

    // MARK: - the grid guide (`draw-guides.ts`)

    /// Where a grid of `divisions` puts its inner lines across `extent`: on a
    /// whole pixel plus a half, so a one-pixel line is crisp.
    public static func gridLines(_ divisions: Int, _ extent: Double) -> [Double] {
        guard divisions > 1 else { return [] }
        return (1..<divisions).map { jsRound(Double($0) / Double(divisions) * extent) + 0.5 }
    }

    /// JS `Math.round`: halves toward +∞.
    private static func jsRound(_ x: Double) -> Double {
        let floor = x.rounded(.down)
        return x - floor >= 0.5 ? floor + 1 : floor
    }
}
