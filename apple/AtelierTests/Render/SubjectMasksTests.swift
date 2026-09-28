// Subject masks on Vision — what can be pinned without the model (which
// instances a stored point picks, how often the model is asked, what a
// delivery asks for, what the stage says where the model cannot run), plus
// one row that runs Vision itself where the machine can and SKIPS, naming
// why, where it cannot: a CI runner may have no Neural Engine, and the
// Simulator has no foreground-instance model at all.

import AtelierKit
import CoreGraphics
import CoreImage
import XCTest
@testable import Atelier

final class SubjectMasksTests: XCTestCase {
    /// A model that answers with a fixed 8×8 instance map — instance 1 down
    /// the left half, instance 2 in the bottom-right quarter, the top-right
    /// quarter background — and counts its runs.
    final class Stub: SubjectSegmenter {
        var runs = 0
        var refusal: SubjectMaskError?
        var asked: [IndexSet] = []

        func instances(in view: CGImage) throws -> SubjectInstances {
            runs += 1
            if let refusal { throw refusal }
            var labels = [UInt8](repeating: 0, count: 64)
            for y in 0..<8 {
                for x in 0..<8 {
                    labels[y * 8 + x] = x < 4 ? 1 : (y >= 4 ? 2 : 0)
                }
            }
            return SubjectInstances(labels: labels, width: 8, height: 8) { [weak self] set in
                self?.asked.append(set)
                return MaskRasterImage.constant(1, over: CGRect(x: 0, y: 0, width: 4, height: 4))
            }
        }
    }

    private func point(_ x: Double, _ y: Double) -> AtelierKit.Point {
        AtelierKit.Point(x, y)
    }

    private func subject(_ id: String, _ points: [AtelierKit.Point], exposure: Double = -1,
                         enabled: Bool = true) -> AdjustLayer {
        var develop = DevelopSettings.default
        develop.exposure = exposure
        return AdjustLayer(id: id, mask: .subject(SubjectMask(points: points, model: SubjectMasks.model)),
                           develop: develop, enabled: enabled)
    }

    /// A small opaque picture, for a `view` closure.
    private func tiny() -> CGImage {
        let context = CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
                                space: RenderContexts.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.4, green: 0.5, blue: 0.6, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        return context.makeImage()!
    }

    // MARK: - which instances a point picks

    func testAPointPicksTheInstanceUnderItAndTwoPointsTheirUnion() {
        let labels: [UInt8] = [
            1, 1, 0, 0,
            1, 1, 0, 0,
            1, 1, 2, 2,
            1, 1, 2, 2,
        ]
        func picked(_ points: [AtelierKit.Point], reach: Int = 0) -> [Int] {
            Array(SubjectMasks.instancesUnder(points, labels: labels, width: 4, height: 4, reach: reach))
        }
        // (0, 0) is the TOP left: rows are read from the top.
        XCTAssertEqual(picked([point(0.1, 0.1)]), [1])
        XCTAssertEqual(picked([point(0.9, 0.9)]), [2])
        XCTAssertEqual(picked([point(0.9, 0.1)]), [], "a point on the background picks nothing")
        XCTAssertEqual(picked([point(0.1, 0.9), point(0.8, 0.8)]), [1, 2], "a second point ADDS its instance")
        // Within a tap's reach of an instance, the nearest one.
        XCTAssertEqual(picked([point(0.6, 0.3)], reach: 1), [1])
        XCTAssertEqual(picked([point(0.9, 0.3)], reach: 1), [2])
        XCTAssertEqual(picked([point(.nan, 0.5)]), [], "a point that is not a number picks nothing")
        XCTAssertEqual(Array(SubjectMasks.instancesUnder([point(0.5, 0.5)], labels: [], width: 0, height: 0)), [])
    }

    // MARK: - asking the model

    func testTheModelIsAskedOncePerPictureAndEachMapIsKept() {
        let stub = Stub()
        let masks = SubjectMasks(segmenter: stub)
        var shown = 0
        let view: () -> CGImage? = {
            shown += 1
            return self.tiny()
        }
        let layers = [
            subject("a", [point(0.1, 0.1)]),
            subject("b", [point(0.9, 0.9), point(0.1, 0.5)]),
            subject("off", [point(0.9, 0.1)]),
        ]
        let first = masks.resolve(layers, picture: "p1", view: view)
        XCTAssertEqual(Set(first.images.keys), ["a", "b"])
        XCTAssertEqual(first.missed, ["off"], "a point on no instance draws nothing, and is said")
        XCTAssertNil(first.unavailable)
        XCTAssertEqual(stub.runs, 1, "one model run answers every layer of the picture")
        XCTAssertEqual(shown, 1)
        XCTAssertEqual(stub.asked, [IndexSet([1]), IndexSet([1, 2])])

        // Asked again: the maps are held, the model is not run, the picture not rendered.
        let again = masks.resolve(layers, picture: "p1", view: view)
        XCTAssertTrue(again.images["a"] === first.images["a"])
        XCTAssertEqual(stub.runs, 1)
        XCTAssertEqual(shown, 1)

        // A moved point is a new map from the same answer.
        _ = masks.resolve([subject("a", [point(0.8, 0.8)])], picture: "p1", view: view)
        XCTAssertEqual(stub.runs, 1)
        XCTAssertEqual(stub.asked.last, IndexSet([2]))

        // Another picture — or the same one in a new frame — asks again.
        _ = masks.resolve(layers, picture: "p2", view: view)
        XCTAssertEqual(stub.runs, 2)
        masks.forget(picture: "p1")
        _ = masks.resolve(layers, picture: "p1", view: view)
        XCTAssertEqual(stub.runs, 3)
    }

    func testADeliveryAsksOnlyForTheSubjectsItDraws() {
        let stub = Stub()
        let masks = SubjectMasks(segmenter: stub)
        var cut = subject("cut", [point(0.9, 0.9)], exposure: 0)
        cut.enabled = false
        let layers = [
            // Draws: its own subject.
            subject("drawn", [point(0.1, 0.1)]),
            // Hidden and untouched, but SUBTRACTED by the layer below: needed.
            cut,
            AdjustLayer(id: "whole", mask: nil, except: "cut", develop: { var d = DevelopSettings.default; d.exposure = 1; return d }()),
            // Visible, a point, but a default develop and nobody subtracts it:
            // the stage segments it (a tap on a fresh layer), a delivery does not.
            subject("fresh", [point(0.1, 0.9)], exposure: 0),
        ]
        let delivery = masks.resolve(layers, picture: "p", forRender: true, view: { self.tiny() })
        XCTAssertEqual(Set(delivery.images.keys), ["drawn", "cut"])
        let stage = masks.resolve(layers, picture: "p", view: { self.tiny() })
        XCTAssertEqual(Set(stage.images.keys), ["drawn", "cut", "fresh"])
    }

    func testWhereTheModelCannotRunItIsSaidAndTheLayersDrawWithoutTheirSubject() throws {
        let stub = Stub()
        stub.refusal = .unavailable("Vision's subject model does not run in the Simulator")
        let masks = SubjectMasks(segmenter: stub)
        let layers = [
            subject("s", [point(0.1, 0.1)], exposure: -2),
            AdjustLayer(id: "w", mask: nil, except: "s", develop: { var d = DevelopSettings.default; d.exposure = 1; return d }()),
        ]
        let resolution = masks.resolve(layers, picture: "p", view: { self.tiny() })
        XCTAssertEqual(resolution.unavailable, "Vision's subject model does not run in the Simulator")
        XCTAssertTrue(resolution.images.isEmpty)
        // Said once, and not asked again on the next repaint.
        _ = masks.resolve(layers, picture: "p", view: { self.tiny() })
        XCTAssertEqual(stub.runs, 1)

        // The layers still build and draw — the subject nothing, the whole
        // layer everywhere — rather than the render failing.
        let passes = LayerPasses.build(layers, aspectRatio: 1, subjects: resolution.images)
        XCTAssertEqual(passes.map { $0.id }, ["layer:s", "layer:w"])
        let grey = LayerPassTests.picture(width: 16, height: 16) { _, _ in (0.5, 0.5, 0.5) }
        let got = CubePassTests.read(FrameGrader(after: passes).render(source: grey.image), width: 16, height: 16)
        if !CubePassTests.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the layer kernels")
        }
        XCTAssertGreaterThan(Double(got[0]), 0.55, "the whole layer applies, un-holed; the subject darkens nothing")
    }

    // MARK: - what the model is shown

    func testTheModelIsShownThePictureAtItsOwnSizeNeverLarger() throws {
        let big = LayerPassTests.picture(width: 300, height: 200) { x, y in (Double(x) / 300, Double(y) / 200, 0.5) }
        let view = try XCTUnwrap(SubjectMasks.view(of: big.image, context: CubePassTests.context))
        XCTAssertEqual(view.width, 300, "a picture under the model's size is shown as it is")
        XCTAssertEqual(view.height, 200)
        XCTAssertEqual(view.colorSpace?.name.map { $0 as String }, CGColorSpace.sRGB as String)

        let wide = LayerPassTests.picture(width: 2048, height: 1024) { _, _ in (0.5, 0.5, 0.5) }
        let fitted = try XCTUnwrap(SubjectMasks.view(of: wide.image, context: CubePassTests.context))
        XCTAssertEqual(fitted.width, SubjectMasks.inputLongEdge)
        XCTAssertEqual(fitted.height, SubjectMasks.inputLongEdge / 2)
    }

    // MARK: - Vision itself, where it can run

    func testVisionFindsInstancesWhereItCanRun() throws {
        // A bright ellipse on a dark ground: whatever Vision makes of it, the
        // answer must be a well-formed map, and any instance it finds must
        // draw at the size of the picture it was shown.
        let w = 512
        let h = 384
        let context = try XCTUnwrap(CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                              space: RenderContexts.srgb,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(red: 0.12, green: 0.14, blue: 0.16, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: w, height: h))
        context.setFillColor(CGColor(red: 0.95, green: 0.35, blue: 0.2, alpha: 1))
        context.fillEllipse(in: CGRect(x: 160, y: 100, width: 190, height: 200))
        let picture = try XCTUnwrap(context.makeImage())

        let found: SubjectInstances
        do {
            found = try VisionSubjectSegmenter().instances(in: picture)
        } catch {
            throw XCTSkip("Vision cannot segment on this machine: \(error)")
        }
        XCTAssertEqual(found.labels.count, found.width * found.height)
        let all = IndexSet(found.labels.filter { $0 != 0 }.map { Int($0) })
        guard !all.isEmpty else {
            throw XCTSkip("Vision ran, and found no subject in a synthetic ellipse — nothing more to check here")
        }
        let map = try found.mask(all)
        XCTAssertEqual(map.extent.size, CGSize(width: w, height: h), "the mask is at the size of the picture shown")
    }
}
