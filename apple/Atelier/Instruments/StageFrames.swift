// What a stage that DRAWS its picture itself needs — LUT Studio's graded
// preview and the Composer's composite, the web's canvases fed by an
// offscreen `<video>`:
//
// - `ClipFrameTap`: the frame under the player's playhead, read through an
//   `AVPlayerItemVideoOutput` as the web's `requestVideoFrameCallback` loop
//   reads its `<video>` — a NEW frame handed on, a repeated one ignored. The
//   frame is the codes the export's reader hands the pipeline (BGRA, labelled
//   `videoCodesColourSpace`, a non-709 source converted to 709 on the way
//   in, turned upright), so preview and export grade the same numbers.
// - `StageRenderer`: a render off the main actor, the LATEST request
//   winning — a slider step never queues behind the one before it.
// - `stageFitRect`: where a fitted picture sits in its box, for what is
//   drawn over it (a divider, a drag).

import AVFoundation
import CoreImage
import Foundation
import Observation
import SwiftUI

@MainActor
final class ClipFrameTap {
    private var output: AVPlayerItemVideoOutput?
    private weak var item: AVPlayerItem?
    private var orientation: CGImagePropertyOrientation?

    /// Read `item`'s frames from now on. `metadata` says how the clip is
    /// turned and whether its colour must be brought to 709.
    func attach(_ item: AVPlayerItem?, metadata: VideoMetadata?) {
        guard let item else {
            detach()
            return
        }
        if item === self.item, output != nil { return }
        detach()
        var settings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        if let metadata, !metadata.colour.isRec709OrUnsaid || metadata.isHDR,
           let rec709 = videoColourProperties(exportColourSpace) {
            settings[AVVideoColorPropertiesKey] = rec709
        }
        let out = AVPlayerItemVideoOutput(outputSettings: settings)
        item.add(out)
        output = out
        self.item = item
        switch metadata?.rotation ?? 0 {
        case 90: orientation = .right
        case 180: orientation = .down
        case 270: orientation = .left
        default: orientation = nil
        }
    }

    func detach() {
        if let output, let item { item.remove(output) }
        output = nil
        item = nil
        orientation = nil
    }

    /// The frame at `time` when it is a NEW one, else nil.
    func newFrame(at time: CMTime) -> CIImage? {
        guard let output, time.isValid, output.hasNewPixelBuffer(forItemTime: time),
              let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) else { return nil }
        var image = CIImage(cvPixelBuffer: buffer, options: [.colorSpace: videoCodesColourSpace])
        if let orientation {
            image = image.oriented(orientation)
            let origin = image.extent.origin
            if origin != .zero {
                image = image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
            }
        }
        return image
    }
}

/// Renders off the main actor, one at a time; a request made while one runs
/// replaces any other waiting, so the stage always catches up to the latest.
@MainActor
@Observable
final class StageRenderer {
    private(set) var image: CGImage?
    @ObservationIgnored private var running = false
    @ObservationIgnored private var pending: (@Sendable () -> CGImage?)?

    func submit(_ job: @escaping @Sendable () -> CGImage?) {
        if running {
            pending = job
            return
        }
        run(job)
    }

    func clear() {
        pending = nil
        image = nil
    }

    private func run(_ job: @escaping @Sendable () -> CGImage?) {
        running = true
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { job() }.value
            guard let self else { return }
            self.image = result
            self.running = false
            if let next = self.pending {
                self.pending = nil
                self.run(next)
            }
        }
    }
}

/// `image` fitted inside `bounds`, centred — what `.aspectRatio(.fit)` draws.
func stageFitRect(_ image: CGSize, in bounds: CGSize) -> CGRect {
    guard image.width > 0, image.height > 0, bounds.width > 0, bounds.height > 0 else { return .zero }
    let s = min(bounds.width / image.width, bounds.height / image.height)
    let w = image.width * s
    let h = image.height * s
    return CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
}

/// The pixels a stage of `points` asks for on this screen, capped at the
/// stage's budget (`PictureRenderer.stageLongEdge`).
func stagePixels(_ points: CGSize, scale: CGFloat) -> CGSize {
    let w = max(1, points.width * scale)
    let h = max(1, points.height * scale)
    let edge = max(w, h)
    let cap = CGFloat(PictureRenderer.stageLongEdge)
    guard edge > cap else { return CGSize(width: w, height: h) }
    let k = cap / edge
    return CGSize(width: w * k, height: h * k)
}
