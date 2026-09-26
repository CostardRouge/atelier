// One slide of a piece as a VIDEO — the web's `hook-video-export.ts` and
// `renderSlideVideo`: whatever the slide is made of, it leaves by one of two
// calls into the landed pipeline (`Video/VideoExport.swift`), and neither
// re-implements anything the stage does.
//
// - PAINTED (`encodeFrames`): a photograph, a collage, a still content
//   picture — no clip to decode, so every frame is the stage's own render
//   (`SlideRenderer`) at a clock instead of settled. The picture is decoded
//   ONCE and graded ONCE (`BadgeSource.picture` holds it): grading per frame
//   would be a render per frame for a picture that cannot change — which
//   also means a painted clip's grain is FROZEN, as on the web
//   (`render-film.md`). Its only sound is the one the opener SCORES, rendered
//   offline from the plan its frames are painted from.
// - A CLIP (`exportProcessedVideo`): cut to the slide's own stretch
//   (`hookRange` — its in point, its screen time at its speed), each frame
//   graded at its own SOURCE instant (so the grain re-rolls per source
//   frame), framed into the variant's frame, the opener and the shades under
//   the badge, the badge over — on the DELIVERED clock, so an entrance
//   composed to take 0.6 s takes 0.6 s of the viewer's time whatever speed the
//   clip plays at, and the opener's own drawing never desyncs from it. The
//   clip's sound is COPIED; a re-timed clip ships silent; the opener's bed
//   becomes the track of a silent clip, or is mixed in only when the opener
//   asked (`mixWithSource`).
//
// Rules kept (`roadtrip.md`, `docs/roadtrip-export.md`):
// - The variant is the piece's frame at 1080 on the short side, the clip's
//   own cadence and the slide's speed (`hookVariant`), and it never
//   upscales; a collage has no one source to size from, so it is sized from
//   a nominal 4096 of the frame's own shape.
// - On the web the burned-in CONTENT slide carries its caption with no title
//   style (`theme: null`) while the still takes the trip's: mirrored here, and
//   said in `Trips/PARITY-paint.md`.
// - The AAC priming is recorded by `AVAssetWriter` in the edit list, so a bed
//   is rendered at its own time, never ahead (`native-app.md`).

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

enum SlideVideoExport {
    /// The export variant a slide of `post` leaves as: the piece's frame, 1080
    /// on the short side, the clip's cadence, the slide's own speed.
    static func variant(_ post: TripPost, _ slide: DeckSlide) -> ExportVariant {
        hookVariant(post.badge.aspectId, .shortSide(1080), slide.speed)
    }

    /// The opener's score as a bed of `seconds`, or nil when nothing scores.
    static func bed(_ hook: ResolvedHook?, seconds: Double, sampleRate: Double = bedSampleRate,
                    channels: Int = bedChannels) -> PlanarAudio? {
        guard let hook else { return nil }
        let score = hook.score()
        guard !score.isEmpty else { return nil }
        return renderBed(score, seconds, leadSeconds: 0, sampleRate: sampleRate, channels: channels)
    }

    /// The options a frame of `slide` is painted with in a VIDEO: the stage's,
    /// on the slide's clock — a content slide's caption without the trip's
    /// title style, as the web burns it.
    private static func videoOptions(_ renderer: SlideRenderer, _ slide: DeckSlide, _ sources: SlideSources,
                                     at t: Double, clock: SlideClock) -> BadgeRenderOptions {
        var o = renderer.options(slide, sources, at: t, clock: clock)
        if slide.kind == .content { o.theme = nil }
        return o
    }

    /// Whether the look this slide wears carries grain — a new noise field a
    /// frame is nothing a P-frame predicts, so it is encoded at more bits.
    private static func grained(_ renderer: SlideRenderer, _ slide: DeckSlide) -> Bool {
        (renderer.looks.film(slide, renderer.trip, renderer.post)?.grain ?? 0) > 0
    }

    // MARK: - painted

    /// A slide with no clip to decode — a photograph, a collage, a still
    /// content picture — painted frame by frame for `seconds`, into a new MP4
    /// in the temporary directory (the caller moves or deletes it).
    static func painted(_ renderer: SlideRenderer, _ slide: DeckSlide, _ sources: SlideSources, seconds: Double,
                        fps: Double? = nil, onAudioSkipped: ((String) -> Void)? = nil,
                        onProgress: ((ExportProgress) -> Void)? = nil,
                        isCancelled: @escaping () -> Bool = { false }) async throws -> URL {
        let chosen = SlideVideoExport.variant(renderer.post, slide)
        let out: AtelierKit.Size
        if slide.collage != nil {
            // A nominal source of the frame's own shape, large enough never to
            // cap the variant's resolution.
            let a = renderer.aspect
            let nominalW = a >= 1 ? 4096 : (4096 * a).rounded()
            let nominalH = a >= 1 ? (4096 / a).rounded() : 4096
            out = variantOutputSize(chosen, nominalW, nominalH)
        } else {
            guard let lead = sources.lead, lead.width > 0, lead.height > 0 else {
                throw BadgeSourceError.undecodable(slide.media?.name ?? "This slide")
            }
            out = variantOutputSize(chosen, lead.width, lead.height)
        }
        let size = paintedOutputSize(out.width, out.height)
        let hook = renderer.hook(slide)
        let clock = SlideClock(seconds: seconds, openerSeconds: slide.kind == .hook ? (hook?.seconds ?? 0) : 0)
        let audio = slide.kind == .hook ? SlideVideoExport.bed(hook, seconds: seconds) : nil
        return try await encodeFrames(
            width: Double(size.w),
            height: Double(size.h),
            seconds: seconds,
            fps: fps,
            draw: { t in
                let options = SlideVideoExport.videoOptions(renderer, slide, sources, at: t, clock: clock)
                guard let frame = renderer.badge.image(width: size.w, height: size.h, options) else {
                    throw VideoExportError.writer("A frame of this slide could not be painted.")
                }
                return CIImage(cgImage: frame, options: [.colorSpace: NSNull()])
            },
            audio: audio,
            onAudioSkipped: onAudioSkipped,
            grained: SlideVideoExport.grained(renderer, slide),
            onProgress: onProgress,
            isCancelled: isCancelled
        )
    }

    // MARK: - a clip

    /// A clip slide cut to its own stretch and re-timed to its speed, every
    /// frame graded, framed and burned in — into a new MP4 in the temporary
    /// directory. `seconds` is the slide's SCREEN time.
    static func clip(_ renderer: SlideRenderer, _ slide: DeckSlide, url: URL, seconds: Double,
                     onAudioSkipped: ((String) -> Void)? = nil,
                     onProgress: ((ExportProgress) -> Void)? = nil,
                     isCancelled: @escaping () -> Bool = { false }) async throws -> URL {
        let name = slide.media?.name ?? url.lastPathComponent
        if let problem = hookSourceProblem(name) { throw VideoExportError.cannotEncode(problem) }
        let source = try await VideoSource.open(url)
        let meta = source.metadata
        let chosen = SlideVideoExport.variant(renderer.post, slide)
        let out = variantOutputSize(chosen, Double(meta.displayWidth), Double(meta.displayHeight))
        let range = hookRange(slide.videoTimeSeconds, seconds, meta.duration, slide.speed)
        let origin = range?.start ?? 0
        let speed = clipSpeed(slide.speed)
        let hook = renderer.hook(slide)
        let clock = SlideClock(seconds: seconds, openerSeconds: slide.kind == .hook ? (hook?.seconds ?? 0) : 0)
        let trip = renderer.trip
        let post = renderer.post

        var options = VideoExportOptions()
        options.outputSize = CGSize(width: out.width, height: out.height)
        options.frameRate = chosen.frameRate
        options.trim = range
        options.speed = chosen.speed
        options.grained = SlideVideoExport.grained(renderer, slide)
        options.onAudioSkipped = onAudioSkipped
        if slide.kind == .hook, let hook, !hook.score().isEmpty {
            options.bed = { format in
                SlideVideoExport.bed(hook, seconds: format.seconds, sampleRate: format.sampleRate,
                                     channels: format.numberOfChannels)
            }
            options.mixBed = hook.mixWithSource
        }

        return try await exportProcessedVideo(
            source,
            makeProcessor: { ctx in
                let graded = renderer.looks.grader(slide, trip, post)
                let width = ctx.outputWidth
                let height = ctx.outputHeight
                return FrameProcessor(draw: { frame, t in
                    // The SOURCE instant is the grain's clock; the DELIVERED
                    // one — since the first exported frame, at the slide's
                    // speed — is every painter's.
                    let picture = graded.map { $0.grader.render(source: frame, sourceSeconds: t) } ?? frame
                    let sinceStart = max(0, t - origin) / speed
                    var o = SlideVideoExport.videoOptions(renderer, slide, SlideSources(lead: BadgeSource(image: picture)),
                                                          at: sinceStart, clock: clock)
                    // Graded above, at the frame's own instant.
                    o.grader = nil
                    o.gradeKey = nil
                    guard let painted = renderer.badge.image(width: width, height: height, o) else {
                        throw VideoExportError.writer("A frame of this clip could not be painted.")
                    }
                    return CIImage(cgImage: painted, options: [.colorSpace: NSNull()])
                })
            },
            onProgress: onProgress,
            isCancelled: isCancelled,
            options: options
        )
    }
}
