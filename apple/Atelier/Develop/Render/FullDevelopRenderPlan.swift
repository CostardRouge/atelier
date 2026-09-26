// The Develop tool's COMPLETE pixel path — every pass a picture carries, in
// the web's order, behind the ONE seam the stage, the filmstrip's snapshot
// and the export all draw through (`DevelopRenderPlan`): preview = export by
// construction. The web's `use-develop-picture.ts` (`graderFrom`) for the
// stage and `roll-render.ts` (`renderRollPicture`) for a delivery, which
// assemble the same list:
//
//     SOURCE — the file, a RAW's render, or its SENSOR at the develop's rung
//       → the camera's gain map               (GeometryFamilyPasses.source)
//       → repair → colour noise → denoise → defringe      (DetailPasses.before)
//     → CUBE — the develop, then the picture's own look, as ONE lattice
//       → camera warp → lens → keystone       (GeometryFamilyPasses.shape)
//       → the adjustment layers, subjects injected         (LayerPasses)
//       → dehaze → clarity → texture → sharpen             (DetailPasses.after)
//       → the post-crop vignette               (GeometryFamilyPasses.finish)
//     → FILM — grain and halation, last of all             (FilmPass)
//     → the crop, framed and cut to the delivered frame
//     → its BORDER, the canvas round the crop — in a delivery
//
// Everything runs at SOURCE density, before the crop, as the web's does: a
// keystone resampled after the crop would resample a resample, a lens
// corrected after one would be radial about the wrong centre, and a grain
// cell is a fraction of the SOURCE's height, so the export's grain is the
// stage's resampled. The budget scales the whole source first (the stage's
// one 4K frame, `device-memory.md`), and every kernel sized in SOURCE pixels
// is told the scale.
//
// The ways of LOOKING are the stage's alone: the clipping (J), drawn over the
// delivered frame by `looking`, and the Layers tab's show-the-mask wash and
// blink, read from its seam (`LayerLooking`) and drawn LAST in `after`; a
// snapshot, the histogram and an export never see them. The border is drawn
// in every DELIVERY (the export's run cuts its file from it) and never on the
// stage, whose geometry has no border canvas — the Crop tab's delivered
// preview shows it there. What this plan does not draw it SAYS
// (`unrendered`), in the inspector's words.

import AtelierKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation

/// What a render drew from, told to the editor: what the chip says and
/// where the measured exposure comes from.
struct DevelopSourceFacts: Equatable {
    /// On the SENSOR's data — a rung above the proxy, decoded.
    var onSensor: Bool
    /// The pixels the graph drew from, whole (before the budget).
    var width: Int
    var height: Int
    /// The pixels the FILE holds where it holds more: a RAW's sensor, as shown.
    var full: PixelSize?
    /// The rung really applied — a rung the file cannot reach falls to its top one.
    var rung: DevelopBase
    /// The exposure measured on this decode (`autoBrightGain`), when the develop had none stored.
    var measuredGain: Double?
}

extension RenderBudget {
    /// The stage and a filmstrip cell — what is LOOKED at, never delivered.
    var isPreview: Bool { self == .stage || self == .thumbnail }
}

final class FullDevelopRenderPlan: DevelopRenderPlan, @unchecked Sendable {
    let looks: DevelopLooks
    let subjects: SubjectMasks
    let device: DeviceClass
    let context: CIContext

    /// Something the stage drew WITHOUT has arrived — a subject's map: render
    /// again. Called on any thread.
    var onInvalidate: (() -> Void)?
    /// What a render drew from, per picture id, when it changed. Called on any thread.
    var onSource: ((String, DevelopSourceFacts) -> Void)?
    /// The Layers tab's seam: the subject maps it keeps for the open picture
    /// and the wash and blink it shows — read on the STAGE only.
    var layerLooking: LayerLooking?

    /// The packed lattices every render of this plan shares: the look's,
    /// and each adjustment layer's own develop cube.
    private let cubes = CubeCache(capacity: 8)
    /// The stage's sensor decodes, rendered once into half floats.
    private let sensors = SensorCache()
    /// The stage's layer passes, kept while nothing they were built from moved.
    private let stageLayers = LayerStack()
    private let lock = NSLock()
    private var bake: (develop: DevelopSettings?, key: String, cube: CubeLut?)?
    private var told: [String: DevelopSourceFacts] = [:]
    private var subjectState: [String: SubjectState] = [:]
    private var subjectWords: [String: [String]] = [:]
    private var sharpenMask = false
    /// Pictures whose sensor the system's decoder refused — drawn on their render, and said.
    private var refused: Set<String> = []

    /// One picture's subjects on the stage: what the model answered for which
    /// points, and which set of points it is answering now.
    private struct SubjectState {
        var signature: String = ""
        var images: [String: CIImage] = [:]
        var pending: String?
    }

    init(looks: DevelopLooks = .shared, subjects: SubjectMasks = SubjectMasks(),
         device: DeviceClass = DevelopDevice.current, context: CIContext = RenderContexts.shared) {
        self.looks = looks
        self.subjects = subjects
        self.device = device
        self.context = context
    }

    // MARK: - ways of looking, the stage's alone

    /// Paint the sharpen's Masking weight on the stage (the web's
    /// `sharpenMask`), never in anything that leaves.
    func setShowSharpenMask(_ on: Bool) {
        lock.lock()
        sharpenMask = on
        lock.unlock()
    }

    private func stageSharpenMask() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return sharpenMask
    }

    // MARK: - DevelopRenderPlan

    /// A pack look's lattice from the vault, before the render asks for it.
    func prepare(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) async {
        await looks.prepare(picture.grade)
    }

    func render(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage {
        draw(picture, decoded, budget, asShot: false)
    }

    /// The picture AS SHOT, for the left of the wipe: `asShotForCompare`'s
    /// picture through the same source and the same crop, so the halves line
    /// up — and nothing the author did. It tells nobody anything: what the
    /// stage says is the corrected picture's.
    func renderBefore(picture: RollPicture, decoded: DecodedPicture, budget: RenderBudget) -> CIImage {
        draw(asShotForCompare(picture), decoded, budget, asShot: true)
    }

    /// One picture's graph, assembled: the grader holding every pass in the
    /// order it draws, and the source it draws on at the render's scale.
    struct Assembly {
        let grader: FrameGrader
        /// The whole source, brought to the budget, at the origin.
        let source: CIImage
        /// Render pixels per SOURCE pixel.
        let scale: Double
        /// DELIVERED pixels per source pixel — the frame is cut at `scale`,
        /// then brought down to this once, never upsampled from a source
        /// already brought down.
        let deliver: Double
        /// What the graph draws from.
        let from: Source
    }

    private func draw(_ p: RollPicture, _ d: DecodedPicture, _ budget: RenderBudget, asShot: Bool) -> CIImage {
        let made = assemble(p, d, budget, asShot: asShot)
        let graded = made.grader.render(source: made.source, sourceScale: made.scale)
        let w = Double(made.source.extent.width)
        let h = Double(made.source.extent.height)
        var framed = FullDevelopRenderPlan.frame(graded, width: w, height: h, aspect: p.aspect, framing: p.framing)
        // A delivery is the crop ON ITS BORDER; what is looked at is the crop.
        if !budget.isPreview {
            framed = FullDevelopRenderPlan.bordered(framed, p.border, context: context)
        }
        // Cut at the render's scale, then brought to what is delivered — once.
        let down = made.scale > 0 ? made.deliver / made.scale : 1
        guard down < 0.999 else { return framed }
        return FrameGrader.resampled(framed, scale: down).image
    }

    /// The pixels `render` draws FROM for `budget`, before the budget scales
    /// them — the SENSOR's (as shown, at the edge this device decodes it at)
    /// where the develop stands above the proxy, else what the pool decoded.
    /// What a delivery's arithmetic reads, never `decoded`'s own size: on a
    /// sensor rung the render inside a DJI DNG is 960 × 540 and the sensor
    /// 8064 × 4536. Nothing is decoded to answer.
    func sourceSize(picture p: RollPicture, decoded d: DecodedPicture, budget: RenderBudget) -> CGSize {
        let own = CGSize(width: d.width, height: d.height)
        guard let dev = p.develop, isRawDevelop(dev), let raw = d.raw, let sensor = raw.sensor else { return own }
        lock.lock()
        let cannot = refused.contains(p.id)
        lock.unlock()
        if cannot { return own }
        let long = Double(max(sensor.width, sensor.height))
        guard long > 0 else { return own }
        let edge = sensorEdge(p, Double(sensor.width), Double(sensor.height), budget) ?? long
        let k = min(1, edge / long)
        return CGSize(width: (Double(sensor.width) * k).rounded(), height: (Double(sensor.height) * k).rounded())
    }

    /// The graph for `p` on `d` within `budget` — every pass in the web's
    /// order, before the crop. What `render` draws, and what the gate reads
    /// the order from.
    func assemble(_ p: RollPicture, _ d: DecodedPicture, _ budget: RenderBudget, asShot: Bool = false) -> Assembly {
        let preview = budget.isPreview
        let stage = budget == .stage && !asShot
        let source = self.source(p, d, budget)
        // What the stage drew from is what the editor is told — never an
        // export's decode of the same picture at another size.
        if stage { tell(p.id, source) }

        // The develop the cube bakes: with the gain measured on this decode
        // where none is stored yet (the editor stores it, once), and with its
        // base taken off where the SENSOR cannot be had — its numbers on the
        // render, never the gain on a render (`raw.md`).
        var develop = p.develop
        if source.onSensor, let g = source.gain, var dv = develop, dv.rawGain == nil {
            dv.rawGain = g
            develop = dv
        }
        if !source.onSensor, let dv = develop, isRawDevelop(dv) {
            develop = withoutBase(dv)
        }
        let look = looks.resolve(p.grade)
        let cube = baked(develop, look, p.grade)

        // The budget: the whole source brought to the render's scale.
        let deliver = FullDevelopRenderPlan.budgetScale(budget, width: source.width, height: source.height,
                                                        aspect: p.aspect)
        let renderAt = FullDevelopRenderPlan.renderScale(budget, width: source.width, height: source.height,
                                                         aspect: p.aspect, framing: p.framing)
        let fit = FrameGrader.resampled(source.image, scale: renderAt)
        let sw = source.width
        let sh = source.height
        let ar = sw > 0 && sh > 0 ? sw / sh : 1

        // The passes, in the web's order.
        let sharpenView = stage ? stageSharpenMask() : false
        let family = GeometryFamilyPasses(picture: p, sourceWidth: sw, sourceHeight: sh,
                                          calibration: source.calibration, onSensor: source.onSensor)
        let detail = DetailPasses.make(for: p, aspectRatio: ar, decodeScale: source.fileScale,
                                       showSharpenMask: sharpenView)
        let shape = family.shape
        let shown = fit.image
        let viewLut: CubeLut? = source.onSensor ? cube : nil
        let context = self.context
        var maps: [String: CIImage] = [:]
        if !asShot {
            let view: () -> CGImage? = { SubjectMasks.view(of: shown, geometry: shape, lut: viewLut, context: context) }
            maps = subjectMaps(p, key: subjectKey(p, source), preview: preview, ask: stage, view: view)
        }
        // The Layers tab keeps the open picture's subjects itself, found in
        // the file's frame: they stand where that is this frame too — never
        // over a camera warp the tab's view does not bend by.
        let seam = stage ? layerLooking : nil
        if let seam, !source.onSensor || source.calibration.warp == nil {
            maps.merge(seam.subjects) { _, theirs in theirs }
        }
        let layers: [RenderPass]
        if drawingLayers(p.layers).isEmpty {
            layers = []
        } else if stage {
            layers = stageLayers.passes(p.layers, aspectRatio: ar, subjects: maps)
        } else {
            layers = LayerPasses.build(p, aspectRatio: ar, subjects: maps)
        }
        let before: [RenderPass] = family.source + detail.before
        var after: [RenderPass] = family.shape
        after += layers
        after += detail.after
        after += family.finish
        // The open layer's wash, then its blink — LAST, over everything that
        // shapes the picture: a way of looking, never delivered.
        if let seam { after += seam.passes(p.layers, aspectRatio: ar) }
        let film: RenderPass? = FilmPass.from(p.grade).map { $0 as RenderPass }
        let grader = FrameGrader(lut: cube, before: before, after: after, film: film, cubes: cubes)
        return Assembly(grader: grader, source: fit.image, scale: fit.scale, deliver: min(deliver, fit.scale), from: source)
    }

    func unrendered(picture p: RollPicture) -> [String] {
        var out: [String] = []
        // A RAW develop on a file that is not a RAW here: its numbers are
        // drawn, its material cannot be.
        if let d = p.develop, isRawDevelop(d) {
            lock.lock()
            let cannot = refused.contains(p.id)
            lock.unlock()
            if !isRawImage(p.ref.name) {
                out.append("RAW base")
            } else if cannot {
                out.append("RAW base (this device’s decoder refused the sensor)")
            }
        }
        out.append(contentsOf: looks.missingWords(p.grade))
        lock.lock()
        let subjectsSaid = subjectWords[p.id] ?? []
        lock.unlock()
        out.append(contentsOf: subjectsSaid)
        if let d = p.develop { out.append(contentsOf: d.unrenderedStages) }
        return out
    }

    // MARK: - the source

    /// What the graph draws from.
    struct Source {
        /// Codes at the origin: the file, a RAW's render, or its sensor sRGB-encoded.
        let image: CIImage
        let width: Double
        let height: Double
        /// Source pixels per FILE pixel — a sensor decoded smaller than its file.
        let fileScale: Double
        let onSensor: Bool
        /// The camera's own calibration at the rung applied.
        let calibration: CalibrationAt
        /// The exposure measured on this decode, when one was asked for.
        let gain: Double?
        let rung: DevelopBase
        let full: PixelSize?
    }

    /// The picture's source for `budget`: the SENSOR at the develop's rung
    /// where the develop stands above the proxy and the file is a RAW this
    /// device can decode, else what the pool decoded.
    func source(_ p: RollPicture, _ d: DecodedPicture, _ budget: RenderBudget) -> Source {
        let full = d.raw?.sensor.map { PixelSize(width: Int($0.width.rounded()), height: Int($0.height.rounded())) }
        let asDecoded = Source(image: d.image, width: Double(d.width), height: Double(d.height), fileScale: 1,
                               onSensor: false, calibration: .nothing, gain: nil, rung: .proxy, full: full)
        guard let dev = p.develop, isRawDevelop(dev), let raw = d.raw else { return asDecoded }
        // A rung the file cannot reach is never left standing: the top one it has.
        let asked = developBase(dev)
        let rung = raw.rungs.contains(asked) ? asked : topRung(raw.calibration)
        // A sensor the decoder refused is not asked again on every repaint;
        // a delivery asks once more.
        lock.lock()
        let refusedBefore = refused.contains(p.id)
        lock.unlock()
        if budget.isPreview && refusedBefore { return asDecoded }
        let decoded = sensorDecode(p, d, raw, budget, measure: dev.rawGain == nil)
        lock.lock()
        if decoded == nil { refused.insert(p.id) } else { refused.remove(p.id) }
        lock.unlock()
        guard let decode = decoded else { return asDecoded }
        return Source(image: decode.image, width: Double(decode.width), height: Double(decode.height),
                      fileScale: decode.scale, onSensor: true, calibration: calibrationAt(rung, raw.calibration),
                      gain: decode.gain, rung: rung, full: full)
    }

    /// The sensor decoded at the edge `budget` needs — the stage's ONCE, into
    /// half floats, and held; a thumbnail's and an export's as a recipe.
    private func sensorDecode(_ p: RollPicture, _ d: DecodedPicture, _ raw: RawAccess, _ budget: RenderBudget,
                              measure: Bool) -> SensorDecode? {
        let shown = raw.sensor ?? CGSize(width: d.width, height: d.height)
        let edge = sensorEdge(p, Double(shown.width), Double(shown.height), budget)
        let held = budget == .stage
        let key = "\(p.id)|\(raw.name)|\(raw.fileSize)|\(ObjectIdentifier(d).hashValue)|\(Int((edge ?? 0).rounded()))"
        if held, let hit = sensors.get(key), hit.gain != nil || !measure { return hit }
        guard let data = try? raw.reread() else { return nil }
        guard let decode = SensorDecoder.decode(data, hint: raw.hint, maxEdge: edge, materialize: held,
                                                measure: measure || held, context: context) else { return nil }
        if held { sensors.put(key, decode, klass: device) }
        return decode
    }

    /// The long edge a sensor is decoded at for `budget`, or nil for whole:
    /// the stage's own edge (`stageEdge`, held once decoded), else what the
    /// budget renders at, within this device's ceiling for its purpose.
    private func sensorEdge(_ p: RollPicture, _ sensorW: Double, _ sensorH: Double, _ budget: RenderBudget) -> Double? {
        let long = max(sensorW, sensorH)
        if budget == .stage {
            return SensorDecoder.stageEdge(sensorWidth: sensorW, sensorHeight: sensorH, klass: device)
        }
        let purpose: RawPurpose = budget.isPreview ? .stage : .export
        let scale = FullDevelopRenderPlan.renderScale(budget, width: sensorW, height: sensorH, aspect: p.aspect,
                                                      framing: p.framing)
        let wanted = min(long * scale, rawDecodeEdge(purpose, device, .infinity))
        return wanted.isFinite && wanted < long ? wanted : nil
    }

    /// What a render drew from, told once per change.
    private func tell(_ id: String, _ source: Source) {
        let facts = DevelopSourceFacts(onSensor: source.onSensor, width: Int(source.width.rounded()),
                                       height: Int(source.height.rounded()), full: source.full, rung: source.rung,
                                       measuredGain: source.gain)
        lock.lock()
        let changed = told[id] != facts
        if changed { told[id] = facts }
        lock.unlock()
        if changed { onSource?(id, facts) }
    }

    /// What the last render of a picture drew from.
    func facts(_ id: String) -> DevelopSourceFacts? {
        lock.lock()
        defer { lock.unlock() }
        return told[id]
    }

    // MARK: - the cube

    /// The develop and the picture's own look as ONE lattice — the kernel's
    /// `composeLutStack`, tetrahedral, baked once per develop and look.
    private func baked(_ develop: DevelopSettings?, _ look: ResolvedLook, _ grade: RollGrade?) -> CubeLut? {
        let key = gradeKey(grade.map { SavedGrade($0) }) + "\u{1}" + look.missing.joined(separator: "\u{1}")
        lock.lock()
        if let hit = bake, hit.key == key, sameDevelop(hit.develop, develop) {
            lock.unlock()
            return hit.cube
        }
        lock.unlock()
        let cube = composeLutStack(look.layers, output: look.output, interpolation: .tetrahedral, develop: develop)
        lock.lock()
        bake = (develop, key, cube)
        lock.unlock()
        return cube
    }

    // MARK: - subjects

    /// Which picture, which source and which frame a subject was segmented
    /// on: a new geometry is a new key, as a tap lives in the warped frame.
    /// On the file it is the Layers tab's own key (`layersPictureKey`), so
    /// one model answer serves both when they share a `SubjectMasks`; on the
    /// sensor the rung is part of it, as the camera's warp bends the frame.
    private func subjectKey(_ p: RollPicture, _ source: Source) -> String {
        let geometry = ["keystone", "lens", "lensProfile"].map { p.carried[$0]?.serialized() ?? "" }
        let key = ([p.id] + geometry).joined(separator: "|")
        return source.onSensor ? key + "|sensor:\(source.rung.rawValue)" : key
    }

    /// The subject layers' points, as one string — what a resolve answered.
    private static func signature(_ layers: [AdjustLayer]) -> String {
        layers.map { layer -> String in
            guard case .subject(let subject)? = layer.mask else { return layer.id }
            let points = subject.points.map { "\($0.x),\($0.y)" }.joined(separator: ";")
            return "\(layer.id)=\(points)"
        }.joined(separator: "|")
    }

    /// Each subject layer's map. A DELIVERY segments its own, now, off the
    /// main thread already (`forRender`: what the export draws, or every
    /// Subject layer leaves the file). The stage never waits on the model: it
    /// draws what is held and asks for the rest in the background (`ask`), and
    /// a map that lands renders the stage again (`onInvalidate`); a filmstrip
    /// cell draws what is held and asks for nothing.
    private func subjectMaps(_ p: RollPicture, key: String, preview: Bool, ask asking: Bool,
                             view: @escaping () -> CGImage?) -> [String: CIImage] {
        let layers = p.layers
        if !preview {
            let wanted = subjectLayersForRender(layers)
            guard !wanted.isEmpty else { return [:] }
            let resolved = subjects.resolve(layers, picture: key, forRender: true, view: view)
            say(p.id, resolved)
            return resolved.images
        }
        let wanted = subjectLayersToSegment(layers)
        guard !wanted.isEmpty else {
            lock.lock()
            subjectWords[p.id] = nil
            lock.unlock()
            return [:]
        }
        let signature = FullDevelopRenderPlan.signature(wanted)
        lock.lock()
        var state = subjectState[key] ?? SubjectState()
        let ask = asking && state.signature != signature && state.pending != signature
        if ask {
            state.pending = signature
            subjectState[key] = state
        }
        lock.unlock()
        if ask {
            let masks = subjects
            Task.detached(priority: .utility) { [weak self] in
                let resolved = masks.resolve(layers, picture: key, forRender: false, view: view)
                guard let self else { return }
                self.lock.lock()
                var next = self.subjectState[key] ?? SubjectState()
                next.signature = signature
                next.images = resolved.images
                if next.pending == signature { next.pending = nil }
                self.subjectState[key] = next
                self.lock.unlock()
                self.say(p.id, resolved)
                self.onInvalidate?()
            }
        }
        return state.images
    }

    /// Why a subject is not drawn, in the stage's words — kept per picture.
    private func say(_ id: String, _ resolved: SubjectMasks.Resolution) {
        var words: [String] = []
        if let why = resolved.unavailable {
            words.append("subject (\(why))")
        } else if !resolved.missed.isEmpty {
            words.append("subject (no subject under the point)")
        }
        lock.lock()
        subjectWords[id] = words.isEmpty ? nil : words
        lock.unlock()
    }

    // MARK: - the budget and the crop

    /// Render pixels per SOURCE pixel for `budget`: the delivered frame's long
    /// edge brought within the cap (never up); and, for what is only LOOKED
    /// at, the whole source within twice the cap, so a tight crop cannot put a
    /// 48-megapixel source through the graph on every slider step. A delivery
    /// is never held back that way: its cap is on what it delivers.
    static func budgetScale(_ budget: RenderBudget, width: Double, height: Double, aspect: String) -> Double {
        guard let cap = budget.longEdge, width > 0, height > 0 else { return 1 }
        let frame = frameSize(width, height, aspect)
        let limit = Double(cap)
        var scale = min(1, limit / max(frame.width, frame.height))
        if budget.isPreview {
            scale = min(scale, 2 * limit / max(width, height))
        }
        return scale
    }

    /// Render pixels per SOURCE pixel for the GRAPH: the delivered scale
    /// (`budgetScale`) times how much the framing MAGNIFIES the source into
    /// its frame — a crop zoomed 3× is drawn from three times the pixels and
    /// brought down once cut, as the web grades at source density and draws
    /// the frame down (`roll-render.ts`), never upsampled from a source
    /// already brought down. Never above the source's own; a preview never
    /// past its ceiling.
    static func renderScale(_ budget: RenderBudget, width: Double, height: Double, aspect: String,
                            framing: Framing?) -> Double {
        let deliver = budgetScale(budget, width: width, height: height, aspect: aspect)
        guard deliver < 1, let cap = budget.longEdge, width > 0, height > 0 else { return deliver }
        let frame = frameSize(width, height, aspect)
        let t = framingTransform(width, height, frame.width, frame.height, framing ?? .default)
        var scale = min(1, deliver * max(1, t.scale))
        if budget.isPreview {
            scale = min(scale, max(deliver, 2 * Double(cap) / max(width, height)))
        }
        return scale
    }

    /// The delivered frame in source pixels — the largest box of the aspect
    /// inside the source (`PictureRenderer.deliveredSize`, unrounded).
    static func frameSize(_ width: Double, _ height: Double, _ aspect: String) -> (width: Double, height: Double) {
        let ratio = pictureAspectRatio(aspect, width, height)
        guard ratio > 0, ratio.isFinite, width > 0, height > 0 else { return (width, height) }
        if width / height > ratio { return (height * ratio, height) }
        return (width, width / ratio)
    }

    /// The crop on its BORDER (`RollPicture.border`): the canvas round the
    /// crop — a colour, or the crop itself blurred on a tiny copy, darkened,
    /// scaled to cover — laid out by the kernel exactly as `border-paint.ts`
    /// lays it (`borderLayout`, `blurFillLayout`, `boxBlurRGBA` three times at
    /// radius 2, black at 0.18 over it). The crop is `crop`'s own pixels at
    /// its own size; the canvas grows round it.
    static func bordered(_ crop: CIImage, _ border: RollBorder?, context: CIContext) -> CIImage {
        guard let border else { return crop }
        let cw = Double(crop.extent.width)
        let ch = Double(crop.extent.height)
        guard cw > 0, ch > 0, !crop.extent.isInfinite else { return crop }
        let layout = borderLayout(cw, ch, border)
        let canvasW = layout.w.rounded()
        let canvasH = layout.h.rounded()
        let canvas = CGRect(x: 0, y: 0, width: canvasW, height: canvasH)
        // Centred: its left at `x`, its bottom (y up) as far from the canvas's
        // as its top is from the canvas's top.
        let left = ((canvasW - cw) / 2).rounded()
        let bottom = ((canvasH - ch) / 2).rounded()
        let origin = crop.extent.origin
        let move = CGAffineTransform(translationX: CGFloat(left) - origin.x, y: CGFloat(bottom) - origin.y)
        let placed = crop.transformed(by: move)
        let ground: CIImage
        if border.isBlur, let blurred = blurFill(crop, layout, canvasHeight: canvasH, context: context) {
            ground = blurred.cropped(to: canvas)
        } else {
            let rgb = hexColour(border.isBlur ? "#000000" : border.fill)
            ground = CIImage(color: CIColor(red: rgb.r, green: rgb.g, blue: rgb.b)).cropped(to: canvas)
        }
        return placed.composited(over: ground).cropped(to: canvas)
    }

    /// The blur fill: the crop drawn into a `sw × sh` copy, box-blurred there
    /// by the kernel's own function, darkened, then scaled to cover the canvas.
    private static func blurFill(_ crop: CIImage, _ layout: BorderLayout, canvasHeight: Double,
                                 context: CIContext) -> CIImage? {
        let fill = blurFillLayout(layout)
        let extent = crop.extent
        let atOrigin = crop.transformed(by: CGAffineTransform(translationX: -extent.minX, y: -extent.minY))
        let lanczos = CIFilter.lanczosScaleTransform()
        lanczos.inputImage = atOrigin.clampedToExtent()
        let sy = Double(fill.sh) / Double(extent.height)
        let sx = Double(fill.sw) / Double(extent.width)
        lanczos.scale = Float(sy)
        lanczos.aspectRatio = Float(sx / sy)
        guard let small = lanczos.outputImage?.cropped(to: CGRect(x: 0, y: 0, width: fill.sw, height: fill.sh)) else {
            return nil
        }
        var bytes = [UInt8](repeating: 0, count: fill.sw * fill.sh * 4)
        bytes.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            context.render(small, toBitmap: base, rowBytes: fill.sw * 4,
                           bounds: CGRect(x: 0, y: 0, width: fill.sw, height: fill.sh), format: .RGBA8, colorSpace: nil)
        }
        boxBlurRGBA(&bytes, fill.sw, fill.sh, borderBlurRadius)
        let data = bytes.withUnsafeBufferPointer { Data(buffer: $0) }
        let blurred = CIImage(bitmapData: data, bytesPerRow: fill.sw * 4,
                              size: CGSize(width: fill.sw, height: fill.sh), format: .RGBA8, colorSpace: nil)
        let k = fill.w / Double(fill.sw)
        // `fill.y` counts down from the canvas's top; Core Image's y runs up.
        let up = canvasHeight - fill.y - fill.h
        let cover = CGAffineTransform(scaleX: CGFloat(k), y: CGFloat(k))
            .concatenating(CGAffineTransform(translationX: CGFloat(fill.x), y: CGFloat(up)))
        let dark = 1 - borderBlurDarken
        let shade: [String: Any] = [
            "inputRVector": CIVector(x: CGFloat(dark), y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: CGFloat(dark), z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: CGFloat(dark), w: 0),
            "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
        ]
        return blurred.clampedToExtent().transformed(by: cover).applyingFilter("CIColorMatrix", parameters: shade)
    }

    /// `#rrggbb` as three shares of 255 — `readBorder` has already lower-cased
    /// and checked it; anything else is black, as the reader's fallback is.
    static func hexColour(_ hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return (0, 0, 0) }
        let r = CGFloat((value >> 16) & 0xff) / 255
        let g = CGFloat((value >> 8) & 0xff) / 255
        let b = CGFloat(value & 0xff) / 255
        return (r, g, b)
    }

    /// The graded source cut to its delivered frame — the kernel's framing
    /// transform in Core Image's y-up coordinates (the web's clockwise angle
    /// and downward pan flip sign, `native-app.md`); under a Whole framing
    /// (`fit: contain`) the frame the picture leaves uncovered is black, as a
    /// canvas the web encodes is.
    static func frame(_ graded: CIImage, width: Double, height: Double, aspect: String, framing: Framing?) -> CIImage {
        let f = framing ?? .default
        let w = Int(width.rounded())
        let h = Int(height.rounded())
        let delivered = PictureRenderer.deliveredSize(width: w, height: h, aspect: aspect)
        if isDefaultFraming(f) && delivered.width == w && delivered.height == h { return graded }
        let dw = Double(delivered.width)
        let dh = Double(delivered.height)
        let t = framingTransform(width, height, dw, dh, f)
        let centre = CGAffineTransform(translationX: -CGFloat(width) / 2, y: -CGFloat(height) / 2)
        let scale = CGAffineTransform(scaleX: CGFloat(t.scale * t.mirrorX), y: CGFloat(t.scale * t.mirrorY))
        let turn = CGAffineTransform(rotationAngle: CGFloat(-t.angle))
        let pan = CGAffineTransform(translationX: CGFloat(t.panX), y: CGFloat(-t.panY))
        let back = CGAffineTransform(translationX: CGFloat(dw) / 2, y: CGFloat(dh) / 2)
        let m = centre.concatenating(scale).concatenating(turn).concatenating(pan).concatenating(back)
        let rect = CGRect(x: 0, y: 0, width: delivered.width, height: delivered.height)
        if f.fit == .contain {
            let black = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: rect)
            return graded.transformed(by: m).composited(over: black).cropped(to: rect)
        }
        // Cover: the frame is always covered, and the source's edge is
        // clamped so a resample at its last pixel reads no clear outside it.
        return graded.clampedToExtent().transformed(by: m).cropped(to: rect)
    }
}
