// Port of `src/shared/render/brush-raster.test.ts`.

import XCTest
@testable import AtelierKit

private func dab(_ change: (inout BrushStroke) -> Void = { _ in }) -> BrushStroke {
    var s = BrushStroke(points: [Point(0.5, 0.5)], radius: 0.2, hardness: 0.5, erase: false)
    change(&s)
    return s
}

final class StrokeCoverageTests: XCTestCase {
    func testIsFullOnTheSpineAndEmptyPastTheRadius() {
        // A dab at the middle of a SQUARE frame sits at the centred origin,
        // and its radius is in centred units — the half-diagonal.
        let s = dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 0.3 }
        XCTAssertEqual(strokeCoverage(s, 0, 0, 1), 1)
        XCTAssertEqual(strokeCoverage(s, 0.31, 0, 1), 0)
        XCTAssertEqual(strokeCoverage(s, 5, 5, 1), 0)
    }

    func testFallsOffMonotonicallyOutward() {
        let s = dab { $0.radius = 0.4; $0.hardness = 0 }
        var last = 2.0
        var d = 0.0
        while d <= 0.5 {
            let c = strokeCoverage(s, d, 0, 1)
            XCTAssertLessThanOrEqual(c, last + 1e-12)
            last = c
            d += 0.01
        }
    }

    func testHardnessWidensTheSolidCoreAndNeverLeavesABareStep() {
        let soft = dab { $0.radius = 0.4; $0.hardness = 0 }
        let hard = dab { $0.radius = 0.4; $0.hardness = 1 }
        // Half way out, a hard brush is still solid and a soft one is not.
        XCTAssertTrue(hard.hardness > soft.hardness)
        XCTAssertGreaterThan(strokeCoverage(hard, 0.2, 0, 1), strokeCoverage(soft, 0.2, 0, 1))
        // Even at hardness 1 the very edge is not a cliff: there is a hair of
        // falloff, or the raster would alias along every stroke.
        XCTAssertLessThan(strokeCoverage(hard, 0.399, 0, 1), 1)
        XCTAssertGreaterThan(strokeCoverage(hard, 0.399, 0, 1), 0)
    }

    func testFollowsAPolylineNotJustItsEnds() {
        let line = dab { $0.points = [Point(0.2, 0.5), Point(0.8, 0.5)]; $0.radius = 0.1; $0.hardness = 1 }
        // A point ON the run, away from both ends, is covered; one above it is not.
        XCTAssertEqual(brushAt([line], 0.5, 0.5), 1)
        XCTAssertEqual(brushAt([line], 0.5, 0.05), 0)
    }

    func testIsADabForAOnePointStrokeRatherThanNothing() {
        XCTAssertEqual(brushAt([dab { $0.points = [Point(0.5, 0.5)]; $0.hardness = 1 }], 0.5, 0.5), 1)
        XCTAssertEqual(brushAt([dab { $0.points = [] }], 0.5, 0.5), 0)
    }
}

final class StrokeOrderTests: XCTestCase {
    private let paint = dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 0.4; $0.hardness = 1 }
    private let erase = dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 0.2; $0.hardness = 1; $0.erase = true }

    func testAnEraserTakesAwayWhatIsUnderIt() {
        XCTAssertEqual(brushAt([paint], 0.5, 0.5), 1)
        XCTAssertEqual(brushAt([paint, erase], 0.5, 0.5), 0)
    }

    func testAndAStrokePaintedAfterTheEraserComesBack() {
        // This is what makes painting feel like painting: order, not set algebra.
        XCTAssertEqual(brushAt([paint, erase, paint], 0.5, 0.5), 1)
    }

    func testAnEraserOverNothingLeavesNothingRatherThanGoingNegative() {
        XCTAssertEqual(brushAt([erase], 0.5, 0.5), 0)
    }
}

final class EmptyPaintedMaskTests: XCTestCase {
    func testCoversNothingOnlyTheAbsenceOfAMaskIsTheWholePicture() {
        XCTAssertEqual(maskAt(.brush(BrushMask(strokes: [])), 0.5, 0.5, 0.5), 0)
        XCTAssertEqual(maskAt(nil, 0.5, 0.5, 0.5), 1)
    }
}

final class BrushRasterTests: XCTestCase {
    func testKeepsTheFramesShapeWithTheLongEdgeCapped() {
        XCTAssertTrue(brushRasterSize(1.5) == (1024, 683))
        XCTAssertTrue(brushRasterSize(0.5) == (512, 1024))
        XCTAssertTrue(brushRasterSize(1) == (brushRasterLongEdge, 1024))
    }

    func testIsTheSameFunctionAsThePureModuleTexelForTexel() {
        // The claim `BrushRaster.swift` rests on, and what lets the GPU be held
        // to the same tolerance as the procedural shapes.
        let strokes = [
            dab { $0.points = [Point(0.3, 0.3), Point(0.6, 0.55)]; $0.radius = 0.25; $0.hardness = 0.3 },
            dab { $0.points = [Point(0.5, 0.45)]; $0.radius = 0.1; $0.hardness = 1; $0.erase = true },
        ]
        let ar = 1.5
        let r = rasteriseBrush(strokes, ar, 128)
        for (fx, fy) in [(0.1, 0.1), (0.3, 0.3), (0.45, 0.4), (0.5, 0.45), (0.62, 0.56), (0.9, 0.8)] {
            let x = min(r.width - 1, Int((fx * Double(r.width)).rounded(.down)))
            let y = min(r.height - 1, Int((fy * Double(r.height)).rounded(.down)))
            let got = Double(r.data[y * r.width + x]) / 255
            let want = brushAt(strokes, (Double(x) + 0.5) / Double(r.width), (Double(y) + 0.5) / Double(r.height), ar)
            // One 8-bit code, which is the quantisation and nothing else.
            XCTAssertLessThanOrEqual(abs(got - want), 1.0 / 255 + 1e-9)
        }
    }

    func testLeavesTheFrameEmptyWhereNothingWasPainted() {
        let r = rasteriseBrush([dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 0.05 }], 1, 64)
        XCTAssertEqual(r.data[0], 0)
        XCTAssertEqual(r.data[r.data.count - 1], 0)
        XCTAssertEqual(r.data[(r.height / 2) * r.width + r.width / 2], 255)
    }

    func testCostsTheAreaPaintedNotTheFrame() {
        // A tiny dab on a big map must not walk every texel — the property
        // that makes a live drag possible. Measured as time, which is crude,
        // so the margin is generous: a full walk is ~250x the work.
        let tiny = [dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 0.02 }]
        let wide = [dab { $0.points = [Point(0.5, 0.5)]; $0.radius = 1.4 }]
        let t0 = Date()
        for _ in 0..<20 { _ = rasteriseBrush(tiny, 1.5, 512) }
        let small = Date().timeIntervalSince(t0)
        let t1 = Date()
        for _ in 0..<20 { _ = rasteriseBrush(wide, 1.5, 512) }
        let big = Date().timeIntervalSince(t1)
        XCTAssertLessThan(small, big)
    }

    func testIsEmptyForNoStrokesAtAll() {
        let r = rasteriseBrush([], 1, 32)
        XCTAssertTrue(r.data.allSatisfy { $0 == 0 })
    }
}
