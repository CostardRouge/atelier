// Shared assertions for the kernel's specs — the TypeScript twins use Jest's
// `toBeCloseTo(x, digits)`, whose tolerance is `10^−digits / 2`; every port
// below keeps the same digits so a drift shows at the same place.

import Foundation
import XCTest
@testable import AtelierKit

typealias RGB = (Double, Double, Double)

/// Jest's `toBeCloseTo`: |a − b| < 10^−digits / 2.
func assertClose(_ a: Double, _ b: Double, _ digits: Int = 5, _ message: String = "",
                 file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(a, b, accuracy: pow(10, -Double(digits)) / 2, message, file: file, line: line)
}

/// The three channels each within `digits`.
func assertTriple(_ got: RGB, _ want: RGB, _ digits: Int = 9, file: StaticString = #filePath, line: UInt = #line) {
    assertClose(got.0, want.0, digits, "red", file: file, line: line)
    assertClose(got.1, want.1, digits, "green", file: file, line: line)
    assertClose(got.2, want.2, digits, "blue", file: file, line: line)
}

/// The three channels bit-identical — what "an untouched pixel comes back
/// bit-identical" means.
func assertExact(_ got: RGB, _ want: RGB, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(got.0, want.0, "red", file: file, line: line)
    XCTAssertEqual(got.1, want.1, "green", file: file, line: line)
    XCTAssertEqual(got.2, want.2, "blue", file: file, line: line)
}

/// A develop with a few fields changed from "as shot".
func dev(_ change: (inout DevelopSettings) -> Void) -> DevelopSettings {
    var d = DevelopSettings.default
    change(&d)
    return d
}

/// A framing with a few fields changed from the centred cover-crop.
func framing(_ change: (inout Framing) -> Void) -> Framing {
    var f = Framing.default
    change(&f)
    return f
}

/// A curve as a document would hold it.
func curveJSON(_ c: Curve) -> JSONValue {
    .array(c.map { .object(["x": .number($0.x), "y": .number($0.y)]) })
}

/// A gentle S: shadows down, highlights up, ends pinned.
let sCurve: Curve = [
    CurvePoint(x: 0, y: 0),
    CurvePoint(x: 0.25, y: 0.18),
    CurvePoint(x: 0.75, y: 0.82),
    CurvePoint(x: 1, y: 1),
]

/// The shape that breaks a naive cubic: a long flat run, then a cliff.
let cliffCurve: Curve = [
    CurvePoint(x: 0, y: 0),
    CurvePoint(x: 0.45, y: 0.02),
    CurvePoint(x: 0.55, y: 0.98),
    CurvePoint(x: 1, y: 1),
]

/// `n` samples of [0, 1], ends included.
func samples(_ n: Int = 1001) -> [Double] {
    (0..<n).map { Double($0) / Double(n - 1) }
}
