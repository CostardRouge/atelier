// The picture a DEVELOP SHEET works on — the web's `useDevelopPicture` as
// `DevelopSheet.tsx` drives it (`src/shared/develop/use-develop-picture.ts`),
// for the two hosts that open the sheet over one picture: the Studio's Grade
// tab and Trips' Picture tab. The Develop tool keeps its own stage
// (`DevelopStageView` over `RollEditor`), whose rules this one copies rather
// than shares a store with: a roll's picture and a host's picture are
// different documents, and the tool's behaviour stays exactly what it was.
//
// What a host ADAPTS is small (`develop.md`, «The workbench is shared blocks»):
// it decodes its picture its own way and hands it over (`load`), holds the
// draft in its own state, and says how it GRADES — its own grader, the look
// on its own rung (`DevelopSheetGrading`). Everything else is the sheet's,
// the same in both hosts:
//
// - rendered ONCE per change, off the main actor, one render in flight and
//   one owed, so a slider dragged at sixty steps a second never queues work;
// - the histogram is the picture as it will be delivered; the clipping (`J`)
//   is painted over what is SHOWN only, never measured (`develop-roll.md`);
// - the compare reads BEFORE → AFTER, left to right: the picture as shot to
//   the LEFT of the divider, the corrected one on its right, no split is 0;
//   it is a SWITCH (`A/B`, remembered on this device), it is SUSPENDED while
//   the grey dropper holds the pointer, and the wipe is remembered, never
//   reset, underneath;
// - the Looking zoom is the Develop stage's own (`LookingZoom`: to 4000 %,
//   one pixel per device pixel a landmark, smooth ↔ pixels past it);
// - the grey dropper reads the picture AS SHOT through the sheet's own
//   geometry, so no framing or zoom can misplace the pixel read;
// - the fidelity chip is computed HERE, from the file and the pixels the host
//   measured (`develop.md`, «The sheet says it, not its hosts»), so the two
//   sheets and the tool cannot say different things about one file;
// - the session's develop clipboard is watched here, so Paste is enabled the
//   moment another host copies.

import CoreGraphics
import CoreImage
import Foundation
import Observation
import AtelierKit

/// One render of the sheet's picture, as a host's grade draws it.
struct DevelopSheetGraded {
    /// The recipe: the source through the draft develop, then the host's look.
    let image: CIImage
    /// Anything changed a pixel — otherwise there is nothing to compare.
    let changed: Bool
}

/// A host's grade for ONE draft: built on the main actor, run off it.
typealias DevelopSheetJob = @Sendable (CIImage) -> DevelopSheetGraded

/// How a host grades the sheet's picture — the seam each host adapts.
protocol DevelopSheetGrading {
    /// `develop` FIRST, then whatever the host lays over it (the look this
    /// picture wears, its film), through the host's own grader.
    func job(for develop: DevelopSettings) -> DevelopSheetJob
}

/// The grade both hosts wear under the draft (`DevelopSheet`'s `stack`): the
/// look resolved on its rung, baked WITH the develop into one cube — the
/// correction before the look, on screen as in the cube — and the grade's
/// film after it.
struct DevelopSheetLook: DevelopSheetGrading {
    let look: ResolvedLook?
    let film: FilmTexture?
    let grader: FrameGrader
    let interpolation: Interpolation

    func job(for develop: DevelopSettings) -> DevelopSheetJob {
        let look = self.look
        let film = self.film
        let grader = self.grader
        let interpolation = self.interpolation
        return { source in
            let cube: CubeLut?
            if let look {
                cube = look.cube(develop: develop, interpolation: interpolation)
            } else {
                cube = composeLutStack([], output: OutputTransform.none, interpolation: interpolation, develop: develop)
            }
            let filmPass = FilmPass(film)
            grader.setCube(cube, intensity: 1, interpolation: interpolation)
            grader.setFilm(filmPass)
            let recipe = grader.render(source: source)
            return DevelopSheetGraded(image: recipe, changed: cube != nil || filmPass != nil)
        }
    }
}

/// What a host knows of the file it hands the sheet — the chip's facts (the
/// web's `usePicturePixels`): nothing is claimed that was not measured.
struct DevelopSheetFacts {
    var file: FidelityFile
    /// The pixels decoded, and the file's own where it holds more; nil when
    /// the host measured nothing (a clip's frame, as on the web).
    var pixels: FidelityPixels?
    /// A RAW with no render of its own, demosaiced by the system's developer.
    var systemDeveloped = false
}

/// A photograph decoded for a sheet, with what its decode measured.
struct DevelopSheetDecoded {
    let image: CIImage
    let natural: CGSize
    let facts: DevelopSheetFacts
}

enum DevelopSheetError: LocalizedError {
    case undecodable(String)

    var errorDescription: String? {
        switch self {
        case .undecodable(let name):
            return "This device cannot decode \(name), and the file carries no render of its own — point this at an exported JPEG instead."
        }
    }
}

/// What one render handed back.
private struct DevelopSheetRender {
    let image: CGImage?
    let histogram: Histogram?
    let changed: Bool
}

@MainActor
@Observable
final class DevelopSheetPicture {
    /// The preview's long edge — a sheet's picture, never the file's density.
    nonisolated static let previewEdge = 1600
    /// The compare switch, remembered on this device.
    nonisolated static let compareKey = "atelier.develop.sheet.compare"

    // MARK: the picture

    /// The picture as the host decoded it, fitted to the sheet — what every
    /// render starts from, and what the dropper reads.
    private(set) var source: CIImage?
    /// Its pixels, which every render keeps.
    private(set) var sourceSize: CGSize = .zero
    /// The file's own pixels before the sheet's fit — the 1:1 landmark.
    private(set) var natural: CGSize?
    private(set) var facts: DevelopSheetFacts?
    /// Why there is no picture: a decoder's refusal, a file gone.
    private(set) var problem: String?

    // MARK: the render

    /// The picture as developed, with the clipping painted when `J` is on.
    private(set) var shown: CGImage?
    /// The picture AS SHOT — the left of the divider, and the held before.
    private(set) var before: CGImage?
    /// The picture as it will be delivered — never with the clipping on it.
    private(set) var histogram: Histogram?
    /// The picture AS SHOT, measured for Auto.
    private(set) var stats: SourceStats?
    /// The grade changes a pixel: there is something to compare.
    private(set) var changed = false

    // MARK: ways of looking — the sheet's, never the picture's

    private(set) var compareOn: Bool
    /// The divider's position across the picture — AS SHOT to its left.
    var wipe: Double = 0
    /// `\` or the pill: the picture as shot, whole.
    private(set) var holding = false
    /// Painting what is clipped on the picture (`J`).
    private(set) var clipping = false
    /// The grey dropper is armed: the next tap reads a pixel.
    private(set) var picking = false
    /// The session's develop clipboard holds something to paste.
    private(set) var canPaste = hasCopiedDevelop()

    /// The Looking zoom — the Develop stage's own.
    let zoom = LookingZoom()
    /// The pixel under the pointer, said under the histogram — held outside
    /// the observed state, so a hover redraws that one line.
    let readout = ReadoutStore()

    @ObservationIgnored private var job: DevelopSheetJob?
    @ObservationIgnored private var running = false
    @ObservationIgnored private var owed = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var unsubscribe: (() -> Void)?

    init() {
        compareOn = UserDefaults.standard.object(forKey: DevelopSheetPicture.compareKey) as? Bool ?? true
    }

    // MARK: - the sheet's life

    /// The sheet is up: listen to the session's clipboard.
    func open() {
        canPaste = hasCopiedDevelop()
        guard unsubscribe == nil else { return }
        unsubscribe = subscribeDevelopClipboard { [weak self] in
            self?.canPaste = hasCopiedDevelop()
        }
    }

    /// The sheet is going: let go of the listener and of the readout.
    func close() {
        unsubscribe?()
        unsubscribe = nil
        readout.set(nil)
    }

    // MARK: - the picture

    /// A picture to develop, decoded by the host: fitted to the sheet, drawn
    /// as shot ONCE for the left of the divider, measured as shot for Auto.
    /// `natural` is the decode's own size (the fitted one when nil); `facts`
    /// is what the chip may say.
    func load(_ image: CIImage, natural: CGSize?, facts: DevelopSheetFacts?, longEdge: Int = DevelopSheetPicture.previewEdge) {
        let origin = image.extent.origin
        let placed = origin == .zero ? image : image.transformed(by: CGAffineTransform(translationX: -origin.x, y: -origin.y))
        let fitted = FrameGrader.fit(placed, longEdge: longEdge).image
        generation += 1
        source = fitted
        sourceSize = fitted.extent.size
        self.natural = natural ?? fitted.extent.size
        self.facts = facts
        problem = nil
        shown = nil
        before = nil
        histogram = nil
        stats = nil
        changed = false
        zoom.reset()
        readout.set(nil)
        let generation = self.generation
        Task { [weak self] in
            let asShot = await Task.detached(priority: .userInitiated) { () -> CGImage? in
                FrameGrader.cgImage(fitted)
            }.value
            let measured = await Task.detached(priority: .utility) { () -> SourceStats? in
                PictureRenderer.shared.rgbaBytes(fitted, longEdge: histogramSampleEdge).map { measureSource($0) }
            }.value
            guard let self, generation == self.generation else { return }
            self.before = asShot
            self.stats = measured
        }
        requestRender()
    }

    /// No picture, and why — said on the frame in place of one.
    func fail(_ problem: String, facts: DevelopSheetFacts? = nil) {
        generation += 1
        source = nil
        sourceSize = .zero
        shown = nil
        before = nil
        histogram = nil
        stats = nil
        changed = false
        self.facts = facts
        self.problem = problem
        picking = false
    }

    // MARK: - the render

    /// Grade the picture with `develop` through the host's grade — at most one
    /// render in flight and one owed, the latest winning.
    func grade(_ develop: DevelopSettings, through grading: any DevelopSheetGrading) {
        job = grading.job(for: develop)
        requestRender()
    }

    private func requestRender() {
        guard source != nil, job != nil else { return }
        if running {
            owed = true
            return
        }
        startRender()
    }

    private func startRender() {
        guard let source, let job else { return }
        owed = false
        running = true
        let clipping = self.clipping
        let generation = self.generation
        Task { [weak self] in
            let out = await Task.detached(priority: .userInitiated) { () -> DevelopSheetRender in
                DevelopSheetPicture.draw(source, job, clipping: clipping)
            }.value
            guard let self else { return }
            self.running = false
            if generation == self.generation {
                self.shown = out.image
                self.histogram = out.histogram
                self.changed = out.changed
            }
            if self.owed { self.startRender() }
        }
    }

    /// One render: the recipe measured as delivered, and shown with the
    /// clipping when it is on — a way of LOOKING, never measured.
    nonisolated private static func draw(_ source: CIImage, _ job: DevelopSheetJob, clipping: Bool) -> DevelopSheetRender {
        let graded = job(source)
        let recipe = graded.image
        let looked = clipping ? ClippingPass.shared.apply(recipe, PassContext(renderSize: recipe.extent.size)) : recipe
        let image = FrameGrader.cgImage(looked)
        let histogram = PictureRenderer.shared.rgbaBytes(recipe, longEdge: histogramSampleEdge).map { luminanceHistogram($0) }
        return DevelopSheetRender(image: image, histogram: histogram, changed: graded.changed)
    }

    // MARK: - ways of looking

    /// The divider is live: a picture something changes, the switch on,
    /// nothing held, the dropper down.
    var comparing: Bool {
        shown != nil && changed && compareOn && !holding && !picking
    }

    /// The wipe as the stage shows it: suspended → 0, remembered underneath.
    var shownWipe: Double { comparing ? wipe : 0 }

    func setCompareOn(_ on: Bool) {
        compareOn = on
        UserDefaults.standard.set(on, forKey: DevelopSheetPicture.compareKey)
    }

    func setHolding(_ on: Bool) {
        guard on != holding else { return }
        holding = on
    }

    /// `J`, or the histogram's end words: the clipping painted on the picture.
    func toggleClipping() {
        clipping.toggle()
        requestRender()
    }

    /// Arm or put down the grey dropper — only over a picture.
    func setPicking(_ on: Bool) {
        picking = on && source != nil
    }

    // MARK: - the grey dropper

    /// The average of a 5 × 5 patch of the picture AS SHOT at `[u, v]` (shares
    /// of its width and height, y down), in linear light — nil off the picture.
    func sampleGrey(u: Double, v: Double) async -> (Double, Double, Double)? {
        guard let source else { return nil }
        return await Task.detached(priority: .userInitiated) { () -> (Double, Double, Double)? in
            DevelopSheetPicture.sampleLinear(source, u: u, v: v)
        }.value
    }

    nonisolated static func sampleLinear(_ image: CIImage, u: Double, v: Double) -> (Double, Double, Double)? {
        let extent = image.extent
        let x = Double(extent.minX) + u * Double(extent.width)
        // Core Image counts y up from the bottom; the shares count down.
        let y = Double(extent.minY) + (1 - v) * Double(extent.height)
        let patch = CGRect(x: x - 2.5, y: y - 2.5, width: 5, height: 5).intersection(extent)
        guard !patch.isEmpty else { return nil }
        let average = image.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: patch)])
        // One pixel, wherever the filter put it.
        let origin = average.extent.isInfinite ? .zero : average.extent.origin
        let bounds = CGRect(origin: origin, size: CGSize(width: 1, height: 1))
        var pixel = [Float](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            RenderContexts.shared.render(average, toBitmap: base, rowBytes: 16, bounds: bounds, format: .RGBAf, colorSpace: nil)
        }
        let r = toLinear(Double(pixel[0]), .srgb)
        let g = toLinear(Double(pixel[1]), .srgb)
        let b = toLinear(Double(pixel[2]), .srgb)
        return (r, g, b)
    }

    // MARK: - what the picture is

    /// The chip and the note — `pictureFidelity` over the host's facts. A RAW
    /// with no render of its own is demosaiced by the system's developer at
    /// its defaults, which the kernel's sentence (written for the web's
    /// embedded render) would misname, so it is said in its own words — the
    /// Develop tool's (`RollEditor.fidelityChip`).
    func fidelity(_ base: DevelopBase?) -> PictureFidelity {
        guard let facts else { return PictureFidelity(chip: nil, note: nil) }
        let onProxy = (base ?? .proxy) == .proxy
        if facts.systemDeveloped && onProxy, let pixels = facts.pixels {
            return PictureFidelity(
                chip: "RAW · system developer · \(pixels.width) × \(pixels.height)",
                note: "the sensor’s data, demosaiced by the system’s RAW developer at its defaults — the file carries no render of its own"
            )
        }
        return pictureFidelity(facts.file, base, facts.pixels)
    }

    // MARK: - a host's decode

    /// A photograph decoded for a sheet — upright, as codes, a RAW through the
    /// render inside it first (`PictureDecoder`) — with what the decode
    /// MEASURED: its pixels, whether they are the camera's render, the
    /// sensor's own size. The sheet fits it; the decode is never kept.
    nonisolated static func decodeStill(_ url: URL, name: String, origin: MediaOrigin?) async throws -> DevelopSheetDecoded {
        try await Task.detached(priority: .userInitiated) { () throws -> DevelopSheetDecoded in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url)
            guard let decoded = PictureDecoder.decode(data, name: name) else {
                throw DevelopSheetError.undecodable(name)
            }
            let sensor = decoded.raw?.sensor.map { PixelSize(width: Int($0.width.rounded()), height: Int($0.height.rounded())) }
            let pixels = FidelityPixels(width: decoded.width, height: decoded.height,
                                        viaRawPreview: decoded.viaRawPreview, full: sensor)
            let facts = DevelopSheetFacts(file: FidelityFile(name: name, origin: origin), pixels: pixels,
                                          systemDeveloped: decoded.systemDeveloped)
            return DevelopSheetDecoded(image: decoded.image,
                                       natural: CGSize(width: decoded.width, height: decoded.height),
                                       facts: facts)
        }.value
    }
}
