// ONE export variant of the open media, rendered — the web's
// `exportVariantVideo` (`src/shared/media/export-variant.ts`), its
// `outroTail`, and `exportPhotoVariant` (`src/shared/media/photo-frame.ts`),
// over the landed pipeline (`Video/VideoExport.swift`'s
// `exportProcessedVideo`) and the painters the stage draws with — so a file
// IS the stage at another size:
//
// - a CLIP goes through the ONE video pipeline with a per-frame processor:
//   graded at its SOURCE instant and at the source's own density (the grain's
//   clock; grading after the crop would give a different result at every
//   output size), cover-cropped centred into the variant's frame, the
//   overlays burnt in relative to THAT frame (a 9:16 cut keeps its titles
//   composed for 9:16) on the Studio's clock — the SOURCE time, the trim's in
//   point as the origin; the cut, the cadence resample and the delivered
//   speed are the pipeline's; the clip's sound is COPIED (a re-timed variant
//   ships silent); the outro card is appended as the pipeline's TAIL, at the
//   variant's frame and resolved cadence, and only on a variant that burns
//   the overlays in — a clean master stays truly clean;
// - a STILL is one composite: graded at its own density, cover-cropped,
//   its SETTLED deck drawn with the photograph's one cue and no clock, a
//   JPEG at 0.92 — which then carries the ORIGINAL's EXIF (`stampExif`: the
//   block copied whole where it can be, signed `Atelier`, an sRGB profile),
//   the maintainer's rule for every delivered picture. The web's Studio still
//   leaves bare; `PARITY.md` says so.
//
// Nothing here reads the editor: a run captures what it needs once
// (`StudioRenderInput`) and every call is off the main actor.

import AVFoundation
import CoreImage
import Foundation
import AtelierKit

/// Everything a variant is drawn with, captured once when a run starts — the
/// web's `VariantRenderOptions` minus the source's size, which the pipeline
/// reads off the file itself.
struct StudioRenderInput {
    /// The deck — for a still, the stage's settled one.
    var elements: [OverlayElement]
    var cues: [Cue]
    /// The look and the media's develop, baked into ONE cube; nil draws none.
    var cube: CubeLut?
    var interpolation: Interpolation = .tetrahedral
    /// Grain and halation — the film node after the cube, on clips as on stills.
    var film: FilmTexture?
    var theme: StyleTheme?
    var timeShift: TimeShift?
    var scenes: [OverlayScene]
    /// The clip's cut; nil exports the whole clip (the exact untrimmed path).
    var trim: TrimRange?
    /// The closing card, appended after the footage of a burnt-in variant.
    var outro: OutroCard?
}

enum StudioExportError: LocalizedError {
    case nothingToExport
    case notDecoded
    case undecodable
    case unreachable(String)
    case encode
    case write(String)

    var errorDescription: String? {
        switch self {
        case .nothingToExport: return "This media has nothing to export."
        case .notDecoded: return "This photo has not been decoded yet."
        case .undecodable: return "This photo could not be decoded on this device — develop it to a JPEG or a TIFF first."
        case .unreachable(let name): return "\(name) cannot be reached on this device — point to the media folder again."
        case .encode: return "This device could not encode this still."
        case .write(let why): return why
        }
    }
}

enum StudioVariantExport {
    /// The web's still quality, `canvas.toBlob(…, 'image/jpeg', 0.92)`.
    static let stillQuality = 0.92

    // MARK: - the frame

    /// `image` cover-cropped, centred, into `width`×`height` — the web's
    /// `drawFramed(…, DEFAULT_FRAMING)`: the frame filled, the excess cropped
    /// symmetrically. A reduction is Lanczos-resampled (the graph's own
    /// resampler, `FrameGrader.resampled`); the offset is whole pixels, so
    /// the crop never blurs a frame by half a pixel.
    static func covered(_ image: CIImage, width: Int, height: Int) -> CIImage {
        var source = image
        let origin = source.extent.origin
        if origin != .zero {
            source = source.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        }
        let e = source.extent
        guard e.width > 0, e.height > 0, width > 0, height > 0 else { return source }
        let w = CGFloat(width)
        let h = CGFloat(height)
        let scale = max(w / e.width, h / e.height)
        var scaled = source
        if scale < 1 - 1e-6 {
            scaled = FrameGrader.resampled(source, scale: Double(scale)).image
        } else if scale > 1 + 1e-6 {
            scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        let s = scaled.extent
        let dx = (s.minX + (s.width - w) / 2).rounded()
        let dy = (s.minY + (s.height - h) / 2).rounded()
        let moved = scaled.transformed(by: CGAffineTransform(translationX: -dx, y: -dy))
        return moved.clampedToExtent().cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
    }

    /// The graph for this input, or nil when nothing would change a pixel —
    /// a texture with no look is still a render: the node is what draws it.
    static func grader(_ input: StudioRenderInput) -> FrameGrader? {
        let film = FilmPass(input.film)
        guard input.cube != nil || film != nil else { return nil }
        return FrameGrader(lut: input.cube, intensity: 1, interpolation: input.interpolation, film: film)
    }

    // MARK: - the outro

    /// The outro as the pipeline's tail — the web's `outroTail`: the card
    /// resolved once (the QR encode is deterministic but not free) and painted
    /// per appended frame at the variant's own size, so an animated line
    /// plays and a 9:16 cut composes its card for 9:16. Nil with no card or no
    /// time.
    static func outroTail(_ outro: OutroCard?, width: Int, height: Int) -> ExportTail<CIImage>? {
        guard let outro, outro.seconds > 0, width > 0, height > 0 else { return nil }
        let prepared = prepareOutro(outro)
        let painter = OverlayPainter()
        let blank = CIImage(color: CIColor.black).cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
        return ExportTail<CIImage>(seconds: outro.seconds) { (t: Double) -> CIImage in
            guard let card = OutroPainter.image(prepared, width: width, height: height, tSeconds: t, painter: painter) else {
                return blank
            }
            return CIImage(cgImage: card, options: [.colorSpace: NSNull()])
        }
    }

    // MARK: - a clip

    /// One variant of a clip, into a new MP4 in the temporary directory (the
    /// caller moves it where it belongs). Blocking on the decoder and the
    /// encoder in turn: call it off the main actor. A cancel (`isCancelled`)
    /// throws `CancellationError` and leaves no file.
    static func video(_ source: VideoSource, _ variant: ExportVariant, _ input: StudioRenderInput,
                      onAudioSkipped: ((String) -> Void)? = nil,
                      onProgress: ((ExportProgress) -> Void)? = nil,
                      isCancelled: @escaping () -> Bool = { false }) async throws -> URL {
        let meta = source.metadata
        let out = variantOutputSize(variant, Double(meta.displayWidth), Double(meta.displayHeight))
        let outWidth = Int(out.width)
        let outHeight = Int(out.height)
        let burns = variant.overlays

        var options = VideoExportOptions()
        options.outputSize = CGSize(width: outWidth, height: outHeight)
        options.frameRate = variant.frameRate
        options.trim = input.trim
        options.speed = variant.speed
        // A new noise field every frame is nothing a P-frame can predict, so a
        // grained clip is encoded at more bits — halation is a blur and costs
        // nothing, hence `grain` and not the whole texture.
        options.grained = (input.film?.grain ?? 0) > 0
        options.tail = burns ? outroTail(input.outro, width: outWidth, height: outHeight) : nil
        options.onAudioSkipped = onAudioSkipped

        let origin = input.trim?.start ?? 0
        let drawing = OverlayDrawOptions(timeShift: input.timeShift, cues: input.cues, scenes: input.scenes,
                                         originSeconds: origin)
        return try await exportProcessedVideo(
            source,
            makeProcessor: { ctx in
                let graph = StudioVariantExport.grader(input)
                let painter = OverlayPainter()
                let width = ctx.outputWidth
                let height = ctx.outputHeight
                return FrameProcessor(draw: { frame, t in
                    // The SOURCE instant: the grain re-rolls per source frame,
                    // and a dropped or duplicated frame carries the grain of
                    // the frame it really is.
                    let graded = graph?.render(source: frame, sourceSeconds: t) ?? frame
                    let framed = StudioVariantExport.covered(graded, width: width, height: height)
                    guard burns else { return framed }
                    // `t` is the SOURCE time; windows count from the first
                    // exported frame, which the trim moves.
                    return painter.burnIn(framed, elements: input.elements, cue: findCue(input.cues, t), time: t,
                                          theme: input.theme, options: drawing)
                })
            },
            onProgress: onProgress,
            isCancelled: isCancelled,
            options: options
        )
    }

    // MARK: - a still

    /// One variant of a still — graded at its own density, then cropped,
    /// then its settled deck — as a JPEG carrying the original's metadata.
    /// `head` is the ORIGINAL's first bytes (its EXIF), `vouched` what its
    /// source said of the capture; `now` dates a picture nobody dated.
    static func still(_ picture: CIImage, _ variant: ExportVariant, _ input: StudioRenderInput,
                      head: [UInt8]?, vouched: ExifData?, now: Double) throws -> Data {
        let e = picture.extent
        let out = variantOutputSize(variant, Double(e.width), Double(e.height))
        let width = Int(out.width)
        let height = Int(out.height)
        let graded = grader(input)?.render(source: picture) ?? picture
        let framed = covered(graded, width: width, height: height)
        // No cue list, no clock: `settleForStill` has already removed
        // everything that would have read one.
        let elements = variant.overlays ? settleForStill(input.elements) : []
        let composed: CIImage
        if elements.isEmpty {
            composed = framed
        } else {
            let drawing = OverlayDrawOptions(timeShift: input.timeShift, originSeconds: 0)
            composed = OverlayPainter().burnIn(framed, elements: elements, cue: input.cues.first, time: 0,
                                               theme: input.theme, options: drawing)
        }
        guard let image = FrameGrader.cgImage(composed),
              let jpeg = StudioEditor.jpeg(image, quality: stillQuality) else {
            throw StudioExportError.encode
        }
        let delivered = Size(Double(width), Double(height))
        let exif = exportExifBlock(head, vouched, delivered, AuthorMeta(), now: now)
        return try stampExif(jpeg, exif, delivered)
    }

    // MARK: - where a file lands

    /// A finished file moved into `folder` under `name`, replacing a file of
    /// that name — the web's `writeItems(dir, …, { replace: true })`.
    static func move(_ temporary: URL, named name: String, into folder: URL) throws -> URL {
        let destination = folder.appendingPathComponent(name)
        let files = FileManager.default
        do {
            if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
            try files.moveItem(at: temporary, to: destination)
        } catch {
            try? files.removeItem(at: temporary)
            throw StudioExportError.write("\(name) could not be written into \(folder.lastPathComponent) — \(error.localizedDescription)")
        }
        return destination
    }

    /// A rendered still written into `folder` under `name`, replacing.
    static func write(_ data: Data, named name: String, into folder: URL) throws -> URL {
        let destination = folder.appendingPathComponent(name)
        do {
            try data.write(to: destination, options: .atomic)
        } catch {
            throw StudioExportError.write("\(name) could not be written into \(folder.lastPathComponent) — \(error.localizedDescription)")
        }
        return destination
    }

    /// A file's size on disk, 0 when it cannot be read.
    static func bytes(_ url: URL) -> Int {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.intValue ?? 0
    }
}
