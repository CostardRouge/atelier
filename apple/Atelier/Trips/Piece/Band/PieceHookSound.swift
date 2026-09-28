// The opener's score, HEARD while the stage's transport plays it — the web's
// `use-hook-sound.ts`, natively an `AVAudioEngine` with one
// `AVAudioPlayerNode`.
//
// Rules kept (`roadtrip.md`, the hook engine's sound bed):
// - The SAME voices the export renders: a pass is the kernel's `renderBed`
//   over the score's events from where the clock stands (`Audio/*`, the
//   voices written as sample arithmetic and measured against Chrome's own
//   graph), scheduled whole on the player node. A live player and the file
//   can never drift apart, because neither has voices of its own.
// - OFF by default (`PieceEditorModel.soundOn`, `M`): a panel that ticks while
//   a slider is dragged is unusable, which is why `p5-templates` keeps its UI
//   sounds apart from its render bridge too. The engine is made the first
//   time a pass starts — the gesture that asked for sound.
// - A pass starts when the transport starts playing the hook with the sound
//   on, and AGAIN each time the clock jumps back by more than a quarter of a
//   second (a loop coming round). Stopping drops everything scheduled on the
//   node, so sounds already queued fall silent instead of ticking on after a
//   pause — the web's per-pass gain node, muted and disconnected.
// - The bed of a pass is rendered off the main actor; the time that took is
//   cut from its head, so the ticks stay on the clock that started them.

import AVFoundation
import Foundation
import AtelierKit

@MainActor
final class PieceHookSound {
    /// How much of a voice's ring is kept past a pass's last event — the
    /// longest voice (a `thud`'s sweep, a band-pass's tail) is under 0.3 s.
    private static let tail = 0.6
    /// A jump back of more than this is a loop coming round (the web's 0.25).
    private static let loopJump = 0.25

    private var engine: AVAudioEngine?
    private var node: AVAudioPlayerNode?
    private let format = AVAudioFormat(standardFormatWithSampleRate: bedSampleRate, channels: 1)
    private var running = false
    private var score: [SoundEvent] = []
    private var lastTime = 0.0
    private var generation = 0
    private var pass: Task<Void, Never>?

    /// The score, read once per change of the opener (the model's revision
    /// and its inputs) rather than once per frame.
    private var scoreKey: (rev: Int, extra: Int)?
    private var cachedScore: [SoundEvent] = []

    /// The opener's events as the open piece prepares them, cached per
    /// document revision — `ResolvedHook.score()`.
    func score(of model: PieceEditorModel) -> [SoundEvent] {
        if let key = scoreKey, key.rev == model.revision, key.extra == model.hookInputs { return cachedScore }
        let made = model.hookState?.hook.score() ?? []
        scoreKey = (model.revision, model.hookInputs)
        cachedScore = made
        return made
    }

    /// What the band sees on every frame: the score, whether the hook is
    /// playing with its sound on, and where the badge's clock is.
    func update(_ next: [SoundEvent], running on: Bool, time: Double) {
        let going = on && !next.isEmpty
        let previous = lastTime
        lastTime = time
        let changed = going != running || next != score
        score = next
        running = going
        if changed {
            if going { start(time) } else { stop() }
            return
        }
        // A loop coming round: the clock jumped back, so the next pass begins.
        if going && time < previous - PieceHookSound.loopJump { start(time) }
    }

    /// The editor is going away: silence, and let the hardware go.
    func close() {
        stop()
        running = false
        engine?.stop()
        engine = nil
        node = nil
    }

    // MARK: - a pass

    private func start(_ from: Double) {
        stop()
        let gen = generation
        let events = score.filter { $0.at >= from }.map { event -> SoundEvent in
            var e = event
            e.at -= from
            return e
        }
        guard let lastAt = events.map(\.at).max() else { return }
        let seconds = lastAt + PieceHookSound.tail
        let asked = Date()
        pass = Task { [weak self] in
            let bed = await Task.detached(priority: .userInitiated) {
                renderBed(events, seconds, sampleRate: bedSampleRate, channels: 1)
            }.value
            guard let self, !Task.isCancelled, self.generation == gen, let bed else { return }
            // The clock ran while the bed rendered: begin where it is now.
            self.play(bed, skipping: Date().timeIntervalSince(asked))
        }
    }

    private func stop() {
        generation &+= 1
        pass?.cancel()
        pass = nil
        node?.stop()
    }

    private func play(_ bed: PlanarAudio, skipping lag: Double) {
        guard let format, let samples = bed.channels.first else { return }
        let skip = max(0, min(samples.count, Int((lag * bed.sampleRate).rounded())))
        let count = samples.count - skip
        guard count > 0, let node = readyNode(),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
              let channel = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        samples.withUnsafeBufferPointer { source in
            guard let base = source.baseAddress else { return }
            channel.update(from: base + skip, count: count)
        }
        node.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        node.play()
    }

    /// The engine, made on the first pass and started again whenever the
    /// system stopped it (a route change, an interruption).
    private func readyNode() -> AVAudioPlayerNode? {
        if engine == nil {
            #if os(iOS)
            // The author asked to HEAR the opener: it plays through the ring
            // switch, beside whatever else is playing.
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try? session.setActive(true)
            #endif
            let made = AVAudioEngine()
            let player = AVAudioPlayerNode()
            made.attach(player)
            made.connect(player, to: made.mainMixerNode, format: format)
            engine = made
            node = player
        }
        guard let engine, let node else { return nil }
        if !engine.isRunning {
            do {
                try engine.start()
            } catch {
                return nil
            }
        }
        return node
    }
}
