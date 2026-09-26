// SUBJECT masks — "what is this, as opposed to its surroundings", answered by
// a model — on Apple's own: Vision's `VNGenerateForegroundInstanceMaskRequest`
// (iOS 17 / macOS 14, the app's floor). The web answers the same question with
// MediaPipe's `magic_touch` (`src/shared/segment/segmenter.ts`,
// `src/shared/develop/use-subject-masks.ts`, `subject-rasters.ts`); this is
// never a port of that model, it is the platform's.
//
// The rules kept from the web (`subject-picking.md`, `render-layers.md`):
//
// - The document stores the REQUEST — the points the author tapped and the
//   model id — never the pixels. Here the model finds every foreground
//   INSTANCE of the picture once, and a layer keeps the instances under its
//   stored points (a union: a second point ADDS its instance, as a second
//   tap does on the web). The map is cached per picture + model + points and
//   is never written anywhere.
// - The model is shown the picture AS THE STAGE SHOWS IT — the source bent by
//   the picture's geometry (camera warp, lens, keystone), before any layer —
//   because a tap and the layer pass both live in that warped frame
//   (`segment-view.ts`, 2026-09-24). A RAW is shown through its own cube,
//   since half-float sensor data is nothing a model can read. Small on
//   purpose: 1024 px on the long edge (`SEGMENT_INPUT_LONG_EDGE`), the
//   painted mask's own density.
// - A DELIVERY segments its subjects itself (`forRender`): what the stage
//   resolved asynchronously needs its own path in the export, or every
//   Subject layer silently leaves the file (the web's 2026-09-23 bug).
// - A layer whose subject has not answered, or cannot be answered, draws
//   NOTHING, and a subtraction of it subtracts nothing — the kernel's rules
//   (`LayerRender.swift`). Where Vision cannot run at all (the Simulator), the
//   resolution SAYS so, once, and the layers draw without their subject
//   rather than the render failing.
//
// Two differences from the web, recorded rather than hidden:
// - a point that lands on NO foreground instance selects nothing (Vision
//   segments salient subjects; `magic_touch` segments whatever is under the
//   finger), within a tap's reach of `tapReach` texels of the instance map;
// - the map is SOFT (Vision's scaled mask, 0…1 at the edge) where the web's
//   category mask is 0 or 255.

import AtelierKit
import CoreImage
import CoreVideo
import Foundation
import Vision

/// What a model found in one picture: its instance map, and a way to draw the
/// mask of any set of its instances.
struct SubjectInstances {
    /// 0 for the background, n for instance n; row-major from the TOP.
    let labels: [UInt8]
    let width: Int
    let height: Int
    /// The soft mask of `instances`, at the size of the picture the model was shown.
    let mask: (IndexSet) throws -> CIImage
}

/// Whatever segments a picture into instances — Vision in the app, a stand-in in the gate.
protocol SubjectSegmenter {
    func instances(in view: CGImage) throws -> SubjectInstances
}

enum SubjectMaskError: Error, CustomStringConvertible {
    /// The model cannot run here, or refused this picture — in words for the stage.
    case unavailable(String)

    var description: String {
        switch self {
        case .unavailable(let why): return why
        }
    }
}

/// Vision's foreground-instance model.
struct VisionSubjectSegmenter: SubjectSegmenter {
    func instances(in view: CGImage) throws -> SubjectInstances {
        #if targetEnvironment(simulator)
        throw SubjectMaskError.unavailable(
            "Vision's subject model does not run in the Simulator — a Subject layer draws nothing here")
        #else
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: view, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw SubjectMaskError.unavailable("Vision could not look for a subject (\(error.localizedDescription))")
        }
        guard let observation = request.results?.first else {
            // The model answered, and found no subject in the picture at all.
            return SubjectInstances(labels: [], width: 0, height: 0) { _ in
                throw SubjectMaskError.unavailable("Vision found no subject in this picture")
            }
        }
        let map = SubjectMasks.labels(of: observation.instanceMask)
        return SubjectInstances(labels: map.labels, width: map.width, height: map.height) { instances in
            let buffer = try observation.generateScaledMaskForImage(forInstances: instances, from: handler)
            return SubjectMasks.image(from: buffer)
        }
        #endif
    }
}

final class SubjectMasks {
    /// The model a raster made here comes from — part of every cache key, as
    /// `SubjectMask.model` is on the web, so a map from another model is never
    /// served as current. A document's own stored id (the web's
    /// `mediapipe/magic_touch@1`) names the model that answered THERE; the
    /// points are what travel, and they are answered here by this one.
    static let model = "apple/vision-foreground-instances@1"

    /// The long edge the model is shown — `SEGMENT_INPUT_LONG_EDGE`.
    static let inputLongEdge = 1024

    /// How far, in texels of the instance map, a point may land off an
    /// instance and still pick it — a finger on a subject's very edge, where
    /// the map (coarser than the picture) has already turned to background.
    static let tapReach = 2

    /// What one resolve found.
    struct Resolution {
        /// Each subject layer's map, by layer id — what `LayerPasses` injects.
        var images: [String: CIImage] = [:]
        /// Why no subject could be segmented at all, in words; nil when the model ran.
        var unavailable: String?
        /// The layers whose points landed on no instance, and so draw nothing.
        var missed: [String] = []
    }

    private let segmenter: SubjectSegmenter
    private let lock = NSLock()
    /// The model's answer per picture key, most recent first.
    private var answers: [(key: String, instances: SubjectInstances)] = []
    /// Why a picture could not be segmented, so a repaint does not ask again.
    private var refused: [String: String] = [:]
    /// Each layer's map, by picture + model + points, most recent first.
    private var maps: [(key: String, image: CIImage)] = []
    private var said: Set<String> = []

    static let picturesKept = 4
    static let mapsKept = 32

    init(segmenter: SubjectSegmenter = VisionSubjectSegmenter()) {
        self.segmenter = segmenter
    }

    /// The subject maps `layers` need on one picture.
    ///
    /// `picture` names the picture AND the frame the model is shown — a new
    /// geometry is a new key, since a subject is re-segmented from the same
    /// spot on the new picture, like every other mask kind staying where it
    /// was drawn. `view` is asked only when this picture has no answer yet
    /// (`SubjectMasks.view(of:)` makes it). `forRender` asks only for what a
    /// DELIVERY draws (`subjectLayersForRender`); the stage asks for every
    /// visible subject with a point, drawing or not (`subjectLayersToSegment`),
    /// so a tap on a fresh layer segments before any slider moves.
    ///
    /// Synchronous, and a model run is slow: call it off the main thread. The
    /// stage renders without the subject meanwhile, which draws nothing.
    func resolve(_ layers: [AdjustLayer]?, picture: String, forRender: Bool = false,
                 view: () -> CGImage?) -> Resolution {
        let wanted = forRender ? subjectLayersForRender(layers) : subjectLayersToSegment(layers)
        var out = Resolution()
        guard !wanted.isEmpty else { return out }

        var answer: SubjectInstances?
        for layer in wanted {
            guard case .subject(let subject)? = layer.mask, !subject.points.isEmpty else { continue }
            let key = SubjectMasks.key(picture, subject.points)
            if let held = heldMap(key) {
                out.images[layer.id] = held
                continue
            }
            if answer == nil {
                switch instances(picture, view: view) {
                case .success(let found): answer = found
                case .failure(let error):
                    out.unavailable = error.description
                    say(error.description, picture: picture)
                    return out
                }
            }
            guard let found = answer else { continue }
            let picked = SubjectMasks.instancesUnder(subject.points, labels: found.labels,
                                                     width: found.width, height: found.height)
            if picked.isEmpty {
                out.missed.append(layer.id)
                continue
            }
            do {
                let image = try found.mask(picked)
                keepMap(key, image)
                out.images[layer.id] = image
            } catch {
                out.missed.append(layer.id)
                say("\(error)", picture: picture)
            }
        }
        return out
    }

    /// Forget one picture's answer and maps — its geometry changed, or it left the roll.
    func forget(picture: String) {
        lock.lock()
        defer { lock.unlock() }
        answers.removeAll { $0.key == picture }
        refused[picture] = nil
        let prefix = picture + "\u{1}"
        maps.removeAll { $0.key.hasPrefix(prefix) }
    }

    // MARK: - what the model is shown

    /// The picture as the model must see it: `source` through the picture's
    /// GEOMETRY alone (and, for a RAW, its own cube), fitted within
    /// `inputLongEdge` — never enlarged — and rendered to 8-bit sRGB codes, the
    /// form a model reads. The web's `segmentationView`.
    static func view(of source: CIImage, geometry: [RenderPass] = [], lut: CubeLut? = nil,
                     context: CIContext = RenderContexts.shared) -> CGImage? {
        let grader = FrameGrader(lut: lut, after: geometry)
        let edge = CGFloat(inputLongEdge)
        return grader.image(source, size: CGSize(width: edge, height: edge), context: context)
    }

    // MARK: - pure halves, for the gate

    /// The instances under the author's points: the label at each point of
    /// the map (points in [0,1] of the frame, from the top left), or — where
    /// that is background — the nearest instance within `reach` texels. A
    /// point on nothing picks nothing.
    static func instancesUnder(_ points: [AtelierKit.Point], labels: [UInt8], width: Int, height: Int,
                               reach: Int = tapReach) -> IndexSet {
        var picked = IndexSet()
        guard width > 0, height > 0, labels.count >= width * height else { return picked }
        for point in points {
            guard point.x.isFinite, point.y.isFinite else { continue }
            let px = min(width - 1, max(0, Int((point.x * Double(width)).rounded(.down))))
            let py = min(height - 1, max(0, Int((point.y * Double(height)).rounded(.down))))
            let here = labels[py * width + px]
            if here != 0 {
                picked.insert(Int(here))
                continue
            }
            var best: (distance: Int, label: UInt8)?
            for dy in -reach...reach {
                for dx in -reach...reach {
                    let x = px + dx
                    let y = py + dy
                    guard x >= 0, y >= 0, x < width, y < height else { continue }
                    let label = labels[y * width + x]
                    guard label != 0 else { continue }
                    let d = dx * dx + dy * dy
                    if best == nil || d < best!.distance { best = (d, label) }
                }
            }
            if let best { picked.insert(Int(best.label)) }
        }
        return picked
    }

    /// A model's mask buffer as the layer kernel reads a raster: the value in
    /// the red channel, the first row at the top, no colour space — the
    /// numbers are the model's own.
    static func image(from buffer: CVPixelBuffer) -> CIImage {
        CIImage(cvPixelBuffer: buffer, options: [.colorSpace: NSNull()])
    }

    /// An 8-bit instance map read out of its buffer, row-major from the top.
    static func labels(of buffer: CVPixelBuffer) -> (labels: [UInt8], width: Int, height: Int) {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let row = CVPixelBufferGetBytesPerRow(buffer)
        guard let base = CVPixelBufferGetBaseAddress(buffer), width > 0, height > 0 else { return ([], 0, 0) }
        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var out = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height {
            for x in 0..<width {
                out[y * width + x] = bytes[y * row + x]
            }
        }
        return (out, width, height)
    }

    /// A map's cache key: the picture, the model, and the points in order.
    static func key(_ picture: String, _ points: [AtelierKit.Point]) -> String {
        let spelled = points.map { "\($0.x),\($0.y)" }.joined(separator: ";")
        return "\(picture)\u{1}\(model)\u{1}\(spelled)"
    }

    // MARK: - the caches

    private func heldMap(_ key: String) -> CIImage? {
        lock.lock()
        defer { lock.unlock() }
        guard let index = maps.firstIndex(where: { $0.key == key }) else { return nil }
        let hit = maps.remove(at: index)
        maps.insert(hit, at: 0)
        return hit.image
    }

    private func keepMap(_ key: String, _ image: CIImage) {
        lock.lock()
        defer { lock.unlock() }
        maps.removeAll { $0.key == key }
        maps.insert((key, image), at: 0)
        if maps.count > SubjectMasks.mapsKept { maps.removeLast(maps.count - SubjectMasks.mapsKept) }
    }

    private func instances(_ picture: String, view: () -> CGImage?) -> Result<SubjectInstances, SubjectMaskError> {
        lock.lock()
        if let why = refused[picture] {
            lock.unlock()
            return .failure(.unavailable(why))
        }
        if let index = answers.firstIndex(where: { $0.key == picture }) {
            let hit = answers.remove(at: index)
            answers.insert(hit, at: 0)
            lock.unlock()
            return .success(hit.instances)
        }
        lock.unlock()

        // The model runs outside the lock: it is slow, and a second picture
        // asking meanwhile must not wait on this one.
        let result: Result<SubjectInstances, SubjectMaskError>
        if let shown = view() {
            do {
                result = .success(try segmenter.instances(in: shown))
            } catch let error as SubjectMaskError {
                result = .failure(error)
            } catch {
                result = .failure(.unavailable("the subject model failed (\(error.localizedDescription))"))
            }
        } else {
            result = .failure(.unavailable("the picture could not be rendered for the subject model"))
        }

        lock.lock()
        defer { lock.unlock() }
        switch result {
        case .success(let found):
            answers.removeAll { $0.key == picture }
            answers.insert((picture, found), at: 0)
            if answers.count > SubjectMasks.picturesKept { answers.removeLast(answers.count - SubjectMasks.picturesKept) }
        case .failure(let error):
            refused[picture] = error.description
        }
        return result
    }

    /// Say why a subject could not be had — once per picture, never in silence.
    private func say(_ why: String, picture: String) {
        lock.lock()
        let first = said.insert(picture + "\u{1}" + why).inserted
        lock.unlock()
        if first { NSLog("%@", "[subject] \(why) — the layer draws without its subject") }
    }
}
