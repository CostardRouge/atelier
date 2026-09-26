// Port of `src/shared/overlay/outro-card.test.ts`, plus the card's JSON round trip.

import Foundation
import XCTest
@testable import AtelierKit

private func card(_ change: (inout OutroCard) -> Void = { _ in }) -> OutroCard {
    var c = createOutroCard("Merci")
    change(&c)
    return c
}

private func qr(_ url: String) -> OutroQr {
    OutroQr(url: url, x: 0.35, y: 0.55, sizeFrac: 0.3, dark: "#fff", light: "#111")
}

final class CreateOutroCardTests: XCTestCase {
    func testSeedsOneEditableHeadlineOnAFlatGround() {
        let c = createOutroCard("Vol du soir")
        XCTAssertEqual(c.seconds, outroSecondsDefault)
        XCTAssertEqual(c.elements.count, 1)
        XCTAssertEqual(c.elements[0].text, "Vol du soir")
        XCTAssertNil(c.qr)
    }

    func testPinsItsLinesAgainstAnyThemeTheCardInkIsItsOwn() {
        let el = createOutroCard("x").elements[0]
        XCTAssertTrue(el.styleOverrides?.contains("color") ?? false)
        XCTAssertTrue(el.styleOverrides?.contains("legibility") ?? false)
        XCTAssertTrue(el.styleOverrides?.contains("glow") ?? false)
    }
}

final class WithOutroLineTests: XCTestCase {
    func testStacksTheNewLineUnderTheLowestText() {
        let c = withOutroLine(card(), "sub")
        XCTAssertEqual(c.elements.count, 2)
        XCTAssertGreaterThan(c.elements[1].y, c.elements[0].y)
    }

    func testNeverPushesALineOffTheFrame() {
        var c = card()
        for _ in 0..<20 { c = withOutroLine(c) }
        for el in c.elements { XCTAssertLessThanOrEqual(el.y, 0.92) }
    }

    func testLeavesTheOriginalCardUntouched() {
        let before = card()
        _ = withOutroLine(before)
        XCTAssertEqual(before.elements.count, 1)
    }
}

final class PrepareOutroTests: XCTestCase {
    func testEncodesARealLinkIntoADrawableMatrix() throws {
        let p = prepareOutro(card { $0.qr = qr("https://example.com/x") })
        XCTAssertNil(p.qrProblem)
        XCTAssertGreaterThan(try XCTUnwrap(p.qr).matrix.size, 0)
    }

    func testNoUrlMeansNoQrAndNoComplaint() {
        XCTAssertNil(prepareOutro(card()).qr)
        XCTAssertNil(prepareOutro(card()).qrProblem)
        let blank = prepareOutro(card { $0.qr = qr("   ") })
        XCTAssertNil(blank.qr)
        XCTAssertNil(blank.qrProblem)
    }

    func testRefusesALinkTooLongToEncodeWithASentence() {
        let p = prepareOutro(card { $0.qr = qr("https://x.dev/" + String(repeating: "a", count: 300)) })
        XCTAssertNil(p.qr)
        XCTAssertTrue(p.qrProblem?.contains("too long") ?? false)
    }

    func testKeepsTheCardsPlacementAndInksOnTheEncodedCode() throws {
        let code = try XCTUnwrap(prepareOutro(card { $0.qr = qr("https://example.com") }).qr)
        XCTAssertEqual(code.x, 0.35)
        XCTAssertEqual(code.y, 0.55)
        XCTAssertEqual(code.sizeFrac, 0.3)
        XCTAssertEqual(code.dark, "#fff")
        XCTAssertEqual(code.light, "#111")
    }
}

final class OutroCardJSONTests: XCTestCase {
    func testWritesBackWhatItReads() throws {
        let c = card { $0.qr = qr("https://example.com") }
        let back = try XCTUnwrap(readOutroCard(c.json))
        XCTAssertEqual(back, c)
        XCTAssertEqual(card().json.objectValue?["qr"], .null)
        XCTAssertNil(readOutroCard("card"))
    }
}
