// Filmstrip cells under a clip — `AVAssetImageGenerator` in the place of the
// web's one `<video>` element seeked from moment to moment
// (`src/shared/roadtrip/video-frames.ts`, `decodeFilmstrip`) and of
// `loadClipMeta`'s one JPEG (`video-metadata.ts`). The rules are the web's
// (`roadtrip/filmstrip.ts`, roadtrip.md, «A hook's frame is chosen by
// dragging a filmstrip»): a cell stands for a SLICE of the clip and samples
// its MIDDLE — the edge would put the first cell on the props spinning up on
// the ground and leave the last slice unrepresented —; cells stream in as
// they decode, so a strip fills from the left rather than appearing at once;
// a cell the platform cannot produce is skipped, never a failure of the
// strip; and ending the iteration stops the decode.
//
// A cell is a thumbnail, never a picture judged: the generator's `CGImage` is
// colour-managed by the platform. What the stage shows under the handle, and
// what an export encodes, come from `ClipStills` / `VideoSource.frames`,
// which read the decoded codes the export reads.

import AVFoundation
import CoreGraphics
import AtelierKit

struct ClipThumbnail {
    let index: Int
    /// The instant asked for — the middle of the cell's slice.
    let seconds: Double
    /// The instant the generator really landed on.
    let actualSeconds: Double
    let image: CGImage
}

/// How many of the generator's answers have arrived — a box, because its
/// handler may be `@Sendable` and a captured `var` cannot be written there.
private final class AnswerCounter {
    private let lock = NSLock()
    private var count = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        count += 1
        return count
    }
}

/// The moment each of `count` cells shows over `window`: the middle of its
/// own slice — the web's `filmstripTimes(duration, count)` (at least one
/// cell, a non-finite or empty window being 0 long), offset to the window.
private func stripCellTimes(_ window: TrimRange, count: Int) -> [Double] {
    let span = window.end - window.start
    let total = span.isFinite && span > 0 ? span : 0
    let n = max(1, count)
    return (0..<n).map { window.start + (Double($0) + 0.5) / Double(n) * total }
}

/// A strip of `count` cells over `window` (the whole clip when nil), each
/// within `maxSize` pixels and upright (the track's transform applied),
/// streamed as they decode.
func filmstrip(source: VideoSource, window: TrimRange? = nil, count: Int, maxSize: CGSize)
    -> AsyncThrowingStream<ClipThumbnail, Error> {
    let span = window ?? fullRange(source.metadata.duration)
    let times = stripCellTimes(span, count: count)
    return AsyncThrowingStream { continuation in
        let generator = AVAssetImageGenerator(asset: source.asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = maxSize
        // Half a slice either way: a cell shows a frame from its own slice,
        // and the generator may reuse a decode where slices are shorter than
        // a GOP — the web's seek lands on the nearest decoded frame too.
        let slice = (span.end - span.start) / Double(times.count)
        let tolerance = CMTime(seconds: max(0, slice / 2), preferredTimescale: 1_000_000)
        generator.requestedTimeToleranceBefore = tolerance
        generator.requestedTimeToleranceAfter = tolerance
        continuation.onTermination = { _ in
            generator.cancelAllCGImageGeneration()
        }

        let requested = times.map { CMTime(seconds: $0, preferredTimescale: 1_000_000) }
        let values = requested.map { NSValue(time: $0) }
        let counter = AnswerCounter()
        generator.generateCGImagesAsynchronously(forTimes: values) { asked, image, actual, result, _ in
            // Once per requested time; the index is found by the time asked,
            // not by the order the answers arrive in.
            let answered = counter.next()
            let index = requested.firstIndex { CMTimeCompare($0, asked) == 0 } ?? (answered - 1)
            switch result {
            case .succeeded:
                if let image {
                    continuation.yield(ClipThumbnail(index: index, seconds: times[index],
                                                     actualSeconds: actual.seconds, image: image))
                }
            case .cancelled:
                continuation.finish()
                return
            case .failed:
                // One cell short is not worth abandoning the strip for.
                break
            @unknown default:
                break
            }
            if answered >= values.count { continuation.finish() }
        }
    }
}

/// One small frame from the clip's first stretch — the web's `loadClipMeta`
/// thumbnail, seeked "a little in so we don't grab a black leading frame":
/// at one second, or half the clip when it is shorter than two.
func clipPoster(source: VideoSource, maxSize: CGSize) async -> CGImage? {
    let duration = source.metadata.duration
    let at = min(1, (duration > 0 ? duration : 2) / 2)
    let generator = AVAssetImageGenerator(asset: source.asset)
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = maxSize
    return try? await generator.image(at: CMTime(seconds: at, preferredTimescale: 1_000_000)).image
}
