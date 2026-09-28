// The single overlay renderer shared by the stage AND the export, so the two
// can never drift — the app-level port of `src/shared/overlay/draw-overlays.ts`,
// on Core Graphics + Core Text through `PaintCanvas`.
//
// Coordinates are the frame's: position normalised, size a fraction of the
// SHORTER side, so the stage's size and the export's give one layout at two
// scales. The layout — every box, anchor, margin, the draw loop's choice of
// elements and transforms — is the kernel's (`OverlayGeometry`), so what
// `measureOverlays` returns is exactly what `drawOverlays` paints; this file
// holds only the paint.
//
// The rules the port keeps, each the web's:
// - A text element is ONE line and never wraps: a sentence is wrapped onto a
//   character budget BEFORE it gets here (`wrapText`, `docs/memory/roadtrip.md`).
// - Every telemetry field reads through the kernel's formatter
//   (`renderElementText`): a missing value draws `—`, never an invented one.
// - An element's alpha (its animation's fade, a solo scene's hold-back) is
//   multiplied into every absolute alpha its drawing sets — the tape's
//   per-tick fade, the compass ring — through `alpha(_:)`, never assigned
//   over, or the element would fade in pieces.
// - A shadow is lost under a `destination-*` composite, so the glow's grain
//   mask is built in its OWN buffer first, then cut with `destinationIn` in a
//   second one (`docs/memory/studio.md`'s canvas trap, which Core Graphics
//   shares).
// - The glow's grain and its mask are the web's to the bit: the same noise
//   tile (`OverlayGeometry.grainTile`), stepped ten times a second.
// - Frame corners span the frame and have no box; an element off screen has
//   none either, unless it is the editor's ghost.
//
// A painter holds the grain tile and each element's grain mask across
// frames, so one painter belongs to one consumer (the stage, one export) —
// never shared across threads, as the web's grader is caller-owned.
//
// Where it is called from:
// - a STAGE (SwiftUI): `Canvas { ctx, size in ctx.withCGContext { cg in
//   painter.drawOverlays(in: cg, size: size, elements: …, cue: …, time: …,
//   theme: …, options: …) } }` — the canvas's space is already y down; the
//   boxes for the selection outline and the hit test come from
//   `measureOverlays(size:…)` with the SAME arguments, and
//   `OverlayGeometry.hitTest` / `boxForId` read them.
// - an EXPORT (Core Image): `painter.burnIn(frame, elements: …, time: …)` in
//   a `FrameProcessor`, or `overlayImage(width:height:…)` to composite
//   yourself (`OverlayRaster.swift`).
// - a still: the same image, over the graded picture, at the file's size.

import AtelierKit
import CoreGraphics
import CoreText
import Foundation

final class OverlayPainter {
    init() {}

    /// Alpha of the element being drawn; multiplied into every absolute
    /// alpha its drawing sets. Set and cleared around each element by
    /// `drawOverlays`, its only writer.
    private var elementAlpha = 1.0

    private func alpha(_ a: Double) -> Double { a * elementAlpha }

    private typealias G = OverlayGeometry

    // MARK: - the entry points

    /// Paint every visible element into `cg`, whose user space is the frame
    /// (`size`), y down. `time` is MEDIA time: it phases the grain and eases
    /// the heading; windows count from `options.originSeconds`.
    func drawOverlays(in cg: CGContext, size: CGSize, elements: [OverlayElement], cue: Cue?,
                      time: Double, theme: StyleTheme?, options: OverlayDrawOptions = OverlayDrawOptions()) {
        let vw = Double(size.width)
        let vh = Double(size.height)
        guard vw > 0, vh > 0 else { return }
        let c = PaintCanvas(cg, width: vw, height: vh)
        drawOverlays(c, elements: elements, cue: cue, time: time, theme: theme, options: options)
        c.finish()
    }

    /// The same, on a canvas a caller already holds (the outro card, an
    /// opener painting a badge over its own frame).
    func drawOverlays(_ c: PaintCanvas, elements: [OverlayElement], cue: Cue?, time: Double,
                      theme: StyleTheme?, options: OverlayDrawOptions) {
        let vw = c.width
        let vh = c.height
        let plan = G.drawPlan(elements, vw, vh, time: time, options: options)
        if let scrim = plan.scrim { drawScrim(c, scrim, vw, vh) }

        for item in plan.items {
            let el = item.element
            let tf = item.transform
            c.save()
            elementAlpha = tf.alpha
            c.globalAlpha = tf.alpha
            applyTransform(c, el, tf, vw, vh)

            switch el.kind {
            case .headingArrow:
                drawArrow(c, el, cue, vw, vh, theme, time: time, cues: options.cues)
            case .headingTape:
                drawHeadingTape(c, el, cue, vw, vh, theme, time: time, cues: options.cues)
            case .battery:
                drawBattery(c, el, cue, vw, vh, theme)
            case .frameCorners:
                drawFrameCorners(c, el, vw, vh, resolveElementStyle(el, theme))
            case .rotateDevice:
                // Its own cycle runs from the moment the element appears.
                drawRotateDevice(c, el, vw, vh, theme, localSeconds: item.localSeconds)
            default:
                if let lay = G.textLayout(el, cue, vw, vh, theme: theme, timeShift: options.timeShift,
                                          measure: PaintFonts.overlayMeasure) {
                    drawTextElement(c, lay, time: time, reveal: tf.reveal, revealSteps: tf.revealSteps, elementId: el.id)
                }
            }

            elementAlpha = 1
            c.restore()
        }
    }

    /// Pixel boxes for every visible, on-screen element, in draw order (the
    /// last is topmost) — for hit-testing and the selection outline. The
    /// same layout the paint uses, measured through Core Text.
    func measureOverlays(size: CGSize, elements: [OverlayElement], cue: Cue?, time: Double,
                         theme: StyleTheme?, options: OverlayDrawOptions = OverlayDrawOptions()) -> [OverlayGeometry.ElementBox] {
        G.measureOverlays(elements, cue, Double(size.width), Double(size.height), time: time, theme: theme,
                          options: options, measure: PaintFonts.overlayMeasure)
    }

    /// Re-anchor `el` to `anchor` keeping its box still: the normalised
    /// position the new anchor needs, or nil (then just swap the anchor).
    func reanchorInPlace(_ el: OverlayElement, size: CGSize, cue: Cue?, anchor: OverlayAnchor,
                         theme: StyleTheme?, timeShift: TimeShift?) -> Point? {
        G.reanchorInPlace(el, cue, Double(size.width), Double(size.height), anchor, theme: theme,
                          timeShift: timeShift, measure: PaintFonts.overlayMeasure)
    }

    // MARK: - the scrim and the transform

    /// A scene's veil over the picture, under every element.
    private func drawScrim(_ c: PaintCanvas, _ scrim: SceneScrimRender, _ vw: Double, _ vh: Double) {
        c.save()
        c.globalAlpha = max(0, min(1, scrim.opacity))
        c.setFill(scrim.color)
        c.fillRect(0, 0, vw, vh)
        c.restore()
    }

    /// An element's animation: an offset in short-side fractions, then a
    /// scale about its ANCHOR point — a title anchored bottom-left grows from
    /// that corner.
    private func applyTransform(_ c: PaintCanvas, _ el: OverlayElement, _ tf: OverlayTransform, _ vw: Double, _ vh: Double) {
        if tf.dx != 0 || tf.dy != 0 {
            let ref = G.refDim(vw, vh)
            c.translate(tf.dx * ref, tf.dy * ref)
        }
        if tf.scale != 1 {
            let ox = el.x * vw
            let oy = el.y * vh
            c.translate(ox, oy)
            c.scale(tf.scale, tf.scale)
            c.translate(-ox, -oy)
        }
    }

    // MARK: - shared pieces

    /// `rgba(r,g,b,a)` of a warm-drifted ink.
    private func warm(_ color: String, _ warmth: Double, _ a: Double) -> String {
        let rgb = warmDrift(color, warmth)
        return "rgba(\(rgb[0]),\(rgb[1]),\(rgb[2]),\(a))"
    }

    /// The `box` legibility panel behind a content box (`x/y/w/h`), padded
    /// here; `unitPx` is the size every fraction of the style is relative to.
    private func paintLegibilityBox(_ c: PaintCanvas, _ st: ResolvedStyle, _ x: Double, _ y: Double,
                                    _ w: Double, _ h: Double, _ unitPx: Double) {
        let leg = st.legibility
        let pad = leg.padFrac * unitPx
        c.save()
        c.roundRectPath(x - pad, y - pad, w + pad * 2, h + pad * 2, pad * (leg.radiusFrac ?? 0.5))
        c.setFill(leg.color)
        c.fill()
        let borderW = (leg.borderWidthFrac ?? 0) * unitPx
        if let border = leg.outlineColor, borderW > 0 {
            c.setStroke(border)
            c.lineWidth = borderW
            c.stroke()
        }
        c.restore()
    }

    // MARK: - the heading arrow

    /// The compass ring, dashed cardinal lines and N/E/S/W, drawn about the
    /// origin under whatever rotation the caller applied.
    private func drawCompassDecoration(_ c: PaintCanvas, _ r: Double, _ st: ResolvedStyle) {
        let ringR = r * 2.0
        let lineW = max(0.5, r * 0.055)
        let gapR = r * 0.65

        if let glow = st.glow {
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * r * 3))
        } else if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: st.legibility.padFrac * r * 0.6)
        }

        // The ring.
        c.setStroke(st.color)
        c.lineWidth = lineW
        c.globalAlpha = alpha(0.45)
        c.beginPath()
        c.arc(0, 0, ringR, 0, Double.pi * 2)
        c.stroke()

        // Dashed cardinal lines, from the gap around the arrow to the ring.
        c.globalAlpha = alpha(0.35)
        c.setLineDash([ringR * 0.09, ringR * 0.07])
        c.beginPath()
        c.moveTo(0, -gapR); c.lineTo(0, -ringR) // N
        c.moveTo(0, gapR); c.lineTo(0, ringR) // S
        c.moveTo(gapR, 0); c.lineTo(ringR, 0) // E
        c.moveTo(-gapR, 0); c.lineTo(-ringR, 0) // W
        c.stroke()
        c.setLineDash([])

        // The letters.
        let letterR = ringR + r * 0.5
        let letterPx = max(6, r * 0.52)
        c.globalAlpha = alpha(0.92)
        c.setFill(st.color)
        c.font = PaintFont(["sans-serif"], size: letterPx, weight: 700)
        c.textAlign = .center
        c.textBaseline = .middle
        c.fillText("N", 0, -letterR)
        c.fillText("S", 0, letterR)
        c.fillText("E", letterR, 0)
        c.fillText("W", -letterR, 0)

        c.globalAlpha = 1
    }

    /// A heading arrow: north-up (the ring fixed, the chevron turning) or
    /// track-up (the chevron up, the ring turning by −heading). With no
    /// heading, a dot north-up and a faded chevron track-up.
    private func drawArrow(_ c: PaintCanvas, _ el: OverlayElement, _ cue: Cue?, _ vw: Double, _ vh: Double,
                           _ theme: StyleTheme?, time: Double, cues: [Cue]?) {
        let st = resolveElementStyle(el, theme)
        let lay = G.arrowLayout(el, vw, vh)
        let r = lay.r
        let reading = G.heading(for: el, cue: cue, time: time, cues: cues)
        let heading = reading.heading
        let isRelative = el.compassMode == .relative

        c.save()
        c.translate(lay.cx, lay.cy)

        // An axis-aligned background box, never rotated.
        if st.legibility.mode == .box {
            paintLegibilityBox(c, st, -lay.halfSize, -lay.halfSize, lay.halfSize * 2, lay.halfSize * 2, r)
        }

        if el.showCompass == true {
            c.save()
            if isRelative, let heading {
                // Track-up: the current heading floats to the top.
                c.rotate(-heading * Double.pi / 180)
            }
            drawCompassDecoration(c, r, st)
            c.restore()
        }

        if isRelative {
            // The chevron is drawn pointing right; −90° is up.
            c.rotate(-Double.pi / 2)
        } else if let heading {
            // Canvas 0° is east; heading 0° is north.
            c.rotate((heading - 90) * Double.pi / 180)
        }

        if let glow = st.glow {
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.haloAlpha),
                        blur: max(1, (glow.haloRadiusFrac + glow.bleedRadiusFrac * 0.4) * r * 3))
        } else if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: st.legibility.padFrac * r)
        } else {
            c.clearShadow()
        }

        // Track-up with no data: the "forward = up" chevron, faded. A held
        // (stale) bearing draws faded rather than vanishing.
        c.globalAlpha = isRelative && heading == nil ? alpha(0.45) : alpha(reading.alpha)
        c.setFill(st.color)

        if heading != nil || isRelative {
            // Chevron pointing east before rotation: tip at (+r, 0), notch at (−0.15r, 0).
            c.beginPath()
            c.moveTo(r, 0)
            c.lineTo(-r * 0.4, -r * 0.6)
            c.lineTo(-r * 0.15, 0)
            c.lineTo(-r * 0.4, r * 0.6)
            c.closePath()
            c.fill()
        } else {
            // North-up and hovering: a dot says the element is there.
            c.beginPath()
            c.arc(0, 0, r * 0.3, 0, Double.pi * 2)
            c.fill()
        }

        c.restore()
    }

    // MARK: - the heading tape

    /// A slice of the compass scale sliding under a fixed sight, each tick
    /// faded on its own (no masked layer — an export renders at full size).
    private func drawHeadingTape(_ c: PaintCanvas, _ el: OverlayElement, _ cue: Cue?, _ vw: Double, _ vh: Double,
                                 _ theme: StyleTheme?, time: Double, cues: [Cue]?) {
        let st = resolveElementStyle(el, theme)
        let lay = G.tapeLayout(el, st, vw, vh)
        let reading = G.heading(for: el, cue: cue, time: time, cues: cues)
        let heading = reading.heading
        let cx = lay.cx, cy = lay.cy, halfW = lay.halfW, fontPx = lay.fontPx, tickH = lay.tickH
        let fade = el.tapeFadeFrac ?? 0.22
        let lineW = max(0.6, fontPx * 0.09)
        let opacity = max(0, min(1, el.tapeOpacity ?? 1))
        let face = PaintFont.overlay(st, fontPx)

        c.save()
        c.globalAlpha = alpha(opacity)

        if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: max(1, st.legibility.padFrac * fontPx), offsetY: fontPx * 0.05)
        } else if let glow = st.glow {
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * fontPx * 3))
        }

        // The rule the ticks stand on: one gradient, transparent at both ends.
        if el.tapeRule ?? true, let gradient = tapeGradient(st.color, fade) {
            c.setStroke(.linear(gradient, from: CGPoint(x: cx - halfW, y: 0), to: CGPoint(x: cx + halfW, y: 0)))
            c.lineWidth = lineW
            c.beginPath()
            c.moveTo(cx - halfW, cy)
            c.lineTo(cx + halfW, cy)
            c.stroke()
        }

        // No heading: the furniture stays, the scale does not — a tape frozen
        // on an invented bearing would be a lie.
        if heading == nil {
            c.globalAlpha = c.globalAlpha * 0.5
            c.setFill(st.color)
            c.font = face
            c.textAlign = .center
            c.textBaseline = .top
            c.fillText("—", cx, cy + tickH * 0.35)
        } else if let heading {
            let ticks = tapeTicks(heading, el.tapeSpanDeg ?? 90, el.tapeMajorStep ?? 30, el.tapeMinorStep ?? 10,
                                  el.tapeCardinals ?? true)
            c.font = face
            c.textAlign = .center
            c.textBaseline = .top
            for tick in ticks {
                let tickAlpha = tapeFadeAlpha(tick.t, fade)
                if tickAlpha <= 0.01 { continue }
                let tx = cx + tick.t * halfW
                let len = tick.major ? tickH : tickH * 0.55
                c.globalAlpha = alpha(tickAlpha * opacity * reading.alpha)
                c.setStroke(st.color)
                c.lineWidth = tick.major ? lineW : lineW * 0.7
                c.beginPath()
                c.moveTo(tx, cy)
                c.lineTo(tx, cy + len)
                c.stroke()
                if let label = tick.label {
                    c.setFill(st.color)
                    c.fillText(label, tx, cy + tickH + fontPx * 0.15)
                }
            }
        }

        // The sight — its own colour, so it never dissolves into the scale.
        c.globalAlpha = alpha(opacity)
        let reticle = el.tapeReticle ?? .both
        let rc = el.tapeReticleColor ?? st.color
        if reticle != .none {
            c.setStroke(rc)
            c.setFill(rc)
            c.lineWidth = lineW * 1.4
            if reticle == .line || reticle == .both {
                c.beginPath()
                c.moveTo(cx, cy - tickH * 0.55)
                c.lineTo(cx, cy + tickH * 1.05)
                c.stroke()
            }
            if reticle == .triangle || reticle == .both {
                let s = tickH * 0.42
                c.beginPath()
                c.moveTo(cx, cy - lineW * 0.5)
                c.lineTo(cx - s, cy - s - lineW * 0.5)
                c.lineTo(cx + s, cy - s - lineW * 0.5)
                c.closePath()
                c.fill()
            }
        }

        // The caption: the same reading, in words.
        let place = el.tapeLabel ?? .above
        if place != .none {
            let caption = formatHeading(heading) ?? "\(el.label ?? "HDG") \(missingField)"
            let text = st.uppercase ? caption.uppercased() : caption
            c.setFill(st.color)
            c.font = face
            switch place {
            case .above:
                c.textAlign = .center
                c.textBaseline = .bottom
                c.fillText(text, cx, cy - tickH * 0.75)
            case .below:
                c.textAlign = .center
                c.textBaseline = .top
                c.fillText(text, cx, cy + tickH + fontPx * 1.5)
            case .left:
                c.textAlign = .right
                c.textBaseline = .middle
                c.fillText(text, cx - halfW - fontPx * 0.5, cy + tickH * 0.4)
            default:
                c.textAlign = .left
                c.textBaseline = .middle
                c.fillText(text, cx + halfW + fontPx * 0.5, cy + tickH * 0.4)
            }
        }

        c.restore()
    }

    /// The rule's gradient: the ink at 0.75, transparent at both ends, the
    /// stops `fade` in from each (at most 0.49). Through the kernel's
    /// `withAlpha`, as the web — which reads a hex ink and whites anything else.
    private func tapeGradient(_ color: String, _ fade: Double) -> CGGradient? {
        let stop = max(0, min(0.49, fade))
        let clear = CSSColor.parse(withAlpha(color, 0), or: CSSColor.clear)
        let strong = CSSColor.parse(withAlpha(color, 0.75), or: CSSColor.white)
        let colours = [clear, strong, strong, clear] as CFArray
        let locations: [CGFloat] = [0, CGFloat(stop), CGFloat(1 - stop), 1]
        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        return CGGradient(colorsSpace: space, colors: colours, locations: locations)
    }

    // MARK: - the battery

    /// A cell that fills with the level, in the alarm colour under the
    /// threshold; with no level, the empty cell and a `—`.
    private func drawBattery(_ c: PaintCanvas, _ el: OverlayElement, _ cue: Cue?, _ vw: Double, _ vh: Double,
                             _ theme: StyleTheme?) {
        let st = resolveElementStyle(el, theme)
        let lay = G.batteryLayout(el, st, vw, vh)
        let cellX = lay.cellX, cellY = lay.cellY, cellW = lay.cellW, cellH = lay.cellH, fontPx = lay.fontPx
        let level = batteryLevel(el, cue)
        let low = el.batteryLowPercent ?? 20
        let isLow = level.map { $0 <= low } ?? false
        let fill = isLow ? (el.batteryLowColor ?? "#e2402a") : st.color
        let lineW = max(0.6, fontPx * 0.08)

        c.save()
        if st.legibility.mode == .box {
            paintLegibilityBox(c, st, lay.x, lay.y, lay.w, lay.h, fontPx)
        } else if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: max(1, st.legibility.padFrac * fontPx), offsetY: fontPx * 0.05)
        } else if let glow = st.glow {
            c.setShadow(color: warm(fill, st.glowWarmth, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * fontPx * 3))
        }

        // Shell and nub.
        c.setStroke(st.color)
        c.lineWidth = lineW
        c.roundRectPath(cellX, cellY, cellW, cellH, cellH * 0.22)
        c.stroke()
        let nubW = cellW * 0.07
        let nubH = cellH * 0.42
        c.setFill(st.color)
        c.roundRectPath(cellX + cellW + lineW * 0.5, cellY + (cellH - nubH) / 2, nubW, nubH, nubW * 0.4)
        c.fill()

        // The fill.
        let inset = lineW * 1.8
        if let level, level > 0 {
            let innerW = cellW - inset * 2
            c.setFill(fill)
            c.roundRectPath(cellX + inset, cellY + inset, max(lineW, (innerW * level) / 100), cellH - inset * 2,
                            (cellH - inset * 2) * 0.18)
            c.fill()
        }

        // The caption.
        let place = G.batteryPlace(el)
        if place != .none {
            let text = level.map { "\(Int(jsRound($0)))%" } ?? missingField
            c.setFill(isLow ? fill : st.color)
            c.font = PaintFont.overlay(st, fontPx)
            switch place {
            case .right:
                c.textAlign = .left
                c.textBaseline = .middle
                c.fillText(text, cellX + cellW + nubW + fontPx * 0.45, cellY + cellH / 2)
            case .left:
                c.textAlign = .right
                c.textBaseline = .middle
                c.fillText(text, cellX - fontPx * 0.35, cellY + cellH / 2)
            case .above:
                c.textAlign = .center
                c.textBaseline = .bottom
                c.fillText(text, cellX + cellW / 2, cellY - fontPx * 0.2)
            default:
                c.textAlign = .center
                c.textBaseline = .top
                c.fillText(text, cellX + cellW / 2, cellY + cellH + fontPx * 0.2)
            }
        }

        c.restore()
    }

    // MARK: - frame corners

    /// Four L-shaped marks inset from the frame's edges; `sizeFrac` is the
    /// arm, `cornerInset` the distance, both of the shorter side.
    private func drawFrameCorners(_ c: PaintCanvas, _ el: OverlayElement, _ vw: Double, _ vh: Double, _ st: ResolvedStyle) {
        let ref = G.refDim(vw, vh)
        let arm = max(2, st.sizeFrac * ref)
        let inset = max(0, (el.cornerInset ?? 0.03) * ref)
        let lw = max(1, arm * 0.08)

        c.save()
        c.setStroke(st.color)
        c.lineWidth = lw
        c.lineCap = .butt
        if let glow = st.glow {
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * ref * 0.6))
        } else if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: st.legibility.padFrac * arm * 0.5)
        }

        let l = inset, t = inset, r = vw - inset, b = vh - inset
        c.beginPath()
        c.moveTo(l, t + arm); c.lineTo(l, t); c.lineTo(l + arm, t) // top-left
        c.moveTo(r - arm, t); c.lineTo(r, t); c.lineTo(r, t + arm) // top-right
        c.moveTo(r, b - arm); c.lineTo(r, b); c.lineTo(r - arm, b) // bottom-right
        c.moveTo(l + arm, b); c.lineTo(l, b); c.lineTo(l, b - arm) // bottom-left
        c.stroke()
        c.restore()
    }

    // MARK: - the rotate prompt

    /// The arc and arrowhead that say "turn", in the STATIC frame: the phone
    /// moves under it, so a still frame reads as an instruction too.
    private func drawTurnArrow(_ c: PaintCanvas, _ r: Double, _ weight: Double, clockwise cw: Bool) {
        let from = -160 * Double.pi / 180
        let to = -20 * Double.pi / 180
        c.lineWidth = weight
        c.lineCap = .round
        c.beginPath()
        c.arc(0, 0, r, from, to)
        c.stroke()

        // The head at the end the motion runs towards, along the tangent.
        let a = cw ? to : from
        let dir: Double = cw ? 1 : -1
        let hx = r * cos(a)
        let hy = r * sin(a)
        let tx = -sin(a) * dir
        let ty = cos(a) * dir
        let size = weight * 3
        c.beginPath()
        c.moveTo(hx + tx * size, hy + ty * size)
        c.lineTo(hx - ty * size * 0.6 - tx * size * 0.2, hy + tx * size * 0.6 - ty * size * 0.2)
        c.lineTo(hx + ty * size * 0.6 - tx * size * 0.2, hy - tx * size * 0.6 - ty * size * 0.2)
        c.closePath()
        c.fill()
    }

    private func drawRotateDevice(_ c: PaintCanvas, _ el: OverlayElement, _ vw: Double, _ vh: Double,
                                  _ theme: StyleTheme?, localSeconds: Double) {
        let st = resolveElementStyle(el, theme)
        let lay = G.rotateLayout(el, st, vw, vh, measure: PaintFonts.overlayMeasure)
        let stroke = max(0.8, lay.phoneH * 0.035)

        c.save()
        if st.legibility.mode == .box {
            paintLegibilityBox(c, st, lay.x, lay.y, lay.w, lay.h, lay.fontPx)
        } else if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: max(1, st.legibility.padFrac * lay.fontPx), offsetY: lay.fontPx * 0.05)
        } else if let glow = st.glow {
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * lay.fontPx * 3))
        }

        c.setStroke(st.color)
        c.setFill(st.color)

        // The turn arrow, around the phone but not turning with it.
        c.save()
        c.translate(lay.cx, lay.cy)
        c.globalAlpha = alpha(0.9)
        drawTurnArrow(c, lay.arcRadius, lay.arcWeight, clockwise: (el.rotateDirection ?? .cw) == .cw)
        c.restore()

        // The phone.
        c.save()
        c.translate(lay.cx, lay.cy)
        c.rotate(tipAngle(localSeconds, el.rotateCycleSeconds ?? 1.8, direction: el.rotateDirection ?? .cw,
                          returns: el.rotateReturn ?? true))
        let pw = lay.phoneW
        let ph = lay.phoneH
        c.setFill(withAlpha(st.color, 0.14))
        c.roundRectPath(-pw / 2, -ph / 2, pw, ph, pw * 0.2)
        c.fill()
        c.setStroke(st.color)
        c.lineWidth = stroke
        c.roundRectPath(-pw / 2, -ph / 2, pw, ph, pw * 0.2)
        c.stroke()
        // Earpiece and home bar: enough to read "phone", and which way up.
        c.setFill(st.color)
        c.roundRectPath(-pw * 0.13, -ph * 0.42, pw * 0.26, stroke, stroke * 0.5)
        c.fill()
        c.globalAlpha = alpha(0.75)
        c.roundRectPath(-pw * 0.18, ph * 0.38, pw * 0.36, stroke, stroke * 0.5)
        c.fill()
        c.restore()

        // The caption.
        if lay.place != .none {
            c.globalAlpha = alpha(1)
            c.setFill(st.color)
            c.font = PaintFont.overlay(st, lay.fontPx)
            c.letterSpacing = st.letterSpacingEm * lay.fontPx
            if lay.place == .above || lay.place == .below {
                c.textAlign = .center
                c.textBaseline = lay.place == .above ? .bottom : .top
                let ty = lay.place == .above ? lay.cy - lay.side / 2 - lay.gap : lay.cy + lay.side / 2 + lay.gap
                c.fillText(lay.caption, lay.cx, ty)
            } else {
                c.textAlign = lay.place == .left ? .right : .left
                c.textBaseline = .middle
                let tx = lay.place == .left ? lay.cx - lay.side / 2 - lay.gap : lay.cx + lay.side / 2 + lay.gap
                c.fillText(lay.caption, tx, lay.cy)
            }
            c.letterSpacing = 0
        }
        c.restore()
    }

    // MARK: - text

    /// One text-bearing element (a field, a label, a title): a reveal clip,
    /// the legibility box, then the glow's four layers or the plain run.
    private func drawTextElement(_ c: PaintCanvas, _ lay: OverlayGeometry.TextLayout, time: Double,
                                 reveal: Double, revealSteps: Bool, elementId: String) {
        let st = lay.style
        c.font = PaintFont.overlay(st, lay.fontPx)
        c.textBaseline = .alphabetic
        c.textAlign = .left

        let pad = st.legibility.padFrac * lay.fontPx

        if reveal < 1 {
            // Cut to the revealed share from the left edge, generous
            // vertically so a glow or a box is not sliced along the way.
            let cutW = revealWidth(c, lay, reveal, steps: revealSteps)
            let slack = lay.fontPx * 2 + pad * 2
            c.beginPath()
            c.rect(lay.x - slack, lay.y - slack, cutW + slack, lay.h + slack * 2)
            c.clip()
        }

        if st.legibility.mode == .box {
            paintLegibilityBox(c, st, lay.x, lay.y, lay.w, lay.h, lay.fontPx)
        }

        if let glow = st.glow {
            drawGlowedText(c, lay, glow, time: time, elementId: elementId)
            return
        }

        c.save()
        c.letterSpacing = st.letterSpacingEm * lay.fontPx
        if st.legibility.mode == .shadow {
            c.setShadow(color: st.legibility.color, blur: max(1, st.legibility.padFrac * lay.fontPx),
                        offsetY: lay.fontPx * 0.05)
        } else {
            c.clearShadow()
        }
        c.setFill(st.color)
        c.fillText(lay.text, lay.x, lay.y + lay.ascent)
        c.letterSpacing = 0
        c.restore()
    }

    /// Where to cut a partly revealed text: a typewriter stops on whole
    /// characters, measured in the paint's own face and spacing; a wipe
    /// cuts anywhere.
    private func revealWidth(_ c: PaintCanvas, _ lay: OverlayGeometry.TextLayout, _ reveal: Double, steps: Bool) -> Double {
        if !steps { return lay.w * reveal }
        guard let prefix = G.typedPrefix(lay.text, reveal) else { return lay.w }
        if prefix.isEmpty { return 0 }
        return PaintFonts.line(prefix, .overlay(lay.style, lay.fontPx), letterSpacing: lay.style.letterSpacingEm * lay.fontPx).width
    }

    // MARK: - the glow

    /// The four-layer glow: a wide warm bleed drawn twice, a tight bright
    /// halo, the softened letter body, then grain masked by the glow itself.
    private func drawGlowedText(_ c: PaintCanvas, _ lay: OverlayGeometry.TextLayout, _ glow: GlowLayers,
                                time: Double, elementId: String) {
        let st = lay.style
        let fontPx = lay.fontPx
        let baselineY = lay.y + lay.ascent

        c.letterSpacing = st.letterSpacingEm * fontPx

        // 1 — the wide bleed, warm-drifted, twice so the veil has body.
        if glow.bleedRadiusFrac > 0 && glow.bleedAlpha > 0 {
            c.save()
            c.setShadow(color: warm(st.color, st.glowWarmth, glow.bleedAlpha), blur: glow.bleedRadiusFrac * fontPx)
            c.setFill(st.color)
            c.fillText(lay.text, lay.x, baselineY)
            c.fillText(lay.text, lay.x, baselineY)
            c.restore()
        }

        // 2 — the tight halo, brightened ink.
        if glow.haloRadiusFrac > 0 && glow.haloAlpha > 0 {
            c.save()
            c.setShadow(color: halolight(st.color, glow.haloAlpha), blur: max(1, glow.haloRadiusFrac * fontPx))
            c.setFill(st.color)
            c.fillText(lay.text, lay.x, baselineY)
            c.restore()
        }

        // 3 — the letter body, slightly softened.
        c.save()
        let coreBlur = glow.coreBlurFrac * fontPx
        if coreBlur >= 0.2 { c.filterBlur = coreBlur }
        c.clearShadow()
        c.setFill(st.color)
        c.fillText(lay.text, lay.x, baselineY)
        c.restore()

        c.letterSpacing = 0

        // 4 — grain, shaped by the glow rather than by a bounding box.
        drawShapedGrain(c, lay, glow, time: time, elementId: elementId)
    }

    /// The glow's noise tile as an opaque grey image, built once.
    private lazy var grainTile: CGImage? = {
        let side = G.grainTileSize
        let grey = G.grainTile()
        var rgba = [UInt8](repeating: 255, count: side * side * 4)
        for i in 0..<(side * side) {
            rgba[i * 4] = grey[i]
            rgba[i * 4 + 1] = grey[i]
            rgba[i * 4 + 2] = grey[i]
        }
        return OverlayRaster.image(rgba: rgba, width: side, height: side)
    }()

    /// One element's grain mask (the blurred white text), kept across frames:
    /// it depends on the text, its face and the bleed, never on the clock.
    private struct MaskEntry {
        var key: String
        var image: CGImage
    }

    private var maskCache: [String: MaskEntry] = [:]
    private static let maxMaskCache = 256

    private func maskFor(_ elementId: String, _ lay: OverlayGeometry.TextLayout, _ glow: GlowLayers,
                         _ w: Int, _ h: Int, _ bx: Double, _ by: Double) -> CGImage? {
        let font = PaintFont.overlay(lay.style, lay.fontPx)
        let key = "\(lay.text) \(font.families) \(font.weight) \(font.italic) \(font.size) \(lay.style.letterSpacingEm) "
            + "\(glow.bleedRadiusFrac) \(String(format: "%.2f,%.2f", bx, by)) \(w)x\(h)"
        if let hit = maskCache[elementId], hit.key == key { return hit.image }

        guard let ctx = OverlayRaster.makeContext(width: w, height: h) else { return nil }
        let m = PaintCanvas(ctx, width: Double(w), height: Double(h))
        m.font = font
        m.textBaseline = .alphabetic
        m.textAlign = .left
        m.letterSpacing = lay.style.letterSpacingEm * lay.fontPx
        m.setFill("#ffffff")
        m.setShadow(color: "rgba(255,255,255,1)", blur: max(1, glow.bleedRadiusFrac * lay.fontPx))
        m.fillText(lay.text, bx, by)
        m.fillText(lay.text, bx, by)
        m.finish()
        guard let image = ctx.makeImage() else { return nil }

        if maskCache.count > Self.maxMaskCache { maskCache.removeAll() }
        maskCache[elementId] = MaskEntry(key: key, image: image)
        return image
    }

    /// Grain over one glow, masked by the glow's OWN shape — a clipped
    /// rectangle of noise drew a visible lighter square around every glowing
    /// readout. The noise is laid in one buffer and cut with `destinationIn`
    /// against the mask, which was built in its own buffer first: a shadow
    /// drawn straight into a `destination-in` composite is lost.
    private func drawShapedGrain(_ c: PaintCanvas, _ lay: OverlayGeometry.TextLayout, _ glow: GlowLayers,
                                 time: Double, elementId: String) {
        guard glow.grainAlpha > 0, let tile = grainTile else { return }
        let box = G.grainBox(lay, glow)
        let w = Int(box.w)
        let h = Int(box.h)
        // A runaway glow radius gets no buffer — and no square of grain either.
        guard w > 0, h > 0, w <= 4096, h <= 4096 else { return }

        let bx = lay.x - box.x
        let by = lay.y - box.y + lay.ascent
        guard let mask = maskFor(elementId, lay, glow, w, h, bx, by),
              let ctx = OverlayRaster.makeContext(width: w, height: h) else { return }

        // The noise field, offset from the media time so the preview and the
        // export grain identically at the same frame.
        let buf = PaintCanvas(ctx, width: Double(w), height: Double(h))
        buf.imageSmoothing = .none
        let offset = G.grainOffset(time)
        let side = G.grainTileSize
        var ty = -offset.y
        while ty < h {
            var tx = -offset.x
            while tx < w {
                buf.drawImage(tile, Double(tx), Double(ty), Double(side), Double(side))
                tx += side
            }
            ty += side
        }
        // Cut the field down to the glow's shape.
        buf.composite = .destinationIn
        buf.drawImage(mask, 0, 0, Double(w), Double(h))
        buf.finish()
        guard let grain = ctx.makeImage() else { return }

        // Onto the frame with `overlay`, biting the bright halo and the dark
        // ground alike instead of washing grey over both.
        c.save()
        c.globalAlpha = alpha(glow.grainAlpha)
        c.composite = .overlay
        c.drawImage(grain, box.x, box.y, Double(w), Double(h))
        c.restore()
    }
}

/// JS `Math.round`: halves toward +∞ — the battery's percentage.
private func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}
