// One frame of a clip at a time, as a `CIImage` — the stage's seek. Replaces
// the web's `<video>`-element seek (`BadgeSource.seek`, roadtrip.md, «A clip's
// frame picker SEEKS the open video element») and `frame-grab.ts`'s decode.
//
// The frame is read through the EXPORT's own path — `VideoSource.frames`, the
// very reader `exportProcessedVideo` decodes with, its codes labelled the same
// way — and is the frame that COVERS the instant, by the web's `trimWindow`
// rule (the earliest presented frame that ends past it, with the 500 µs
// edge). So a still grabbed here and an export trimmed there open on the
// same frame with the same pixels: preview = export by construction.
// `AVAssetImageGenerator` is deliberately not used for this: its `CGImage` is
// colour-managed by the platform on a path the export never takes, which
// would make the graded preview a guess about the graded file (it serves the
// filmstrip, `VideoThumbnails.swift`, where a cell is a thumbnail).
//
// Every grab decodes from the keyframe before the instant — as a `<video>`
// seek does. For a scrub that walks FORWARD frame by frame,
// `VideoSource.frames(from:to:upright:)` is the cheaper tool: one decode,
// handed out in order.

import AVFoundation
import CoreImage
import AtelierKit

final class ClipStills {
    struct Still {
        let image: CIImage
        /// Where the frame really is, on the author's clock — at or just
        /// before the instant asked for.
        let seconds: Double
        let micros: Int
    }

    private let source: VideoSource
    private let longEdge: Int?

    /// `longEdge` caps the picture (the stage's pixel budget,
    /// device-memory.md); nil is the file's own density, which is what a
    /// deliverable composes from.
    init(source: VideoSource, longEdge: Int? = nil) {
        self.source = source
        self.longEdge = longEdge
    }

    /// The frame covering `seconds`, upright. Blocking on the decoder — call
    /// it off the main actor, or through `frame(at:)`.
    func grab(at seconds: Double) throws -> Still {
        let duration = source.metadata.duration
        let asked = seconds.isFinite ? max(0, seconds) : 0
        let t = duration > 0 ? min(asked, duration) : asked
        // The web's edge: a frame that ends on the instant does not cover it.
        let edge = videoMicros(seconds: t) + 500
        let reader = try source.frames(from: t, to: t + source.frameSeconds, upright: true)
        defer { reader.cancel() }
        var covering: VideoFrame? = nil
        var last: VideoFrame? = nil
        while let frame = try reader.next() {
            last = frame
            if frame.micros + frame.durationMicros > edge {
                covering = frame
                break
            }
        }
        // Past the last frame: the last one decoded is the one on screen.
        guard let picked = covering ?? last else {
            throw VideoSourceError.unreadable("No frame of this clip could be decoded at \(String(format: "%.2f", t)) s.")
        }
        return Still(image: capped(picked.image), seconds: picked.seconds, micros: picked.micros)
    }

    /// `grab(at:)` off the current actor.
    func frame(at seconds: Double) async throws -> Still {
        try await Task.detached(priority: .userInitiated) { [self] in
            try self.grab(at: seconds)
        }.value
    }

    /// The picture within the long-edge budget, never enlarged.
    private func capped(_ image: CIImage) -> CIImage {
        guard let longEdge, longEdge > 0 else { return image }
        let long = max(image.extent.width, image.extent.height)
        guard long > CGFloat(longEdge) else { return image }
        let scale = CGFloat(longEdge) / long
        return image.applyingFilter("CILanczosScaleTransform", parameters: [
            kCIInputScaleKey: scale,
            kCIInputAspectRatioKey: 1.0,
        ])
    }
}
