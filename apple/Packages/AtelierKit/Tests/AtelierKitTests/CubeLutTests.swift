// Port of `src/shared/lib/cube-parser.test.ts` and `src/shared/lut/interpolate.test.ts`.

import XCTest
@testable import AtelierKit

/// A minimal valid 2×2×2 identity LUT (red varies fastest).
private let identity2 = """
# Generated for tests
TITLE "Test Identity"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0

"""

private func identity(_ n: Int = 5) -> CubeLut {
    CubeLut.make(size: n) { r, g, b in (r, g, b) }
}

/// Affine: trilinear reproduces any affine transform exactly.
private func affine(_ n: Int = 5) -> CubeLut {
    CubeLut.make(size: n) { r, g, b in
        (0.3 * r + 0.6 * g, g * 0.8 + 0.1, b * 0.5 + r * 0.2)
    }
}

/// Non-affine AND channel-asymmetric, but neutral-preserving: every
/// correction is driven by a squared channel DIFFERENCE, zero when r=g=b.
private func neutralSafe(_ n: Int = 5) -> CubeLut {
    CubeLut.make(size: n) { r, g, b in
        let x = r + 0.6 * (g - b) * (g - b)
        let y = g + 0.2 * (b - r) * (b - r)
        let z = b - 0.35 * (r - g) * (r - g)
        return (x, y, z)
    }
}

private func spread(_ p: RGB) -> Double { max(p.0, p.1, p.2) - min(p.0, p.1, p.2) }

final class CubeParserTests: XCTestCase {
    func testParsesAValid2x2x2LUTWithTheRightSizeAndLength() {
        let lut = parseCube(identity2)
        XCTAssertNotNil(lut)
        XCTAssertEqual(lut?.size, 2)
        XCTAssertEqual(lut?.data.count, 24)
    }

    func testKeepsTableOrderWithRedVaryingFastest() {
        let lut = parseCube(identity2)!
        XCTAssertEqual(Array(lut.data[3..<6]), [1, 0, 0])
        XCTAssertEqual(Array(lut.data[21..<24]), [1, 1, 1])
    }

    func testParsesTheTitle() {
        XCTAssertEqual(parseCube(identity2)?.title, "Test Identity")
    }

    func testDefaultsTheDomainToUnitWhenNotSpecified() {
        let lut = parseCube(identity2)!
        XCTAssertTrue(lut.domainMin == (0, 0, 0))
        XCTAssertTrue(lut.domainMax == (1, 1, 1))
    }

    func testReadsAnExplicitDomain() {
        let rows = Array(repeating: "0.5 0.5 0.5", count: 8).joined(separator: "\n")
        let lut = parseCube("LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n" + rows + "\n")!
        XCTAssertTrue(lut.domainMax == (2, 2, 2))
    }

    func testRejectsA1DLUT() {
        XCTAssertNil(parseCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n"))
    }

    func testRejectsATruncatedTable() {
        XCTAssertNil(parseCube("LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n"))
    }

    func testRejectsAnOverlongTable() {
        XCTAssertNil(parseCube(identity2 + "0.5 0.5 0.5\n"))
    }

    func testReturnsNilForEmptyOrNonCubeInput() {
        XCTAssertNil(parseCube(""))
        XCTAssertNil(parseCube("not a cube file at all"))
    }

    func testIgnoresCommentsBlankLinesAndWindowsLineEndings() {
        let withNoise = "# a comment\r\n\r\nLUT_3D_SIZE 2\r\n\r\n# another\r\n"
            + "0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1\r\n"
        let lut = parseCube(withNoise)
        XCTAssertNotNil(lut)
        XCTAssertEqual(lut?.size, 2)
    }

    func testTheIdentityCubeIsTheSmallestCubeThatChangesNothing() {
        let cube = CubeLut.identity()
        XCTAssertEqual(cube.size, 2)
        XCTAssertEqual(cube, parseCube(identity2).map { CubeLut(size: $0.size, data: $0.data) })
    }
}

final class InterpolationTests: XCTestCase {
    private let samplers: [(String, (CubeLut, Double, Double, Double) -> RGB)] = [
        ("trilinear", sampleTrilinear), ("tetrahedral", sampleTetrahedral),
    ]

    func testBothReproduceTheIdentityLUTExactly() {
        for (name, s) in samplers {
            for v in [0.0, 0.137, 0.5, 0.812, 1] {
                let out = s(identity(), v, v * 0.3, 1 - v)
                assertClose(out.0, v, 6, name)
                assertClose(out.1, v * 0.3, 6, name)
                assertClose(out.2, 1 - v, 6, name)
            }
        }
    }

    func testBothAgreeExactlyAtTheLatticeNodes() {
        let lut = neutralSafe(5)
        for i in 0..<5 {
            for j in 0..<5 {
                let (r, g, b) = (Double(i) / 4, Double(j) / 4, Double((i + j) % 5) / 4)
                assertTriple(sampleTetrahedral(lut, r, g, b), sampleTrilinear(lut, r, g, b), 6)
            }
        }
    }

    func testBothReproduceAnAffineLUTExactly() {
        let lut = affine(3)
        let inputs: [RGB] = [(0.21, 0.44, 0.67), (0.9, 0.13, 0.5)]
        for (r, g, b) in inputs {
            let truth: RGB = (0.3 * r + 0.6 * g, g * 0.8 + 0.1, b * 0.5 + r * 0.2)
            for (name, s) in samplers {
                let got = s(lut, r, g, b)
                assertClose(got.0, truth.0, 6, name)
                assertClose(got.1, truth.1, 6, name)
                assertClose(got.2, truth.2, 6, name)
            }
        }
    }

    func testBothHonourTheDomainAndClampOutsideIt() {
        let lut = CubeLut.make(size: 3, { r, g, b in (r, g, b) }, domainMin: (0.2, 0.2, 0.2), domainMax: (0.8, 0.8, 0.8))
        for (name, s) in samplers {
            assertClose(s(lut, 0.5, 0.5, 0.5).0, 0.5, 6, name)
            assertClose(s(lut, 0, 0, 0).0, 0, 6, name)
            assertClose(s(lut, 1, 1, 1).0, 1, 6, name)
            assertClose(s(lut, -5, -5, -5).0, 0, 6, name)
            assertClose(s(lut, 9, 9, 9).0, 1, 6, name)
        }
    }

    func testTetrahedralLeavesGreysGreyWhereTrilinearTintsThem() {
        let lut = neutralSafe(5)
        var worstTri = 0.0
        for i in 1..<200 {
            let v = Double(i) / 200
            XCTAssertLessThan(spread(sampleTetrahedral(lut, v, v, v)), 1e-12)
            worstTri = max(worstTri, spread(sampleTrilinear(lut, v, v, v)))
        }
        // Trilinear really does drift — otherwise this test proves nothing.
        XCTAssertGreaterThan(worstTri, 0.002)
    }

    func testTetrahedralHoldsOnTheNeutralAxisForAnyLatticeSize() {
        for n in [2, 3, 8, 17] {
            let lut = neutralSafe(n)
            for v in [0.05, 0.33, 0.5, 0.77, 0.95] {
                XCTAssertLessThan(spread(sampleTetrahedral(lut, v, v, v)), 1e-12)
            }
        }
    }

    func testSampleWithDispatchesToTheRequestedMode() {
        let lut = neutralSafe(5)
        let v = 0.42
        XCTAssertTrue(sampleWith(lut, v, v, v, .tetrahedral) == sampleTetrahedral(lut, v, v, v))
        XCTAssertTrue(sampleWith(lut, v, v, v, .trilinear) == sampleTrilinear(lut, v, v, v))
    }
}
