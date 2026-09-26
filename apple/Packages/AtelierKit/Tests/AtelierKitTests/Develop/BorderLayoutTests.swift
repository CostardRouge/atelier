// Port of `src/shared/develop/border-layout.test.ts`, plus the blur fill's
// layout (`border-paint.ts`, which has no spec) and the roll's field.

import XCTest
@testable import AtelierKit

private func border(_ aspect: String?, _ fill: String, _ x: Double, _ y: Double) -> RollBorder {
    RollBorder(aspect: aspect, fill: fill, margin: RollBorder.Margin(x: x, y: y))
}

final class BorderLayoutTests: XCTestCase {
    func testIsTheCropItselfWithNoBorder() {
        XCTAssertEqual(borderLayout(3000, 2000, nil), BorderLayout(w: 3000, h: 2000, x: 0, y: 0, pw: 3000, ph: 2000))
    }

    func testMeasuresTheMarginsOnTheCropsSHORTSideSoTheyReadTheSameAtAnySize() {
        let l = borderLayout(3000, 2000, border(nil, "#ffffff", 0.1, 0.05))
        XCTAssertEqual(l, BorderLayout(w: 3400, h: 2200, x: 200, y: 100, pw: 3000, ph: 2000))
        let small = borderLayout(300, 200, border(nil, "#ffffff", 0.1, 0.05))
        assertClose(small.w / small.h, l.w / l.h, 12)
    }

    func testGrowsTheBoxToTheFilesShapeNeverCutsItThePictureCentred() {
        // 3:2 crop, no margins, a square file: the height grows to the width.
        let sq = borderLayout(3000, 2000, border("1:1", "#000000", 0, 0))
        XCTAssertEqual(sq, BorderLayout(w: 3000, h: 3000, x: 0, y: 500, pw: 3000, ph: 2000))
        // A portrait crop in a 9:16 file with margins: W = max(box.w, box.h·A).
        let tall = borderLayout(1000, 1500, border("9:16", "#000000", 0.05, 0.05))
        assertClose(tall.h, tall.w * (16.0 / 9), 9)
        XCTAssertGreaterThanOrEqual(tall.w, 1100 - 1e-9)
        XCTAssertGreaterThanOrEqual(tall.h, 1600 - 1e-9)
        assertClose(tall.x, (tall.w - 1000) / 2, 9)
        assertClose(tall.y, (tall.h - 1500) / 2, 9)
    }

    func testScalesAsOnePiece() {
        let l = scaleLayout(borderLayout(100, 50, border(nil, "#000000", 0.2, 0.2)), 2)
        XCTAssertEqual(l, BorderLayout(w: 240, h: 140, x: 20, y: 20, pw: 200, ph: 100))
    }
}

final class ReadBorderTests: XCTestCase {
    func testTrustsNothing() {
        XCTAssertNil(readBorder(.null))
        XCTAssertNil(readBorder("x"))
        XCTAssertEqual(readBorder([:]), border(nil, "#000000", 0, 0))
        XCTAssertEqual(
            readBorder(["aspect": "4:5", "fill": "#D9442A", "margin": ["x": 9, "y": -1]]),
            border("4:5", "#d9442a", borderMarginMax, 0)
        )
        XCTAssertNil(readBorder(["aspect": "nonsense", "fill": "red"])?.aspect)
        XCTAssertNil(readBorder(["aspect": "original"])?.aspect)
        XCTAssertEqual(readBorder(["fill": "blur"])?.fill, "blur")
        XCTAssertEqual(readBorder(["aspect": "free:1.25"])?.aspect, "free:1.25")
    }

    func testComparesByValue() {
        let a = border(nil, "#000000", 0.1, 0.1)
        XCTAssertTrue(sameBorder(a, border(nil, "#000000", 0.1, 0.1)))
        XCTAssertFalse(sameBorder(a, nil))
        XCTAssertTrue(sameBorder(nil, nil))
    }

    // Not in the web spec: the record written reads back as itself, and rides
    // the roll as `RollPicture.border`.
    func testWritesWhatItReadsAndRidesTheRoll() {
        let b = border("free:1.25", "blur", 0.1, 0.2)
        XCTAssertEqual(readBorder(b.json), b)
        XCTAssertEqual(readBorder(RollBorder.default.json), RollBorder.default)
        var p = createRollPicture(SavedMediaRef(name: "a.jpg", size: 1, lastModified: 0), id: "p")
        XCTAssertNil(p.border)
        p.border = b
        XCTAssertEqual(p.border, b)
        XCTAssertEqual(pictureEdits(p), [.border])
        XCTAssertEqual(p.json.objectValue?["border"], b.json)
        p.border = nil
        XCTAssertEqual(p.json.objectValue?["border"], .null)
    }
}

final class LegacyWholeBorderTests: XCTestCase {
    let contain = framing { $0.fit = .contain }

    func testBecomesTheWholePictureOnBlackBarsOfItsOldAspectWhenItIsExactlyThat() {
        XCTAssertEqual(
            legacyWholeBorder("4:5", contain),
            LegacyWholeCrop(aspect: "original", framing: .default, border: border("4:5", "#000000", 0, 0))
        )
        let half = legacyWholeBorder("1:1", framing { $0.fit = .contain; $0.rotation = 180; $0.flipX = true })
        XCTAssertEqual(half?.framing, framing { $0.rotation = 180; $0.flipX = true })
        // Its own shape, whole: no bars at all.
        let own = legacyWholeBorder("original", framing { $0.fit = .contain; $0.x = 0.2 })
        XCTAssertNotNil(own)
        XCTAssertNil(own?.border)
    }

    func testStaysOnTheLegacyPathWhenItIsNotExactlyABorder() {
        XCTAssertNil(legacyWholeBorder("4:5", framing { $0.fit = .contain; $0.rotation = 90 }))
        XCTAssertNil(legacyWholeBorder("4:5", framing { $0.fit = .contain; $0.rotation = 3 }))
        XCTAssertNil(legacyWholeBorder("4:5", framing { $0.fit = .contain; $0.scale = 1.5 }))
        XCTAssertNil(legacyWholeBorder("4:5", framing { $0.fit = .contain; $0.x = 0.1 }))
        XCTAssertNil(legacyWholeBorder("4:5", .default))
    }
}

final class BoxBlurRGBATests: XCTestCase {
    func testSpreadsASingleBrightPixelAndKeepsTheTotal() {
        let w = 9
        let h = 9
        var data = [UInt8](repeating: 0, count: w * h * 4)
        let mid = (4 * w + 4) * 4
        data[mid] = 255
        boxBlurRGBA(&data, w, h, 1, passes: 1)
        XCTAssertLessThan(data[mid], 255)
        XCTAssertGreaterThan(data[mid], 0)
        XCTAssertGreaterThan(data[(4 * w + 5) * 4], 0)
        var sum = 0
        for i in stride(from: 0, to: data.count, by: 4) { sum += Int(data[i]) }
        XCTAssertGreaterThan(sum, 200)
        XCTAssertLessThan(sum, 310)
    }

    func testLeavesAFlatPictureFlat() {
        var data = [UInt8](repeating: 120, count: 4 * 4 * 4)
        boxBlurRGBA(&data, 4, 4, 2)
        XCTAssertTrue(data.allSatisfy { $0 == 120 })
    }
}

final class BlurFillLayoutTests: XCTestCase {
    func testBlursA48PixelCopyAndCoversTheWholeCanvasCentred() {
        // A 3:2 crop on a square canvas: the copy is 48 × 32, scaled to the height.
        let l = blurFillLayout(borderLayout(3000, 2000, border("1:1", "blur", 0, 0)))
        XCTAssertEqual(l.sw, 48)
        XCTAssertEqual(l.sh, 32)
        assertClose(l.h, 3000, 9)
        assertClose(l.w, 4500, 9)
        assertClose(l.x, -750, 9)
        assertClose(l.y, 0, 9)
        // A portrait crop: 48 on its long side, the short one rounded.
        let tall = blurFillLayout(borderLayout(1000, 1500, border(nil, "blur", 0.05, 0.05)))
        XCTAssertEqual(tall.sw, 32)
        XCTAssertEqual(tall.sh, 48)
    }
}
