// Playing the WHOLE piece on one stage that shows one slide at a time — the
// web's `use-deck-transport.ts` — and the open clip played on that stage
// (`BadgeStage`'s `StagePlayback`).
//
// Rules kept (`roadtrip.md`, «Why the stage drives the `<video>` and the
// editor owns the clock»; the deck transport of 2026-09-14/15):
// - Two clocks, never both: on a loaded clip the PLAYER is the clock (it
//   reports its playhead and says when it stopped on the out point); on
//   anything else — a photograph, the closing card, a clip still decoding —
//   a frame loop counts the slide's seconds.
// - Playback never stops on its own: at an end it LOOPS, over the whole
//   piece (the next slide, the first after the last) or over the open slide
//   (`LoopScope`, `nextAtEnd`).
// - The piece's time is DERIVED: the open slide's start plus how far into it
//   the clock is. A still's position is kept with the key of the slide it
//   belongs to, so a slide opened from anywhere else starts at zero.
// - A picture still decoding holds a still's clock for up to two seconds, so
//   a clip is not skipped before it has shown a frame.
// - The clip plays its stretch at its speed, muted; pressing play on (or
//   outside) the out point replays from the in point; the out point is
//   watched sixty times a second, never on a coarse timer; paused, the
//   player lands exactly on the handle.
//
// The band, the cut, the speed pill and the sound are the transport task's;
// they drive this clock through `PieceEditorModel`'s verbs (`togglePlay`,
// `deck.goTo`, `deck.scrub`, `setTrimming`, `setClipPlaying`).

import AVFoundation
import CoreImage
import Foundation
import Observation
import AtelierKit

/// A still's position and the slide it belongs to.
struct PieceStillClock: Equatable {
    var key: String
    var local: Double
}

@MainActor
@Observable
final class PieceDeckClock {
    /// A clip decoding for longer than this stops holding the piece up.
    static let pendingGraceSeconds = 2.0
    static let endTolerance = 0.04

    @ObservationIgnored weak var host: PieceEditorModel?
    private(set) var playing = false
    private(set) var still = PieceStillClock(key: "", local: 0)
    @ObservationIgnored private var pendingJump: PieceStillClock?
    @ObservationIgnored private var ticker: Task<Void, Never>?

    // MARK: - reading

    private var lengths: [Double] { host?.lengths ?? [] }
    private var count: Int { lengths.count }
    private var open: Int { max(0, min(host?.slideIndex ?? 0, count - 1)) }
    private var key: String {
        let keys = host?.slideKeys ?? []
        return keys.indices.contains(open) ? keys[open] : ""
    }
    private var length: Double { lengths.indices.contains(open) ? lengths[open] : 0 }
    private var layout: StripLayout { stripLayout(lengths, 1, 0, 0) }

    /// How far into the open slide: the clip's playhead on a loaded clip, the
    /// still clock otherwise.
    var local: Double {
        let span = max(0, length)
        if let host, host.isClipSlide, let slide = host.slide {
            let raw = (host.playhead - host.clipRange.start) / max(1e-9, slide.speed)
            return min(span, max(0, raw))
        }
        let s = still.key == key ? still.local : 0
        return min(span, max(0, s))
    }

    /// Where the piece is, in seconds from the hook's first frame.
    var time: Double {
        let cells = layout.cells
        let start = cells.indices.contains(open) ? cells[open].start : 0
        return start + local
    }

    /// The whole piece's length.
    var seconds: Double { layout.seconds }

    // MARK: - the verbs

    func setPlaying(_ on: Bool) {
        guard on != playing else { return }
        playing = on
        if on { runTicker() } else { stopTicker() }
        host?.playbackChanged()
    }

    /// ▶ / ❚❚. Pressing play on the end of a slide goes where the loop would.
    func toggle() {
        guard count > 0 else { return }
        if playing {
            setPlaying(false)
            return
        }
        if local >= length - PieceDeckClock.endTolerance {
            goTo(nextAtEnd(open, count, host?.loopScope ?? .piece), 0)
        }
        setPlaying(true)
    }

    /// Go to a moment of the piece — the slide under it opens there.
    func scrub(_ t: Double) {
        setPlaying(false)
        let at = locate(layout, t)
        goTo(at.index, at.local)
    }

    /// Open slide `target` at `at` seconds into it.
    func goTo(_ target: Int, _ at: Double = 0) {
        guard let host else { return }
        let keys = host.slideKeys
        let i = max(0, min(target, keys.count - 1))
        let k = keys.indices.contains(i) ? keys[i] : ""
        pendingJump = PieceStillClock(key: k, local: at)
        still = PieceStillClock(key: k, local: at)
        if i != host.slideIndex {
            host.openSlide(i)
        } else if host.isClipSlide, let slide = host.slide {
            host.setPlayhead(host.clipRange.start + at * slide.speed)
        }
        host.requestRender()
    }

    /// The stage stopped a clip on its out point.
    func onClipEnded() {
        if playing { advance() }
    }

    /// Where a clip slide just opened by `goTo` should put its playhead, in
    /// seconds into the slide; 0 for a slide opened any other way.
    func pendingLocal(_ k: String) -> Double {
        pendingJump?.key == k ? (pendingJump?.local ?? 0) : 0
    }

    private func advance() {
        goTo(nextAtEnd(open, count, host?.loopScope ?? .piece), 0)
    }

    // MARK: - a still's clock

    private func runTicker() {
        stopTicker()
        ticker = Task { [weak self] in
            var last = Date()
            var waited = 0.0
            var waitingOn = ""
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 16_000_000)
                guard let self, self.playing, let host = self.host else { return }
                let now = Date()
                let dt = min(0.1, now.timeIntervalSince(last))
                last = now
                // A loaded clip is its own clock.
                if host.isClipSlide { continue }
                let k = self.key
                if waitingOn != k {
                    waitingOn = k
                    waited = 0
                }
                if host.stagePending && waited < PieceDeckClock.pendingGraceSeconds {
                    waited += dt
                    continue
                }
                let local = self.local
                if local + dt >= self.length {
                    let next = nextAtEnd(self.open, self.count, host.loopScope)
                    if next != self.open {
                        self.still = PieceStillClock(key: k, local: self.length)
                        self.advance()
                        continue
                    }
                    // The same slide again: the clock starts it over itself.
                    self.still = PieceStillClock(key: k, local: 0)
                } else {
                    self.still = PieceStillClock(key: k, local: local + dt)
                }
                host.clockTicked()
            }
        }
    }

    private func stopTicker() {
        ticker?.cancel()
        ticker = nil
    }
}

// MARK: - the clip, played on the stage

/// The open clip, played through an `AVPlayer` whose frames are read as they
/// come (`ClipFrameTap`) and handed to the stage — the native stand-in for
/// the `<video>` element `BadgeStage` held.
@MainActor
final class PieceClipPlayer {
    /// What the stage asks to be played.
    struct Want: Equatable {
        var url: URL
        var start: Double
        var end: Double
        var rate: Double
        var loop: Bool
        /// Which slide: a new one starts its stretch over, even on the same file.
        var slide: String
    }

    weak var host: PieceEditorModel?
    private let player = AVPlayer()
    private let tap = ClipFrameTap()
    private var want: Want?
    private var loaded: URL?
    private var loop: Task<Void, Never>?

    init() {
        player.isMuted = true
        player.actionAtItemEnd = .pause
    }

    /// Play `next` from `from` (source seconds), or stop (nil). The same want
    /// twice changes nothing.
    func run(_ next: Want?, from: Double) {
        guard next != want else { return }
        want = next
        loop?.cancel()
        loop = nil
        guard let next else {
            player.pause()
            return
        }
        // Pressing play on (or outside) the out point replays the stretch.
        let begin = (from < next.start || from >= next.end - trimEpsilon) ? next.start : from
        loop = Task { [weak self] in
            guard let self else { return }
            if self.loaded != next.url {
                let item = AVPlayerItem(url: next.url)
                self.player.replaceCurrentItem(with: item)
                self.loaded = next.url
                let metadata = try? await VideoSource.open(next.url).metadata
                guard !Task.isCancelled else { return }
                self.tap.attach(item, metadata: metadata)
            }
            _ = await self.player.seek(to: CMTime(seconds: begin, preferredTimescale: 600),
                                   toleranceBefore: .zero, toleranceAfter: .zero)
            guard !Task.isCancelled else { return }
            self.player.playImmediately(atRate: Float(clampPlaybackRate(next.rate)))
            await self.watch(next)
        }
    }

    /// Stop and let go of the clip — the editor is going away.
    func stop() {
        want = nil
        loop?.cancel()
        loop = nil
        player.pause()
        tap.detach()
        player.replaceCurrentItem(with: nil)
        loaded = nil
    }

    /// The out point, watched about sixty times a second, and each new frame
    /// handed to the stage.
    private func watch(_ w: Want) async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 16_000_000)
            guard !Task.isCancelled, want == w else { return }
            let current = player.currentTime()
            guard current.isNumeric else { continue }
            let now = current.seconds
            if now >= w.end - trimEpsilon {
                if w.loop {
                    _ = await player.seek(to: CMTime(seconds: w.start, preferredTimescale: 600),
                                      toleranceBefore: .zero, toleranceAfter: .zero)
                    continue
                }
                player.pause()
                // Land exactly on the handle, so the next press is "at the
                // out point" and replays from the in point.
                _ = await player.seek(to: CMTime(seconds: w.end, preferredTimescale: 600),
                                  toleranceBefore: .zero, toleranceAfter: .zero)
                want = nil
                host?.clipReported(w.end, frame: tap.newFrame(at: player.currentTime()))
                host?.clipEnded()
                return
            }
            host?.clipReported(now, frame: tap.newFrame(at: current))
        }
    }
}
