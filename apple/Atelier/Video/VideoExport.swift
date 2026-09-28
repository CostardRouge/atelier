// The native video pipeline: a clip's frames through a per-frame transform
// and back into an MP4 — the port of the web's ONE shared pipeline,
// `exportProcessedVideo` (`src/shared/media/webcodecs-export.ts`), with what
// rides beside it: `render-video.ts` (`encodeFrames`, a clip PAINTED from
// nothing), the appended tail, the audio plan, the bed and the mix. On
// AVFoundation and Core Image, no third party: `AVAssetReader` → `CIImage` →
// processor → `CIContext` into a pooled `CVPixelBuffer` → `AVAssetWriter`
// (H.264 or HEVC), the clip's own sound COPIED through a passthrough input.
//
// Every number is the kernel's, so the web and the native export cannot
// disagree about one: the cadence and the grid (`FrameRate.swift`), the
// painted plan and the tail (`FramePlan.swift`, `ExportTail.swift`), the trim
// (`Trim.swift`), which sound the file carries (`AudioPlan.swift`), how a bed
// meets a clip's channels (`AudioMix.swift`), the bits spent
// (`WebcodecsExport.swift`, `RenderVideo.swift`), the colour tag's
// all-or-nothing guard (`ColourTag.swift`) and the stat line
// (`ExportStats.swift`).
//
// The rules the web's memory states (media-pipeline.md), kept:
//  - The cadence is the source's unless asked otherwise; a target rate is a
//    RESAMPLE onto a `1/fps` grid over the same timeline — frames dropped or
//    duplicated, never interpolated — and asking for the source's own rate is
//    the exact pass-through. A dropped frame skips the processor entirely; a
//    duplicated one is drawn once and encoded twice. The GOP and the bitrate
//    follow the OUTPUT rate, the progress the decoded source frames.
//  - A trim is cut on the author's clock with the web's 500 µs edge, and the
//    output is rebased on the frame that COVERS the in point; the processor
//    keeps receiving SOURCE seconds, so cues and the capture clock stay on
//    their frame.
//  - What sound the file carries is decided BEFORE the writer is started,
//    because its tracks are fixed then: the clip's own copied bit for bit (the
//    default whenever it has any), a bed the suite made where there is none to
//    keep (a silent drone clip, a re-timed export), a mix only on request, or
//    nothing. Anything that cannot be done falls back — to the copy, else to
//    no track — with a sentence (`onAudioSkipped`), never to a failed export.
//  - The colour tag is bt709 for primaries, transfer and matrix, through the
//    kernel's guard. The pixels are the decoded codes, LABELLED and never
//    resampled — Chrome's relabel, which is what makes preview = export hold
//    between the two apps (`VideoSource.swift`).
//  - The tail is appended after the footage's last frame, at `timestamp +
//    duration` of the last emitted frame, and the audio ends with the
//    footage: nothing already encoded moves.
//  - Reader, feeds and writer are torn down on every exit path, and a
//    cancelled or failed run leaves no file behind — the web's one
//    try/finally around the encoder, for the web's reason (a leaked encode
//    session breaks every export after it, not only this one).
//
// What the platform does that the browser could not, said rather than
// re-implemented, and each of it only a device can confirm:
//  - HEVC in and out: `transcode.ts` has no port (`VideoSource.swift`).
//  - The AAC PRIMING the web measured (2112 samples, `audio-encode.ts`) is
//    recorded by `AVAssetWriter` in the track's edit list, so a bed is handed
//    in AT ITS OWN TIME and must NOT be rendered ahead the way the web's
//    `renderBed` does with `leadSeconds`. Sync is claimed only after a file is
//    decoded back on a device — the web's own rule.
//  - A copied track cut mid-file keeps the packet that straddles the in point
//    at a NEGATIVE time with a `TrimDurationAtStart` saying how much of it
//    precedes the cut; the writer edits that part out, so the cut is exact
//    rather than the web's ~21 ms packet boundary.
//
// Not here: HDR video (said in the metadata, flattened to 709 on the way in)
// and the web's `exportVariantVideo` — the Studio's overlays, framing and
// outro card are a PROCESSOR and a TAIL handed to this function, and arrive
// with the Studio's port.

import AVFoundation
import CoreImage
import AtelierKit

// MARK: - the vocabulary

struct ExportProgress: Equatable {
    enum Phase: Equatable { case demuxing, encoding, finalizing }
    let phase: Phase
    /// 0...1 while encoding; nil when the phase has no measurable ratio.
    let ratio: Double?
}

/// What the per-frame transform is told about the source — the web's
/// `FrameContext`, plus whether the frame it receives is already turned.
struct FrameContext: Equatable {
    /// The decoder's raw frame, un-rotated.
    let codedWidth: Int
    let codedHeight: Int
    /// What gets encoded — display orientation when the rotation is baked,
    /// the composition's own size under `outputSize`.
    let outputWidth: Int
    let outputHeight: Int
    /// The container's display rotation, clockwise degrees.
    let rotation: Int
    /// The frame handed to `draw` is already upright (`bakeRotation`, or an
    /// `outputSize` composition): the web made the processor turn it itself
    /// with `drawRotatedFrame`; here `CIImage.oriented` does it once, before.
    let upright: Bool
}

/// A per-frame transform: the decoded frame and its SOURCE time in seconds
/// (the author's clock, the one a trim is picked on) in, the picture to
/// encode out, whose `(0, 0, outputWidth, outputHeight)` window is the frame.
/// `dispose` runs once, on every exit path — where a grader is released.
struct FrameProcessor {
    let draw: (CIImage, Double) throws -> CIImage
    let dispose: () -> Void

    init(draw: @escaping (CIImage, Double) throws -> CIImage, dispose: @escaping () -> Void = {}) {
        self.draw = draw
        self.dispose = dispose
    }

    /// The identity: the frame as decoded.
    static let passThrough = FrameProcessor(draw: { image, _ in image })
}

/// What a bed is asked for, once the pipeline knows what it is writing — the
/// web's `bed(format)`: the clip's own rate and layout when it will be MIXED
/// in, 48 kHz stereo when it becomes the track alone. `seconds` is the
/// footage's delivered length (the bed ends with the footage).
struct BedFormat: Equatable {
    let sampleRate: Double
    let numberOfChannels: Int
    let seconds: Double
}

enum ExportCodec: Equatable {
    case h264
    case hevc

    var label: String { self == .h264 ? "H.264" : "HEVC" }
}

/// The web's `ExportOptions`, key for key, plus the native choices (codec,
/// the stat).
struct VideoExportOptions {
    /// Turn each frame upright in pixels and write no rotation flag — needed
    /// whenever something is drawn at fixed coordinates.
    var bakeRotation = false
    /// Encode at this size (a composition); the frame arrives upright.
    var outputSize: CGSize? = nil
    /// `.source` (or nil) keeps every frame at its own time; a rate resamples.
    var frameRate: ExportFrameRate? = nil
    /// Encode only this stretch of the source, on the author's clock.
    var trim: TrimRange? = nil
    /// 2 twice as fast, 0.5 half; a re-timed clip ships without the clip's sound.
    var speed: Double = 1
    /// Frames appended after the footage (the outro card); they play silent.
    var tail: ExportTail<CIImage>? = nil
    /// Audio the suite MADE for this export, asked for in the format needed.
    var bed: ((BedFormat) async throws -> PlanarAudio?)? = nil
    /// Mix the bed into the clip's own sound, re-encoding it. Off keeps it bit for bit.
    var mixBed = false
    /// Told why composed or copied sound did not make it into the file as asked.
    var onAudioSkipped: ((String) -> Void)? = nil
    /// The grade carries film GRAIN: encoded at the grained bits per pixel.
    var grained = false
    var codec: ExportCodec = .h264
    /// What the run cost, once the file is written (`ExportStats.swift`).
    var onFinished: ((ExportStat) -> Void)? = nil

    init() {}
}

enum VideoExportError: LocalizedError {
    /// A painted clip that would be zero frames long — refused, never an empty MP4.
    case emptyClip
    /// The window holds no frame at all.
    case noFrames
    /// The device has no encoder for this codec at this size.
    case cannotEncode(String)
    case writer(String)

    var errorDescription: String? {
        switch self {
        case .emptyClip: return "Nothing to encode: this clip would be zero frames long."
        case .noFrames: return "No video frames found."
        case .cannotEncode(let why), .writer(let why): return why
        }
    }
}

// The sentences an export says when sound did not go out as asked.
private let cannotMix =
    "The clip’s sound could not be mixed here, so it kept its own sound untouched and the ticks were left out."
private let cannotEncodeBed =
    "This device cannot encode AAC audio, so the clip went out without its ticks."
private let soundUnreadable =
    "The clip’s sound could not be read here, so it went out without it."

private func soundReencoded(_ codec: String) -> String {
    "The clip’s sound is \(codec), which an MP4 cannot carry as it is, so it was encoded to AAC."
}

// MARK: - exportProcessedVideo

/// Re-encode `source` through the processor `makeProcessor` builds, and write
/// a new MP4 into the temporary directory, returning its URL (the caller moves
/// or deletes it).
///
/// Blocking on the decoder and on the encoder in turn: run it from a detached
/// task. A cancel — `isCancelled()` answering true, or the task cancelled —
/// throws `CancellationError` and leaves no file.
func exportProcessedVideo(
    _ source: VideoSource,
    makeProcessor: (FrameContext) throws -> FrameProcessor,
    onProgress: ((ExportProgress) -> Void)? = nil,
    isCancelled: @escaping () -> Bool = { false },
    options: VideoExportOptions = VideoExportOptions()
) async throws -> URL {
    let startedAt = Date()
    let meta = source.metadata
    onProgress?(ExportProgress(phase: .demuxing, ratio: nil))
    try checkCancelled(isCancelled)

    // Geometry — the web's: either the rotation flag is copied onto the
    // output, or the pixels are turned and the flag is 0. A composition
    // encodes at its own size, the frame upright, no flag.
    let rotation = meta.rotation
    let swap = options.bakeRotation && (rotation == 90 || rotation == 270)
    var outputWidth = swap ? meta.codedHeight : meta.codedWidth
    var outputHeight = swap ? meta.codedWidth : meta.codedHeight
    var transform = options.bakeRotation ? CGAffineTransform.identity : meta.preferredTransform
    var upright = options.bakeRotation
    if let size = options.outputSize {
        outputWidth = Int(size.width)
        outputHeight = Int(size.height)
        transform = .identity
        upright = true
    }
    let even = paintedOutputSize(Double(outputWidth), Double(outputHeight))
    outputWidth = even.w
    outputHeight = even.h

    // Cadence and speed. Asking for the rate the clip already has resolves to
    // the source rate and keeps the exact pass-through; a speed always takes
    // the grid, even at the source cadence, because every timestamp moves.
    let sourceFps = meta.sourceFrameRate
    let framerate = Double(resolveFrameRate(options.frameRate, sourceFps))
    let speed = resolveSpeed(options.speed)
    let retime = framerate != sourceFps || speed != 1

    // The trim, made possible before it is cut: inside the clip, ordered, at
    // least one frame long (a collapsed range keeps the frame under it).
    var trim = options.trim
    if let asked = trim, meta.duration > 0 {
        trim = clampRange(asked, meta.duration, minTrimLength(meta.nominalFrameRate))
    }
    // The window on the author's clock, with the web's tolerance: a frame that
    // ENDS on the in point, or starts on the out point, stays out.
    let edge = 500
    let startMicros = trim.map { max(0, videoMicros(seconds: $0.start)) + edge } ?? 0
    let endMicros = trim.map { max(startMicros, videoMicros(seconds: $0.end) - edge) } ?? Int.max
    let footageSeconds = trim.map(trimDuration) ?? meta.duration
    let deliveredSeconds = max(0, footageSeconds / speed)

    // What sound the file carries — decided HERE, before the writer exists.
    let route = try await planRoute(source: source, speed: speed, deliveredSeconds: deliveredSeconds, options: options)
    try checkCancelled(isCancelled)

    let bits = deriveBitrate(outputWidth, outputHeight, framerate, options.grained)
    let url = temporaryExportURL()
    let writer = try ClipWriter(url: url, codec: options.codec, width: outputWidth, height: outputHeight,
                                framerate: framerate, bitrate: bits, transform: transform)

    var processor: FrameProcessor? = nil
    var reader: VideoFrameReader? = nil
    var feed: AudioFeed? = nil
    defer {
        processor?.dispose()
        reader?.cancel()
        feed?.cancel()
    }

    do {
        feed = attachAudio(route, source: source, writer: writer, note: options.onAudioSkipped)
        // A bed never outlasts the footage — bounded before the first frame,
        // since the sound runs ahead of the picture; refined once it ends. (A
        // clip whose duration the container did not say waits for the end.)
        if deliveredSeconds > 0 { feed?.end(at: videoMicros(seconds: deliveredSeconds)) }
        try writer.start()

        let made = try makeProcessor(FrameContext(
            codedWidth: meta.codedWidth, codedHeight: meta.codedHeight,
            outputWidth: outputWidth, outputHeight: outputHeight,
            rotation: rotation, upright: upright
        ))
        processor = made
        let frames = try source.frames(from: trim?.start ?? 0, to: trim?.end, upright: upright)
        reader = frames

        // The appended card is planned up front, so the ratio covers the run.
        let tailCount = options.tail.map { $0.frames(fps: framerate, startMicros: 0).count } ?? 0
        let total = max(1, outputFrameCount(footageSeconds, sourceFps)) + tailCount
        var processed = 0
        func report() {
            onProgress?(ExportProgress(phase: .encoding, ratio: min(1, Double(processed) / Double(total))))
        }

        // Retiming state: the grid is anchored on the first KEPT frame, so a
        // trimmed export starts its output at index 0 like any other.
        let sourceFrameDuration = frameTimestampMicros(1, sourceFps)
        let outputFrameDuration = frameTimestampMicros(1, framerate)
        var base: Int? = nil
        var nextIndex = 0
        // End of the picture on the OUTPUT timeline (timestamp + duration of
        // the last emitted frame) — where an appended card starts.
        var outEndMicros = 0

        while let frame = try frames.next() {
            try checkCancelled(isCancelled)
            let pts = frame.micros
            let srcDuration = frame.durationMicros > 0 ? frame.durationMicros : sourceFrameDuration
            if trim != nil {
                // Ends on or before the in point: decoded only because the
                // reader was asked to start early. On or past the out point:
                // done — presentation order is monotonic.
                if pts + srcDuration <= startMicros { continue }
                if pts >= endMicros { break }
            }
            if base == nil {
                // The frame under the in handle opens the file; the sound is
                // cut on the same origin, so it learns it now.
                base = pts
                feed?.open(base: pts, until: endMicros, windowed: trim != nil)
            }
            let origin = base ?? pts

            // Which output frames this decoded frame owes. Pass-through gives
            // one, at the source's own timestamp; retiming gives none (dropped),
            // one, or several (duplicated) on the output grid. Either way the
            // file starts at zero.
            let timestamps: [Int]
            let duration: Int
            if retime {
                // The source span, divided by the speed: that is the whole
                // re-time, and the grid turns it into dropped or repeated frames.
                let start = Double(pts - origin) / speed
                let end = start + Double(srcDuration) / speed
                let indices = planFrameIndices(start, end, framerate, nextIndex)
                if indices.isEmpty {
                    // Nothing to encode from this frame — skip the transform
                    // entirely, which is what makes a 60 → 24 export cheaper.
                    processed += 1
                    report()
                    continue
                }
                nextIndex = indices[indices.count - 1] + 1
                timestamps = indices.map { frameTimestampMicros($0, framerate) }
                duration = outputFrameDuration
            } else {
                timestamps = [pts - origin]
                duration = srcDuration
            }

            // The processor reads the author's clock — the source's seconds.
            let picture = try made.draw(frame.image, frame.seconds)
            try await writer.appendFrame(picture, at: timestamps, feed: feed)
            for ts in timestamps { outEndMicros = max(outEndMicros, ts + duration) }
            processed += 1
            report()
            // The sound keeps pace with the picture, a second ahead, so the
            // two tracks interleave on disk.
            if let feed { try writer.pump(feed, upTo: outEndMicros + audioLeadMicros) }
        }
        frames.cancel()
        guard base != nil else { throw VideoExportError.noFrames }

        // A bed ends WITH the footage; the copied track is bounded by its
        // own window (the out point, or the track's end).
        feed?.end(at: outEndMicros)

        // The appended card starts exactly where the footage ends and plays
        // silent, as an outro does; the sound left over keeps interleaving.
        if let tail = options.tail, tail.seconds > 0 {
            for planned in tail.frames(fps: framerate, startMicros: outEndMicros) {
                try checkCancelled(isCancelled)
                try await writer.appendFrame(tail.draw(planned.tSeconds), at: [planned.timestampMicros], feed: feed)
                processed += 1
                report()
            }
        }

        // The picture is done, so nothing holds the sound back any more.
        writer.finishVideo()
        if let feed { try await writer.drain(feed) }

        onProgress?(ExportProgress(phase: .finalizing, ratio: nil))
        try await writer.finish()
        options.onFinished?(measuredStat(url, startedAt: startedAt, clipSeconds: footageSeconds))
        return url
    } catch {
        writer.cancel()
        throw error
    }
}

// MARK: - encodeFrames (render-video.ts)

/// Paint `seconds` of video and write it as an MP4 with no source clip: the
/// same pipeline with its first half removed — plan the frames (`framePlan`),
/// ask the caller to paint each one, encode. A painted clip is SILENT unless
/// the suite made `audio` for it, and has no source cadence to inherit (`fps`
/// is a delivery choice, `defaultPaintedFps` when absent). A zero-length clip
/// is refused rather than delivered empty, and a device that cannot encode at
/// this size says so with the size in the sentence.
func encodeFrames(
    width: Double,
    height: Double,
    seconds: Double,
    fps: Double? = nil,
    draw: (Double) async throws -> CIImage,
    audio: PlanarAudio? = nil,
    onAudioSkipped: ((String) -> Void)? = nil,
    grained: Bool = false,
    codec: ExportCodec = .h264,
    onProgress: ((ExportProgress) -> Void)? = nil,
    isCancelled: @escaping () -> Bool = { false }
) async throws -> URL {
    let size = paintedOutputSize(width, height)
    let rate = Double(paintedFps(fps))
    let plan = framePlan(seconds, rate)
    guard !plan.isEmpty else { throw VideoExportError.emptyClip }
    try checkCancelled(isCancelled)

    let url = temporaryExportURL()
    let writer = try ClipWriter(url: url, codec: codec, width: size.w, height: size.h, framerate: rate,
                                bitrate: deriveBitrate(size.w, size.h, rate, grained), transform: .identity)
    var feed: AudioFeed? = nil
    defer { feed?.cancel() }
    do {
        // Whether the file gets an audio track is decided by whether there is
        // audio to put in it: an empty track would be a silent lie.
        if let audio = usable(audio) {
            feed = attachAudio(.bed(audio), source: nil, writer: writer, note: onAudioSkipped)
        }
        // The sound never outlasts the picture: a file lasts as long as its
        // longest track (the web measured a flush tail ~75 ms long). Bounded
        // before the first frame, since the sound runs ahead of the picture.
        if let last = plan.last { feed?.end(at: last.timestampMicros + last.durationMicros) }
        try writer.start()

        var done = 0
        var outEndMicros = 0
        for planned in plan {
            try checkCancelled(isCancelled)
            let picture = try await draw(planned.tSeconds)
            try await writer.appendFrame(picture, at: [planned.timestampMicros], feed: feed)
            outEndMicros = planned.timestampMicros + planned.durationMicros
            done += 1
            onProgress?(ExportProgress(phase: .encoding, ratio: Double(done) / Double(plan.count)))
            if let feed { try writer.pump(feed, upTo: outEndMicros + audioLeadMicros) }
        }
        feed?.end(at: outEndMicros)
        writer.finishVideo()
        if let feed { try await writer.drain(feed) }

        onProgress?(ExportProgress(phase: .finalizing, ratio: nil))
        try await writer.finish()
        return url
    } catch {
        writer.cancel()
        throw error
    }
}

// MARK: - the audio decision

/// Seconds of sound handed to the writer ahead of the picture, so the two
/// interleave on disk and neither input starves the other.
private let audioLeadMicros = 1_000_000

/// Linear PCM as the pipeline decodes and encodes it: interleaved Float32.
private struct PCMFormat: Equatable {
    let sampleRate: Double
    let channels: Int
}

private enum AudioRoute {
    case none
    /// The clip's own packets, bit for bit.
    case passthrough
    /// The clip's sound decoded and encoded to AAC — with a bed summed in
    /// for a mix.
    case decoded(PCMFormat, mix: PlanarAudio?)
    /// Audio the suite made, encoded to AAC, as the whole track.
    case bed(PlanarAudio)
}

/// The clip's sound as the pipeline decodes it: its own rate, at most stereo
/// (the reader folds a wider layout down, and a mix is at most stereo too).
private func decodedFormat(_ info: AudioTrackInfo) -> PCMFormat {
    let rate = info.sampleRate.isFinite && info.sampleRate > 0 ? info.sampleRate : 48_000
    return PCMFormat(sampleRate: rate, channels: max(1, min(2, info.channels)))
}

private func usable(_ audio: PlanarAudio?) -> PlanarAudio? {
    guard let audio, audio.length > 0, audio.numberOfChannels > 0, audio.sampleRate > 0 else { return nil }
    return audio
}

/// The kernel's `planAudio`, then what each outcome needs: the bed asked for
/// in the format it will be written in, the copy's route by codec.
private func planRoute(source: VideoSource, speed: Double, deliveredSeconds: Double,
                       options: VideoExportOptions) async throws -> AudioRoute {
    let info = source.audioTrack != nil ? source.metadata.audio : nil
    let plan = planAudio(AudioPlanInput(sourceAudio: info != nil, retimed: speed != 1,
                                        bed: options.bed != nil, mix: options.mixBed))
    func copyRoute() -> AudioRoute {
        guard let info else { return .none }
        if info.isMP4Passthrough { return .passthrough }
        options.onAudioSkipped?(soundReencoded(info.codec))
        return .decoded(decodedFormat(info), mix: nil)
    }
    switch plan {
    case .none:
        return .none
    case .copy(let droppedBed):
        if let droppedBed { options.onAudioSkipped?(droppedBed) }
        return copyRoute()
    case .bed:
        let format = BedFormat(sampleRate: 48_000, numberOfChannels: 2, seconds: deliveredSeconds)
        let asked = try await options.bed?(format)
        guard let made = usable(asked) else { return .none }
        return .bed(made)
    case .mix:
        guard let info else { return .none }
        let pcm = decodedFormat(info)
        let format = BedFormat(sampleRate: pcm.sampleRate, numberOfChannels: pcm.channels, seconds: deliveredSeconds)
        let asked = try await options.bed?(format)
        // Nothing to add after all: the clip keeps its own sound, bit for bit.
        guard let made = usable(asked) else { return copyRoute() }
        guard made.sampleRate == pcm.sampleRate else {
            options.onAudioSkipped?(cannotMix)
            return copyRoute()
        }
        return .decoded(pcm, mix: made)
    }
}

/// Declare the audio input the route needs and build its feed — or fall back
/// the way the web does: a copy the file cannot carry is encoded, a mix that
/// cannot be made keeps the clip's own sound, and what cannot be done at all
/// goes out with no audio track and a sentence. Never a failed export, never
/// a declared-but-broken track.
private func attachAudio(_ route: AudioRoute, source: VideoSource?, writer: ClipWriter,
                         note: ((String) -> Void)?) -> AudioFeed? {
    func decodedFeed(_ pcm: PCMFormat, _ bed: PlanarAudio?) -> AudioFeed? {
        guard let source, let track = source.audioTrack,
              let feed = try? SourceAudioFeed(asset: source.asset, track: track, pcm: pcm, bed: bed),
              writer.addAudio(.aac(pcm.sampleRate, pcm.channels)) else { return nil }
        return feed
    }
    func passthroughFeed() -> AudioFeed? {
        guard let source, let track = source.audioTrack, let format = source.audioFormat,
              let feed = try? SourceAudioFeed(asset: source.asset, track: track, pcm: nil, bed: nil),
              writer.addAudio(.passthrough(format)) else { return nil }
        return feed
    }
    switch route {
    case .none:
        return nil
    case .bed(let bed):
        let channels = max(1, min(2, bed.numberOfChannels))
        guard let feed = try? BedAudioFeed(bed: bed, channels: channels),
              writer.addAudio(.aac(bed.sampleRate, channels)) else {
            note?(cannotEncodeBed)
            return nil
        }
        return feed
    case .passthrough:
        if let feed = passthroughFeed() { return feed }
        if let info = source?.metadata.audio, let feed = decodedFeed(decodedFormat(info), nil) {
            note?(soundReencoded(info.codec))
            return feed
        }
        note?(soundUnreadable)
        return nil
    case .decoded(let pcm, let mix):
        if let feed = decodedFeed(pcm, mix) { return feed }
        if mix != nil {
            note?(cannotMix)
            return attachAudio(.passthrough, source: source, writer: writer, note: note)
        }
        note?(soundUnreadable)
        return nil
    }
}

// MARK: - helpers

private func checkCancelled(_ isCancelled: () -> Bool) throws {
    if isCancelled() { throw CancellationError() }
    try Task.checkCancellation()
}

private func temporaryExportURL() -> URL {
    let name = "atelier-\(UUID().uuidString.lowercased()).mp4"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    try? FileManager.default.removeItem(at: url)
    return url
}

/// What the finished run cost: the file's size, the wall clock, and the
/// seconds of SOURCE encoded — a trimmed run that rendered 5 s of a 40 s rush
/// is not 8× realtime (the Studio's own rule).
private func measuredStat(_ url: URL, startedAt: Date, clipSeconds: Double) -> ExportStat {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    let size = attributes?[.size] as? NSNumber
    let clip: Double? = clipSeconds.isFinite && clipSeconds > 0 ? clipSeconds : nil
    return ExportStat(bytes: size?.intValue ?? 0, seconds: Date().timeIntervalSince(startedAt), clipSeconds: clip)
}

/// A mono or stereo layout, for a writer or reader that is asked for one.
private func channelLayoutData(_ channels: Int) -> Data {
    var layout = AudioChannelLayout()
    layout.mChannelLayoutTag = channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
    return Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
}

// MARK: - the writer

/// One `AVAssetWriter`: a video input fed from Core Image through a pixel
/// buffer pool, and at most one audio input — the clip's own packets passed
/// through, or LPCM the writer encodes to AAC-LC.
private final class ClipWriter {
    enum AudioInput {
        case passthrough(CMFormatDescription)
        /// Sample rate, channels.
        case aac(Double, Int)
    }

    /// Every rate this suite delivers is a whole number of ticks at 60 000 —
    /// 29.97 is 2002, 59.94 is 1001, 24 is 2500, 25 is 2400 — so NTSC
    /// cadences never accumulate a rounding drift.
    private static let timescale: CMTimeScale = 60_000
    private static let aacBitrate = 128_000

    let url: URL
    private let width: Int
    private let height: Int
    private let writer: AVAssetWriter
    private let video: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private var audio: AVAssetWriterInput?
    private let context = CIContext(options: [.cacheIntermediates: false])
    /// Black under every frame: whatever a processor leaves uncovered is
    /// black, never the previous contents of a pooled buffer.
    private let ground: CIImage
    private var videoFinished = false
    private var audioFinished = false
    /// The latest timestamp handed to the video input — how far the sound may
    /// be pumped while the picture waits.
    private var lastVideoMicros = 0

    init(url: URL, codec: ExportCodec, width: Int, height: Int, framerate: Double, bitrate: Int,
         transform: CGAffineTransform) throws {
        self.url = url
        self.width = width
        self.height = height
        self.ground = CIImage(color: CIColor(red: 0, green: 0, blue: 0))
            .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))

        let writer: AVAssetWriter
        do {
            writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        } catch {
            throw VideoExportError.writer(error.localizedDescription)
        }
        // The web's `fastStart: 'in-memory'`: the `moov` ahead of the samples.
        writer.shouldOptimizeForNetworkUse = true
        writer.movieTimeScale = ClipWriter.timescale

        var compression: [String: Any] = [
            AVVideoAverageBitRateKey: bitrate,
            // A keyframe every ~2 s, the web's GOP, keyed to the OUTPUT rate.
            AVVideoMaxKeyFrameIntervalKey: max(1, Int(framerate * 2)),
            AVVideoExpectedSourceFrameRateKey: framerate,
        ]
        let codecType: AVVideoCodecType
        switch codec {
        case .h264:
            codecType = .h264
            compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
            compression[AVVideoH264EntropyModeKey] = AVVideoH264EntropyModeCABAC
        case .hevc:
            // Main, 8-bit — the pipeline is SDR by construction.
            codecType = .hevc
        }
        var settings: [String: Any] = [
            AVVideoCodecKey: codecType,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
        ]
        if let colour = videoColourProperties(exportColourSpace) {
            settings[AVVideoColorPropertiesKey] = colour
        }
        let refusal = "This device cannot encode \(codec.label) video at \(width)×\(height), so no clip can be written here."
        guard writer.canApply(outputSettings: settings, forMediaType: .video) else {
            throw VideoExportError.cannotEncode(refusal)
        }
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        video.expectsMediaDataInRealTime = false
        video.transform = transform
        video.mediaTimeScale = ClipWriter.timescale
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ])
        guard writer.canAdd(video) else { throw VideoExportError.cannotEncode(refusal) }
        writer.add(video)

        self.writer = writer
        self.video = video
        self.adaptor = adaptor
    }

    /// Declare the one audio input — before `start()`. False when this file
    /// cannot carry it; the caller then falls back and says so.
    func addAudio(_ kind: AudioInput) -> Bool {
        guard audio == nil, writer.status == .unknown else { return false }
        let input: AVAssetWriterInput
        switch kind {
        case .passthrough(let format):
            input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: format)
        case .aac(let sampleRate, let channels):
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVChannelLayoutKey: channelLayoutData(channels),
                AVEncoderBitRateKey: ClipWriter.aacBitrate,
            ]
            guard writer.canApply(outputSettings: settings, forMediaType: .audio) else { return false }
            input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        }
        input.expectsMediaDataInRealTime = false
        guard writer.canAdd(input) else { return false }
        writer.add(input)
        audio = input
        return true
    }

    func start() throws {
        guard writer.startWriting() else {
            throw VideoExportError.writer(writer.error?.localizedDescription ?? "The file could not be started.")
        }
        writer.startSession(atSourceTime: .zero)
    }

    /// Render `image`'s `(0, 0, width, height)` window ONCE and append it at
    /// every timestamp — a duplicated frame is drawn once, encoded twice.
    func appendFrame(_ image: CIImage, at timestampsMicros: [Int], feed: AudioFeed?) async throws {
        guard !timestampsMicros.isEmpty else { return }
        try await waitForVideo(feed)
        guard let pool = adaptor.pixelBufferPool else {
            throw VideoExportError.writer("The encoder gave no pixel buffer pool.")
        }
        var made: CVPixelBuffer?
        let status = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &made)
        guard status == kCVReturnSuccess, let buffer = made else {
            throw VideoExportError.writer("No pixel buffer could be made for a frame.")
        }
        // The buffer says its RGB is 709: the codes Core Image writes are
        // LABELLED, never resampled — the web's relabel — so the encoder only
        // converts R'G'B' → Y'CbCr with the 709 matrix.
        CVBufferSetAttachment(buffer, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
        CVBufferSetAttachment(buffer, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
        let frame = CGRect(x: 0, y: 0, width: width, height: height)
        context.render(image.composited(over: ground), to: buffer, bounds: frame, colorSpace: videoCodesColourSpace)
        for (i, micros) in timestampsMicros.enumerated() {
            if i > 0 { try await waitForVideo(feed) }
            guard adaptor.append(buffer, withPresentationTime: videoTime(micros: micros)) else {
                throw VideoExportError.writer(writer.error?.localizedDescription ?? "The encoder refused a frame.")
            }
            lastVideoMicros = max(lastVideoMicros, micros)
        }
    }

    /// Hand the writer what the feed has up to `limit` on the output clock,
    /// for as long as the audio input takes it. NEVER waits: a writer that is
    /// holding the sound back until the picture catches up is answered by the
    /// picture, not by a loop here. Marks the audio finished once the feed
    /// runs dry, so the picture is never held for a track with nothing left.
    @discardableResult
    func pump(_ feed: AudioFeed, upTo limit: Int) throws -> Bool {
        guard let audio, !audioFinished else { return false }
        var moved = false
        while audio.isReadyForMoreMediaData {
            guard let next = try feed.peek() else {
                finishAudio()
                break
            }
            if next.outputMicros > limit { break }
            guard audio.append(next.buffer) else {
                throw VideoExportError.writer(writer.error?.localizedDescription ?? "The writer refused an audio packet.")
            }
            feed.consume()
            moved = true
        }
        return moved
    }

    /// The rest of the sound, once the picture is finished and nothing can
    /// hold it back.
    func drain(_ feed: AudioFeed) async throws {
        guard audio != nil else { return }
        while !audioFinished {
            try checkWriter()
            let moved = try pump(feed, upTo: Int.max)
            if !moved && !audioFinished { try await Task.sleep(nanoseconds: 1_000_000) }
        }
    }

    func finishVideo() {
        if !videoFinished { video.markAsFinished() }
        videoFinished = true
    }

    func finishAudio() {
        if let audio, !audioFinished { audio.markAsFinished() }
        audioFinished = true
    }

    func finish() async throws {
        finishVideo()
        finishAudio()
        await writer.finishWriting()
        guard writer.status == .completed else {
            throw VideoExportError.writer(writer.error?.localizedDescription ?? "The file could not be finished.")
        }
    }

    /// Stop, and leave no file behind. A no-op after a completed `finish()`.
    func cancel() {
        if writer.status == .writing { writer.cancelWriting() }
        if writer.status != .completed { try? FileManager.default.removeItem(at: url) }
    }

    /// The web's `awaitQueue`: back-pressure, polled. While the picture is
    /// held — which the writer does to INTERLEAVE, when the sound is behind —
    /// the sound is fed up to a second past the picture, so neither input can
    /// wait on the other forever and the sound never runs far ahead. A track
    /// that STARTS late (a gap before its first packet) would leave nothing
    /// within that second, so a picture held ~50 polls with nothing moving
    /// lets the sound go as far as it has; its own end still bounds it.
    private func waitForVideo(_ feed: AudioFeed?) async throws {
        var idle = 0
        while !video.isReadyForMoreMediaData {
            try checkWriter()
            var moved = false
            if let feed {
                let limit = idle < 50 ? lastVideoMicros + audioLeadMicros : Int.max
                moved = try pump(feed, upTo: limit)
            }
            if moved {
                idle = 0
            } else {
                idle += 1
                try await Task.sleep(nanoseconds: 1_000_000)
            }
        }
    }

    private func checkWriter() throws {
        switch writer.status {
        case .failed:
            throw VideoExportError.writer(writer.error?.localizedDescription ?? "The encoder failed.")
        case .cancelled:
            throw CancellationError()
        default:
            return
        }
    }
}

// MARK: - the sound, fed beside the picture

/// A buffer of sound and where it starts on the OUTPUT clock (microseconds
/// from the file's first frame).
private struct AudioChunk {
    let buffer: CMSampleBuffer
    let outputMicros: Int
}

/// Sound handed to the writer as the picture advances.
private protocol AudioFeed: AnyObject {
    /// The clip's window, known once the first kept frame is: `base` is its
    /// presentation time (the output's zero), `until` the out point.
    func open(base: Int, until: Int, windowed: Bool)
    /// The next chunk, without taking it; nil once there is no more.
    func peek() throws -> AudioChunk?
    /// Take the chunk `peek` answered.
    func consume()
    /// Nothing past this output time (the footage's end).
    func end(at outputMicros: Int)
    func cancel()
}

/// Uniform per-sample timing of a buffer — an AAC packet, an LPCM frame — in
/// microseconds: the first sample's time and the step.
private func sampleClock(_ sample: CMSampleBuffer, count: Int) -> (first: Double, step: Double)? {
    var timing = CMSampleTimingInfo()
    guard CMSampleBufferGetSampleTimingInfo(sample, at: 0, timingInfoOut: &timing) == noErr,
          timing.presentationTimeStamp.isNumeric else { return nil }
    let first = timing.presentationTimeStamp.seconds * 1_000_000
    var step = timing.duration.isNumeric ? timing.duration.seconds * 1_000_000 : 0
    if step <= 0 {
        let whole = CMSampleBufferGetDuration(sample)
        if whole.isNumeric, count > 0 { step = whole.seconds * 1_000_000 / Double(count) }
    }
    return (first, step)
}

/// The same buffer on a clock `by` earlier — every timing entry moved.
private func retimed(_ sample: CMSampleBuffer, by offset: CMTime) -> CMSampleBuffer? {
    var needed: CMItemCount = 0
    _ = CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: 0, arrayToFill: nil, entriesNeededOut: &needed)
    guard needed > 0 else { return nil }
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: needed)
    guard CMSampleBufferGetSampleTimingInfoArray(sample, entryCount: needed, arrayToFill: &timing,
                                                 entriesNeededOut: &needed) == noErr else { return nil }
    for i in 0..<timing.count {
        timing[i].presentationTimeStamp = CMTimeSubtract(timing[i].presentationTimeStamp, offset)
        if timing[i].decodeTimeStamp.isNumeric {
            timing[i].decodeTimeStamp = CMTimeSubtract(timing[i].decodeTimeStamp, offset)
        }
    }
    var out: CMSampleBuffer?
    let status = CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sample,
                                                       sampleTimingEntryCount: timing.count, sampleTimingArray: &timing,
                                                       sampleBufferOut: &out)
    return status == noErr ? out : nil
}

/// The clip's own track over the export window — its packets passed through
/// as they are (AAC, AC-3), or decoded to LPCM for the writer to encode when
/// the container cannot carry them, or when a bed is MIXED in.
private final class SourceAudioFeed: AudioFeed {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    /// nil: the packets as they are. Otherwise the LPCM the reader decodes to.
    private let pcm: PCMFormat?
    private let bed: PlanarAudio?
    private var base = 0
    private var until = Int.max
    private var windowed = false
    private var pending: AudioChunk?
    private var started = false
    private var exhausted = false
    private var emitted = false

    init(asset: AVAsset, track: AVAssetTrack, pcm: PCMFormat?, bed: PlanarAudio?) throws {
        let reader = try AVAssetReader(asset: asset)
        var settings: [String: Any]? = nil
        if let pcm {
            settings = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: pcm.sampleRate,
                AVNumberOfChannelsKey: pcm.channels,
                AVChannelLayoutKey: channelLayoutData(pcm.channels),
                AVLinearPCMBitDepthKey: 32,
                AVLinearPCMIsFloatKey: true,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
        }
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw VideoSourceError.unreadable(soundUnreadable) }
        reader.add(output)
        self.reader = reader
        self.output = output
        self.pcm = pcm
        self.bed = bed
    }

    deinit {
        if reader.status == .reading { reader.cancelReading() }
    }

    func open(base: Int, until: Int, windowed: Bool) {
        guard !started else { return }
        self.base = base
        self.until = until
        self.windowed = windowed
        guard windowed else { return }
        // Decoded audio is cut to the sample by the reader; packets are cut
        // here, so their reader reads a little either side of the window.
        let slack = pcm == nil ? 250_000 : 0
        let from = videoTime(micros: max(0, base - slack))
        let to: CMTime = until == Int.max ? .positiveInfinity : videoTime(micros: until + slack)
        reader.timeRange = CMTimeRange(start: from, end: to)
    }

    func peek() throws -> AudioChunk? {
        if pending == nil && !exhausted { try pull() }
        return pending
    }

    func consume() {
        pending = nil
    }

    func end(at outputMicros: Int) {
        // The window already bounds the clip's own sound.
    }

    func cancel() {
        exhausted = true
        pending = nil
        if reader.status == .reading { reader.cancelReading() }
    }

    private func pull() throws {
        if !started {
            started = true
            guard reader.startReading() else {
                exhausted = true
                throw VideoExportError.writer(reader.error?.localizedDescription ?? soundUnreadable)
            }
        }
        let offset = videoTime(micros: base)
        while pending == nil && !exhausted {
            guard let sample = output.copyNextSampleBuffer() else {
                exhausted = true
                if reader.status == .failed {
                    throw VideoExportError.writer(reader.error?.localizedDescription ?? soundUnreadable)
                }
                return
            }
            let count = CMSampleBufferGetNumSamples(sample)
            guard count > 0, let clock = sampleClock(sample, count: count) else { continue }

            // Untrimmed, the track goes out whole, every packet and its own
            // attachments as the file wrote them; trimmed, only what overlaps.
            var first = 0
            var last = count
            if windowed {
                if clock.step > 0 {
                    // A packet is kept when it ENDS after the in point (the
                    // web's rule) and STARTS before the out point; an LPCM
                    // frame, when it starts on or after the in point.
                    let head = (Double(base) - clock.first) / clock.step
                    let from = pcm == nil ? head.rounded(.down) : head.rounded(.up)
                    first = Int(max(0, min(Double(count), from)))
                    if until != Int.max {
                        let tail = ((Double(until) - clock.first) / clock.step).rounded(.up)
                        last = Int(max(0, min(Double(count), tail)))
                    }
                } else if clock.first >= Double(until) {
                    last = 0
                }
                if last <= first {
                    // Wholly before the window: skip it. Wholly past it: done.
                    if until != Int.max && clock.first + Double(first) * clock.step >= Double(until) {
                        exhausted = true
                        reader.cancelReading()
                    }
                    continue
                }
            }

            var piece = sample
            if first > 0 || last < count {
                var sliced: CMSampleBuffer?
                let status = CMSampleBufferCopySampleBufferForRange(allocator: kCFAllocatorDefault, sampleBuffer: sample,
                                                                    sampleRange: CFRangeMake(first, last - first),
                                                                    sampleBufferOut: &sliced)
                guard status == noErr, let sliced else { continue }
                piece = sliced
            }
            let firstMicros = Int((clock.first + Double(first) * clock.step).rounded())
            guard var chunk = retimed(piece, by: offset) else { continue }

            // The packet straddling the in point keeps its place at a negative
            // time, and says how much of it precedes the cut: the writer edits
            // that part out, so the cut is exact and the decoder still has the
            // whole packet to start from.
            let lead = base - firstMicros
            if pcm == nil, windowed, !emitted, lead > 0,
               CMGetAttachment(chunk, key: kCMSampleBufferAttachmentKey_TrimDurationAtStart, attachmentModeOut: nil) == nil,
               let trim = CMTimeCopyAsDictionary(videoTime(micros: lead), allocator: kCFAllocatorDefault) {
                CMSetAttachment(chunk, key: kCMSampleBufferAttachmentKey_TrimDurationAtStart, value: trim,
                                attachmentMode: kCMAttachmentMode_ShouldNotPropagate)
            }

            let outputMicros = firstMicros - base
            if let bed, let pcm {
                chunk = mixed(chunk, bed: bed, pcm: pcm, atMicros: outputMicros) ?? chunk
            }
            pending = AudioChunk(buffer: chunk, outputMicros: outputMicros)
            emitted = true
        }
    }

    /// The bed summed into one decoded chunk at its place on the output
    /// clock, through the kernel's `mixPlanar` (the web's channel rules and
    /// clamp). A chunk that cannot be read back is passed on untouched.
    private func mixed(_ sample: CMSampleBuffer, bed: PlanarAudio, pcm: PCMFormat, atMicros: Int) -> CMSampleBuffer? {
        let frames = CMSampleBufferGetNumSamples(sample)
        let channels = pcm.channels
        guard frames > 0, let format = CMSampleBufferGetFormatDescription(sample),
              let interleaved = interleavedFloats(sample, frames: frames, channels: channels) else { return nil }
        var planes = [[Float]](repeating: [], count: channels)
        for c in 0..<channels {
            var plane = [Float](repeating: 0, count: frames)
            for i in 0..<frames { plane[i] = interleaved[i * channels + c] }
            planes[c] = plane
        }
        let clip = PlanarAudio(sampleRate: pcm.sampleRate, channels: planes)
        let offset = max(0, Int((Double(atMicros) * pcm.sampleRate / 1_000_000).rounded()))
        let sum = mixPlanar(clip, bedSlice(bed, from: offset, count: frames))
        var out = [Float](repeating: 0, count: frames * channels)
        for c in 0..<channels {
            let plane = sum.channels[c]
            for i in 0..<frames { out[i * channels + c] = plane[i] }
        }
        return try? lpcmSampleBuffer(out, frames: frames, format: format,
                                     pts: CMSampleBufferGetPresentationTimeStamp(sample))
    }
}

/// `count` frames of `bed` from `from`, every channel — empty past its end.
private func bedSlice(_ bed: PlanarAudio, from: Int, count: Int) -> PlanarAudio {
    let channels = bed.channels.map { plane -> [Float] in
        let start = min(max(0, from), plane.count)
        let end = min(plane.count, start + max(0, count))
        return Array(plane[start..<end])
    }
    return PlanarAudio(sampleRate: bed.sampleRate, channels: channels)
}

/// An LPCM buffer's samples as interleaved Float32, when it holds that many.
private func interleavedFloats(_ sample: CMSampleBuffer, frames: Int, channels: Int) -> [Float]? {
    guard let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
    let byteCount = frames * channels * MemoryLayout<Float>.size
    guard CMBlockBufferGetDataLength(block) >= byteCount else { return nil }
    var values = [Float](repeating: 0, count: frames * channels)
    let status = values.withUnsafeMutableBytes { raw -> OSStatus in
        guard let destination = raw.baseAddress else { return -1 }
        return CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: byteCount, destination: destination)
    }
    return status == kCMBlockBufferNoErr ? values : nil
}

/// A bed the suite made, handed to the writer as LPCM in chunks at its own
/// time — no priming lead (see the header) — and cut where the footage ends.
private final class BedAudioFeed: AudioFeed {
    private let bed: PlanarAudio
    private let channels: Int
    private let format: CMAudioFormatDescription
    private let chunkFrames = 4096
    private var frame = 0
    private var endFrame: Int
    private var pending: AudioChunk?
    private var stopped = false

    init(bed: PlanarAudio, channels: Int) throws {
        self.bed = bed
        self.channels = channels
        self.endFrame = bed.length
        self.format = try lpcmFormat(sampleRate: bed.sampleRate, channels: channels)
    }

    func open(base: Int, until: Int, windowed: Bool) {
        // A bed starts at the output's zero whatever the source's clock says.
    }

    func peek() throws -> AudioChunk? {
        if pending == nil && !stopped { try make() }
        return pending
    }

    func consume() {
        pending = nil
    }

    func end(at outputMicros: Int) {
        let last = Int((Double(outputMicros) * bed.sampleRate / 1_000_000).rounded(.down))
        endFrame = min(endFrame, max(0, last))
    }

    func cancel() {
        stopped = true
        pending = nil
    }

    private func make() throws {
        let count = min(chunkFrames, endFrame - frame)
        guard count > 0 else {
            stopped = true
            return
        }
        var interleaved = [Float](repeating: 0, count: count * channels)
        for c in 0..<channels {
            let plane = bed.channels[c]
            for i in 0..<count {
                let at = frame + i
                if at < plane.count { interleaved[i * channels + c] = plane[at] }
            }
        }
        let timescale = CMTimeScale(max(1, bed.sampleRate.rounded()))
        let pts = CMTime(value: Int64(frame), timescale: timescale)
        let sample = try lpcmSampleBuffer(interleaved, frames: count, format: format, pts: pts)
        let outputMicros = Int((Double(frame) / bed.sampleRate * 1_000_000).rounded())
        pending = AudioChunk(buffer: sample, outputMicros: outputMicros)
        frame += count
    }
}

/// Interleaved, packed Float32 LPCM at `sampleRate`.
private func lpcmFormat(sampleRate: Double, channels: Int) throws -> CMAudioFormatDescription {
    let bytesPerFrame = UInt32(MemoryLayout<Float>.size * channels)
    var asbd = AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: bytesPerFrame,
        mFramesPerPacket: 1,
        mBytesPerFrame: bytesPerFrame,
        mChannelsPerFrame: UInt32(channels),
        mBitsPerChannel: 32,
        mReserved: 0
    )
    var format: CMAudioFormatDescription?
    let status = CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil,
                                                magicCookieSize: 0, magicCookie: nil, extensions: nil,
                                                formatDescriptionOut: &format)
    guard status == noErr, let format else { throw VideoExportError.writer(cannotEncodeBed) }
    return format
}

/// `frames` interleaved frames as one LPCM sample buffer stamped `pts`.
private func lpcmSampleBuffer(_ interleaved: [Float], frames: Int, format: CMAudioFormatDescription,
                              pts: CMTime) throws -> CMSampleBuffer {
    let byteCount = interleaved.count * MemoryLayout<Float>.size
    var block: CMBlockBuffer?
    var status = CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: byteCount,
                                                    blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
                                                    offsetToData: 0, dataLength: byteCount,
                                                    flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
    guard status == kCMBlockBufferNoErr, let block else { throw VideoExportError.writer(cannotEncodeBed) }
    status = interleaved.withUnsafeBytes { raw -> OSStatus in
        guard let pointer = raw.baseAddress else { return -1 }
        return CMBlockBufferReplaceDataBytes(with: pointer, blockBuffer: block, offsetIntoDestination: 0, dataLength: byteCount)
    }
    guard status == kCMBlockBufferNoErr else { throw VideoExportError.writer(cannotEncodeBed) }

    var sample: CMSampleBuffer?
    status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block,
                                                                  formatDescription: format, sampleCount: frames,
                                                                  presentationTimeStamp: pts, packetDescriptions: nil,
                                                                  sampleBufferOut: &sample)
    guard status == noErr, let sample else { throw VideoExportError.writer(cannotEncodeBed) }
    return sample
}
