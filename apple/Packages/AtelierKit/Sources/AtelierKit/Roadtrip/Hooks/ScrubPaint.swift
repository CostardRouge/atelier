// One frame of «Défilé», read off the plan — the layout arithmetic of
// `src/shared/roadtrip/hooks/scrub-paint.ts`. The strokes themselves (a fill,
// a rounded bar, a gradient, a shadow) are the app's Core Graphics painter;
// every position, size, colour and alpha it draws is decided here, so the
// stage and the export draw the same tape at two scales and the rectangle a
// click grabs (`tapeBox`) is the band that is drawn.
//
// What a frame shows while the sweep runs:
// - a stop with a picture → that picture, cover-cropped into the frame (the
//   source picture of the piece telling that day, or one the author picked);
// - a stop without one, or whose picture could not be found → the frame goes
//   dark (`scrubEmptyDayColor`). Not a stand-in and not the hero shown early:
//   an empty day looks empty, which is what makes the hero's arrival land;
// - a frame of darkness as the head lands on any stop but the first — the
//   projector's advance, `scrubDipSeconds` long.
// Once the sweep has come to rest nothing but the tape is drawn, and the
// piece's own picture — already on the canvas — is the frame.
//
// Sizes are in units of a 1080-wide frame (`TapeGeometry.u`).

import Foundation

/// What an untold day looks like: the paper's ink, not pure black.
public let scrubEmptyDayColor = "#0c0b09"
/// How long the shutter dip lasts after the head lands, in seconds.
public let scrubDipSeconds = 0.06
/// How dark the dip gets at its deepest.
public let scrubDipAlpha = 0.38
/// How many steps a faded band or track's gradient is drawn with (13 stops).
public let scrubFadeSteps = 12

/// What fills the frame while the head sweeps.
public enum ScrubFlash: Equatable, Sendable {
    /// The picture decoded under this key (`hookPictureKey`), cover-cropped
    /// into the frame. Should the app fail to draw it after all (an image
    /// released under a render still in flight), it paints the empty day's
    /// ink, exactly as the web falls back.
    case picture(key: String)
    /// A stop with nothing to show.
    case empty
}

/// One stop of a horizontal alpha gradient, `offset` 0…1 along the bar.
public struct ScrubGradientStop: Equatable, Sendable {
    public var offset: Double
    public var alpha: Double
}

/// A filled bar of the tape — the band behind it or the track under it.
public struct ScrubBar: Equatable, Sendable {
    public var rect: Rect
    /// Corner radius; 0 is square.
    public var radius: Double
    /// `#rrggbb`.
    public var color: String
    /// The fill's alpha when it is flat.
    public var alpha: Double
    /// With the edge fade on: the alpha along the bar, left to right, in place of `alpha`.
    public var gradient: [ScrubGradientStop]?
}

/// One tick of the tape.
public struct ScrubTick: Equatable, Sendable {
    public var day: Int
    public var rect: Rect
    /// `#rrggbb` — the passed colour once the head has gone by.
    public var color: String
    public var alpha: Double
    /// A leg starts on this day: the tall tick.
    public var leg: Bool
    public var passed: Bool
}

/// The reading head's shape, in frame pixels.
public enum ScrubHeadShape: Equatable, Sendable {
    /// A rounded upright bar.
    case bar(Rect, radius: Double)
    /// A disc above (or below) the ticks.
    case dot(center: Point, radius: Double)
    /// A triangle pointing AT the tape from beyond the tallest tick.
    case needle(tip: Point, left: Point, right: Point)
}

/// The head as drawn: its shape, its colour and alpha, and its glow.
public struct ScrubHeadMark: Equatable, Sendable {
    public var shape: ScrubHeadShape
    /// `#rrggbb`, drawn at full opacity under `alpha`.
    public var color: String
    /// The whole head's alpha — the edge fade at its position.
    public var alpha: Double
    /// The glow's blur radius (one shadow a frame) in the passed colour at
    /// 0.75, or nil with the glow off.
    public var glowBlur: Double?
}

/// Everything one frame of Défilé draws, in painting order: the flash and its
/// dip (under the tape), then the band, the track, the ticks and the head.
public struct ScrubFrame: Equatable, Sendable {
    /// What fills the frame, or nil to leave the picture below as it is.
    public var flash: ScrubFlash?
    /// Black over the flash at this alpha; 0 for none.
    public var dipAlpha: Double
    public var band: ScrubBar?
    public var track: ScrubBar?
    public var ticks: [ScrubTick]
    public var head: ScrubHeadMark
}

/// Round to three decimals, as the web's `toFixed(3)` alpha does.
private func scrubAlpha3(_ v: Double) -> Double {
    (v * 1000).rounded() / 1000
}

/// One frame of the sweep at `t` on a frame of `frame`'s size, or nil for a
/// frame with no area (the web draws nothing). A stop flashes its picture only
/// when `pictures` holds one with an area under its key; otherwise it is dark.
public func scrubFrame(_ plan: ScrubPlan, _ opts: ScrubOptions, _ pictures: [String: HookPicture]?,
                       _ t: Double, _ frame: FrameBox) -> ScrubFrame? {
    let w = frame.width
    let h = frame.height
    guard w > 0, h > 0 else { return nil }

    let sweeping = plan.sweepSeconds > 0 && t < plan.endSeconds
    let index = plan.stopAt(t)

    var flash: ScrubFlash? = nil
    var dipAlpha = 0.0
    if opts.flash && sweeping {
        let key = plan.stops[index].pictureKey
        let picture = key.flatMap { pictures?[$0] }
        if let key, let picture, picture.width > 0, picture.height > 0 {
            flash = .picture(key: key)
        } else {
            flash = .empty
        }
        // The projector's advance: not on the first stop, which is where the
        // sweep starts rather than a landing.
        let since = plan.sinceStopAt(t)
        if index > 0 && since >= 0 && since < scrubDipSeconds {
            dipAlpha = scrubDipAlpha * (1 - since / scrubDipSeconds)
        }
    }

    let g = tapeGeometry(w, h, opts.tapeGeometryOptions)
    let u = g.u
    let headDay = plan.headDayAt(t)
    let legs = Set(plan.legStarts)
    func xOf(_ day: Double) -> Double { g.x0 + g.length * tapeFraction(day, plan.totalDays) }
    func fade(_ x: Double) -> Double { edgeFadeAt(x, g.x0, g.x1, opts.edgeFade) }
    let steps = scrubFadeSteps

    var band: ScrubBar? = nil
    if opts.tapeBackground {
        let b = g.band
        let gradient: [ScrubGradientStop]? = opts.edgeFade
            ? (0...steps).map { i in
                let k = Double(i) / Double(steps)
                return ScrubGradientStop(offset: k, alpha: scrubAlpha3(opts.backgroundOpacity * fade(b.x + b.width * k)))
            }
            : nil
        band = ScrubBar(rect: b, radius: 8 * u, color: "#000000", alpha: opts.backgroundOpacity, gradient: gradient)
    }

    var track: ScrubBar? = nil
    if opts.showTrack {
        let gradient: [ScrubGradientStop]? = opts.edgeFade
            ? (0...steps).map { i in
                let k = Double(i) / Double(steps)
                return ScrubGradientStop(offset: k, alpha: opts.tickOpacity * fade(g.x0 + g.length * k))
            }
            : nil
        track = ScrubBar(rect: Rect(x: g.x0, y: g.baseline - 0.75 * u, width: g.length, height: 1.5 * u),
                         radius: 0, color: opts.tickColor, alpha: opts.tickOpacity, gradient: gradient)
    }

    var ticks: [ScrubTick] = []
    for day in tapeTicks(plan.totalDays, g.length, plan.legStarts, minGapPx: opts.tickGap * u) {
        let leg = legs.contains(day)
        let tall = leg ? g.tallTick : g.shortTick
        let passed = Double(day) <= headDay + 1e-6
        let x = xOf(Double(day))
        let ahead = min(1, opts.tickOpacity + (leg ? 0.25 : 0))
        let alpha = fade(x) * (passed ? 0.95 : ahead)
        if alpha <= 0 { continue }
        let y = g.dir < 0 ? g.baseline - tall : g.baseline
        ticks.append(ScrubTick(day: day, rect: Rect(x: x - u, y: y, width: 2 * u, height: tall),
                               color: passed ? opts.passedColor : opts.tickColor, alpha: alpha,
                               leg: leg, passed: passed))
    }

    let hx = xOf(headDay)
    let shape: ScrubHeadShape
    switch opts.headStyle {
    case .dot:
        let cy = g.dir < 0 ? g.baseline - g.shortTick - 9 * u : g.baseline + g.shortTick + 9 * u
        shape = .dot(center: Point(hx, cy), radius: 7 * u)
    case .needle:
        let base = g.dir < 0 ? g.baseline - g.headTall : g.baseline + g.headTall
        let tip = g.dir < 0 ? g.baseline - 4 * u : g.baseline + 4 * u
        shape = .needle(tip: Point(hx, tip), left: Point(hx - 7 * u, base), right: Point(hx + 7 * u, base))
    case .bar:
        let y = g.dir < 0 ? g.baseline - g.headTall + 6 * u : g.baseline - 6 * u
        shape = .bar(Rect(x: hx - 2.5 * u, y: y, width: 5 * u, height: g.headTall), radius: 2.5 * u)
    }
    let head = ScrubHeadMark(shape: shape, color: opts.passedColor, alpha: fade(hx),
                             glowBlur: opts.headGlow ? 14 * u : nil)

    return ScrubFrame(flash: flash, dipAlpha: dipAlpha, band: band, track: track, ticks: ticks, head: head)
}

extension ScrubDrawing {
    /// This drawing's frame at `t` — what the app's painter strokes.
    public func frame(at t: Double, _ frame: FrameBox) -> ScrubFrame? {
        scrubFrame(plan, options, pictures, t, frame)
    }
}
