// Port of `src/shared/film/film-noise.test.ts`, plus the tile's bytes and a
// phase MEASURED in node against the web's own functions: a seed stored on a
// grade must roll the same field on the phone as in the browser.

import XCTest
@testable import AtelierKit

final class FilmMakeGrainNoiseTests: XCTestCase {
    func testIsDeterministicPerSeedAndTwoSeedsDiffer() {
        let a = makeGrainNoise(5, 32)
        XCTAssertEqual(makeGrainNoise(5, 32), a)
        XCTAssertNotEqual(makeGrainNoise(6, 32), a)
        XCTAssertEqual(a.count, 32 * 32 * 4)
        XCTAssertEqual(makeGrainNoise(1).count, noiseSize * noiseSize * 4)
    }

    func testIsWhiteMeanNearHalfVarianceNearOneTwelfthChannelsUncorrelatedHistogramFlat() {
        let bytes = makeGrainNoise(11)
        let n = noiseSize * noiseSize
        let ch: [[Double]] = (0..<4).map { c in (0..<n).map { i in Double(bytes[i * 4 + c]) / 255 } }
        let means = ch.map { v in v.reduce(0, +) / Double(v.count) }
        for m in means { XCTAssertLessThan(abs(m - 0.5), 0.01) }
        var variance = [Double](repeating: 0, count: 4)
        for c in 0..<4 {
            var sum = 0.0
            for x in ch[c] {
                let d = x - means[c]
                sum += d * d
            }
            variance[c] = sum / Double(n)
        }
        for s2 in variance { XCTAssertLessThan(abs(s2 - 1.0 / 12), 0.005) }
        for a in 0..<4 {
            for b in (a + 1)..<4 {
                var cov = 0.0
                for i in 0..<n { cov += (ch[a][i] - means[a]) * (ch[b][i] - means[b]) }
                let r = cov / Double(n) / (variance[a] * variance[b]).squareRoot()
                XCTAssertLessThan(abs(r), 0.02)
            }
        }
        var bins = [Int](repeating: 0, count: 16)
        for i in 0..<n { bins[Int(bytes[i * 4] >> 4)] += 1 }
        for count in bins { XCTAssertLessThan(abs(Double(count) / (Double(n) / 16) - 1), 0.05) }
    }

    /// Measured in node (2026-09-25) with the web's functions verbatim.
    func testRollsTheWebsOwnBytesFromTheWebsOwnSeed() {
        let small = makeGrainNoise(5, 32)
        XCTAssertEqual(Array(small[0..<8]), [176, 197, 56, 159, 21, 151, 184, 117])
        XCTAssertEqual(small[small.count - 1], 124)
        let big = makeGrainNoise(101)
        XCTAssertEqual(big[0], 34)
        XCTAssertEqual(big[4095], 129)
        XCTAssertEqual(big[262143], 214)
    }
}

final class FilmGrainPhaseTests: XCTestCase {
    func testIsPureInFrameSeedInsideTheTileAndConsecutiveFramesLandCellsApart() {
        XCTAssertTrue(grainPhase(3, 9) == grainPhase(3, 9))
        XCTAssertFalse(grainPhase(3, 9) == grainPhase(4, 9))
        XCTAssertFalse(grainPhase(3, 9) == grainPhase(3, 10))
        let twoCells = 2 / Double(noiseSize)
        for i in 0..<2000 {
            let a = grainPhase(Double(i), 9)
            let b = grainPhase(Double(i + 1), 9)
            for v in [a.0, a.1, b.0, b.1] {
                XCTAssertGreaterThanOrEqual(v, 0)
                XCTAssertLessThan(v, 1)
            }
            let dx = min(abs(a.0 - b.0), 1 - abs(a.0 - b.0))
            let dy = min(abs(a.1 - b.1), 1 - abs(a.1 - b.1))
            XCTAssertGreaterThan(dx, twoCells)
            XCTAssertGreaterThan(dy, twoCells)
        }
    }

    func testANegativeOrFractionalFrameReadsAsItsFloorAtZero() {
        XCTAssertTrue(grainPhase(-2, 1) == grainPhase(0, 1))
        XCTAssertTrue(grainPhase(2.9, 1) == grainPhase(2, 1))
    }

    /// Measured in node (2026-09-25) with the web's functions verbatim.
    func testLandsWhereTheWebLandsForTheSameFrameAndSeed() {
        let p = grainPhase(3, 9)
        assertClose(p.0, 0.052830884347597973, 15)
        assertClose(p.1, 0.093851483393530000, 15)
        let first = grainPhase(0, 106)
        assertClose(first.0, 0.20949179562740028, 15)
        assertClose(first.1, 0.65480248210951686, 15)
        let far = grainPhase(1000, 106)
        assertClose(far.0, 0.24348054552228859, 12)
        assertClose(far.1, 0.86836485520456108, 12)
    }
}

final class FilmSampleGrainTileTests: XCTestCase {
    private let size = 8
    private lazy var bytes = makeGrainNoise(3, size)

    func testOnATexelCentreItIsThatTexel() {
        for (ix, iy) in [(0, 0), (3, 5), (size - 1, size - 1)] {
            let got = sampleGrainTile(bytes, (Double(ix) + 0.5) / Double(size), (Double(iy) + 0.5) / Double(size), size)
            let want = grainSampleFrom(bytes, iy * size + ix)
            assertClose(got.luma, want.luma, 12)
            assertClose(got.r, want.r, 12)
            assertClose(got.g, want.g, 12)
            assertClose(got.b, want.b, 12)
        }
    }

    func testHalfwayBetweenTwoTexelsItIsTheirMeanAndItWrapsLikeRepeat() {
        let left = grainSampleFrom(bytes, 0 * size + 2)
        let right = grainSampleFrom(bytes, 0 * size + 3)
        let mid = sampleGrainTile(bytes, 3 / Double(size), 0.5 / Double(size), size)
        assertClose(mid.luma, (left.luma + right.luma) / 2, 12)
        assertClose(mid.r, (left.r + right.r) / 2, 12)
        assertClose(mid.g, (left.g + right.g) / 2, 12)
        assertClose(mid.b, (left.b + right.b) / 2, 12)
        // One tile along is the same field, and the left edge blends with the right.
        let at = sampleGrainTile(bytes, 0.31, 0.62, size)
        let wrapped = sampleGrainTile(bytes, 1.31, -0.38, size)
        assertClose(wrapped.luma, at.luma, 12)
        assertClose(wrapped.r, at.r, 12)
        assertClose(wrapped.g, at.g, 12)
        assertClose(wrapped.b, at.b, 12)
        let edge = sampleGrainTile(bytes, 0, 0.5 / Double(size), size)
        let first = grainSampleFrom(bytes, 0)
        let last = grainSampleFrom(bytes, size - 1)
        assertClose(edge.luma, (first.luma + last.luma) / 2, 12)
        assertClose(edge.r, (first.r + last.r) / 2, 12)
        assertClose(edge.g, (first.g + last.g) / 2, 12)
        assertClose(edge.b, (first.b + last.b) / 2, 12)
    }

    func testIsBandLimitedABilinearReadNeverLeavesTheRangeOfItsFourTexels() {
        // The web draws `Math.random()` here; a spec may, the render path never.
        for _ in 0..<500 {
            let got = sampleGrainTile(bytes, Double.random(in: -1..<2), Double.random(in: -1..<2), size)
            for v in [got.luma, got.r, got.g, got.b] {
                XCTAssertGreaterThanOrEqual(v, -0.5)
                XCTAssertLessThanOrEqual(v, 0.5)
            }
        }
    }
}

final class FilmGrainFrameIndexTests: XCTestCase {
    func testQuantisesSourceTimeToTheGrainCadenceAndFreezesAt0Fps() {
        XCTAssertEqual(grainFrameIndex(0, 24), 0)
        XCTAssertEqual(grainFrameIndex(1, 24), 24)
        XCTAssertEqual(grainFrameIndex(1.0 / 60, 24), 0)
        XCTAssertEqual(grainFrameIndex(2.0 / 24 + 1e-9, 24), 2)
        XCTAssertEqual(grainFrameIndex(3.7, 0), 0)
        XCTAssertEqual(grainFrameIndex(-1, 24), 0)
        XCTAssertEqual(grainFrameIndex(.nan, 24), 0)
    }
}
