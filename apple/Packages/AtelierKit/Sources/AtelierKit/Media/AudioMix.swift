// Mixing audio the suite MADE into a clip's own sound — the pure half of
// `src/shared/media/audio-mix.ts`.
//
// The one place the pipeline's copy-only rule bends, and only on request
// (`AudioPlan.swift`'s `mix`). The web decodes the clip's AAC with
// WebCodecs (`decodeAacWindow`); the app decodes it with `AVAssetReader`
// (`apple/Atelier/Video/VideoExport.swift`), and both sum the bed in HERE,
// chunk by chunk or whole, so the channels meet by the same rules.

import Foundation

/// Planar floating-point audio — one array per channel, full scale ±1 — the
/// web's `PlanarAudio` (what `AudioBuffer` already is, and all an encoder
/// needs to read). Its length is its FIRST channel's, as the web's `planar`.
public struct PlanarAudio: Equatable, Sendable {
    public var sampleRate: Double
    public var channels: [[Float]]

    public init(sampleRate: Double, channels: [[Float]]) {
        self.sampleRate = sampleRate
        self.channels = channels
    }

    public var numberOfChannels: Int { channels.count }
    public var length: Int { channels.first?.count ?? 0 }
    /// Seconds at `sampleRate`; 0 when the rate is not a rate.
    public var seconds: Double { sampleRate > 0 ? Double(length) / sampleRate : 0 }

    /// The web's `getChannelData`.
    public func channelData(_ channel: Int) -> [Float] { channels[channel] }
}

/// The bed summed into the clip's sound, sample by sample, clamped to full
/// scale. Both must share a sample rate (the bed is rendered AT the clip's).
///
/// Channels meet sensibly rather than by index alone: a mono clip takes the
/// average of a stereo bed; a stereo clip takes the bed's left and right on
/// its own; a mono bed reaches the first two channels of a wider clip; extra
/// clip channels are left as they are. The output is the clip's length and
/// layout — the bed never makes a clip longer or wider — and the clip handed
/// in is never written to (a value type here, a copy there).
///
/// The sum is taken in doubles and stored as a Float, as the web sums a
/// `Float32Array`'s values in JavaScript numbers.
public func mixPlanar(_ clip: PlanarAudio, _ bed: PlanarAudio, _ bedGain: Double = 1) -> PlanarAudio {
    var out: [[Float]] = []
    out.reserveCapacity(clip.numberOfChannels)
    for c in 0..<clip.numberOfChannels {
        var channel = clip.channels[c]
        let add = bedSource(clipChannels: clip.numberOfChannels, channel: c, bed: bed)
        if let add {
            let n = min(channel.count, bed.length)
            for i in 0..<n {
                let v = Double(channel[i]) + add(i) * bedGain
                channel[i] = Float(v > 1 ? 1 : (v < -1 ? -1 : v))
            }
        }
        out.append(channel)
    }
    return PlanarAudio(sampleRate: clip.sampleRate, channels: out)
}

/// Which of the bed's samples feed clip channel `c`, or nil for none.
private func bedSource(clipChannels: Int, channel c: Int, bed: PlanarAudio) -> ((Int) -> Double)? {
    let bedChannels = bed.numberOfChannels
    if bedChannels == 0 { return nil }
    if clipChannels == 1 && bedChannels >= 2 {
        let l = bed.channels[0]
        let r = bed.channels[1]
        return { i in
            let left = i < l.count ? Double(l[i]) : 0
            let right = i < r.count ? Double(r[i]) : 0
            return (left + right) / 2
        }
    }
    if c < bedChannels {
        let b = bed.channels[c]
        return { i in i < b.count ? Double(b[i]) : 0 }
    }
    if bedChannels == 1 && c < 2 {
        let b = bed.channels[0]
        return { i in i < b.count ? Double(b[i]) : 0 }
    }
    return nil
}
