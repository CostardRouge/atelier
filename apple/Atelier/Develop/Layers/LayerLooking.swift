// What the stage SHOWS of the layers while one is open — the picture with
// its layers drawn, the open layer's mask washed over it (show-the-mask), the
// region a tap just added blinking — and the colour a layer SEES under the
// pointer. The web's `useDevelopPicture` does all of it inside the one held
// grader (`showMaskOf`, `maskStyle`, `flashMask`, `sampleColour`); here the
// stage's render is the integration task's seam (`DevelopRenderPlan`), so
// this file holds two things:
//
// - `LayerLooking`, the SEAM a plan reads to draw the same thing itself: the
//   subject maps a `LayerStack` needs (`subjects`) and the passes that go
//   LAST in `after`, past everything that shapes the picture — the mask's
//   wash, then the blink (`passes(_:aspectRatio:)`). Thread-safe: a plan
//   renders off the main thread.
// - `LayerLookingRenderer`, which draws the layered picture for the Layers
//   tab while the stage's plan does not (`RollEditor.planDrawsLayers`): the
//   web's order — SOURCE → the develop's ONE cube → the geometry's warps →
//   the layers, bottom to top → the wash → the blink — at the stage's own
//   budget, then framed by `PictureRenderer.compose`'s very crop, so it lands
//   on the stage's picture to the pixel.
//
// Nothing here is a second implementation of a mask: the wash is the layer's
// own pass with a one-colour cube (`LayerPasses.overlay`), the blink the
// kernel's `maskFlashPass` over the point's own map (`LayerPasses.flash`), and
// the layers are `LayerStack`'s. Show-the-mask is a way of LOOKING — it never
// reaches a delivery, the histogram or a thumbnail.

import AtelierKit
import CoreGraphics
import CoreImage
import Foundation

// MARK: - the seam a render plan reads

/// What the stage shows beyond the picture while a layer is open, held for
/// whichever renderer draws the stage.
final class LayerLooking: @unchecked Sendable {
    private let lock = NSLock()
    private var heldSubjects: [String: CIImage] = [:]
    private var heldWash: (layer: AdjustLayer, style: MaskOverlayStyle)?
    private var heldFlash: CIImage?

    /// Each SUBJECT layer's map, by layer id — what `LayerStack.passes(…,
    /// subjects:)` and `LayerPasses.build(…, subjects:)` take.
    var subjects: [String: CIImage] {
        lock.lock()
        defer { lock.unlock() }
        return heldSubjects
    }

    func setSubjects(_ maps: [String: CIImage]) {
        lock.lock()
        heldSubjects = maps
        lock.unlock()
    }

    /// The mask shown and the region blinking — nil for none.
    func setLook(wash: (layer: AdjustLayer, style: MaskOverlayStyle)?, flash: CIImage?) {
        lock.lock()
        heldWash = wash
        heldFlash = flash
        lock.unlock()
    }

    /// Everything forgotten — another picture opened.
    func clear() {
        lock.lock()
        heldSubjects = [:]
        heldWash = nil
        heldFlash = nil
        lock.unlock()
    }

    /// The passes that go LAST in the stage's `after` list: the open layer's
    /// wash (`layers` is the picture's whole stack, for the subtraction a
    /// wash shows), then the blink. Empty when nothing is shown.
    func passes(_ layers: [AdjustLayer], aspectRatio: Double) -> [RenderPass] {
        lock.lock()
        let wash = heldWash
        let flash = heldFlash
        let maps = heldSubjects
        lock.unlock()
        var out: [RenderPass] = []
        if let wash, let pass = LayerPasses.overlay(wash.layer, in: layers, aspectRatio: aspectRatio,
                                                    style: wash.style, subjects: maps) {
            out.append(pass)
        }
        if let flash, let pass = LayerPasses.flash(flash, aspectRatio: aspectRatio) {
            out.append(pass)
        }
        return out
    }
}

// MARK: - the colour a layer sees

/// The picture as ONE layer sees it — the develop, the warps and the layers
/// under it, none of its own change nor anything above — small, as 8-bit
/// codes: what a colour sample is read from, and the readout under the
/// pointer (`mask-parts.md`, «A sample is the colour THIS LAYER SEES»).
struct BelowBuffer {
    let bytes: [UInt8]
    let width: Int
    let height: Int

    /// The codes at a share of the source, 0…1 each — one pixel.
    func rgb(u: Double, v: Double) -> (Double, Double, Double)? {
        average(u: u, v: v, half: 0)
    }

    /// The mean of a (2·half + 1)² patch at a share of the source, 0…1 each —
    /// the web's 5 × 5 at 512 px.
    func average(u: Double, v: Double, half: Int = 2) -> (Double, Double, Double)? {
        guard width > 0, height > 0, bytes.count >= width * height * 4, u.isFinite, v.isFinite else { return nil }
        let x = min(width - 1, max(0, Int((u * Double(width)).rounded(.down))))
        let y = min(height - 1, max(0, Int((v * Double(height)).rounded(.down))))
        var r = 0.0
        var g = 0.0
        var b = 0.0
        var n = 0.0
        for yy in max(0, y - half)...min(height - 1, y + half) {
            for xx in max(0, x - half)...min(width - 1, x + half) {
                let i = (yy * width + xx) * 4
                r += Double(bytes[i])
                g += Double(bytes[i + 1])
                b += Double(bytes[i + 2])
                n += 1
            }
        }
        guard n > 0 else { return nil }
        return (r / n / 255, g / n / 255, b / n / 255)
    }
}

// MARK: - the Layers tab's own render

/// One render of the layered picture: as it stands, and with the blink on.
struct LookingFrame {
    let image: CGImage?
    let flash: CGImage?
}

final class LayerLookingRenderer: @unchecked Sendable {
    /// The long edge a colour is sampled at — the web's `COLOUR_SAMPLE_EDGE`.
    static let sampleEdge = 512

    private let lock = NSLock()
    /// The packed lattices: the develop's and every layer's own cube.
    private let cubes = CubeCache(capacity: maxLayers + 2)
    /// Each layer's pass kept while nothing it was built from moved.
    private let stack = LayerStack()
    /// A renderer of our own for the crop, so the stage's bake cache is never thrashed.
    private let framer = PictureRenderer()
    private var bake: (develop: DevelopSettings?, cube: CubeLut?)?

    /// The develop's ONE cube (no look: the looks are their task's), baked once per develop.
    private func cube(for develop: DevelopSettings?) -> CubeLut? {
        lock.lock()
        defer { lock.unlock() }
        if let hit = bake, sameDevelop(hit.develop, develop) { return hit.cube }
        let cube = composeLutStack([], output: OutputTransform.none, interpolation: .tetrahedral, develop: develop)
        bake = (develop, cube)
        return cube
    }

    /// The picture as the stage frames it, with its layers — `wash` the open
    /// layer shown and how, `flash` a point's own map to blink. Rendered at
    /// the stage's budget (`longEdge` on the DELIVERED frame): the source is
    /// brought down FIRST, so no layer runs at the file's own density.
    func frame(picture: RollPicture, decoded: DecodedPicture, subjects: [String: CIImage],
               wash: (layer: AdjustLayer, style: MaskOverlayStyle)?, flash: CIImage?,
               longEdge: Int = PictureRenderer.stageLongEdge) -> LookingFrame {
        let width = Double(decoded.width)
        let height = Double(decoded.height)
        guard width > 0, height > 0 else { return LookingFrame(image: nil, flash: nil) }
        let aspectRatio = width / height
        let delivered = PictureRenderer.deliveredSize(width: decoded.width, height: decoded.height, aspect: picture.aspect)
        let longest = Double(max(delivered.width, delivered.height))
        let scale = longest > 0 ? min(1, Double(longEdge) / longest) : 1
        let fitted = FrameGrader.resampled(decoded.image, scale: scale)

        let layers = picture.layers
        let shape = GeometryFamilyPasses(picture: picture, sourceWidth: width, sourceHeight: height).shape
        let drawn = stack.passes(layers, aspectRatio: aspectRatio, subjects: subjects)
        var after: [RenderPass] = shape + drawn
        if let wash, let pass = LayerPasses.overlay(wash.layer, in: layers, aspectRatio: aspectRatio,
                                                    style: wash.style, subjects: subjects) {
            after.append(pass)
        }
        let lut = cube(for: picture.develop)
        let image = framed(fitted.image, scale: fitted.scale, after: after, lut: lut, picture: picture)

        var flashed: CGImage?
        if let flash, let pass = LayerPasses.flash(flash, aspectRatio: aspectRatio) {
            flashed = framed(fitted.image, scale: fitted.scale, after: after + [pass], lut: lut, picture: picture)
        }
        return LookingFrame(image: image, flash: flashed)
    }

    /// `source` through the cube and `after`, then cropped as the stage crops.
    private func framed(_ source: CIImage, scale: Double, after: [RenderPass], lut: CubeLut?,
                        picture: RollPicture) -> CGImage? {
        let grader = FrameGrader(lut: lut, after: after, cubes: cubes)
        let extent = source.extent
        let graded = grader.render(source: source, sourceScale: scale).cropped(to: extent)
        let drawn = DecodedPicture(image: graded, properties: [:], isRaw: false)
        // The crop is `PictureRenderer.compose`'s own, with no develop (it is
        // already in) and no cap (the budget was paid above).
        let recipe = PictureRenderer.Recipe(develop: nil, framing: picture.framing, aspect: picture.aspect, longEdge: nil)
        return framer.cgImage(framer.compose(drawn, recipe: recipe))
    }

    /// The picture as the layer `layerId` sees it — the develop, the warps and
    /// the layers UNDER it — small, as codes (`BelowBuffer`). The finishing
    /// passes (presence, sharpen, the post-crop vignette, grain) all run after
    /// every layer, so none of them is here.
    func below(picture: RollPicture, decoded: DecodedPicture, layerId: String, subjects: [String: CIImage],
               longEdge: Int = LayerLookingRenderer.sampleEdge) -> BelowBuffer? {
        let width = Double(decoded.width)
        let height = Double(decoded.height)
        guard width > 0, height > 0 else { return nil }
        let aspectRatio = width / height
        let fitted = FrameGrader.fit(decoded.image, longEdge: longEdge)
        let all = picture.layers
        let at = all.firstIndex(where: { $0.id == layerId }) ?? all.count
        let under = Array(all.prefix(at))
        let shape = GeometryFamilyPasses(picture: picture, sourceWidth: width, sourceHeight: height).shape
        let layers = LayerPasses.build(under, aspectRatio: aspectRatio, subjects: subjects)
        let grader = FrameGrader(lut: cube(for: picture.develop), after: shape + layers, cubes: cubes)
        let extent = fitted.image.extent
        let graded = grader.render(source: fitted.image, sourceScale: fitted.scale).cropped(to: extent)
        let w = Int(extent.width.rounded())
        let h = Int(extent.height.rounded())
        guard w > 0, h > 0, let bytes = framer.rgbaBytes(graded, longEdge: max(w, h)) else { return nil }
        return BelowBuffer(bytes: bytes, width: w, height: h)
    }
}
