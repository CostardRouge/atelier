// The suite's small synthesised voices — ticks, knocks, blips. Port of
// `src/shared/audio/voices.ts`.
//
// The web schedules each voice into a Web Audio context (oscillators, a
// biquad, gain envelopes) and lets the browser render it. The kernel has no
// audio engine, so the port is in two halves:
//
// - **The table** (`scheduleVoice`) is the web's, one for one: a voice is a
//   list of PARTS — a tone or a filtered noise hit at a time — handed to the
//   sink it is given, never built into anything else. That is the web's one
//   rule (*a voice only ever touches the ctx it is handed*), kept as the
//   `VoiceSink` protocol: `[VoicePart]` records (the spec's stand-in context),
//   `VoiceRenderer` renders.
// - **The renderer** (`VoiceRenderer`) is Web Audio's offline graph written
//   as sample arithmetic, into Doubles, at any sample rate. What the browser's
//   nodes do had to be reproduced by hand, and it was MEASURED against
//   Chromium's own `OfflineAudioContext` running the web's `renderBed`
//   (headless Chrome 153, 2026-09-25) rather than read off the spec, because
//   Chrome departs from the spec in ways a render carries:
//     · a BUFFER source starts on `TimeToSampleFrame`'s frame — `ceil` of its
//       time taken at 1024× the rate (crbug.com/1044117) — sub-sample,
//       linearly interpolated, its last sample extrapolated from the two
//       before it; every source STOPS on that frame too; but an OSCILLATOR
//       starts on a plain `ceil(time × rate)`, so a start a rounding error
//       past a frame plays from the next one; an automation event applies
//       from `ceil(time × rate)`;
//     · an oscillator under frequency automation starts at phase 0 and, until
//       the end of the 128-frame render quantum it starts in, its k-th frame
//       steps with the frequency of the QUANTUM's k-th frame — the 440 Hz
//       default before its own `setValueAtTime`, then its own automation run
//       late — so a tone's first ≤ 64 frames (1.3 ms, under one cycle at
//       440 Hz, inside its attack) step at 440 Hz. From the next quantum it
//       follows the automation per frame, as the spec says;
//     · a waveform is band-limited Chrome's way (`PeriodicWave`): a table per
//       third of an octave, 4096 points at 44.1/48 kHz, each culling the
//       partials its range would alias, the two tables either side of the
//       pitch blended by its position, normalised on the fullest table;
//     · the biquad is the Audio EQ Cookbook band-pass in direct form I, double
//       coefficients and a Float output fed back, as Blink runs it;
//     · an exponential ramp is v₁·(v₂/v₁)^((t−t₁)/(t₂−t₁)) per frame; before
//       its first event a param holds its default (a gain of 1, 440 Hz),
//       which only ever meets a zero sample (a phase-0 start).
//   With those, every bed measured agrees with Chrome's graph within 2e−6 a
//   sample (≥ 113 dB below the signal) — Float rounding. What the kernel does
//   NOT reproduce is a race: the web's `onended` handlers disconnect a hit's
//   nodes from the main thread while the offline render runs, cutting a
//   band-pass's ring at whichever quantum the disconnect lands in, so Chrome
//   renders the SAME score differently from one export to the next, by up to
//   1.5e−3 in a filter's tail. The kernel lets every ring decay — the graph
//   as written, and one of the outcomes Chrome itself produces.
//
// Two departures from `p5-templates`' `clickSynth.ts`, both the web's own and
// kept: the noise is SEEDED per hit (mulberry32 from its time and pitch, the
// kernel's `mulberry32`, so the same piece renders the same bed in both
// apps), and three scrub voices (`detent`, `leg`, `seat`) join the seven.

import Foundation

/// `exponentialRampToValueAtTime` cannot reach true zero.
private let minGain = 0.0001

public enum VoiceName: String, CaseIterable, Sendable {
    case click, tick, blip, pop, beep, wood, typewriter, detent, leg, seat
}

/// Every voice, in the web's order.
public let voiceNames: [VoiceName] = VoiceName.allCases

public func isVoice(_ name: String?) -> Bool {
    guard let name else { return false }
    return VoiceName(rawValue: name) != nil
}

/// The loudest a single voice may be asked to play. Above 1 on purpose: a
/// score turned up (the scrub's ticks volume) must come out LOUDER, not
/// flattened against a ceiling of 1 while quieter hits keep rising. What
/// protects the file from clipping is the bed's own peak guard
/// (`RenderBed.swift`), not this.
public let maxVoiceGain = 2.0

public struct VoiceParams: Equatable, Sendable {
    /// Peak level, 0..maxVoiceGain; 1 is the voice as designed. Nil = 0.5.
    public var gain: Double?
    /// Pitch multiplier: 1 as designed, 2 an octave up. Nil = 1.
    public var rate: Double?
    public init(gain: Double? = nil, rate: Double? = nil) { self.gain = gain; self.rate = rate }
}

public enum OscillatorShape: String, Sendable {
    case sine, triangle
}

/// An oscillator through an attack/decay envelope — the web's `tone()`.
public struct ToneSpec: Equatable, Sendable {
    public var type: OscillatorShape
    public var freq: Double
    /// Swept to exponentially over the duration; nil or ≤ 0 holds `freq`.
    public var endFreq: Double?
    public var duration: Double
    public var attack: Double
    public var gain: Double
    public var delay: Double

    public init(type: OscillatorShape = .sine, freq: Double, endFreq: Double? = nil, duration: Double = 0.05,
                attack: Double = 0.001, gain: Double = 0.5, delay: Double = 0) {
        self.type = type; self.freq = freq; self.endFreq = endFreq; self.duration = duration
        self.attack = attack; self.gain = gain; self.delay = delay
    }
}

/// Seeded white noise fading out linearly, through a band-pass — `noiseHit()`.
public struct NoiseSpec: Equatable, Sendable {
    public var freq: Double
    public var q: Double
    public var duration: Double
    public var gain: Double
    public var delay: Double

    public init(freq: Double, q: Double = 1, duration: Double = 0.03, gain: Double = 0.3, delay: Double = 0) {
        self.freq = freq; self.q = q; self.duration = duration; self.gain = gain; self.delay = delay
    }
}

/// One source a voice starts: what the web's `tone()` / `noiseHit()` build
/// into the context, as a value.
public enum VoicePart: Equatable, Sendable {
    case tone(ToneSpec, when: Double)
    case noise(NoiseSpec, when: Double)

    /// The time the part's source starts — `when + delay`.
    public var start: Double {
        switch self {
        case let .tone(spec, when): return when + spec.delay
        case let .noise(spec, when): return when + spec.delay
        }
    }
}

/// Where a voice's parts go — the web's `(ctx, destination)` pair.
public protocol VoiceSink {
    mutating func schedule(_ part: VoicePart)
}

/// A plain list records what was scheduled — the spec's stand-in context.
extension Array: VoiceSink where Element == VoicePart {
    public mutating func schedule(_ part: VoicePart) { append(part) }
}

/// The ten voices, as the web's table defines them.
private func voiceParts(_ voice: VoiceName, _ when: Double, _ gain: Double, _ rate: Double) -> [VoicePart] {
    func tone(_ s: ToneSpec) -> VoicePart { .tone(s, when: when) }
    func noise(_ s: NoiseSpec) -> VoicePart { .noise(s, when: when) }
    switch voice {
    // --- the seven originals, as designed in p5-templates -------------------
    case .click:
        // Soft camera-shutter tick: a filtered noise snap over a faint sine body.
        return [noise(NoiseSpec(freq: 2400 * rate, q: 3, duration: 0.025, gain: gain)),
                tone(ToneSpec(freq: 1800 * rate, duration: 0.02, gain: gain * 0.35))]
    case .tick:
        // Bright, dry metronome tick.
        return [noise(NoiseSpec(freq: 3200 * rate, q: 1.5, duration: 0.03, gain: gain))]
    case .blip:
        // Short rounded triangle blip.
        return [tone(ToneSpec(type: .triangle, freq: 1300 * rate, duration: 0.05, attack: 0.002, gain: gain))]
    case .pop:
        // Bubble pop: a fast downward sweep.
        return [tone(ToneSpec(freq: 520 * rate, endFreq: 160 * rate, duration: 0.09, attack: 0.002, gain: gain))]
    case .beep:
        // Plain sine beep — the longest, reads as a confirmation.
        return [tone(ToneSpec(freq: 880 * rate, duration: 0.12, attack: 0.004, gain: gain))]
    case .wood:
        // Woodblock: a resonant low knock over a short thump.
        return [noise(NoiseSpec(freq: 950 * rate, q: 8, duration: 0.06, gain: gain)),
                tone(ToneSpec(freq: 220 * rate, endFreq: 180 * rate, duration: 0.05, gain: gain * 0.5))]
    case .typewriter:
        // Two-part key strike: hammer, then rebound.
        return [noise(NoiseSpec(freq: 2000 * rate, q: 2, duration: 0.02, gain: gain)),
                noise(NoiseSpec(freq: 1400 * rate, q: 2, duration: 0.03, gain: gain * 0.6, delay: 0.03))]
    // --- the scrub's three ---------------------------------------------------
    case .detent:
        // The ordinary landing: a ratchet, not a beep.
        return [noise(NoiseSpec(freq: 2200 * rate, q: 6, duration: 0.06, gain: gain)),
                tone(ToneSpec(freq: 1600 * rate, duration: 0.018, gain: gain * 0.25))]
    case .leg:
        // A leg of the trip starting: the detent an octave down and a little
        // louder — the one sound that carries meaning, so the one that differs.
        return [noise(NoiseSpec(freq: 1100 * rate, q: 3.5, duration: 0.11, gain: min(maxVoiceGain, gain * 1.4))),
                tone(ToneSpec(freq: 420 * rate, endFreq: 300 * rate, duration: 0.06, gain: gain * 0.35))]
    case .seat:
        // The seat: the head coming to rest on today — it ends the phrase.
        return [tone(ToneSpec(freq: 190 * rate, endFreq: 120 * rate, duration: 0.22, attack: 0.006, gain: gain)),
                noise(NoiseSpec(freq: 2200 * rate, q: 6, duration: 0.05, gain: gain * 0.7))]
    }
}

/// Schedule one voice at `when`, in the sink's own time base. An unknown name
/// falls back to `click` — a score written by a newer build still makes a
/// sound where one was meant — and the level and pitch are clamped to what the
/// voices were designed around.
public func scheduleVoice<S: VoiceSink>(_ sink: inout S, _ when: Double, _ voice: String,
                                        _ params: VoiceParams = VoiceParams()) {
    let name = VoiceName(rawValue: voice) ?? .click
    // A NaN level is refused by the browser (the voice never plays), never
    // read as the loudest one.
    let asked = params.gain ?? 0.5
    let gain = asked.isNaN ? 0 : max(0, min(maxVoiceGain, asked))
    let rate = max(0.05, params.rate ?? 1)
    for part in voiceParts(name, max(0, when), gain, rate) { sink.schedule(part) }
}

// MARK: - The renderer: Web Audio's offline graph as sample arithmetic

/// Chrome processes a graph in quanta of this many frames.
private let renderQuantum = 128

/// Chrome's `TimeToSampleFrame(time, rate, kRoundUp)`: the frame is rounded at
/// 1024× the rate first (crbug.com/1044117), so a time a rounding error past a
/// frame lands ON it. Where a buffer source starts, and where any source stops.
private func sampleFrame(_ time: Double, _ sampleRate: Double) -> Int {
    frameIndex(((time * sampleRate * 1024).rounded() / 1024).rounded(.up))
}

/// Where an OSCILLATOR starts: a plain `ceil(time × rate)`, measured — a start
/// a rounding error past a frame (0.017 s × 48 kHz = 816.0000000000001) plays
/// from the NEXT frame, where a buffer source would start on it.
private func oscillatorStartFrame(_ time: Double, _ sampleRate: Double) -> Int {
    frameIndex((time * sampleRate).rounded(.up))
}

/// A whole frame as an index; a time no bed reaches (∞, NaN — which the
/// browser refuses outright) is past every bed.
private func frameIndex(_ frame: Double) -> Int {
    if frame.isNaN || frame >= 1e15 { return Int.max }
    return frame <= 0 ? 0 : Int(frame)
}

/// An `AudioParam`'s timeline: `setValueAtTime` and `exponentialRampToValueAtTime`
/// events, each applying from `ceil(time × rate)` as Chrome's timeline does.
private struct ParamTimeline {
    struct Event { let time: Double; let value: Double; let ramp: Bool }
    let events: [Event]
    let defaultValue: Double

    init(defaultValue: Double, _ events: [Event]) {
        self.defaultValue = defaultValue
        // Stable by time, as the timeline inserts them.
        self.events = events.enumerated()
            .sorted { $0.element.time != $1.element.time ? $0.element.time < $1.element.time : $0.offset < $1.offset }
            .map(\.element)
    }

    func value(frame n: Int, sampleRate: Double) -> Double {
        let x = Double(n)
        var previous: Event?
        for event in events {
            if x < event.time * sampleRate {
                guard event.ramp, let p = previous else { return previous?.value ?? defaultValue }
                if p.value * event.value <= 0 { return p.value }
                let u = (x / sampleRate - p.time) / (event.time - p.time)
                return p.value * pow(event.value / p.value, u)
            }
            previous = event
        }
        return previous?.value ?? defaultValue
    }
}

/// A param's value as the browser stores it — a Float.
private func f32(_ v: Double) -> Double { Double(Float(v)) }

/// Chrome's `PeriodicWave` for the two shapes the voices use: per third of an
/// octave, a table whose partials are culled so none reaches Nyquist, the two
/// tables either side of the pitch blended by its position between them.
private struct BandLimitedWave {
    let shape: OscillatorShape
    /// The table's length — what a phase index wraps at.
    let size: Int
    let lowestFundamental: Float
    let ranges: Int
    let partials: [Int]
    let normalisation: Double

    init(_ shape: OscillatorShape, sampleRate: Double) {
        self.shape = shape
        size = sampleRate <= 24000 ? 2048 : sampleRate <= 88200 ? 4096 : 16384
        let maxPartials = size / 2
        lowestFundamental = Float(0.5 * sampleRate) / Float(maxPartials)
        ranges = Int(0.5 + 3 * log2(Double(size)))
        partials = (0..<ranges).map { r in
            let scale = powf(2, -(Float(r) * 400) / 1200)
            // Bins 1 ..< min(components, partials + 1) are kept; components = size / 2.
            return min(maxPartials - 1, Int(scale * Float(maxPartials)))
        }
        // Normalised on the first (fullest) table's peak, as Chrome does.
        switch shape {
        case .sine:
            normalisation = 1
        case .triangle:
            var peak = 0.0
            var k = 1
            while k <= maxPartials - 1 {
                peak += 8 / (Double.pi * Double.pi * Double(k * k))
                k += 2
            }
            normalisation = 1 / peak
        }
    }

    private func series(_ cycles: Double, _ count: Int) -> Double {
        guard count >= 1 else { return 0 }
        switch shape {
        case .sine:
            return sin(2 * Double.pi * cycles)
        case .triangle:
            var v = 0.0
            var k = 1
            while k <= count {
                let sign: Double = ((k - 1) / 2) % 2 == 0 ? 1 : -1
                v += sign * 8 / (Double.pi * Double.pi * Double(k * k)) * sin(2 * Double.pi * Double(k) * cycles)
                k += 2
            }
            return v
        }
    }

    func sample(_ cycles: Double, frequency: Float) -> Double {
        let f = abs(frequency)
        let ratio: Float = f > 0 ? f / lowestFundamental : 0.5
        var pitch = 1 + log2f(ratio) * 1200 / 400
        pitch = min(max(pitch, 0), Float(ranges - 1))
        let r1 = Int(pitch)
        let r2 = r1 < ranges - 1 ? r1 + 1 : r1
        let w = Double(pitch - Float(r1))
        let higher = series(cycles, partials[r1])
        let lower = partials[r2] == partials[r1] ? higher : series(cycles, partials[r2])
        return ((1 - w) * higher + w * lower) * normalisation
    }
}

/// Web Audio's offline graph, reproduced: every part scheduled into it is
/// rendered at once into a mono bus of Doubles (the voices are mono; the bed
/// copies the bus to each channel as the browser's up-mix does).
public struct VoiceRenderer: VoiceSink {
    public let sampleRate: Double
    public private(set) var frames: [Double]
    private let sine: BandLimitedWave
    private let triangle: BandLimitedWave

    public init(sampleRate: Double, length: Int) {
        self.sampleRate = sampleRate
        frames = [Double](repeating: 0, count: max(0, length))
        sine = BandLimitedWave(.sine, sampleRate: sampleRate)
        triangle = BandLimitedWave(.triangle, sampleRate: sampleRate)
    }

    public mutating func schedule(_ part: VoicePart) {
        switch part {
        case let .tone(spec, when): renderTone(spec, when + spec.delay)
        case let .noise(spec, when): renderNoise(spec, when + spec.delay)
        }
    }

    // An OscillatorNode → GainNode, stopped 50 ms after its envelope ends.
    private mutating func renderTone(_ spec: ToneSpec, _ start: Double) {
        let sr = sampleRate
        let first = oscillatorStartFrame(start, sr)
        let end = min(frames.count, sampleFrame(start + spec.duration + 0.05, sr))
        guard first < end else { return }

        var freqEvents = [ParamTimeline.Event(time: start, value: f32(max(1, spec.freq)), ramp: false)]
        if let endFreq = spec.endFreq, endFreq > 0 {
            freqEvents.append(.init(time: start + spec.duration, value: f32(max(1, endFreq)), ramp: true))
        }
        let frequency = ParamTimeline(defaultValue: 440, freqEvents)
        let envelope = ParamTimeline(defaultValue: 1, [
            .init(time: start, value: f32(minGain), ramp: false),
            .init(time: start + spec.attack, value: f32(max(minGain, spec.gain)), ramp: true),
            .init(time: start + spec.duration, value: f32(minGain), ramp: true),
        ])
        let wave = spec.type == .sine ? sine : triangle
        // The phase in table units, as Chrome keeps it (a Double of Float steps).
        let tableSize = Double(wave.size)
        let rateScale = Float(tableSize / sr)
        let quantum = (first / renderQuantum) * renderQuantum
        var index = 0.0
        for n in first..<end {
            // Chrome's start-quantum lag: the frequency of frame `quantum + k`
            // steps the k-th frame after the start, until the next quantum.
            let m = n < quantum + renderQuantum ? quantum + (n - first) : n
            let hz = Float(frequency.value(frame: m, sampleRate: sr))
            let value = wave.sample(index / tableSize, frequency: hz)
            let gain = Double(Float(envelope.value(frame: n, sampleRate: sr)))
            frames[n] += Double(Float(value) * Float(gain))
            index += Double(hz * rateScale)
            index -= (index / tableSize).rounded(.down) * tableSize
        }
    }

    // An AudioBufferSourceNode of seeded, fading noise → BiquadFilterNode
    // (band-pass) → GainNode.
    private mutating func renderNoise(_ spec: NoiseSpec, _ start: Double) {
        let sr = sampleRate
        let length = max(1, Int((sr * spec.duration).rounded(.down)))
        let random = mulberry32(noiseJsRound(start * 1000) + noiseJsRound(spec.freq))
        var buffer = [Float](repeating: 0, count: length)
        for i in 0..<length {
            let r = random()
            buffer[i] = Float((r * 2 - 1) * (1 - Double(i) / Double(length)))
        }

        // The Cookbook band-pass, as Blink sets it: normalised to Nyquist.
        let normalised = f32(max(1, spec.freq)) / (sr / 2)
        let q = f32(spec.q)
        var b0 = 0.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0
        if normalised > 0 && normalised < 1 {
            if q > 0 {
                let w0 = Double.pi * normalised
                let alpha = sin(w0) / (2 * q)
                let a0 = 1 + alpha
                b0 = alpha / a0; b1 = 0; b2 = -alpha / a0
                a1 = -2 * cos(w0) / a0; a2 = (1 - alpha) / a0
            } else {
                b0 = 1
            }
        }
        let gain = Float(spec.gain)

        let first = sampleFrame(start, sr)
        guard first < frames.count else { return }
        let offset = max(0, Double(first) - start * sr)
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        var n = first
        while n < frames.count {
            let position = offset + Double(n - first)
            var x: Float = 0
            if position < Double(length) {
                let k = Int(position)
                let t = position - Double(k)
                let s1 = Double(buffer[k])
                let s2: Double
                if k + 1 < length { s2 = Double(buffer[k + 1]) }
                else if k >= 1 { s2 = 2 * s1 - Double(buffer[k - 1]) }
                else { s2 = s1 }
                x = Float((1 - t) * s1 + t * s2)
            } else if abs(x1) + abs(x2) + abs(y1) + abs(y2) < 1e-10 {
                break  // the source ended and the filter has rung out
            }
            let xd = Double(x)
            let y = Double(Float(b0 * xd + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2))
            x2 = x1; x1 = xd; y2 = y1; y1 = y
            frames[n] += Double(Float(y) * gain)
            n += 1
        }
    }
}

/// JavaScript's `Math.round` (half toward +∞) — the web's noise seed.
private func noiseJsRound(_ v: Double) -> Double {
    let down = v.rounded(.down)
    return v - down >= 0.5 ? down + 1 : down
}
