// One sound in a score — times and a voice name, never an audio engine. Port
// of `src/shared/audio/sound-event.ts`.
//
// Kept apart from anything that plays it, so a score can be written, merged,
// sorted and tested on Linux, and so the thing that produces one (a hook
// variant) never depends on the thing that renders it (`RenderBed.swift`
// offline, the app's audio engine live).

import Foundation

public struct SoundEvent: Equatable, Sendable {
    /// Seconds into the composition's own life.
    public var at: Double
    /// A voice from `Voices.swift`; an unknown name plays as `click`.
    public var voice: String
    /// Peak level, 0..1 (up to `maxVoiceGain` for a score turned up).
    public var gain: Double?
    /// Pitch multiplier, 1 = the voice as designed.
    public var rate: Double?

    public init(at: Double, voice: String, gain: Double? = nil, rate: Double? = nil) {
        self.at = at; self.voice = voice; self.gain = gain; self.rate = rate
    }
}
