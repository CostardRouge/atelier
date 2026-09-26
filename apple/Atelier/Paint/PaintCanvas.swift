// A canvas 2D context, as far as the painters under `Paint/` use one, over a
// Core Graphics context — so `OverlayPainter` and its siblings are the web's
// `draw-overlays.ts` & co. line for line, and a difference between the two is
// a difference in ONE place.
//
// The user space is the FRAME's, y DOWN, origin at its top-left: SwiftUI's
// `Canvas` / `GraphicsContext.withCGContext` space as it comes, or an
// `OverlayRaster` bitmap (which flips itself). Everything the web measures in
// canvas pixels is measured in it.
//
// What a canvas does that Core Graphics does differently, and how it is kept:
// - STATE: a canvas's globalAlpha, styles, font, alignment, shadow and
//   composite live in a Swift-side stack pushed and popped with the CG state,
//   and are applied to CG right before each paint — CG cannot READ its alpha
//   back, and `globalAlpha *= 0.5` needs to.
// - THE PATH survives a fill (the web fills then strokes one path, and clips
//   with one): it is a `CGMutablePath` of our own, added to the context at
//   each paint. Every call site builds and paints a path under one transform.
// - SHADOWS: a canvas measures shadowBlur and the offsets in the canvas's
//   own units, untouched by the transform; CG measures them in DEVICE space,
//   untouched by the transform too. So both are converted once, through the
//   frame space's device transform captured when the canvas is made — which
//   also turns a canvas's "down" into whatever the device's y is.
// - `filter: blur(r)` (the glow's softened core) has no CG twin: the run is
//   drawn far outside the frame with a shadow of radius 2r offset back onto
//   it — a Gaussian of σ = r, which is what the CSS blur is.
// - TEXT goes through Core Text (`PaintFonts`), upright under the y-down CTM
//   by a flipped text matrix; `textBaseline`'s top / middle / bottom are the
//   em box's, as Chrome's are.
// - IMAGES are drawn with their top row at the top (CG would draw them
//   upside down in a y-down space).

import CoreGraphics
import CoreText
import Foundation

enum PaintStyle {
    case color(CGColor)
    /// A canvas `createLinearGradient(x0, y0, x1, y1)` with its stops.
    case linear(CGGradient, from: CGPoint, to: CGPoint)
}

enum CanvasTextAlign { case left, center, right }
enum CanvasTextBaseline { case top, middle, bottom, alphabetic }

enum CanvasComposite {
    case sourceOver, destinationIn, overlay

    var blendMode: CGBlendMode {
        switch self {
        case .sourceOver: return .normal
        case .destinationIn: return .destinationIn
        case .overlay: return .overlay
        }
    }
}

final class PaintCanvas {
    let cg: CGContext
    let width: Double
    let height: Double

    /// The frame space's user → device linear map when the canvas was made:
    /// what a shadow and a filter are measured through.
    private let base: CGAffineTransform
    private let baseScale: Double

    private struct State {
        var alpha: Double = 1
        var fill: PaintStyle = .color(CSSColor.black)
        var stroke: PaintStyle = .color(CSSColor.black)
        var lineWidth: Double = 1
        var lineCap: CGLineCap = .butt
        var dash: [CGFloat] = []
        var font = PaintFont(["sans-serif"], size: 10)
        var align: CanvasTextAlign = .left
        var baseline: CanvasTextBaseline = .alphabetic
        var letterSpacing: Double = 0
        var shadowColor: CGColor? = nil
        var shadowBlur: Double = 0
        var shadowOffsetX: Double = 0
        var shadowOffsetY: Double = 0
        var composite: CanvasComposite = .sourceOver
        var blur: Double = 0
        var smoothing: CGInterpolationQuality = .default
    }

    private var state = State()
    private var stack: [State] = []
    private var path = CGMutablePath()
    private let savedTextMatrix: CGAffineTransform

    /// A canvas over `cg`, whose user space is the `width`×`height` frame, y down.
    init(_ cg: CGContext, width: Double, height: Double) {
        self.cg = cg
        self.width = width
        self.height = height
        var m = cg.userSpaceToDeviceSpaceTransform
        m.tx = 0
        m.ty = 0
        base = m
        baseScale = max(1e-6, sqrt(abs(Double(m.a * m.d - m.b * m.c))))
        savedTextMatrix = cg.textMatrix
    }

    /// Hand the context back as it came: the text matrix is not part of CG's
    /// graphics state, so a save/restore would not undo ours.
    func finish() {
        while !stack.isEmpty { restore() }
        cg.textMatrix = savedTextMatrix
    }

    // MARK: - state

    func save() {
        stack.append(state)
        cg.saveGState()
    }

    func restore() {
        guard let previous = stack.popLast() else { return }
        state = previous
        cg.restoreGState()
    }

    var globalAlpha: Double {
        get { state.alpha }
        set { if newValue.isFinite { state.alpha = max(0, min(1, newValue)) } }
    }

    var composite: CanvasComposite {
        get { state.composite }
        set { state.composite = newValue }
    }

    /// A CSS colour; a string a canvas cannot parse is ignored, as there.
    func setFill(_ css: String) {
        if let c = CSSColor.parse(css) { state.fill = .color(c) }
    }

    func setFill(_ style: PaintStyle) { state.fill = style }

    func setStroke(_ css: String) {
        if let c = CSSColor.parse(css) { state.stroke = .color(c) }
    }

    func setStroke(_ style: PaintStyle) { state.stroke = style }

    var lineWidth: Double {
        get { state.lineWidth }
        set { if newValue.isFinite && newValue > 0 { state.lineWidth = newValue } }
    }

    var lineCap: CGLineCap {
        get { state.lineCap }
        set { state.lineCap = newValue }
    }

    func setLineDash(_ segments: [Double]) {
        state.dash = segments.map { CGFloat($0) }
    }

    var font: PaintFont {
        get { state.font }
        set { state.font = newValue }
    }

    var textAlign: CanvasTextAlign {
        get { state.align }
        set { state.align = newValue }
    }

    var textBaseline: CanvasTextBaseline {
        get { state.baseline }
        set { state.baseline = newValue }
    }

    /// The canvas's `letterSpacing`, in pixels.
    var letterSpacing: Double {
        get { state.letterSpacing }
        set { state.letterSpacing = newValue }
    }

    /// `shadowColor`: a CSS colour; nil or an unparsable string clears it.
    func setShadow(color css: String?, blur: Double, offsetX: Double = 0, offsetY: Double = 0) {
        state.shadowColor = css.flatMap { CSSColor.parse($0) }
        state.shadowBlur = blur.isFinite ? max(0, blur) : 0
        state.shadowOffsetX = offsetX
        state.shadowOffsetY = offsetY
    }

    /// The web's `shadowColor = ZERO_SHADOW; shadowBlur = 0`.
    func clearShadow() {
        state.shadowColor = nil
        state.shadowBlur = 0
        state.shadowOffsetX = 0
        state.shadowOffsetY = 0
    }

    /// `filter = blur(px)`; 0 is none.
    var filterBlur: Double {
        get { state.blur }
        set { state.blur = newValue.isFinite ? max(0, newValue) : 0 }
    }

    /// `imageSmoothingQuality`.
    var imageSmoothing: CGInterpolationQuality {
        get { state.smoothing }
        set { state.smoothing = newValue }
    }

    // MARK: - transform

    func translate(_ x: Double, _ y: Double) {
        cg.translateBy(x: CGFloat(x), y: CGFloat(y))
    }

    func rotate(_ radians: Double) {
        cg.rotate(by: CGFloat(radians))
    }

    func scale(_ x: Double, _ y: Double) {
        cg.scaleBy(x: CGFloat(x), y: CGFloat(y))
    }

    // MARK: - the path

    func beginPath() {
        path = CGMutablePath()
    }

    func moveTo(_ x: Double, _ y: Double) {
        path.move(to: CGPoint(x: x, y: y))
    }

    func lineTo(_ x: Double, _ y: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }

    func closePath() {
        if !path.isEmpty { path.closeSubpath() }
    }

    /// `arc(x, y, r, start, end, anticlockwise)`: in a y-down space a
    /// canvas's increasing angle is CG's `clockwise: false`, measured on the
    /// path's own numbers.
    func arc(_ x: Double, _ y: Double, _ r: Double, _ start: Double, _ end: Double, anticlockwise: Bool = false) {
        guard r >= 0 else { return }
        path.addArc(center: CGPoint(x: x, y: y), radius: CGFloat(r), startAngle: CGFloat(start),
                    endAngle: CGFloat(end), clockwise: anticlockwise)
    }

    func arcTo(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ r: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: x1, y: y1)) }
        path.addArc(tangent1End: CGPoint(x: x1, y: y1), tangent2End: CGPoint(x: x2, y: y2), radius: CGFloat(max(0, r)))
    }

    func quadraticCurveTo(_ cx: Double, _ cy: Double, _ x: Double, _ y: Double) {
        if path.isEmpty { path.move(to: CGPoint(x: cx, y: cy)) }
        path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cx, y: cy))
    }

    func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        path.addRect(CGRect(x: x, y: y, width: w, height: h))
    }

    /// The web's `roundRectPath`: a fresh path, the radius clamped to half the
    /// shorter side (circular corners, which is what `ctx.roundRect` draws).
    func roundRectPath(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) {
        let rr = max(0, min(r, w / 2, h / 2))
        beginPath()
        moveTo(x + rr, y)
        arcTo(x + w, y, x + w, y + h, rr)
        arcTo(x + w, y + h, x, y + h, rr)
        arcTo(x, y + h, x, y, rr)
        arcTo(x, y, x + w, y, rr)
        closePath()
    }

    // MARK: - painting

    /// Alpha, composite and shadow onto CG, right before a paint.
    private func applyCommon() {
        cg.setAlpha(CGFloat(state.alpha))
        cg.setBlendMode(state.composite.blendMode)
        applyShadow()
    }

    /// Whether a shadow would draw: a visible colour, and a blur or an offset.
    private var shadowActive: Bool {
        guard let c = state.shadowColor, c.alpha > 0 else { return false }
        return state.shadowBlur > 0 || state.shadowOffsetX != 0 || state.shadowOffsetY != 0
    }

    private func applyShadow() {
        guard shadowActive, let color = state.shadowColor else {
            cg.setShadow(offset: .zero, blur: 0, color: nil)
            return
        }
        let offset = CGSize(width: state.shadowOffsetX, height: state.shadowOffsetY).applying(base)
        cg.setShadow(offset: offset, blur: CGFloat(state.shadowBlur * baseScale), color: color)
    }

    private func applyStrokeGeometry() {
        cg.setLineWidth(CGFloat(state.lineWidth))
        cg.setLineCap(state.lineCap)
        cg.setLineDash(phase: 0, lengths: state.dash)
    }

    /// Paint `region` (already the context's path, clipped to) with a
    /// gradient — inside a layer when a shadow is up, so the shadow is the
    /// shape's and not clipped away with the rest.
    private func paintGradient(_ gradient: CGGradient, _ from: CGPoint, _ to: CGPoint, clipTo region: () -> Void) {
        let layered = shadowActive
        cg.saveGState()
        applyCommon()
        if layered {
            cg.beginTransparencyLayer(auxiliaryInfo: nil)
            cg.setShadow(offset: .zero, blur: 0, color: nil)
            cg.setAlpha(1)
        }
        region()
        cg.drawLinearGradient(gradient, start: from, end: to,
                              options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        if layered { cg.endTransparencyLayer() }
        cg.restoreGState()
    }

    func fill() {
        guard !path.isEmpty else { return }
        switch state.fill {
        case .color(let color):
            cg.saveGState()
            applyCommon()
            cg.setFillColor(color)
            cg.addPath(path)
            cg.fillPath(using: .winding)
            cg.restoreGState()
        case .linear(let gradient, let from, let to):
            let shape = path
            paintGradient(gradient, from, to) {
                cg.addPath(shape)
                cg.clip(using: .winding)
            }
        }
    }

    func stroke() {
        guard !path.isEmpty else { return }
        switch state.stroke {
        case .color(let color):
            cg.saveGState()
            applyCommon()
            applyStrokeGeometry()
            cg.setStrokeColor(color)
            cg.addPath(path)
            cg.strokePath()
            cg.restoreGState()
        case .linear(let gradient, let from, let to):
            let shape = path
            paintGradient(gradient, from, to) {
                applyStrokeGeometry()
                cg.addPath(shape)
                cg.replacePathWithStrokedPath()
                cg.clip(using: .winding)
            }
        }
    }

    /// `clip()`: the current path becomes the clip, and stays the path.
    func clip() {
        cg.addPath(path)
        cg.clip(using: .winding)
    }

    func fillRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        guard case .color(let color) = state.fill else {
            let r = CGRect(x: x, y: y, width: w, height: h)
            if case .linear(let g, let from, let to) = state.fill {
                paintGradient(g, from, to) { cg.clip(to: r) }
            }
            return
        }
        cg.saveGState()
        applyCommon()
        cg.setFillColor(color)
        cg.fill(CGRect(x: x, y: y, width: w, height: h))
        cg.restoreGState()
    }

    func strokeRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        guard case .color(let color) = state.stroke else { return }
        cg.saveGState()
        applyCommon()
        applyStrokeGeometry()
        cg.setStrokeColor(color)
        cg.stroke(CGRect(x: x, y: y, width: w, height: h))
        cg.restoreGState()
    }

    func clearRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) {
        cg.clear(CGRect(x: x, y: y, width: w, height: h))
    }

    // MARK: - images

    /// `drawImage(image, dx, dy, dw, dh)`, the image's top row at the top.
    func drawImage(_ image: CGImage, _ dx: Double, _ dy: Double, _ dw: Double, _ dh: Double) {
        guard dw != 0, dh != 0 else { return }
        cg.saveGState()
        applyCommon()
        cg.interpolationQuality = state.smoothing
        cg.translateBy(x: CGFloat(dx), y: CGFloat(dy + dh))
        cg.scaleBy(x: 1, y: -1)
        cg.draw(image, in: CGRect(x: 0, y: 0, width: dw, height: dh))
        cg.restoreGState()
    }

    /// The nine-argument `drawImage`: the source rectangle in the image's
    /// pixels, top-left origin.
    func drawImage(_ image: CGImage, sx: Double, sy: Double, sw: Double, sh: Double,
                   dx: Double, dy: Double, dw: Double, dh: Double) {
        let full = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        let source = CGRect(x: sx, y: sy, width: sw, height: sh).integral.intersection(full)
        guard !source.isEmpty else { return }
        if source == full {
            drawImage(image, dx, dy, dw, dh)
        } else if let part = image.cropping(to: source) {
            drawImage(part, dx, dy, dw, dh)
        }
    }

    // MARK: - text

    func measureText(_ text: String) -> PaintLine {
        PaintFonts.line(text, state.font, letterSpacing: state.letterSpacing)
    }

    /// `fillText(text, x, y, maxWidth)`: aligned on the advance width, set on
    /// the baseline `textBaseline` names; wider than `maxWidth`, squeezed
    /// horizontally to fit, as a canvas does.
    func fillText(_ text: String, _ x: Double, _ y: Double, maxWidth: Double? = nil) {
        guard !text.isEmpty, case .color(let color) = state.fill else { return }
        let set = measureText(text)
        var squeeze = 1.0
        if let maxWidth, maxWidth > 0, set.width > maxWidth { squeeze = maxWidth / set.width }
        let width = set.width * squeeze
        let dx: Double
        switch state.align {
        case .left: dx = 0
        case .center: dx = -width / 2
        case .right: dx = -width
        }
        let dy: Double
        switch state.baseline {
        case .alphabetic: dy = 0
        case .top: dy = set.emAscent
        case .bottom: dy = -set.emDescent
        case .middle: dy = (set.emAscent - set.emDescent) / 2
        }

        cg.saveGState()
        applyCommon()
        cg.setFillColor(color)
        cg.setStrokeColor(color)
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        cg.translateBy(x: CGFloat(x + dx), y: CGFloat(y + dy))
        if squeeze != 1 { cg.scaleBy(x: CGFloat(squeeze), y: 1) }
        if state.blur > 0 {
            drawBlurred(set.line, color: color)
        } else {
            cg.textPosition = .zero
            CTLineDraw(set.line, cg)
        }
        cg.restoreGState()
    }

    /// The run as `filter: blur(r)` draws it, and nothing else: set far
    /// outside the frame, its shadow — radius 2r, a Gaussian of σ = r — is
    /// what lands back on it. This takes the shadow slot for the paint; the
    /// one caller that blurs (the glow's softened core) clears its shadow
    /// first, as the web does.
    private func drawBlurred(_ line: CTLine, color: CGColor) {
        // Far past the frame in user units, whatever the scale.
        let far = (width + height) * 4 + 1000
        let away = CGSize(width: far, height: 0).applying(cg.userSpaceToDeviceSpaceTransform)
        cg.setShadow(offset: CGSize(width: -away.width, height: -away.height),
                     blur: CGFloat(state.blur * 2 * baseScale), color: color)
        cg.textPosition = CGPoint(x: far, y: 0)
        CTLineDraw(line, cg)
    }
}
