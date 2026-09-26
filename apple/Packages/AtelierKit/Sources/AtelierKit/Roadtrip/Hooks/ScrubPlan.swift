// The scrub's driver — «Défilé» as arithmetic. Port of
// `src/shared/roadtrip/hooks/scrub-plan.ts`.
//
// One number runs the whole opener: the seconds since the hook began. This
// module turns it into the ONE thing every follower reads — which stop the
// reading head has reached, where along the tape it sits, and how long ago it
// landed — so the flashed picture, the passed ticks, the numeral and the tick
// in the ear are four readings of one array and cannot disagree.
//
// Decisions that live here:
// - A stop is a real picture, or an honest dark frame. Stopping on the
//   pieces' days, a stop is a day another piece already tells and flashes the
//   SOURCE picture that piece is composed over; a day nothing was posted from
//   is crossed by the head, never shown, never faked. A trip with nothing told
//   yet still sweeps — through evenly spaced days that flash nothing — so the
//   tape reads the trip's length even on its first piece.
// - The easing places the stops. Stops sit on the INVERSE of the chosen curve
//   and the head glides on the curve itself, which is what makes it sit
//   EXACTLY on a stop at that stop's time (`HookEasing.swift`).
// - The author may pick the pictures (`stopsOn: .picked`): one stop a picture,
//   in the order they were shot, the hero appended. A day with three pictures
//   is three stops on one tick: the head holds while the frames change. A
//   picture shot after this piece's day, or outside the trip, has no place on
//   the tape and is left out — and the panel says so.
// - A stored options record is never trusted (`scrubOptions`): every number is
//   read the way JavaScript's `Number()` reads it and clamped, an unknown word
//   falls back, a colour is kept lower-cased.
//
// The tape's GEOMETRY is here (`tapeGeometry`), so the rectangle the stage
// grabs is exactly the one the app's painter draws; one frame's layout is
// `ScrubPaint.swift`, and the strokes are the app's, reading a `ScrubDrawing`.

import Foundation

public enum ScrubMode: String, CaseIterable, Sendable {
    case fromStart = "from-start"
    case runUp = "run-up"
}

public enum TapePosition: String, CaseIterable, Sendable {
    case bottom, top
}

/// How the head travels — see `hookEasings`.
public typealias ScrubEasing = HookEasing
/// Which voices the ticks are played on — see `TickKits.swift`.
public typealias ScrubKit = TickKit
/// How the ticks' pitch moves along the sweep.
public typealias ScrubDrift = TickDrift

/// What the sweep stops on: the days other pieces tell, or the pictures picked.
public enum ScrubStopsOn: String, CaseIterable, Sendable {
    case pieces, picked
}

/// The shape of the reading head.
public enum ScrubHead: String, CaseIterable, Sendable {
    case bar, dot, needle
}

public struct ScrubOptions: Equatable, Sendable {
    /// What the sweep stops on.
    public var stopsOn: ScrubStopsOn
    /// `picked` only: the pictures, in any order — the plan sorts them by capture.
    public var picked: [HookPickedPicture]
    /// `pieces` only: sweep the whole trip from day 1, or only the days just before this one.
    public var mode: ScrubMode
    /// Run-up only: how many told days before this one the sweep starts from.
    public var runUpDays: Int
    /// `pieces` only: the most stops a sweep makes, the hero's own included.
    public var maxStops: Int
    /// How long the sweep takes to come to rest.
    public var sweepSeconds: Double
    /// How the head travels from the first stop to the last.
    public var easing: ScrubEasing
    /// Seconds the frame holds on the first stop before the head moves.
    public var delaySeconds: Double
    /// Flash each stop's picture as the head lands on it.
    public var flash: Bool
    /// Where the tape runs.
    public var tape: TapePosition
    /// The tape's length as a share of the frame's width, centred.
    public var tapeWidth: Double
    /// How far the tape sits from its edge, as a share of the frame's height.
    public var edgeOffset: Double
    /// Where a drag on the stage left the tape, from the placement above:
    /// shares of the frame's width and height. 0 is where Runs / From edge put it.
    public var offsetX: Double
    public var offsetY: Double
    /// Ticks and track, `#rrggbb`.
    public var tickColor: String
    /// The head and every tick it has passed, `#rrggbb`.
    public var passedColor: String
    /// Opacity of the ticks still ahead and of the track.
    public var tickOpacity: Double
    /// Tick height, 1 as designed.
    public var tickHeight: Double
    /// The least room between two ticks, in 1080-frame units — the tape's density.
    public var tickGap: Double
    /// The thin line the ticks stand on.
    public var showTrack: Bool
    /// A dark band behind the tape, for a tape over a bright picture.
    public var tapeBackground: Bool
    public var backgroundOpacity: Double
    /// Ticks and track fading out over the tape's two ends.
    public var edgeFade: Bool
    public var headStyle: ScrubHead
    /// The head's glow — one shadow blur a frame.
    public var headGlow: Bool
    /// Tick at every landing, in the exported video.
    public var sound: Bool
    /// How loud the ticks are: 1 as designed, 0 silent, up to 2.
    public var tickVolume: Double
    /// The voices the landings are played on.
    public var kit: ScrubKit
    /// Pitch of every tick: 1 as designed, 2 an octave up, 0.5 an octave down.
    public var tickPitch: Double
    /// Whether the pitch climbs, falls or stays as the head slows.
    public var pitchDrift: ScrubDrift
    /// Over a clip with its own sound: mix the ticks in rather than leave them out.
    public var mixWithClip: Bool

    /// The web's `SCRUB_DEFAULTS`.
    public static let defaults = ScrubOptions(
        stopsOn: .pieces, picked: [], mode: .fromStart, runUpDays: 8, maxStops: 12, sweepSeconds: 1.9,
        easing: .easeOut, delaySeconds: 0, flash: true, tape: .bottom, tapeWidth: 0.86, edgeOffset: 0.045,
        offsetX: 0, offsetY: 0, tickColor: "#ffffff", passedColor: "#d9442a", tickOpacity: 0.55,
        tickHeight: 1, tickGap: 6, showTrack: true, tapeBackground: false, backgroundOpacity: 0.45,
        edgeFade: false, headStyle: .bar, headGlow: true, sound: true, tickVolume: 1, kit: .ratchet,
        tickPitch: 1, pitchDrift: .flat, mixWithClip: false
    )

    public init(stopsOn: ScrubStopsOn, picked: [HookPickedPicture], mode: ScrubMode, runUpDays: Int,
                maxStops: Int, sweepSeconds: Double, easing: ScrubEasing, delaySeconds: Double, flash: Bool,
                tape: TapePosition, tapeWidth: Double, edgeOffset: Double, offsetX: Double, offsetY: Double,
                tickColor: String, passedColor: String, tickOpacity: Double, tickHeight: Double, tickGap: Double,
                showTrack: Bool, tapeBackground: Bool, backgroundOpacity: Double, edgeFade: Bool,
                headStyle: ScrubHead, headGlow: Bool, sound: Bool, tickVolume: Double, kit: ScrubKit,
                tickPitch: Double, pitchDrift: ScrubDrift, mixWithClip: Bool) {
        self.stopsOn = stopsOn; self.picked = picked; self.mode = mode; self.runUpDays = runUpDays
        self.maxStops = maxStops; self.sweepSeconds = sweepSeconds; self.easing = easing
        self.delaySeconds = delaySeconds; self.flash = flash; self.tape = tape; self.tapeWidth = tapeWidth
        self.edgeOffset = edgeOffset; self.offsetX = offsetX; self.offsetY = offsetY
        self.tickColor = tickColor; self.passedColor = passedColor; self.tickOpacity = tickOpacity
        self.tickHeight = tickHeight; self.tickGap = tickGap; self.showTrack = showTrack
        self.tapeBackground = tapeBackground; self.backgroundOpacity = backgroundOpacity
        self.edgeFade = edgeFade; self.headStyle = headStyle; self.headGlow = headGlow; self.sound = sound
        self.tickVolume = tickVolume; self.kit = kit; self.tickPitch = tickPitch; self.pitchDrift = pitchDrift
        self.mixWithClip = mixWithClip
    }

    /// The options as a layer's record holds them — every key, the web's words.
    public var json: HookOptions {
        [
            "stopsOn": .string(stopsOn.rawValue),
            "picked": .array(picked.map(\.json)),
            "mode": .string(mode.rawValue),
            "runUpDays": .number(Double(runUpDays)),
            "maxStops": .number(Double(maxStops)),
            "sweepSeconds": .number(sweepSeconds),
            "easing": .string(easing.rawValue),
            "delaySeconds": .number(delaySeconds),
            "flash": .bool(flash),
            "tape": .string(tape.rawValue),
            "tapeWidth": .number(tapeWidth),
            "edgeOffset": .number(edgeOffset),
            "offsetX": .number(offsetX),
            "offsetY": .number(offsetY),
            "tickColor": .string(tickColor),
            "passedColor": .string(passedColor),
            "tickOpacity": .number(tickOpacity),
            "tickHeight": .number(tickHeight),
            "tickGap": .number(tickGap),
            "showTrack": .bool(showTrack),
            "tapeBackground": .bool(tapeBackground),
            "backgroundOpacity": .number(backgroundOpacity),
            "edgeFade": .bool(edgeFade),
            "headStyle": .string(headStyle.rawValue),
            "headGlow": .bool(headGlow),
            "sound": .bool(sound),
            "tickVolume": .number(tickVolume),
            "kit": .string(kit.rawValue),
            "tickPitch": .number(tickPitch),
            "pitchDrift": .string(pitchDrift.rawValue),
            "mixWithClip": .bool(mixWithClip),
        ]
    }

    /// What the tape's geometry is read from.
    public var tapeGeometryOptions: TapeGeometryOptions {
        TapeGeometryOptions(tape: tape, tapeWidth: tapeWidth, edgeOffset: edgeOffset,
                            offsetX: offsetX, offsetY: offsetY, tickHeight: tickHeight)
    }
}

/// The web's `SCRUB_DEFAULTS`.
public let scrubDefaults = ScrubOptions.defaults

/// A bound an option is clamped to.
public struct ScrubRange: Equatable, Sendable {
    public var min: Double
    public var max: Double

    public init(min: Double, max: Double) {
        self.min = min; self.max = max
    }
}

/// The bounds each option is clamped to — a stored value is never trusted.
/// The web's `SCRUB_LIMITS`.
public struct ScrubLimits: Equatable, Sendable {
    public let runUpDays = ScrubRange(min: 2, max: 30)
    public let tickVolume = ScrubRange(min: 0, max: 2)
    public let maxStops = ScrubRange(min: 3, max: 16)
    public let sweepSeconds = ScrubRange(min: 0.8, max: 4)
    public let delaySeconds = ScrubRange(min: 0, max: 2)
    public let tickPitch = ScrubRange(min: 0.5, max: 2)
    public let tapeWidth = ScrubRange(min: 0.4, max: 1)
    public let edgeOffset = ScrubRange(min: 0.02, max: 0.2)
    public let tickOpacity = ScrubRange(min: 0.15, max: 1)
    public let tickHeight = ScrubRange(min: 0.4, max: 2.5)
    public let tickGap = ScrubRange(min: 3, max: 30)
    public let backgroundOpacity = ScrubRange(min: 0.1, max: 0.9)
}

public let scrubLimits = ScrubLimits()

/// The most pictures a picked sweep stops on, the hero's own not counted. Past
/// it the list is thinned evenly — the first and the last kept — rather than
/// cut: at four seconds that is already a tenth of a second a picture.
public let pickedMaxStops = 40

// MARK: - the tape's geometry

/// What the tape's geometry is read from; a drag's offsets and the tick
/// height default to 0 and 1.
public struct TapeGeometryOptions: Equatable, Sendable {
    public var tape: TapePosition
    public var tapeWidth: Double
    public var edgeOffset: Double
    public var offsetX: Double
    public var offsetY: Double
    public var tickHeight: Double

    public init(tape: TapePosition, tapeWidth: Double, edgeOffset: Double,
                offsetX: Double = 0, offsetY: Double = 0, tickHeight: Double = 1) {
        self.tape = tape; self.tapeWidth = tapeWidth; self.edgeOffset = edgeOffset
        self.offsetX = offsetX; self.offsetY = offsetY; self.tickHeight = tickHeight
    }
}

public struct TapeGeometry: Equatable, Sendable {
    public var x0: Double
    public var x1: Double
    public var length: Double
    public var baseline: Double
    /// Which way the ticks grow: +1 down (a top tape), −1 up.
    public var dir: Double
    /// The 1080-frame unit every drawn size is in.
    public var u: Double
    public var shortTick: Double
    public var tallTick: Double
    public var headTall: Double
    /// How deep the band behind the tape reaches from the baseline.
    public var bandDepth: Double
    /// The band's rectangle — the tallest thing on the tape with room to
    /// breathe; what a click grabs.
    public var band: Rect
}

/// Where the tape sits on a frame of `w`×`h`: its two ends, its baseline,
/// which way its ticks grow (away from the frame's edge, into the picture) and
/// every size drawn on it. The painter only reads this, so what the stage
/// grabs (`tapeBox`) is exactly what is drawn. A dragged tape (a non-zero
/// offset) is kept inside the frame on this frame's own aspect; an unmoved
/// tape is placed exactly as it always was.
public func tapeGeometry(_ w: Double, _ h: Double, _ opts: TapeGeometryOptions) -> TapeGeometry {
    let u = w / 1080
    let tickHeight = opts.tickHeight
    let length = w * opts.tapeWidth
    let top = opts.tape == .top
    let dir: Double = top ? 1 : -1
    let shortTick = 13 * u * tickHeight
    let tallTick = 26 * u * tickHeight
    let headTall = 40 * u * max(0.6, min(1.4, tickHeight))
    let bandDepth = max(tallTick, headTall) + 14 * u
    let breathe = 6 * u

    var x0 = (w - length) / 2 + w * opts.offsetX
    if opts.offsetX != 0 { x0 = min(max(0, w - length), max(0, x0)) }
    let anchored = top ? h * opts.edgeOffset : h * (1 - opts.edgeOffset)
    var baseline = anchored + h * opts.offsetY
    if opts.offsetY != 0 {
        let lo = top ? breathe : bandDepth + breathe
        let hi = top ? h - bandDepth - breathe : h - breathe
        if lo <= hi { baseline = min(hi, max(lo, baseline)) }
    }

    let pad = 16 * u
    let bandY = dir < 0 ? baseline - bandDepth - breathe : baseline - breathe
    return TapeGeometry(
        x0: x0, x1: x0 + length, length: length, baseline: baseline, dir: dir, u: u,
        shortTick: shortTick, tallTick: tallTick, headTall: headTall, bandDepth: bandDepth,
        band: Rect(x: x0 - pad, y: bandY, width: length + pad * 2, height: bandDepth + breathe * 2)
    )
}

/// The tape's band on a frame — what the stage outlines and a click grabs.
public func tapeBox(_ w: Double, _ h: Double, _ opts: TapeGeometryOptions) -> Rect {
    tapeGeometry(w, h, opts).band
}

/// How far a drag may move the tape, frame-free.
public struct TapeOffsetLimits: Equatable, Sendable {
    public var x: ScrubRange
    public var y: ScrubRange
}

/// Sideways until an end meets the frame's edge, up and down while the
/// baseline stays inside the frame (`tapeGeometry` then keeps the band itself
/// inside, on the frame's aspect).
public func tapeOffsetLimits(_ tape: TapePosition, _ tapeWidth: Double, _ edgeOffset: Double) -> TapeOffsetLimits {
    let side = max(0, (1 - tapeWidth) / 2)
    let anchor = tape == .top ? edgeOffset : 1 - edgeOffset
    let edge = scrubLimits.edgeOffset.min
    return TapeOffsetLimits(x: ScrubRange(min: -side, max: side),
                            y: ScrubRange(min: edge - anchor, max: 1 - edge - anchor))
}

/// The tape after a drag of `dx`, `dy` — shares of the frame, incremental.
public func moveTape(_ opts: ScrubOptions, _ dx: Double, _ dy: Double) -> ScrubOptions {
    let limits = tapeOffsetLimits(opts.tape, opts.tapeWidth, opts.edgeOffset)
    func step(_ v: Double, _ d: Double, _ l: ScrubRange) -> Double {
        min(l.max, max(l.min, v + (d.isFinite ? d : 0)))
    }
    var out = opts
    out.offsetX = step(opts.offsetX, dx, limits.x)
    out.offsetY = step(opts.offsetY, dy, limits.y)
    return out
}

/// The tape has been dragged away from where Runs / From edge put it.
public func tapeMoved(_ opts: ScrubOptions) -> Bool {
    opts.offsetX != 0 || opts.offsetY != 0
}

/// How much of the tape's length each end fades over, when the fade is on.
public let edgeFadeShare = 0.14

/// The alpha factor at `x` along a tape from `x0` to `x1`: 1 everywhere with
/// the fade off; with it on, a smooth ramp from 0 at either end to 1 past
/// `edgeFadeShare` of the length. Ticks, track and band all read it, so they
/// fade as one thing.
public func edgeFadeAt(_ x: Double, _ x0: Double, _ x1: Double, _ fade: Bool) -> Double {
    if !fade { return 1 }
    let length = x1 - x0
    if length <= 0 { return 1 }
    let ramp = length * edgeFadeShare
    let d = min(x - x0, x1 - x)
    if d <= 0 { return 0 }
    if d >= ramp { return 1 }
    let t = d / ramp
    return t * t * (3 - 2 * t)
}

// MARK: - the plan

/// One place the head comes to rest.
public struct ScrubStop: Equatable, Sendable {
    public var date: IsoDate
    public var dayNumber: Int
    /// Seconds into the hook at which the head lands here.
    public var at: Double
    /// The stop has a picture to flash: another piece tells the day, or the
    /// author picked a picture shot on it. Never the hero.
    public var told: Bool
    /// The picture this stop flashes (`hookPictureKey`), or nil for none.
    public var pictureKey: String?
    /// A leg of the trip starts on this day.
    public var legStart: Bool
    /// The day this piece tells — the picture already on the frame, never flashed.
    public var hero: Bool

    public init(date: IsoDate, dayNumber: Int, at: Double, told: Bool, pictureKey: String?, legStart: Bool, hero: Bool) {
        self.date = date; self.dayNumber = dayNumber; self.at = at; self.told = told
        self.pictureKey = pictureKey; self.legStart = legStart; self.hero = hero
    }
}

/// `Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))`.
private func scrubClamp(_ n: Double, _ lo: Double, _ hi: Double) -> Double {
    min(hi, max(lo, n.isFinite ? n : lo))
}

/// Like `scrubClamp`, but an unreadable value falls back to `fallback`, not to `lo`.
private func scrubClampOr(_ n: Double, _ lo: Double, _ hi: Double, _ fallback: Double) -> Double {
    n.isFinite ? min(hi, max(lo, n)) : fallback
}

/// How far through the stops the head is, as a fractional index.
private func scrubProgress(_ t: Double, _ delay: Double, _ sweep: Double, _ count: Int, _ easing: ScrubEasing) -> Double {
    if count <= 1 || sweep <= 0 { return Double(max(0, count - 1)) }
    let u = scrubClamp((t - delay) / sweep, 0, 1)
    let ease = hookEasings[easing]?.ease ?? { $0 }
    return ease(u) * Double(count - 1)
}

/// The scrub, planned: stops, their times, and the readings a frame needs.
public struct ScrubPlan: Equatable, Sendable {
    public var totalDays: Int
    public var stops: [ScrubStop]
    /// Day numbers a leg starts on — the tape's long ticks.
    public var legStarts: [Int]
    /// Seconds the head is in MOTION; 0 when there is nowhere to sweep from.
    public var sweepSeconds: Double
    /// Seconds the frame holds on the first stop before the head moves.
    public var delaySeconds: Double
    /// The curve the head glides on.
    public var easing: ScrubEasing

    /// When the head comes to rest — the delay plus the sweep. The opener's
    /// life, what the painter reads for "still sweeping", 0 for a sweep of one.
    public var endSeconds: Double { delaySeconds + sweepSeconds }

    private func progress(_ t: Double) -> Double {
        scrubProgress(t, delaySeconds, sweepSeconds, stops.count, easing)
    }

    /// Which stop the head last reached.
    public func stopAt(_ t: Double) -> Int {
        let reached = (progress(t) + 1e-9).rounded(.down)
        return min(stops.count - 1, Int(reached))
    }

    /// The (fractional) day number under the head.
    public func headDayAt(_ t: Double) -> Double {
        let count = stops.count
        let f = progress(t)
        let i = min(count - 1, Int(f.rounded(.down)))
        let next = stops[min(count - 1, i + 1)]
        let here = Double(stops[i].dayNumber)
        return here + (Double(next.dayNumber) - here) * (f - Double(i))
    }

    /// Seconds since the head last landed — drives the shutter dip.
    public func sinceStopAt(_ t: Double) -> Double {
        t - stops[stopAt(t)].at
    }
}

/// A stored options record, read through the defaults and clamped.
public func scrubOptions(_ raw: HookOptions) -> ScrubOptions {
    let d = ScrubOptions.defaults
    let L = scrubLimits
    // `{ ...SCRUB_DEFAULTS, ...raw }`: a key the record holds, even as null, is read.
    func number(_ key: String, _ fallback: Double) -> Double {
        raw[key].map { JSLoose.number($0) } ?? fallback
    }
    func word<T: RawRepresentable>(_ key: String, _ fallback: T) -> T where T.RawValue == String {
        raw[key]?.stringValue.flatMap(T.init(rawValue:)) ?? fallback
    }
    func colour(_ key: String, _ fallback: String) -> String {
        guard let s = raw[key]?.stringValue else { return fallback }
        let bytes = Array(s.utf8)
        guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return fallback }
        for b in bytes[1...] {
            let hex = (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
            if !hex { return fallback }
        }
        return s.lowercased()
    }
    /// `o.key !== false`: only a stored `false` turns it off.
    func notFalse(_ key: String) -> Bool { raw[key] != .bool(false) }
    /// `o.key === true`: only a stored `true` turns it on.
    func isTrue(_ key: String) -> Bool { raw[key] == .bool(true) }

    let tape: TapePosition = raw["tape"]?.stringValue == "top" ? .top : .bottom
    let tapeWidth = scrubClampOr(number("tapeWidth", d.tapeWidth), L.tapeWidth.min, L.tapeWidth.max, d.tapeWidth)
    let edgeOffset = scrubClampOr(number("edgeOffset", d.edgeOffset), L.edgeOffset.min, L.edgeOffset.max, d.edgeOffset)
    // A drag's offsets are read against the placement they are measured from,
    // so a tape widened or moved to the other edge after a drag still fits.
    let limits = tapeOffsetLimits(tape, tapeWidth, edgeOffset)
    let headStyle: ScrubHead = {
        let s = raw["headStyle"]?.stringValue
        return s == "dot" ? .dot : (s == "needle" ? .needle : .bar)
    }()
    let pitchDrift: ScrubDrift = {
        let s = raw["pitchDrift"]?.stringValue
        return s == "rising" ? .rising : (s == "falling" ? .falling : .flat)
    }()

    return ScrubOptions(
        stopsOn: raw["stopsOn"]?.stringValue == "picked" ? .picked : .pieces,
        picked: readPicked(raw["picked"] ?? .array([])),
        mode: raw["mode"]?.stringValue == "run-up" ? .runUp : .fromStart,
        // Clamped first, so the rounded value is always a whole, finite count.
        runUpDays: Int(TripJS.round(scrubClamp(number("runUpDays", Double(d.runUpDays)), L.runUpDays.min,
                                               L.runUpDays.max))),
        maxStops: Int(TripJS.round(scrubClamp(number("maxStops", Double(d.maxStops)), L.maxStops.min,
                                              L.maxStops.max))),
        sweepSeconds: scrubClamp(number("sweepSeconds", d.sweepSeconds), L.sweepSeconds.min, L.sweepSeconds.max),
        easing: word("easing", ScrubEasing.easeOut),
        delaySeconds: scrubClampOr(number("delaySeconds", d.delaySeconds), L.delaySeconds.min, L.delaySeconds.max,
                                   d.delaySeconds),
        flash: notFalse("flash"),
        tape: tape,
        tapeWidth: tapeWidth,
        edgeOffset: edgeOffset,
        offsetX: scrubClampOr(number("offsetX", d.offsetX), limits.x.min, limits.x.max, 0),
        offsetY: scrubClampOr(number("offsetY", d.offsetY), limits.y.min, limits.y.max, 0),
        tickColor: colour("tickColor", d.tickColor),
        passedColor: colour("passedColor", d.passedColor),
        tickOpacity: scrubClampOr(number("tickOpacity", d.tickOpacity), L.tickOpacity.min, L.tickOpacity.max,
                                  d.tickOpacity),
        tickHeight: scrubClampOr(number("tickHeight", d.tickHeight), L.tickHeight.min, L.tickHeight.max,
                                 d.tickHeight),
        tickGap: scrubClampOr(number("tickGap", d.tickGap), L.tickGap.min, L.tickGap.max, d.tickGap),
        showTrack: notFalse("showTrack"),
        tapeBackground: isTrue("tapeBackground"),
        backgroundOpacity: scrubClampOr(number("backgroundOpacity", d.backgroundOpacity), L.backgroundOpacity.min,
                                        L.backgroundOpacity.max, d.backgroundOpacity),
        edgeFade: isTrue("edgeFade"),
        headStyle: headStyle,
        headGlow: notFalse("headGlow"),
        sound: notFalse("sound"),
        tickVolume: scrubClampOr(number("tickVolume", d.tickVolume), L.tickVolume.min, L.tickVolume.max,
                                 d.tickVolume),
        kit: word("kit", ScrubKit.ratchet),
        tickPitch: scrubClampOr(number("tickPitch", d.tickPitch), L.tickPitch.min, L.tickPitch.max, d.tickPitch),
        pitchDrift: pitchDrift,
        mixWithClip: isTrue("mixWithClip")
    )
}

/// The time a stop is reached, as a fraction of the sweep: the easing's
/// inverse at the stop's share of the way. The first stop is at 0, the last at 1.
public func stopFraction(_ index: Int, _ count: Int, _ easing: ScrubEasing = .easeOut) -> Double {
    if count <= 1 { return 1 }
    let p = Double(index) / Double(count - 1)
    let inverse = hookEasings[easing]?.inverse ?? { $0 }
    return scrubClamp(inverse(p), 0, 1)
}

/// One stop before it is timed: the day it sits on, and the picture it asks
/// the shell for. The hero's seed asks for nothing — its picture is the frame.
public struct ScrubSeed: Equatable, Sendable {
    public var day: HookDay
    public var want: HookPictureWant?
    /// A leg starts here AND this is the first stop on that day.
    public var legStart: Bool

    public init(day: HookDay, want: HookPictureWant?, legStart: Bool) {
        self.day = day; self.want = want; self.legStart = legStart
    }
}

/// `list.slice(-n)`.
private func scrubSliceLast<T>(_ list: [T], _ n: Int) -> [T] {
    let start = -n < 0 ? max(list.count - n, 0) : min(-n, list.count)
    return Array(list[start...])
}

/// The stops a sweep makes, the hero last — or nil when this piece's day is
/// not a day of the trip at all.
///
/// On the pieces' days, the pool is the TOLD days before this one. When it is
/// empty the sweep still runs, through evenly spaced untold days, so a first
/// piece reads the trip's length too; those stops flash nothing because there
/// is nothing to flash. On picked pictures, it is one stop a picture.
public func scrubSeeds(_ calendar: [HookDay], _ date: IsoDate, _ opts: ScrubOptions) -> [ScrubSeed]? {
    guard let heroIndex = calendar.firstIndex(where: { $0.date == date }) else { return nil }
    let hero = calendar[heroIndex]
    let heroSeed = ScrubSeed(day: hero, want: nil, legStart: hero.legStart)

    if opts.stopsOn == .picked {
        var byDate: [IsoDate: HookDay] = [:]
        for day in calendar { byDate[day.date] = day }
        let kept = sampleEvenly(partitionPicked(calendar, date, opts.picked).inReach, pickedMaxStops)
        var lastDate = ""
        var seeds: [ScrubSeed] = []
        for picture in kept {
            // `partitionPicked` keeps only pictures shot on a day of the calendar.
            guard let day = byDate[picture.date] else { continue }
            let first = picture.date != lastDate
            lastDate = picture.date
            seeds.append(ScrubSeed(day: day, want: HookPictureWant(key: hookPictureKey(picture.ref), ref: picture.ref),
                                   legStart: first && day.legStart))
        }
        // The hero's tick sounds its leg only when no picture already landed there.
        var last = heroSeed
        last.legStart = hero.legStart && lastDate != hero.date
        return seeds + [last]
    }

    let before = Array(calendar[..<heroIndex])
    let budget = opts.maxStops - 1
    let runUpDays = opts.runUpDays
    let told = before.filter(\.told)
    var picks: [HookDay]
    if opts.mode == .runUp {
        picks = !told.isEmpty
            ? scrubSliceLast(told, min(runUpDays, budget))
            : sampleEvenly(scrubSliceLast(before, runUpDays), min(budget, runUpDays))
    } else {
        picks = !told.isEmpty ? sampleEvenly(told, budget) : sampleEvenly(before, min(budget, 6))
        // A sweep from the start STARTS at the start: the head leaves day 1 even
        // when nothing was told there, or the tape's first stretch is never read.
        if let start = before.first, picks.first?.date != start.date {
            picks = [start] + (budget > 1 ? scrubSliceLast(picks, budget - 1) : [])
        }
    }
    let seeds = picks.map { day -> ScrubSeed in
        let piece = day.told ? standingPiece(day) : nil
        let want = piece.flatMap { p -> HookPictureWant? in
            guard let media = p.media else { return nil }
            return HookPictureWant(key: hookPictureKey(media), ref: media, atSeconds: p.videoSeconds)
        }
        return ScrubSeed(day: day, want: want, legStart: day.legStart)
    }
    return seeds + [heroSeed]
}

/// The scrub, planned: stops, their times, and the readings a frame needs.
public func scrubPlan(_ calendar: [HookDay], _ date: IsoDate, _ opts: ScrubOptions) -> ScrubPlan? {
    guard let seeds = scrubSeeds(calendar, date, opts) else { return nil }

    let count = seeds.count
    let sweep = count > 1 ? opts.sweepSeconds : 0
    // A sweep of one has nothing to wait for either: no delay, no life.
    let delay = count > 1 ? opts.delaySeconds : 0
    let stops = seeds.enumerated().map { i, seed -> ScrubStop in
        let hero = i == count - 1
        let told = !hero && (opts.stopsOn == .picked ? seed.want != nil : seed.day.told)
        return ScrubStop(
            date: seed.day.date,
            dayNumber: seed.day.dayNumber,
            at: delay + sweep * stopFraction(i, count, opts.easing),
            told: told,
            pictureKey: hero ? nil : seed.want?.key,
            legStart: seed.legStart,
            hero: hero
        )
    }
    return ScrubPlan(
        totalDays: calendar.count,
        stops: stops,
        legStarts: calendar.filter(\.legStart).map(\.dayNumber),
        sweepSeconds: sweep,
        delaySeconds: delay,
        easing: opts.easing
    )
}

/// The pictures a plan's stops flash, once each — what the variant hands the
/// shell to decode. The hero's picture is already on the frame.
public func scrubWants(_ seeds: [ScrubSeed]) -> [HookPictureWant] {
    var seen = Set<String>()
    var out: [HookPictureWant] = []
    for seed in seeds.dropLast() {
        guard let want = seed.want, !seen.contains(want.key) else { continue }
        seen.insert(want.key)
        out.append(want)
    }
    return out
}

// MARK: - the tape's days

/// Where a day sits along the tape, as a fraction 0..1 of its length. A trip
/// of one day puts it at the start, rather than dividing by zero.
public func tapeFraction(_ dayNumber: Double, _ totalDays: Int) -> Double {
    if totalDays <= 1 { return 0 }
    return scrubClamp((dayNumber - 1) / Double(totalDays - 1), 0, 1)
}

/// The day numbers that get a tick on a tape `lengthPx` long. Every day while
/// ticks stay `minGapPx` apart, every k-th day past that — the start and
/// every leg start always, since those are the ticks that carry meaning.
public func tapeTicks(_ totalDays: Int, _ lengthPx: Double, _ legStarts: [Int], minGapPx: Double = 5) -> [Int] {
    if totalDays <= 0 { return [] }
    let perDay = totalDays > 1 ? lengthPx / Double(totalDays - 1) : lengthPx
    // JavaScript's `Math.max` keeps a NaN where Swift's `max` would drop it.
    let floorPerDay = perDay.isNaN ? perDay : max(perDay, 1e-6)
    let raw = (minGapPx / floorPerDay).rounded(.up)
    var ticks = Set([1, totalDays] + legStarts)
    if raw.isNaN || raw == .infinity {
        // `day += NaN` (or `+= Infinity`) in the web: the first day, nothing after.
        ticks.insert(1)
    } else {
        // Past the last day the loop has nothing left to add.
        let stride = Int(min(max(1, raw), Double(totalDays)))
        var day = 1
        while day <= totalDays {
            ticks.insert(day)
            day += stride
        }
    }
    return ticks.filter { $0 >= 1 && $0 <= totalDays }.sorted()
}

// MARK: - the sound

/// Which voices the ticks are played on and how their pitch moves.
public struct ScrubTuning: Equatable, Sendable {
    public var kit: ScrubKit
    public var pitch: Double
    public var drift: ScrubDrift

    public init(kit: ScrubKit = .ratchet, pitch: Double = 1, drift: ScrubDrift = .flat) {
        self.kit = kit; self.pitch = pitch; self.drift = drift
    }
}

/// The sweep, heard: a sound at every landing, read off the same stops the
/// head and the pictures follow — so the ticks cannot fall between frames they
/// belong to. The cadence comes free from the deceleration.
///
/// - an ordinary landing is the kit's tick;
/// - a landing on a day a leg starts is the kit's leg voice — the one sound
///   carrying meaning, so the one that is different;
/// - the hero is the seat, which ends the phrase.
///
/// Levels fall along the sweep as the mechanism slows. `volume` scales every
/// one of them; `pitch` transposes them all, and a `drift` climbs or falls
/// across the landings — the seat takes the pitch but not the drift. Nothing
/// when there is nowhere to sweep from — or at volume 0, which writes no track
/// at all rather than a silent one.
public func scrubScore(_ plan: ScrubPlan, _ volume: Double = 1, _ tuning: ScrubTuning = ScrubTuning()) -> [SoundEvent] {
    if plan.sweepSeconds <= 0 || !(volume > 0) { return [] }
    let kit = tuning.kit.spec
    let landings = max(1, plan.stops.count - 1)
    return plan.stops.enumerated().map { i, stop -> SoundEvent in
        if stop.hero {
            return SoundEvent(at: stop.at, voice: kit.seat.rawValue, gain: 0.8 * volume, rate: tuning.pitch)
        }
        let share = landings > 1 ? Double(i) / Double(landings - 1) : 0
        let rate = tuning.pitch * driftAt(tuning.drift, share)
        let level = max(0.35, 0.85 - Double(i) * 0.04) * volume
        if stop.legStart {
            return SoundEvent(at: stop.at, voice: kit.leg.voice.rawValue, gain: level * kit.leg.gain, rate: rate * kit.leg.rate)
        }
        return SoundEvent(at: stop.at, voice: kit.tick.rawValue, gain: level, rate: rate)
    }
}

// MARK: - what the app paints

/// Défilé's drawing: the plan `prepare` built — the one its numeral and its
/// ticks read — with the options and the pictures it was prepared against.
/// The app's painter (`scrub-paint.ts` on the web) reads nothing else, and
/// reads it through `frame(at:_:)` (`ScrubPaint.swift`): what fills the frame,
/// the dip, the band, the track, every tick and the head, placed and coloured.
public struct ScrubDrawing: HookDrawing {
    public let plan: ScrubPlan
    public let options: ScrubOptions
    public let pictures: [String: HookPicture]?

    public init(plan: ScrubPlan, options: ScrubOptions, pictures: [String: HookPicture]?) {
        self.plan = plan; self.options = options; self.pictures = pictures
    }
}
