// The Studio's transport — the native stand-in for the web's offscreen
// `<video>` + `useVideoTransport` (with `resumeAcrossMedia`) + `useVideoScrub`:
// one `AVPlayer`, its clock read about thirty times a second, the preview
// rate, and the in/out rules of the trim:
//
// - playback PAUSES on the out point, landing exactly on the handle, or loops
//   back to the in point when the ↻ toggle is on (`outPointAction`) — checked
//   by the editor's frame loop, sixty times a second, not by the clock's
//   thirty (the web's rAF watch, for the web's reason: a 4 Hz `timeupdate`
//   ran 250 ms past the handle);
// - a play press on (or outside) the out point REPLAYS from the in point
//   (`playStartTime`);
// - stepping to another clip while playing hands playback over to it;
// - a scrub is COALESCED: a seek in flight takes the latest target when it
//   lands, so a fast drag never queues a hundred exact seeks.
//
// The preview RATE is a viewing choice (`PreviewSpeed`), never the
// document's, and nothing derived follows it: every readout keys off the
// media time, whatever rate it advances at.

import AVFoundation
import Observation
import SwiftUI
import AtelierKit

@MainActor
@Observable
final class StudioPlayback {
    let player = AVPlayer()
    /// Seconds of media under the playhead.
    private(set) var time: Double = 0
    /// Seconds, once the asset says; 0 before.
    private(set) var duration: Double = 0
    private(set) var playing = false
    /// Why this clip cannot play here, when it cannot.
    private(set) var failure: String?
    /// The clip loaded, if any.
    private(set) var url: URL?
    /// A drag on the bar is moving the playhead: the clock does not fight it.
    private(set) var scrubbing = false

    /// The rate the player runs at while playing.
    @ObservationIgnored private var rate: Float = 1
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var seekInFlight = false
    @ObservationIgnored private var pendingSeek: Double?

    init() {
        player.actionAtItemEnd = .pause
        player.isMuted = true
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] now in
            MainActor.assumeIsolated {
                self?.tick(now)
            }
        }
    }

    /// Load `url` — nil empties the player. A clip that was playing hands
    /// playback over to the next one once it is ready.
    func load(_ url: URL?) {
        guard url != self.url else { return }
        let wasPlaying = playing
        loadTask?.cancel()
        player.pause()
        playing = false
        time = 0
        duration = 0
        failure = nil
        self.url = url
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        guard let url else {
            player.replaceCurrentItem(with: nil)
            return
        }
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        player.replaceCurrentItem(with: item)
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                             object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.playing = false
            }
        }
        loadTask = Task { [weak self] in
            do {
                let (length, playable) = try await asset.load(.duration, .isPlayable)
                guard let self, !Task.isCancelled else { return }
                self.duration = length.isNumeric ? max(0, length.seconds) : 0
                if !playable {
                    self.failure = "This clip cannot be played on this device."
                } else if wasPlaying {
                    self.player.playImmediately(atRate: self.rate)
                    self.playing = true
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.failure = error.localizedDescription
            }
        }
    }

    /// The preview rate — applied at once while playing.
    func setRate(_ next: Double) {
        rate = Float(next)
        if playing { player.rate = rate }
    }

    /// Play, or pause — replaying the range from its in point when the
    /// playhead sits on (or outside) the out point.
    func togglePlay(range: TrimRange?) {
        guard player.currentItem != nil else { return }
        if playing {
            pause()
            return
        }
        if let from = playStartTime(time, range) {
            seek(to: from)
        } else if range == nil, duration > 0, time >= duration - 0.05 {
            seek(to: 0)
        }
        player.playImmediately(atRate: rate)
        playing = true
    }

    func pause() {
        player.pause()
        playing = false
    }

    /// Jump the playhead, frame-exact — a scrub lands on the frame under it.
    func seek(to seconds: Double) {
        let target = max(0, duration > 0 ? min(seconds, duration) : seconds)
        time = target
        if seekInFlight {
            pendingSeek = target
            return
        }
        seekInFlight = true
        let player = self.player
        let when = CMTime(seconds: target, preferredTimescale: 600)
        Task { [weak self] in
            _ = await player.seek(to: when, toleranceBefore: .zero, toleranceAfter: .zero)
            self?.seekLanded()
        }
    }

    private func seekLanded() {
        seekInFlight = false
        if let next = pendingSeek {
            pendingSeek = nil
            seek(to: next)
        }
    }

    /// A drag on the bar began or ended.
    func setScrubbing(_ on: Bool) {
        scrubbing = on
    }

    /// The out point, read by the editor's frame loop: pause exactly on it,
    /// or loop back to the in point.
    func enforce(_ range: TrimRange?, loop: Bool) {
        guard playing, !scrubbing, let item = player.currentItem else { return }
        let now = item.currentTime()
        guard now.isNumeric else { return }
        switch outPointAction(now.seconds, range, loop: loop) {
        case .keepPlaying:
            break
        case .loop(let start):
            seek(to: start)
        case .stop(let end):
            pause()
            seek(to: end)
        }
    }

    private func tick(_ now: CMTime) {
        if now.isNumeric, !scrubbing, !seekInFlight { time = now.seconds }
        if let item = player.currentItem, item.status == .failed {
            failure = item.error?.localizedDescription ?? "This clip cannot be played on this device."
        }
        let running = player.rate != 0
        if running != playing, !seekInFlight { playing = running }
    }

    /// Release the player — the editor is going away for good.
    func stop() {
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        url = nil
        playing = false
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
    }
}
