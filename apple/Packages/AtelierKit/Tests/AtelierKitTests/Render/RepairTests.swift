// Port of `src/shared/render/repair.test.ts`.

import XCTest
@testable import AtelierKit

private func picture(_ w: Int, _ h: Int, _ fill: (Int, Int) -> RGB) -> DetailImage {
    DetailImage(width: w, height: h, fill: fill)
}

private func patch(id: String = "p1", kind: PatchKind = .heal, x: Double = 0.5, y: Double = 0.5, radius: Double = 0.1,
                   feather: Double = 0.5, dx: Double = 0.2, dy: Double = 0) -> Patch {
    Patch(id: id, kind: kind, x: x, y: y, radius: radius, feather: feather, dx: dx, dy: dy)
}

final class RenderRepairRecordTests: XCTestCase {
    func testReadsBackClampedDropsJunkAndARepeatedIdCapsTheList() {
        XCTAssertEqual(
            normalisePatch(["id": "a", "kind": "clone", "x": 2, "y": -1, "radius": 9, "feather": 3, "dx": 5]),
            Patch(id: "a", kind: .clone, x: 1, y: 0, radius: patchRadiusRange.max, feather: 1, dx: 1, dy: 0)
        )
        XCTAssertEqual(normalisePatch(["id": "a", "kind": "weird"])!.kind, .heal)
        XCTAssertNil(normalisePatch(["kind": "heal"]))
        let list = readPatches([["id": "a"], ["id": "a"], "junk", ["id": "b", "radius": 0.02]])
        XCTAssertEqual(list.map { $0.id }, ["a", "b"])
        let many = readPatches(.array((0..<100).map { .object(["id": .string("p\($0)")]) }))
        XCTAssertEqual(many.count, maxPatches)
        XCTAssertTrue(samePatches([patch()], [patch()]))
        XCTAssertFalse(samePatches([patch()], [patch(dx: 0.1)]))
        XCTAssertTrue(samePatches(nil, []))
        XCTAssertEqual(describePatches([patch(), patch(id: "p2", kind: .clone)]), "2 patches · 1 healed, 1 cloned")
        XCTAssertEqual(describePatches([]), "")
    }
}

final class RenderRepairPlacingTests: XCTestCase {
    func testMovesAPatchClampedToTheFrameItsSourceTravellingWithIt() {
        let moved = movePatch(patch(dx: 0.2, dy: 0.1), 0.8, 1.4)
        XCTAssertEqual(moved.x, 0.8)
        XCTAssertEqual(moved.y, 1)
        XCTAssertEqual(moved.dx, 0.2)
        XCTAssertEqual(moved.dy, 0.1)
        let changed = adjustPatch(patch(), kind: .clone, radius: 9, feather: -1)
        XCTAssertEqual(changed.kind, .clone)
        XCTAssertEqual(changed.radius, patchRadiusRange.max)
        XCTAssertEqual(changed.feather, 0)
        XCTAssertEqual(adjustPatch(patch()), patch())
    }

    func testGivesADefaultSourceToTheRightMirroredAtTheRightEdge() {
        let p = patch(x: 0.5, y: 0.5, radius: 0.1)
        let ru = patchExtent(p, 1.5).ru
        let source = defaultSource(p, 1.5)
        XCTAssertEqual(source.dx, ru * defaultSourceRadii)
        XCTAssertEqual(source.dy, 0)
        XCTAssertLessThan(defaultSource(patch(x: 0.95, y: 0.5, radius: 0.1), 1.5).dx, 0)
    }

    func testReadsTheAngleFromTheHandInsideTheDiscAndHoldsTheSourceToTheTouchingDistance() {
        let p = patch(x: 0.5, y: 0.5, radius: 0.1)
        let extent = patchExtent(p, 1.5)
        let ru = extent.ru
        let rv = extent.rv
        // A pointer half a radius above the centre — well inside the disc.
        let up = placeSource(p, Point(0.5, 0.5 - rv * 0.5), 1.5)!
        assertClose(up.dx, 0, 9)
        assertClose(up.dy, -rv * minSourceRadii, 9)
        // Diagonal, still inside: the direction is kept, the distance is the minimum.
        let diag = placeSource(p, Point(0.5 + ru * 0.3, 0.5 + rv * 0.3), 1.5)!
        assertClose(diag.dx / ru, diag.dy / rv, 9)
        assertClose(hypot(diag.dx / ru, diag.dy / rv), minSourceRadii, 9)
        // Past the minimum the source is exactly where the hand is.
        let far = placeSource(p, Point(0.5 + ru * 3, 0.5), 1.5)!
        assertClose(far.dx, ru * 3, 9)
        assertClose(far.dy, 0, 9)
        // A press with no direction yet says nothing.
        XCTAssertNil(placeSource(p, Point(0.5 + ru * 0.05, 0.5), 1.5))
    }

    func testKeepsTheSourceDiscInsideTheFrame() {
        let p = patch(x: 0.9, y: 0.5, radius: 0.1)
        let ru = patchExtent(p, 1.5).ru
        let out = placeSource(p, Point(1.2, 0.5), 1.5)!
        XCTAssertLessThanOrEqual(p.x + out.dx + ru, 1 + 1e-9)
        XCTAssertGreaterThanOrEqual(p.x + out.dx - ru, 0)
    }
}

final class RenderRepairCoverageAndSamplingTests: XCTestCase {
    func testIs1InTheCore0PastTheRadiusAndFadesBetweenMeasuredAgainstTheHalfDiagonal() {
        let p = patch(x: 0.5, y: 0.5, radius: 0.1, feather: 0.5)
        XCTAssertEqual(patchCoverageAt(p, 0.5, 0.5, 1.5), 1)
        // A point far away.
        XCTAssertEqual(patchCoverageAt(p, 0.9, 0.5, 1.5), 0)
        // On the ring, halfway through the feather: between 0 and 1.
        let ru = patchExtent(p, 1.5).ru
        let mid = patchCoverageAt(p, 0.5 + ru * 0.75, 0.5, 1.5)
        XCTAssertGreaterThan(mid, 0)
        XCTAssertLessThan(mid, 1)
        XCTAssertEqual(patchSource(p), Point(0.7, 0.5))
    }

    func testSamplesLikeGLLinearWithClampToEdgeTexelCentresExactHalfwayBlendedEdgesHeld() {
        let img = picture(4, 1) { x, _ in (Double(x) / 3, 0, 0) }
        assertClose(sampleAt(img, 0.5 / 4, 0.5).0, 0, 6)
        assertClose(sampleAt(img, 1.5 / 4, 0.5).0, 1.0 / 3, 6)
        assertClose(sampleAt(img, 1.0 / 4, 0.5).0, 1.0 / 6, 6)
        XCTAssertEqual(sampleAt(img, -1, 0.5).0, 0)
        assertClose(sampleAt(img, 2, 0.5).0, 1, 6)
    }
}

final class RenderRepairAtTests: XCTestCase {
    func testClonesTheSourcePixelIntoTheDestinationAndLeavesTheRestAlone() {
        // Left half dark, right half bright; a clone at the left copies from the right.
        let img = picture(60, 40) { x, _ in x < 30 ? (0.2, 0.2, 0.2) : (0.8, 0.8, 0.8) }
        let p = patch(kind: .clone, x: 0.25, y: 0.5, radius: 0.08, feather: 0.3, dx: 0.5, dy: 0)
        assertClose(repairAt(img, 0.25, 0.5, [p], 1.5).0, 0.8, 6)
        assertClose(repairAt(img, 0.1, 0.1, [p], 1.5).0, 0.2, 6)
        assertClose(repairAt(img, 0.75, 0.5, [p], 1.5).0, 0.8, 6)
    }

    func testHealsTheSourcesTextureArrivesAtTheDestinationsTone() {
        // A bright field with a dark spot at the destination; the source is a
        // bright field with faint texture. Healing must NOT paste the source's
        // brightness (a clone would): it pastes the source's texture shifted so
        // its mean matches the destination's own surroundings.
        let img = picture(80, 60) { x, y in
            let spot = hypot(Double(x - 20), Double(y - 30)) < 3
            let texture = Double((x + y) % 2) * 0.02
            let base = x < 40 ? 0.7 : 0.4 // the source side is DARKER
            if spot { return (0.1, 0.1, 0.1) }
            let v = base + texture
            return (v, v, v)
        }
        let p = patch(kind: .heal, x: 0.25, y: 0.5, radius: 0.12, feather: 0.4, dx: 0.5, dy: 0)
        let means = patchMeans(img, p, 80.0 / 60)
        // The means are of the SURROUNDINGS: the destination's ring is the bright
        // field, untouched by the spot in its middle; the source's is the darker one.
        XCTAssertGreaterThan(means.dst.0, 0.65)
        XCTAssertLessThan(means.src.0, means.dst.0)
        let healed = repairAt(img, 0.25, 0.5, [p], 80.0 / 60)
        // Not the source's 0.4 (a clone), not the spot's 0.1: the bright field
        // the destination lives in, with the source's texture on it.
        XCTAssertGreaterThan(healed.0, 0.65)
        XCTAssertLessThan(healed.0, 0.76)
        // And a clone of the same would have brought the dark side over.
        var clone = p
        clone.kind = .clone
        XCTAssertLessThan(repairAt(img, 0.25, 0.5, [clone], 80.0 / 60).0, 0.45)
    }

    func testAppliesPatchesInOrderEachOverTheLast() {
        let img = picture(40, 40) { x, y in (x < 20 ? 0.2 : 0.8, y < 20 ? 0.3 : 0.9, 0.5) }
        let first = patch(id: "a", kind: .clone, x: 0.25, y: 0.25, radius: 0.1, feather: 0, dx: 0.5, dy: 0)
        let second = patch(id: "b", kind: .clone, x: 0.25, y: 0.25, radius: 0.1, feather: 0, dx: 0, dy: 0.5)
        let out = repairAt(img, 0.25, 0.25, [first, second], 1)
        // The second patch wins where both cover: it copies from below.
        assertClose(out.1, 0.9, 6)
        assertClose(out.0, 0.2, 6)
    }
}

final class RenderRepairDetectDustTests: XCTestCase {
    func testFindsSmallDarkRoundSpotsAndIgnoresAWireABigShapeAndTheCleanField() {
        let W = 600
        let H = 400
        let img = picture(W, H) { x, y in
            var v = 0.7 + sin(Double(x) / 40) * 0.02
            if hypot(Double(x - 100), Double(y - 100)) < 4 { v = 0.4 } // dust
            if hypot(Double(x - 300), Double(y - 250)) < 6 { v = 0.45 } // dust
            if x > 400 && x < 520 && y > 100 && y < 200 { v = 0.3 } // a dark rectangle: far too big
            if y == 320 && x > 50 && x < 350 { v = 0.2 } // a wire
            return (v, v, v)
        }
        let spots = detectDust(img, DustOptions(makeId: { "d\(Double.random(in: 0..<1))" }))
        XCTAssertEqual(spots.count, 2)
        func near(_ p: Patch, _ x: Int, _ y: Int) -> Bool {
            hypot(p.x - Double(x) / Double(W), p.y - Double(y) / Double(H)) < 0.01
        }
        XCTAssertTrue(spots.contains { near($0, 100, 100) })
        XCTAssertTrue(spots.contains { near($0, 300, 250) })
        for p in spots {
            XCTAssertEqual(p.kind, .heal)
            XCTAssertEqual(p.feather, defaultPatchFeather)
            XCTAssertGreaterThan(hypot(p.dx, p.dy), 0)
            // The source is inside the frame.
            let s = patchSource(p)
            XCTAssertGreaterThan(s.x, 0)
            XCTAssertLessThan(s.x, 1)
        }
        // Healing the found spot brings it back to the field.
        let fixed = repairAt(img, 100.0 / Double(W), 100.0 / Double(H), spots, Double(W) / Double(H))
        XCTAssertGreaterThan(fixed.0, 0.62)
        XCTAssertEqual(detectDust(picture(200, 100) { _, _ in (0.5, 0.5, 0.5) }), [])
    }

    func testIsAFieldMeasuredOnceReadAtAnySensitivity() {
        let W = 400
        let H = 300
        let img = picture(W, H) { x, y in
            var v = 0.7
            if hypot(Double(x - 100), Double(y - 100)) < 4 { v = 0.4 } // deep
            if hypot(Double(x - 300), Double(y - 200)) < 4 { v = 0.62 } // shallow: 0.08 below
            return (v, v, v)
        }
        let field = dustField(img)!
        XCTAssertEqual(field.width, W)
        assertClose(field.aspectRatio, Double(W) / Double(H), 9)
        assertClose(dustThreshold(0), dustThresholdRange.gentle, 12)
        assertClose(dustThreshold(1), dustThresholdRange.keen, 12)
        // Gentle finds the deep one alone, keen finds both, darkest first.
        XCTAssertEqual(dustSpots(field, threshold: dustThreshold(0)).count, 1)
        let keen = dustSpots(field, threshold: dustThreshold(1))
        XCTAssertEqual(keen.count, 2)
        XCTAssertGreaterThan(keen[0].depth, keen[1].depth)
        assertClose(keen[0].x, 100.0 / Double(W), 2)
        // The veil reads the same measure: 1 at a spot the threshold finds, 0 on the field.
        let veil = dustVeil(field, 0.2)
        XCTAssertEqual(veil[100 * W + 100], 1)
        XCTAssertEqual(veil[10 * W + 10], 0)
        XCTAssertGreaterThan(veil[200 * W + 300], 0.25)
        XCTAssertLessThan(veil[200 * W + 300], 1)
        // A spot becomes a heal sourced from a clean neighbour; a source is never on another spot.
        let p = dustPatch(field, keen[0], { "d1" })!
        XCTAssertEqual(p.kind, .heal)
        assertClose(p.x, 100.0 / Double(W), 2)
        XCTAssertGreaterThan(hypot(p.dx, p.dy), 0)
    }

    func testIgnoresADarkBlobOnRestlessGroundAndAWireAtAnyAngle() {
        let W = 600
        let H = 400
        // A pseudo-random texture on the right half, a smooth sky on the left.
        var seed: UInt32 = 7
        func rnd() -> Double {
            seed = seed &* 1664525 &+ 1013904223
            return Double(seed) / 4294967296
        }
        var noise = [Float](repeating: 0, count: W * H)
        for i in 0..<(W * H) { noise[i] = Float((rnd() - 0.5) * 0.3) }
        let img = picture(W, H) { x, y in
            var v = x < 300 ? 0.7 : 0.6 + Double(noise[y * W + x])
            if hypot(Double(x - 100), Double(y - 100)) < 4 { v = 0.45 } // dust, in the sky
            if hypot(Double(x - 450), Double(y - 100)) < 4 { v = 0.45 } // the same blob, in the texture
            if abs(Double(x - y - 50)) < 1.5 && x > 60 && x < 260 { v = 0.2 } // a diagonal wire in the sky
            return (v, v, v)
        }
        let field = dustField(img)!
        let spots = dustSpots(field, threshold: dustThreshold(0.5))
        XCTAssertEqual(spots.count, 1)
        assertClose(spots[0].x, 100.0 / Double(W), 2)
    }
}
