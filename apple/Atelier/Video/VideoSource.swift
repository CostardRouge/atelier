// A clip opened for reading: its facts and its frames. Replaces the web's
// `src/shared/media/video-metadata.ts` (size, duration, cadence, codec —
// `loadClipMeta` + `probeContainer`) and the demux → decode half of
// `webcodecs-export.ts` (mp4box → `VideoDecoder` → frames with their
// presentation times), on AVFoundation and Core Image.
//
// What AVFoundation changes, and what it does not:
//  - HEVC decodes natively (VideoToolbox), so `transcode.ts` — ffmpeg.wasm
//    turning HEVC into H.264 for a browser that cannot decode it — has NO
//    port and never will: there is nothing to escape from. The web's
//    `DecodeUnsupportedError` and its `isHevc` flag go with it; a codec the
//    device cannot decode surfaces as `VideoSourceError.unreadable`, carrying
//    the platform's own sentence.
//  - The asset's timeline already applies the edit list, so a B-framed file
//    whose samples start late — `TrimWindow.leadMicros` on the web, the trap
//    that cut every B-framed clip two frames short — is read on the AUTHOR'S
//    clock, from its first presented frame. The lead is 0 here by
//    construction, and the seconds a frame carries are the ones a trim was
//    picked on.
//  - Frames come out in PRESENTATION order, decoded from the sync sample
//    before the window by the reader itself: two of the three rules
//    `trimWindow` spells out (start at the keyframe; decode far enough for
//    late-presented frames) are the reader's own. The third stays the
//    caller's — the cut opens on the frame that COVERS the in point — which
//    is why a windowed read starts two frames early and `exportProcessedVideo`
//    drops what ends before its edge.
//  - The decoded codes are LABELLED sRGB, never converted: the web draws a
//    decoded frame's R'G'B' codes straight into its canvas and its cube, and
//    Chrome relabels bt709 ↔ sRGB rather than resampling the curve
//    (media-pipeline.md, «Exports already carry a colr tag»). Tagging the
//    frame sRGB for Core Image makes an untouched pixel come back with the
//    codes it went in with, and hands the develop cube (`PictureRenderer`'s
//    `CIColorCubeWithColorSpace` on sRGB) the very codes the web's shader reads.
//  - HDR (HLG, PQ, Dolby Vision) is SAID in the metadata and never handled:
//    the pipeline is SDR bt709 by construction, as the web's
//    (media-pipeline.md, «HDR is not handled» — a ruling about VIDEO, which
//    stands). A source that is not plain 709 is converted to 709 by the reader
//    (`AVVideoColorPropertiesKey` on its output), which is the honest native
//    form of the web's "silently flattened" — and, unlike the web, the flag
//    is there for a panel to say so.

import AVFoundation
import CoreImage
import ImageIO
import AtelierKit

enum VideoSourceError: LocalizedError {
    case noVideoTrack
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .noVideoTrack: return "This file has no video track."
        case .unreadable(let why): return why
        }
    }
}

// MARK: - colour

/// What every export says about its colour, in the web's own words — the
/// record Chrome's encoder reports for a canvas-sourced frame (media-pipeline.md).
let exportColourSpace = VideoColorSpaceInit(primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false)

/// `AVVideoColorPropertiesKey`'s dictionary for a colour space — or nil, so no
/// tag is written at all. All-or-nothing through the kernel's own guard
/// (`isEncodableColorSpace`, `ColourTag.swift`): a partial tag is a WRONG
/// claim, not a partial improvement. A full-range claim is refused too — the
/// writer's BGRA → Y'CbCr conversion is video range and the dictionary has no
/// key to say otherwise, so writing "full" would be a lie about the file.
func videoColourProperties(_ cs: VideoColorSpaceInit?) -> [String: Any]? {
    guard isEncodableColorSpace(cs), let cs else { return nil }
    guard cs.fullRange == false else { return nil }
    let primaries: String
    switch cs.primaries {
    case "bt709": primaries = AVVideoColorPrimaries_ITU_R_709_2
    case "smpte170m": primaries = AVVideoColorPrimaries_SMPTE_C
    default: return nil
    }
    let transfer: String
    switch cs.transfer {
    // SMPTE 170M's curve IS 709's; AVFoundation names it once.
    case "bt709", "smpte170m": transfer = AVVideoTransferFunction_ITU_R_709_2
    default: return nil
    }
    let matrix: String
    switch cs.matrix {
    case "bt709": matrix = AVVideoYCbCrMatrix_ITU_R_709_2
    case "bt470bg", "smpte170m": matrix = AVVideoYCbCrMatrix_ITU_R_601_4
    default: return nil
    }
    return [
        AVVideoColorPrimariesKey: primaries,
        AVVideoTransferFunctionKey: transfer,
        AVVideoYCbCrMatrixKey: matrix,
    ]
}

/// The one colour space the decoded codes are labelled with (see the header).
let videoCodesColourSpace: CGColorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

// MARK: - time

/// A CMTime in whole microseconds — the web's `toMicros`, rounded the same
/// way (a half away from zero, which is `Math.round` for every time ≥ 0).
func videoMicros(_ t: CMTime) -> Int {
    guard t.isValid, t.isNumeric else { return 0 }
    return Int(CMTimeConvertScale(t, timescale: 1_000_000, method: .roundHalfAwayFromZero).value)
}

/// Microseconds back into a CMTime, exactly.
func videoTime(micros: Int) -> CMTime {
    CMTime(value: Int64(micros), timescale: 1_000_000)
}

/// Seconds into whole microseconds, `Math.round`'s way.
func videoMicros(seconds: Double) -> Int {
    guard seconds.isFinite else { return 0 }
    return Int((seconds * 1_000_000).rounded(.toNearestOrAwayFromZero))
}

// MARK: - facts

private func fourCC(_ code: UInt32) -> String {
    let bytes = [
        UInt8((code >> 24) & 0xff), UInt8((code >> 16) & 0xff),
        UInt8((code >> 8) & 0xff), UInt8(code & 0xff),
    ]
    let text = String(bytes: bytes, encoding: .isoLatin1) ?? String(code)
    return text.trimmingCharacters(in: .whitespaces)
}

/// What the format description says about the colour — its own words
/// (`ITU_R_709_2`, `ITU_R_2020`, `SMPTE_ST_2084_PQ`…), nil where it says nothing.
struct VideoColour: Equatable {
    let primaries: String?
    let transfer: String?
    let matrix: String?
    let fullRange: Bool?

    static let unsaid = VideoColour(primaries: nil, transfer: nil, matrix: nil, fullRange: nil)

    /// The transfer is HLG or PQ.
    var isHDRTransfer: Bool {
        guard let transfer else { return false }
        let hlg = kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG as String
        let pq = kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ as String
        return transfer == hlg || transfer == pq
    }

    /// Plain Rec.709, or unsaid — which every SDR camera file means. The reader
    /// converts nothing for these; anything else is converted to 709.
    var isRec709OrUnsaid: Bool {
        let p709 = kCMFormatDescriptionColorPrimaries_ITU_R_709_2 as String
        let t709 = kCMFormatDescriptionTransferFunction_ITU_R_709_2 as String
        let primariesFine = primaries == nil || primaries == p709
        let transferFine = transfer == nil || transfer == t709
        return primariesFine && transferFine
    }
}

struct AudioTrackInfo: Equatable {
    let formatID: AudioFormatID
    let sampleRate: Double
    let channels: Int

    /// The four characters of the format (`aac `, `lpcm`, `ac-3`…).
    var codec: String { fourCC(formatID) }

    /// Carried into an MP4 as it is — the copy the pipeline makes by default.
    /// A PCM track (a Sony XAVC S file, a `.mov` from a recorder) is not, and
    /// is encoded to AAC with a sentence that says so.
    var isMP4Passthrough: Bool {
        switch formatID {
        case kAudioFormatMPEG4AAC, kAudioFormatMPEG4AAC_HE, kAudioFormatMPEG4AAC_HE_V2,
             kAudioFormatAC3, kAudioFormatEnhancedAC3:
            return true
        default:
            return false
        }
    }
}

struct VideoMetadata {
    /// The decoder's raw frame, un-rotated — the web's `codedWidth/Height`.
    let codedWidth: Int
    let codedHeight: Int
    /// The container's display rotation, clockwise degrees: 0, 90, 180 or 270
    /// (the kernel's `rotationFromMatrix` over the track's transform).
    let rotation: Int
    let preferredTransform: CGAffineTransform
    /// Seconds, the asset's own (edits applied).
    let duration: Double
    /// The track's nominal cadence (29.97, 59.94…), unrounded.
    let nominalFrameRate: Double
    /// Four characters: `avc1`, `hvc1`, `hev1`, `ap4h`…
    let codec: String
    let bitDepth: Int?
    let colour: VideoColour
    /// The track declares HDR (`AVMediaCharacteristic.containsHDRVideo`) —
    /// Dolby Vision included, which a transfer function alone may not say.
    let declaresHDR: Bool
    let audio: AudioTrackInfo?

    /// Display-oriented size — what the stage shows and a composition frames.
    var displayWidth: Int { rotation == 90 || rotation == 270 ? codedHeight : codedWidth }
    var displayHeight: Int { rotation == 90 || rotation == 270 ? codedWidth : codedHeight }
    var isHEVC: Bool { codec == "hvc1" || codec == "hev1" || codec == "dvh1" || codec == "dvhe" }
    /// Said on screen, never handled: the export is SDR bt709 and flattens it.
    var isHDR: Bool { declaresHDR || colour.isHDRTransfer }
    var hasAudio: Bool { audio != nil }
    /// The cadence the pipelines measure: the nominal rate rounded, at least 1
    /// — the web's `sourceFramerate`, which `resolveFrameRate` compares against.
    var sourceFrameRate: Double { Double(resolveFrameRate(nil, nominalFrameRate)) }
}

/// One decoded frame: the picture over its BGRA buffer, and WHEN it is — the
/// source's presentation time, the author's clock (the one a trim is picked
/// on), in seconds for a painter and in whole microseconds for the plan.
struct VideoFrame {
    let image: CIImage
    let seconds: Double
    let micros: Int
    let durationMicros: Int
    let pixelBuffer: CVPixelBuffer
}

final class VideoSource {
    let url: URL
    let asset: AVURLAsset
    let videoTrack: AVAssetTrack
    let audioTrack: AVAssetTrack?
    let metadata: VideoMetadata
    /// The tracks' own formats — the audio one is the passthrough input's hint.
    let videoFormat: CMFormatDescription?
    let audioFormat: CMFormatDescription?

    private init(url: URL, asset: AVURLAsset, videoTrack: AVAssetTrack, audioTrack: AVAssetTrack?,
                 metadata: VideoMetadata, videoFormat: CMFormatDescription?, audioFormat: CMFormatDescription?) {
        self.url = url
        self.asset = asset
        self.videoTrack = videoTrack
        self.audioTrack = audioTrack
        self.metadata = metadata
        self.videoFormat = videoFormat
        self.audioFormat = audioFormat
    }

    /// Open a clip: its tracks and their facts, loaded asynchronously. Nothing
    /// is decoded here; the duration is asked for precisely, so a camera file
    /// whose `moov` sits at the end is read to the end once.
    static func open(_ url: URL) async throws -> VideoSource {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        guard let video = videoTracks.first else { throw VideoSourceError.noVideoTrack }
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let audio = audioTracks.first

        let (naturalSize, transform) = try await video.load(.naturalSize, .preferredTransform)
        let (nominalFps, videoFormats) = try await video.load(.nominalFrameRate, .formatDescriptions)
        let characteristics = try await video.load(.mediaCharacteristics)
        let videoFormat = videoFormats.first

        var codedWidth = Int(naturalSize.width.rounded())
        var codedHeight = Int(naturalSize.height.rounded())
        var codec = ""
        var bitDepth: Int? = nil
        var colour = VideoColour.unsaid
        if let format = videoFormat {
            let dims = CMVideoFormatDescriptionGetDimensions(format)
            if dims.width > 0 && dims.height > 0 {
                codedWidth = Int(dims.width)
                codedHeight = Int(dims.height)
            }
            codec = fourCC(CMFormatDescriptionGetMediaSubType(format))
            bitDepth = extensionInt(format, kCMFormatDescriptionExtension_BitsPerComponent)
            colour = VideoColour(
                primaries: extensionString(format, kCMFormatDescriptionExtension_ColorPrimaries),
                transfer: extensionString(format, kCMFormatDescriptionExtension_TransferFunction),
                matrix: extensionString(format, kCMFormatDescriptionExtension_YCbCrMatrix),
                fullRange: extensionBool(format, kCMFormatDescriptionExtension_FullRangeVideo)
            )
        }

        var audioInfo: AudioTrackInfo? = nil
        var audioFormat: CMFormatDescription? = nil
        if let audio {
            let formats = try await audio.load(.formatDescriptions)
            audioFormat = formats.first
            if let format = audioFormat, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
                audioInfo = AudioTrackInfo(formatID: asbd.mFormatID, sampleRate: asbd.mSampleRate,
                                           channels: Int(asbd.mChannelsPerFrame))
            }
        }

        let seconds = duration.isValid && duration.isNumeric ? duration.seconds : 0
        let metadata = VideoMetadata(
            codedWidth: codedWidth,
            codedHeight: codedHeight,
            rotation: rotationFromMatrix([Double(transform.a), Double(transform.b)]),
            preferredTransform: transform,
            duration: max(0, seconds),
            nominalFrameRate: Double(nominalFps),
            codec: codec,
            bitDepth: bitDepth,
            colour: colour,
            declaresHDR: characteristics.contains(.containsHDRVideo),
            audio: audioInfo
        )
        return VideoSource(url: url, asset: asset, videoTrack: video, audioTrack: audio,
                           metadata: metadata, videoFormat: videoFormat, audioFormat: audioFormat)
    }

    /// The frames of `[start, end]` in presentation order — nil `end` reads to
    /// the last one. `upright` applies the container's rotation to the pixels
    /// (the web's `bakeRotation`); off, the frame is the decoder's coded
    /// orientation and the rotation is the caller's to carry as a flag.
    func frames(from start: Double = 0, to end: Double? = nil, upright: Bool = false) throws -> VideoFrameReader {
        try VideoFrameReader(source: self, from: start, to: end, upright: upright)
    }

    /// Seconds of one frame at the clip's own cadence (1/30 when it says none).
    var frameSeconds: Double {
        let nominal = metadata.nominalFrameRate
        return 1 / (nominal.isFinite && nominal > 0 ? nominal : 30)
    }

    // MARK: format extensions

    private static func extensionString(_ format: CMFormatDescription, _ key: CFString) -> String? {
        guard let value = CMFormatDescriptionGetExtension(format, extensionKey: key) else { return nil }
        return value as? String
    }

    private static func extensionBool(_ format: CMFormatDescription, _ key: CFString) -> Bool? {
        guard let value = CMFormatDescriptionGetExtension(format, extensionKey: key) else { return nil }
        return value as? Bool
    }

    private static func extensionInt(_ format: CMFormatDescription, _ key: CFString) -> Int? {
        guard let value = CMFormatDescriptionGetExtension(format, extensionKey: key) else { return nil }
        return value as? Int
    }
}

/// A windowed read of a clip's frames, in presentation order — `AVAssetReader`
/// under it. The reader seeks to the sync sample before the window and decodes
/// forward, delivering only what falls inside it; it is asked to start two
/// frames EARLY so the frame that covers the in point is among what comes out,
/// and the caller drops what ends before its edge (`exportProcessedVideo`).
///
/// Blocking: `next()` waits for the decoder. Drive it off the main actor.
final class VideoFrameReader {
    private let reader: AVAssetReader
    private let output: AVAssetReaderTrackOutput
    private let orientation: CGImagePropertyOrientation?
    private let fallbackDurationMicros: Int
    private var started = false
    private var finished = false

    init(source: VideoSource, from start: Double, to end: Double?, upright: Bool) throws {
        let reader: AVAssetReader
        do {
            reader = try AVAssetReader(asset: source.asset)
        } catch {
            throw VideoSourceError.unreadable(error.localizedDescription)
        }
        var settings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ]
        // A source that is not plain 709 (HLG, PQ, 2020, P3) is converted on
        // the way in — HDR to SDR by the platform — because everything
        // downstream is bt709 by construction. A 709 clip takes the plainest
        // path and is converted by nothing.
        if !source.metadata.colour.isRec709OrUnsaid || source.metadata.isHDR,
           let rec709 = videoColourProperties(exportColourSpace) {
            settings[AVVideoColorPropertiesKey] = rec709
        }
        let output = AVAssetReaderTrackOutput(track: source.videoTrack, outputSettings: settings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else {
            throw VideoSourceError.unreadable("This clip's video cannot be decoded on this device.")
        }
        reader.add(output)

        let lead = 2 * source.frameSeconds
        let from = videoTime(micros: max(0, videoMicros(seconds: start - lead)))
        let to: CMTime = end.map { videoTime(micros: max(0, videoMicros(seconds: $0 + lead))) } ?? .positiveInfinity
        reader.timeRange = CMTimeRange(start: from, end: to)

        self.reader = reader
        self.output = output
        self.fallbackDurationMicros = videoMicros(seconds: source.frameSeconds)
        switch upright ? source.metadata.rotation : 0 {
        case 90: orientation = .right
        case 180: orientation = .down
        case 270: orientation = .left
        default: orientation = nil
        }
    }

    deinit {
        if reader.status == .reading { reader.cancelReading() }
    }

    /// The next frame, or nil past the window's end. Throws once, when the
    /// reader itself failed (a codec the device does not decode, a file that
    /// went away).
    func next() throws -> VideoFrame? {
        if finished { return nil }
        if !started {
            started = true
            guard reader.startReading() else {
                finished = true
                throw VideoSourceError.unreadable(reader.error?.localizedDescription ?? "The clip could not be read.")
            }
        }
        while true {
            guard let sample = output.copyNextSampleBuffer() else {
                finished = true
                if reader.status == .failed {
                    throw VideoSourceError.unreadable(reader.error?.localizedDescription ?? "The clip could not be decoded.")
                }
                return nil
            }
            // A sample with no picture (a marker, an empty edit) is skipped.
            guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
            let measured = videoMicros(CMSampleBufferGetDuration(sample))
            let duration = measured > 0 ? measured : fallbackDurationMicros
            var image = CIImage(cvPixelBuffer: buffer, options: [.colorSpace: videoCodesColourSpace])
            if let orientation {
                image = image.oriented(orientation)
                let origin = image.extent.origin
                if origin != .zero {
                    image = image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
                }
            }
            return VideoFrame(image: image, seconds: pts.seconds, micros: videoMicros(pts),
                              durationMicros: duration, pixelBuffer: buffer)
        }
    }

    /// Stop decoding now. Safe to call twice, and after the end.
    func cancel() {
        finished = true
        if reader.status == .reading { reader.cancelReading() }
    }
}
