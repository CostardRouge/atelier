// Encoding a rendered bed to AAC — the pure half. Port of
// `src/shared/media/audio-encode.ts`.
//
// The rest of the pipeline never encodes audio: a clip's track is copied
// bit-for-bit, and that rule stands. This is for audio the suite MADE — a
// hook's tick bed — which has no track to copy from. The encoder itself is
// the app's (AVFoundation's AAC-LC); what is ported is what the web decides
// around it: the format asked for, the chunks the bed is fed in, the priming
// the bed is rendered AHEAD of, and the tail packets dropped after the flush.
// The whole bed is encoded BEFORE the muxer is built, so "is there an audio
// track" is answered by "are there chunks", never by a half-written track.

import Foundation

/// What is asked of the encoder. AAC-LC — the one every platform ingests.
public let aacCodec = "mp4a.40.2"
public let aacBitrate = 128_000
/// Frames per block handed to the encoder — one AAC frame's worth.
public let aacFramesPerChunk = 1024

/// The silence an AAC encoder puts in front of the signal (its "priming"), in
/// samples. MEASURED, 2026-09-13, on the maintainer's platform (Chrome, macOS,
/// whose AudioEncoder is AudioToolbox — the encoder AVFoundation drives too),
/// by rendering ticks at known times, muxing, and decoding the MP4 back: the
/// first packet is stamped 0 and carries 2112 samples of priming, so every
/// tick decoded 44 ms after its frame.
///
/// Two fixes were tried and do NOT work, so they are not re-proposed: stamping
/// the audio packets early (mp4-muxer refuses a negative timestamp), and
/// stamping the picture late (mp4-muxer writes no edit list). What works is
/// rendering the bed AHEAD of the priming — `renderBed`'s `leadSeconds` —
/// measured at 0 ms of drift. A muxer that DOES write the priming as an edit
/// list (AVAssetWriter trims it) wants no lead; measure the round trip first.
public let aacPrimingSamples = 2112

/// The priming, in seconds at `sampleRate` — the lead a bed is rendered with.
public func aacPrimingSeconds(_ sampleRate: Double) -> Double {
    Double(aacPrimingSamples) / sampleRate
}

/// Planar frames [start, start + count) of every channel, concatenated —
/// channel 0's `count` frames, then channel 1's. A slice running past the end
/// is zero-padded to `count`, as the web's typed-array `set` leaves it.
public func planarSlice(_ buffer: PlanarAudio, _ start: Int, _ count: Int) -> [Float] {
    let channels = buffer.numberOfChannels
    var out = [Float](repeating: 0, count: max(0, count) * channels)
    for c in 0..<channels {
        let data = buffer.channels[c]
        let from = min(max(0, start), data.count)
        let to = min(data.count, from + max(0, count))
        for i in from..<to { out[c * count + (i - from)] = data[i] }
    }
    return out
}

/// One block of the bed handed to the encoder: its frames and its timestamp.
public struct AudioChunkSlice: Equatable, Sendable {
    public var start: Int
    public var count: Int
    /// `Math.round(start / rate × 1e6)`.
    public var timestampMicros: Double
}

/// The blocks a bed of `length` frames is encoded in, `aacFramesPerChunk` at a
/// time, the last one short.
public func audioChunkSlices(length: Int, sampleRate: Double) -> [AudioChunkSlice] {
    var slices: [AudioChunkSlice] = []
    var start = 0
    while start < length {
        let count = min(aacFramesPerChunk, length - start)
        let micros = (Double(start) / sampleRate) * 1_000_000
        let down = micros.rounded(.down)
        let stamp = micros - down >= 0.5 ? down + 1 : down
        slices.append(AudioChunkSlice(start: start, count: count, timestampMicros: stamp))
        start += aacFramesPerChunk
    }
    return slices
}

/// The encoder's packets without its tail: the flush emits padding stamped at
/// or past the end of the signal, and kept, it made the audio track ~75 ms
/// longer than the picture (measured) — a file lasts as long as its longest
/// track. Should nothing survive the cut, everything is kept.
public func trimEncoderTail<T>(_ chunks: [T], length: Int, sampleRate: Double,
                               timestampMicros: (T) -> Double) -> [T] {
    let endMicros = (Double(length) / sampleRate) * 1_000_000
    let kept = chunks.filter { timestampMicros($0) < endMicros }
    return kept.isEmpty ? chunks : kept
}

/// Said when the device cannot encode AAC at all — the clip goes out silent,
/// never failed (`p5-templates`' rule: a video without sound beats a failed job).
public let aacUnavailable = "This device cannot encode AAC audio, so the clip went out without its ticks."
/// Said when the encoder ran and produced nothing usable.
public let ticksNotEncoded = "The ticks could not be encoded, so the clip went out without them."
