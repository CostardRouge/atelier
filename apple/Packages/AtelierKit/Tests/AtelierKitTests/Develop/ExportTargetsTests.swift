// Port of `src/shared/develop/export-targets.test.ts` — over `Roll.swift`'s
// record and readers and `ExportTargets.swift`'s additions.

import XCTest
@testable import AtelierKit

private func t(_ size: ExportSize?) -> ExportTarget {
    var target = ExportTarget.default
    target.size = size
    return target
}

final class TargetSizeTests: XCTestCase {
    func testCapsTheLongEdgeAndNeverUpscales() {
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .long, value: 2048), width: 6000, height: 4000), 2048)
        XCTAssertNil(longEdgeFor(ExportSize(mode: .long, value: 8000), width: 6000, height: 4000))
        XCTAssertNil(longEdgeFor(nil, width: 6000, height: 4000))
    }

    func testTurnsAShortEdgeIntoTheLongEdgeOfThisShape() {
        // 1080 across a 3:2 landscape is 1620 long; across a 4:5 portrait, 1350.
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .short, value: 1080), width: 6000, height: 4000), 1620)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .short, value: 1080), width: 3200, height: 4000), 1350)
    }

    func testKeepsAnAreaWhateverTheShapeAndAPercentageOfTheFrame() {
        let edge = Double(longEdgeFor(ExportSize(mode: .megapixels, value: 2), width: 6000, height: 4000)!)
        let area = edge * (edge / 1.5 + 0.5).rounded(.down)
        XCTAssertGreaterThan(area, 1.99e6)
        XCTAssertLessThan(area, 2.01e6)
        XCTAssertEqual(longEdgeFor(ExportSize(mode: .percent, value: 50), width: 6000, height: 4000), 3000)
        XCTAssertNil(longEdgeFor(ExportSize(mode: .percent, value: 100), width: 6000, height: 4000))
    }

    func testDecodesOnlyAsMuchAsEveryTargetAsksOrWholeWhenASizeWaitsForTheShape() {
        XCTAssertEqual(decodeEdgeFor([t(ExportSize(mode: .long, value: 2048)), t(ExportSize(mode: .long, value: 4096))]), 4096)
        XCTAssertNil(decodeEdgeFor([t(ExportSize(mode: .long, value: 2048)), t(ExportSize(mode: .short, value: 1080))]))
        XCTAssertNil(decodeEdgeFor([t(nil)]))
    }

    func testKnowsWhichTargetAsksTheMostOfAPicture() {
        XCTAssertEqual(largestSize([t(ExportSize(mode: .long, value: 2048)), t(ExportSize(mode: .short, value: 2000))]),
                       ExportSize(mode: .short, value: 2000))
        XCTAssertNil(largestSize([t(ExportSize(mode: .long, value: 2048)), t(nil)]))
    }
}

final class TargetRecordTests: XCTestCase {
    func testReadsAV5RollsLongEdgeAndQualityAsItsOneTarget() {
        XCTAssertEqual(readTargets(nil, legacyLongEdge: 2048, legacyQuality: 0.8),
                       [ExportTarget(size: ExportSize(mode: .long, value: 2048), quality: 0.8)])
        XCTAssertEqual(readTargets(nil, legacyLongEdge: nil), [ExportTarget.default])
        XCTAssertEqual(readTargets("junk"), [ExportTarget.default])
    }

    func testReadsTargetsSafelyClampedCappedJunkDroppedNeverEmpty() {
        let one: JSONValue = ["name": "W", "size": ["mode": "megapixels", "value": 999], "quality": 3, "sharpen": "max"]
        let read = readTargets(.array(Array(repeating: one, count: 9) + ["junk"]))
        XCTAssertEqual(read.count, maxTargets)
        XCTAssertEqual(read[0], ExportTarget(name: "W", size: ExportSize(mode: .megapixels, value: 200), quality: 1, sharpen: .off, watermark: false))
        XCTAssertEqual(readSize(["mode": "percent", "value": 1]), ExportSize(mode: .percent, value: 5))
        XCTAssertNil(readSize(["mode": "inches", "value": 3]))
    }

    func testComparesByValueAndSaysASizeInWords() {
        let web = targetPresets.first { $0.id == "web" }!.target
        var same = web
        same.size = ExportSize(mode: .long, value: 2048)
        XCTAssertTrue(sameTarget(web, same))
        var softer = web
        softer.sharpen = .off
        XCTAssertFalse(sameTarget(web, softer))
        XCTAssertEqual(describeSize(nil), "full size")
        XCTAssertEqual(describeSize(ExportSize(mode: .short, value: 1080)), "1080 px short edge")
        XCTAssertEqual(describeSize(ExportSize(mode: .megapixels, value: 2)), "2 MP")
    }

    func testNamesASubFolderAVolumeAccepts() {
        XCTAssertEqual(targetFolder("Web", index: 1), "Web")
        XCTAssertEqual(targetFolder("  a/b:c  ", index: 1), "a b c")
        XCTAssertEqual(targetFolder("..hidden", index: 1), "hidden")
        XCTAssertEqual(targetFolder("", index: 2), "Target 3")
    }

    func testKeepsRoughlyTheSamePictureWhenTheSizeChangesMode() {
        XCTAssertEqual(convertSize(ExportSize(mode: .long, value: 2048), .short), ExportSize(mode: .short, value: 1365))
        XCTAssertEqual(convertSize(ExportSize(mode: .short, value: 1080), .long), ExportSize(mode: .long, value: 1620))
        XCTAssertEqual(convertSize(nil, .long), ExportSize(mode: .long, value: 2048))
        assertClose(convertSize(ExportSize(mode: .long, value: 2048), .megapixels).value, 2.8, 1)
    }

    func testDescribesATargetAsItsLineSaysIt() {
        let web = targetPresets.first { $0.id == "web" }!.target
        XCTAssertEqual(describeTarget(web, first: false), "Web/ · 2048 px long edge · 85 % · standard screen sharpening")
        XCTAssertEqual(describeTarget(ExportTarget.default, first: true), "this folder · full size · 92 %")
        XCTAssertEqual(outputSharpenLevels, [.off, .low, .standard, .high])
    }
}
