// Port of `src/shared/render/clipping.test.ts` (`clipOf` itself lives in
// `Histogram.swift`, ported with the histogram; its cases are kept here so the
// rule is pinned where the web pins it).

import XCTest
@testable import AtelierKit

final class ClipOfTests: XCTestCase {
    func testIsWhiteWhenAnyChannelReaches254BlackOnlyWhenEveryChannelIsAt1OrUnder() {
        XCTAssertEqual(clipOf(254, 10, 10), .white)
        XCTAssertEqual(clipOf(10, 10, 255), .white)
        XCTAssertNil(clipOf(253, 253, 253))
        XCTAssertEqual(clipOf(1, 0, 1), .black)
        XCTAssertNil(clipOf(0, 0, 30))
    }

    func testAsksWhiteFirstAPixelIsNeverBoth() {
        XCTAssertEqual(clipOf(0, 0, 255), .white)
    }
}

final class ReadoutOfTests: XCTestCase {
    func testReadsTheNumbersWhenTheViewIsOffEvenOverAMark() {
        XCTAssertEqual(readoutOf(0, 128, 255, clipping: false), .value(r: 0, g: 128, b: 255))
    }

    func testReadsAMarkAsTheClipItPaintsWhenTheViewIsOnWithinAStep() {
        let white = clipMarks[.white]!
        XCTAssertEqual(readoutOf(Double(white.r), Double(white.g), Double(white.b), clipping: true), .clip(.white))
        XCTAssertEqual(readoutOf(1, 127, 254, clipping: true), .clip(.black))
        XCTAssertEqual(readoutOf(40, 128, 250, clipping: true), .value(r: 40, g: 128, b: 250))
    }

    func testCanNeverMistakeAnUnpaintedPixelForAMarkEveryMarkSitsAStepFromAClippedChannel() {
        for mark in clipMarks.values {
            for dr in [-1, 0, 1] {
                for dg in [-1, 0, 1] {
                    for db in [-1, 0, 1] {
                        let r = min(255, max(0, mark.r + dr))
                        let g = min(255, max(0, mark.g + dg))
                        let b = min(255, max(0, mark.b + db))
                        XCTAssertEqual(clipOf(r, g, b), .white)
                    }
                }
            }
        }
    }
}

final class ReadoutLabelTests: XCTestCase {
    func testSaysTheThreeValuesOrTheClip() {
        XCTAssertEqual(readoutLabel(.value(r: 212, g: 180, b: 96)), "R 212 · G 180 · B  96")
        XCTAssertEqual(readoutLabel(.clip(.black)), "crushed to black")
    }
}
