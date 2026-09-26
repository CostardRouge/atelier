// The layers' BUILDER — from a picture's stored layers to the passes the
// grader draws after the cube — held to the kernel's rules it must not
// re-decide: only a layer that draws costs a pass, bottom to top, `layer:<id>`
// each; a subject's map is injected by LAYER id and its subtraction by the
// subtracted subject's id; a subject with no map draws nothing and a
// subtraction of it subtracts nothing; the stage's stack hands the same pass
// back while nothing it was built from moved.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class LayerPassesTests: XCTestCase {
    static let W = 64
    static let H = 48

    private func layer(_ id: String, _ mask: Mask?, exposure: Double, enabled: Bool = true,
                       except: String? = nil, opacity: Double = 1) -> AdjustLayer {
        var develop = DevelopSettings.default
        develop.exposure = exposure
        return AdjustLayer(id: id, mask: mask, except: except, develop: develop, opacity: opacity, enabled: enabled)
    }

    private func ids(_ passes: [RenderPass]) -> [String] {
        passes.map { $0.id }
    }

    /// A map whose LEFT half is the subject — as Vision hands one over.
    private func leftHalf() throws -> CIImage {
        let made = try XCTUnwrap(LayerPassTests.floatBuffer(width: Self.W, height: Self.H) { x, _ in
            x < Self.W / 2 ? 1 : 0
        })
        return SubjectMasks.image(from: made.buffer)
    }

    /// The grey frame through `after`, read back: (a pixel on the left, one on the right), red channel.
    private func leftAndRight(_ after: [RenderPass]) throws -> (left: Double, right: Double) {
        let grey = LayerPassTests.picture(width: Self.W, height: Self.H) { _, _ in (0.5, 0.5, 0.5) }
        let grader = FrameGrader(after: after)
        let got = CubePassTests.read(grader.render(source: grey.image), width: Self.W, height: Self.H)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the layer kernels")
        }
        let row = Self.H / 2
        return (Double(got[(row * Self.W + 8) * 4]), Double(got[(row * Self.W + Self.W - 8) * 4]))
    }

    // MARK: - which layers draw

    func testOnlyALayerThatDrawsCostsAPassBottomToTop() {
        let layers = [
            layer("a", .linear(LinearMask.default), exposure: -1),
            layer("parked", .radial(RadialMask.default), exposure: 1, enabled: false),
            layer("untouched", nil, exposure: 0),
            layer("clear", nil, exposure: 1, opacity: 0),
            layer("d", .radial(RadialMask.default), exposure: 1),
        ]
        XCTAssertEqual(ids(LayerPasses.build(layers, aspectRatio: 1.5)), ["layer:a", "layer:d"])
        XCTAssertTrue(LayerPasses.build(nil, aspectRatio: 1.5).isEmpty)
    }

    func testThePictureRecordIsReadThroughItsLayers() {
        var picture = RollPicture(id: "p", ref: SavedMediaRef(name: "DJI_0101.JPG", size: 1, lastModified: 0))
        picture.layers = [layer("a", nil, exposure: -1)]
        XCTAssertEqual(ids(LayerPasses.build(picture, aspectRatio: 1.5)), ["layer:a"])
    }

    // MARK: - subjects, injected

    func testASubjectDrawsByItsMapAndAWholeLayerIsHoledByIt() throws {
        let point = AtelierKit.Point(0.25, 0.5)
        let layers = [
            // The subject, darkened.
            layer("s", .subject(SubjectMask(points: [point], model: SubjectMasks.model)), exposure: -2),
            // The whole picture EXCEPT the subject, brightened.
            layer("w", nil, exposure: 1, except: "s"),
        ]
        let ar = Double(Self.W) / Double(Self.H)

        let with = try leftAndRight(LayerPasses.build(layers, aspectRatio: ar, subjects: ["s": try leftHalf()]))
        XCTAssertLessThan(with.left, 0.45, "the subject (left) is darkened by its own layer")
        XCTAssertGreaterThan(with.right, 0.55, "outside the subject (right) the whole layer brightens")

        // No map yet: the subject draws NOTHING, and the whole layer subtracts
        // nothing — it applies everywhere for the moment the model thinks.
        let without = try leftAndRight(LayerPasses.build(layers, aspectRatio: ar))
        XCTAssertGreaterThan(without.left, 0.55, "with no map the subject draws nothing and the hole is not cut")
        XCTAssertGreaterThan(without.right, 0.55)
    }

    func testTheOverlayShowsTheMaskAndNothingElse() throws {
        let subject = layer("s", .subject(SubjectMask(points: [AtelierKit.Point(0.25, 0.5)])), exposure: -2)
        let ar = Double(Self.W) / Double(Self.H)
        // A layer with no mask, no part and no subtraction has nothing to show.
        XCTAssertNil(LayerPasses.overlay(layer("w", nil, exposure: 1), in: [subject], aspectRatio: ar))
        let fill = try XCTUnwrap(LayerPasses.overlay(subject, in: [subject], aspectRatio: ar, style: .fill,
                                                     subjects: ["s": try leftHalf()]))
        XCTAssertEqual(fill.id, "mask-fill:s")
        let shown = try leftAndRight([fill])
        XCTAssertGreaterThan(abs(shown.left - 0.5), 0.05, "the wash lands on the subject")
        XCTAssertEqual(shown.right, 0.5, accuracy: 1e-3, "and nowhere else")
    }

    // MARK: - the stage's stack

    func testTheStageStackHandsTheSamePassBackWhileNothingMoved() throws {
        let stack = LayerStack()
        let painted = Mask.brush(BrushMask(strokes: [
            BrushStroke(points: [AtelierKit.Point(0.2, 0.2), AtelierKit.Point(0.6, 0.5)]),
        ]))
        var layers = [layer("p", painted, exposure: -1)]
        let first = try XCTUnwrap(stack.passes(layers, aspectRatio: 1.5).first as? LayerRenderPass)
        let again = try XCTUnwrap(stack.passes(layers, aspectRatio: 1.5).first as? LayerRenderPass)
        XCTAssertTrue(first.layer === again.layer, "the kernel's record is kept while nothing moved")
        XCTAssertTrue(first.raster === again.raster, "the painted map is turned into an image once, not per repaint")

        layers[0].opacity = 0.5
        let moved = try XCTUnwrap(stack.passes(layers, aspectRatio: 1.5).first as? LayerRenderPass)
        XCTAssertFalse(moved.layer === first.layer, "an opacity nudge is a new pass")
        XCTAssertEqual(moved.layer.opacity, 0.5)

        // A new subject map is a new pass; the same map is not.
        let subject = [layer("s", .subject(SubjectMask(points: [AtelierKit.Point(0.5, 0.5)])), exposure: -1)]
        let map = try leftHalf()
        let s1 = try XCTUnwrap(stack.passes(subject, aspectRatio: 1.5, subjects: ["s": map]).first as? LayerRenderPass)
        let s2 = try XCTUnwrap(stack.passes(subject, aspectRatio: 1.5, subjects: ["s": map]).first as? LayerRenderPass)
        XCTAssertTrue(s1.raster === s2.raster)
        let s3 = try XCTUnwrap(stack.passes(subject, aspectRatio: 1.5, subjects: ["s": try leftHalf()]).first as? LayerRenderPass)
        XCTAssertFalse(s3.raster === s1.raster)
    }
}
