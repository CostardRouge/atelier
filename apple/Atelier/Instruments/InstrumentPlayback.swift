// A clip playing for an instrument — the native stand-in for the web's
// `<video>` + `useVideoTransport` + `useActiveCue`: one player, its clock
// read about thirty times a second, the play/pause state, the duration, and
// the sentence when the device cannot play it.
//
// HEVC plays here (VideoToolbox), so the web's "the video failed to play —
// DJI clips are often HEVC, transcode to H.264" notice and its ffmpeg.wasm
// control have no port and never will (`Video/VideoSource.swift` says why);
// a clip this device refuses says the platform's own reason instead.
//
// `PlayerSurface` draws a player with no controls of its own — the stage of
// Compare, LUT Studio and the Flight Map, whose transport is the suite's.

import AVFoundation
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor
@Observable
final class InstrumentPlayback {
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

    private var observer: Any?
    private var endObserver: NSObjectProtocol?
    private var loadTask: Task<Void, Never>?

    init() {
        player.actionAtItemEnd = .pause
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] now in
            MainActor.assumeIsolated {
                self?.tick(now)
            }
        }
    }

    /// Load `url` (nil empties the player). A composition, when given, is how
    /// every frame is drawn — LUT Studio's grade.
    func load(_ url: URL?, composition: AVVideoComposition? = nil) {
        guard url != self.url || composition != nil else { return }
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
        item.videoComposition = composition
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
                if !playable { self.failure = "This clip cannot be played on this device." }
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.failure = error.localizedDescription
            }
        }
    }

    /// Swap the per-frame drawing of the clip already loaded.
    func setComposition(_ composition: AVVideoComposition?) {
        player.currentItem?.videoComposition = composition
    }

    func togglePlay() {
        guard player.currentItem != nil else { return }
        if playing {
            player.pause()
            playing = false
        } else {
            // At the end, play again from the top — a transport's habit.
            if duration > 0, time >= duration - 0.05 { seek(to: 0) }
            player.play()
            playing = true
        }
    }

    func pause() {
        player.pause()
        playing = false
    }

    /// Jump the playhead, frame-exact — a scrub lands on the frame under it.
    func seek(to seconds: Double) {
        let target = max(0, duration > 0 ? min(seconds, duration) : seconds)
        time = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func tick(_ now: CMTime) {
        if now.isNumeric { time = now.seconds }
        if let item = player.currentItem, item.status == .failed {
            failure = item.error?.localizedDescription ?? "This clip cannot be played on this device."
        }
        playing = player.rate != 0
    }

    /// Release the player's observers — a screen going away for good.
    func stop() {
        loadTask?.cancel()
        player.pause()
        player.replaceCurrentItem(with: nil)
        url = nil
    }
}

// MARK: - a player with no controls of its own

#if os(iOS)
/// The player's picture, fitted, on the darkroom's frame; the transport is
/// the suite's (`InstrumentTransport`), never the system's.
struct PlayerSurface: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect

    func makeUIView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = gravity
    }

    final class PlayerLayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
#else
struct PlayerSurface: NSViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect

    func makeNSView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        return view
    }

    func updateNSView(_ view: PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = gravity
    }

    final class PlayerLayerView: NSView {
        let playerLayer = AVPlayerLayer()

        override init(frame: NSRect) {
            super.init(frame: frame)
            wantsLayer = true
            layer = playerLayer
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            wantsLayer = true
            layer = playerLayer
        }
    }
}
#endif
