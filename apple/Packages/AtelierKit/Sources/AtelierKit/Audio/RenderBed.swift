// A hook's sound bed, rendered offline from its score. Port of
// `src/shared/audio/render-bed.ts`.
//
// The score (`[SoundEvent]`) is times and voice names — known before a single
// frame is drawn, because a variant's plan is declarative — so it is handed
// over up front and rendered once. The web renders it into an
// `OfflineAudioContext`; the kernel renders it through `VoiceRenderer`, the
// same graph written as sample arithmetic, so the file the phone writes
// carries the bed the browser's file carries (`Voices.swift` says how close,
// and where Chrome's own node behaviour had to be reproduced by hand). The
// web's version is async only because the browser's render is; this one is a
// plain function.

import Foundation

/// The bed's format — what the AAC encoder is asked for and platforms expect.
public let bedSampleRate = 48_000.0
public let bedChannels = 2

/// Headroom on the master bus. Voices peak near 1 on their own, and two
/// landing within a few milliseconds of each other at the fast start of a
/// sweep would otherwise sum past full scale and clip.
private let masterGain = 0.7

/// The events a bed of `seconds` can actually play: in its span, in time
/// order (a stable sort, as JavaScript's).
public func eventsWithin(_ events: [SoundEvent], _ seconds: Double) -> [SoundEvent] {
    events.enumerated()
        .filter { $0.element.at.isFinite && $0.element.at >= 0 && $0.element.at < seconds }
        .sorted { $0.element.at != $1.element.at ? $0.element.at < $1.element.at : $0.offset < $1.offset }
        .map(\.element)
}

/// Schedule a score into any sink, from `offset` seconds of it onward, with
/// its own time base starting at `when`. A live player and the offline render
/// both go through here, so neither can drift from the other. Answers how
/// many EVENTS were scheduled.
@discardableResult
public func scheduleScore<S: VoiceSink>(_ sink: inout S, _ events: [SoundEvent], _ when: Double,
                                        _ offset: Double = 0) -> Int {
    var scheduled = 0
    for event in events {
        if event.at < offset { continue }
        scheduleVoice(&sink, when + (event.at - offset), event.voice,
                      VoiceParams(gain: event.gain, rate: event.rate))
        scheduled += 1
    }
    return scheduled
}

/// Render `seconds` of bed. Nil when there is nothing to play — the video is
/// then simply silent, which is what it was before the bed existed.
///
/// - `leadSeconds`: render every sound this much EARLY. An encoder that
///   primes (AAC delays its signal by a fixed number of samples) pushes it
///   back onto its frame; a sound in the first `leadSeconds` cannot move
///   earlier than zero and lands up to that much late, which on the scrub is
///   only the sweep's opening tick. See `aacPrimingSeconds`. The web's muxer
///   writes no edit list, so it leads by the priming; `AVAssetWriter` records
///   the priming in one, so the app hands a bed in at its own time (0).
/// - `sampleRate` / `channels`: the format to render at. A bed mixed into a
///   clip is rendered at the CLIP's rate and layout, so the two can be summed
///   sample for sample. Channels are 1 or 2; the voices are mono and every
///   channel carries the same signal (the browser's mono → stereo up-mix).
///   An endless length is no bed (the browser throws); a rate that is not a
///   rate renders at `bedSampleRate`.
public func renderBed(_ events: [SoundEvent], _ seconds: Double, leadSeconds: Double = 0,
                      sampleRate: Double = bedSampleRate, channels: Int = bedChannels) -> PlanarAudio? {
    let playable = eventsWithin(events, seconds)
    if playable.isEmpty || !(seconds > 0) || !seconds.isFinite { return nil }

    let rate = sampleRate > 0 && sampleRate.isFinite ? sampleRate : bedSampleRate
    let layout = max(1, min(2, channels == 0 ? bedChannels : channels))
    let length = max(1, Int((seconds * rate).rounded(.up)))
    let lead = max(0, leadSeconds)
    var bus = VoiceRenderer(sampleRate: rate, length: length)
    let early = playable.map { event -> SoundEvent in
        var e = event
        e.at = max(0, event.at - lead)
        return e
    }
    scheduleScore(&bus, early, 0)

    // The master gain, then the destination's Float32 buffer.
    let master = Float(masterGain)
    let mono = bus.frames.map { Float($0) * master }
    return limitPeak(PlanarAudio(sampleRate: rate, channels: [[Float]](repeating: mono, count: layout)))
}

/// The highest a bed's samples may reach once rendered — just under full scale.
public let bedCeiling = 0.98

/// Scale a rendered bed down, as a whole, if any sample passed the ceiling.
/// Two ticks turned up and landing a few milliseconds apart at the fast start
/// of a sweep can sum past full scale, and an AAC encoder handed that clips
/// it audibly. Only a bed that WOULD clip is touched, and it keeps its shape —
/// the ticks stay in proportion to each other, just no louder than the file
/// allows.
public func limitPeak(_ buffer: PlanarAudio) -> PlanarAudio {
    var peak = 0.0
    for channel in buffer.channels {
        for v in channel {
            let a = Double(abs(v))
            if a > peak { peak = a }
        }
    }
    if peak <= bedCeiling { return buffer }
    let k = bedCeiling / peak
    var out = buffer
    out.channels = buffer.channels.map { channel in channel.map { Float(Double($0) * k) } }
    return out
}
