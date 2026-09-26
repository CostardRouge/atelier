// Port of `src/shared/lib/prng.test.ts`, plus draws MEASURED in node against
// the web's own `mulberry32` — the proof that a seed stored by the web rolls
// the same numbers here.

import XCTest
@testable import AtelierKit

final class PRNGTests: XCTestCase {
    func testDrawsTheSameSequenceFromTheSameSeedADifferentOneFromAnother() {
        let a = mulberry32(42)
        let b = mulberry32(42)
        let c = mulberry32(43)
        let seqA = (0..<8).map { _ in a() }
        XCTAssertEqual((0..<8).map { _ in b() }, seqA)
        XCTAssertNotEqual((0..<8).map { _ in c() }, seqA)
    }

    func testStaysInZeroOneAndSpreads() {
        let r = mulberry32(7)
        var lo = 1.0
        var hi = 0.0
        for _ in 0..<10_000 {
            let v = r()
            XCTAssertGreaterThanOrEqual(v, 0)
            XCTAssertLessThan(v, 1)
            lo = min(lo, v)
            hi = max(hi, v)
        }
        XCTAssertLessThan(lo, 0.01)
        XCTAssertGreaterThan(hi, 0.99)
    }

    /// Measured in node (2026-09-25) with the web's function verbatim; the
    /// draws are exact to the last digit because the arithmetic is integer.
    func testDrawsTheWebsOwnNumbersFromTheWebsOwnSeed() {
        let r = mulberry32(42)
        XCTAssertEqual(r(), 0.60110375192016363)
        XCTAssertEqual(r(), 0.44829055899754167)
        XCTAssertEqual(r(), 0.85246579349040985)
        XCTAssertEqual(mulberry32(-7)(), 0.43306733411736786)
        XCTAssertEqual(mulberry32(5)(), 0.68977491091936827)
    }

    /// `seed | 0`: a fraction truncates, a value past 2³² wraps, NaN is 0.
    func testSeedsAsJavaScriptsToInt32Does() {
        XCTAssertEqual(mulberry32(12.7)(), mulberry32(12)())
        XCTAssertEqual(mulberry32(12)(), 0.28815091354772449)
        XCTAssertEqual(mulberry32(pow(2, 33) + 5)(), mulberry32(5)())
        XCTAssertEqual(mulberry32(.nan)(), mulberry32(0)())
        XCTAssertEqual(mulberry32(.nan)(), 0.26642920868471265)
    }
}
