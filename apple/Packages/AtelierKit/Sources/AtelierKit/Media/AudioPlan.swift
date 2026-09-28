// What audio a clip export writes — decided once, before the muxer exists,
// because the muxer's audio track is fixed the moment it is built. Port of
// `src/shared/media/audio-plan.ts`.
//
// Four outcomes, and the rule each keeps (`media-pipeline.md`):
//
// - `copy` — the clip's own AAC, bit-for-bit. The pipeline's founding rule and
//   still the DEFAULT whenever a clip has sound of its own: re-encoding
//   someone's recording is never done behind their back.
// - `bed`  — audio the suite made (a hook's ticks) becomes the track. Only
//   when there is no clip sound to preserve: a clip recorded without a
//   microphone (most drone footage), or a re-timed export, which never carries
//   the source's sound (a copied track against a re-timed picture is a desync).
// - `mix`  — the clip's sound decoded, the bed summed into it, re-encoded.
//   Only when the author ASKED for it, and only at normal speed.
// - `none` — nothing to write.
//
// When a bed exists and does not make it into the file, the plan carries the
// sentence that says so, so an export never quietly drops what was composed.

import Foundation

public enum AudioPlan: Equatable, Sendable {
    case none
    case copy(droppedBed: String?)
    case bed
    case mix
}

public struct AudioPlanInput: Equatable, Sendable {
    /// The clip has an audio track of its own.
    public var sourceAudio: Bool
    /// The export changes the clip's speed.
    public var retimed: Bool
    /// Something the suite rendered wants to be heard.
    public var bed: Bool
    /// The author asked for the bed to be mixed into the clip's own sound.
    public var mix: Bool

    public init(sourceAudio: Bool, retimed: Bool, bed: Bool, mix: Bool) {
        self.sourceAudio = sourceAudio; self.retimed = retimed; self.bed = bed; self.mix = mix
    }
}

public let bedKeptOut =
    "The clip kept its own sound untouched, so the ticks were left out — turn on mixing to hear both."

public func planAudio(_ input: AudioPlanInput) -> AudioPlan {
    let keepsSource = input.sourceAudio && !input.retimed
    if !input.bed { return keepsSource ? .copy(droppedBed: nil) : .none }
    if !keepsSource { return .bed }
    return input.mix ? .mix : .copy(droppedBed: bedKeptOut)
}
