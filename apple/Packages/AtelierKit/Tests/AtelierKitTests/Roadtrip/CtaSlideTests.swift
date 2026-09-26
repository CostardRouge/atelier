// Port of `src/shared/roadtrip/cta-slide.test.ts` — every case of the card's
// layout and its QR. The stored half (the record and its reader) is
// `DayBadgeWordsTests.swift`'s `CtaSlideStoredTests`.

import XCTest
@testable import AtelierKit

private let reel = 9.0 / 16
private let square = 1.0
private let portrait = 4.0 / 5

private func cta(_ change: (inout CtaSlide) -> Void = { _ in }) -> CtaSlide {
    var card = defaultCta
    change(&card)
    return card
}

private func joinedText(_ elements: [OverlayElement]) -> String {
    elements.map { $0.text ?? "" }.joined(separator: " ")
}

final class CtaLayoutTests: XCTestCase {
    func testLaysOutHeadlineBodyAndUrlAsText() {
        let joined = joinedText(ctaLayout(cta(), portrait).elements)
        XCTAssertTrue(joined.contains(defaultCta.headline))
        XCTAssertTrue(joined.contains(defaultCta.url))
        // The body arrives wrapped, so it is compared word by word.
        for word in defaultCta.body.split(separator: " ") { XCTAssertTrue(joined.contains(word)) }
    }

    func testWrapsASentenceInsteadOfRunningItOffTheFrame() {
        let elements = ctaLayout(cta(), portrait).elements
        XCTAssertGreaterThan(elements.count, 3)
        for el in elements { XCTAssertLessThan(el.text!.utf16.count, 60) }
    }

    func testWrapsHarderOnANarrowerFrame() {
        let wide = ctaLayout(cta(), 16.0 / 9).elements.count
        let narrow = ctaLayout(cta(), reel).elements.count
        XCTAssertGreaterThanOrEqual(narrow, wide)
    }

    func testKeepsALineBreakTheAuthorTyped() {
        let elements = ctaLayout(cta {
            $0.headline = "One\nTwo"
            $0.body = ""
            $0.url = ""
            $0.showQr = false
        }, portrait).elements
        XCTAssertEqual(elements.map(\.text), ["One", "Two"])
    }

    func testStacksThemDownTheFrameWithoutOverlapping() {
        let elements = ctaLayout(cta(), portrait).elements
        for i in 1..<elements.count { XCTAssertGreaterThan(elements[i].y, elements[i - 1].y) }
    }

    func testMakesTheHeadlineTheBiggestLine() {
        let elements = ctaLayout(cta(), portrait).elements
        let headline = elements[0]
        let rest = elements.dropFirst()
        for el in rest { XCTAssertLessThanOrEqual(el.sizeFrac, headline.sizeFrac) }
        XCTAssertTrue(rest.contains { $0.sizeFrac < headline.sizeFrac })
    }

    func testSkipsALineTheAuthorLeftEmptyRatherThanReservingItsSpace() {
        let elements = ctaLayout(cta { $0.body = "" }, portrait).elements
        XCTAssertEqual(elements.map(\.text), [defaultCta.headline, defaultCta.url])
    }

    func testKeepsEveryLineInsideTheFramesWidthBudget() {
        for aspect in [reel, square, portrait, 16.0 / 9] {
            let elements = ctaLayout(cta(), aspect).elements
            let w = aspect >= 1 ? 1000 : 1000 * aspect
            let h = aspect >= 1 ? 1000 / aspect : 1000
            for el in elements {
                // The same pessimistic 0.55 em per character the wrapper budgets on.
                let widthPx = Double(el.text!.utf16.count) * el.sizeFrac * min(w, h) * 0.55
                XCTAssertLessThanOrEqual(widthPx, w * 0.86)
            }
        }
    }

    func testCentresTheBlockWhateverItHoldsSoAShortCardDoesNotSitHigh() {
        let full = ctaLayout(cta(), portrait)
        let bare = ctaLayout(cta {
            $0.body = ""
            $0.url = ""
            $0.showQr = false
        }, portrait)
        // One line alone lands near the middle.
        XCTAssertGreaterThan(bare.elements[0].y, 0.4)
        XCTAssertLessThan(bare.elements[0].y, 0.6)
        XCTAssertLessThan(full.elements[0].y, bare.elements[0].y)
    }

    func testPinsItsOwnInkAndFlatnessAgainstTheTripsTitleStyle() {
        for el in ctaLayout(cta(), portrait).elements {
            for key in ["color", "legibility", "glow"] { XCTAssertTrue(el.styleOverrides?.contains(key) == true) }
            XCTAssertEqual(el.glowAmount, 0)
        }
    }

    func testGivesEveryLineAStableIdThatNamesItsRoleAndLine() throws {
        let a = ctaLayout(cta(), portrait).elements
        let b = ctaLayout(cta(), portrait).elements
        XCTAssertEqual(a.map(\.id), b.map(\.id))
        XCTAssertEqual(Set(a.map(\.id)).count, a.count)
        for el in a {
            let parsed = try XCTUnwrap(ctaRoleFromElementId(el.id))
            XCTAssertEqual(ctaElementId(parsed.role, parsed.line), el.id)
        }
        XCTAssertEqual(ctaRoleFromElementId(a[0].id), CtaLine(role: .headline, line: 0))
        XCTAssertEqual(ctaRoleFromElementId(a[a.count - 1].id), CtaLine(role: .url, line: 0))
        // The body wraps, so its lines are numbered in order.
        let body = a.compactMap { ctaRoleFromElementId($0.id) }.filter { $0.role == .body }
        XCTAssertEqual(body.map(\.line), Array(body.indices))
    }

    func testKeepsIdsUniqueAndOnTheirRoleWhenALineIsLeftEmpty() {
        let els = ctaLayout(cta { $0.headline = "" }, portrait).elements
        XCTAssertFalse(els.contains { ctaRoleFromElementId($0.id)?.role == .headline })
        XCTAssertEqual(Set(els.map(\.id)).count, els.count)
    }

    func testRefusesAnIdThatIsNotACardLines() {
        XCTAssertNil(ctaRoleFromElementId("piece:kicker"))
        XCTAssertNil(ctaRoleFromElementId("cta:footer:0"))
        XCTAssertNil(ctaRoleFromElementId("cta:body:x"))
    }
}

final class CtaLayoutQrTests: XCTestCase {
    func testEncodesTheUrl() throws {
        let layout = ctaLayout(cta(), portrait)
        let qr = try XCTUnwrap(layout.qr)
        XCTAssertNil(layout.qrProblem)
        XCTAssertEqual(qr.matrix.size, qr.matrix.version * 4 + 17)
    }

    func testIsAbsentWhenSwitchedOffAndTheTextStays() {
        let layout = ctaLayout(cta { $0.showQr = false }, portrait)
        XCTAssertNil(layout.qr)
        XCTAssertTrue(layout.elements.map(\.text).contains(defaultCta.url))
    }

    func testIsAbsentWhenThereIsNoUrlToEncode() {
        XCTAssertNil(ctaLayout(cta { $0.url = "" }, portrait).qr)
    }

    func testSaysWhyItCouldNotDrawOneRatherThanLeavingABlankSquare() {
        let long = ctaLayout(cta { $0.url = "https://x.test/" + String(repeating: "y", count: 250) }, portrait)
        XCTAssertNil(long.qr)
        XCTAssertNotNil(long.qrProblem?.range(of: "too long", options: .caseInsensitive))
    }

    func testCentresTheSquareHorizontallyOnAnyFrame() throws {
        for aspect in [reel, square, portrait, 16.0 / 9] {
            let qr = try XCTUnwrap(ctaLayout(cta(), aspect).qr)
            let widthFrac = qr.sizeFrac * min(1 / aspect, 1)
            assertClose(qr.x + widthFrac / 2, 0.5, 6)
        }
    }

    func testKeepsTheWholeBlockInsideTheFrame() throws {
        for aspect in [reel, square, portrait, 16.0 / 9] {
            let layout = ctaLayout(cta(), aspect)
            let qr = try XCTUnwrap(layout.qr)
            XCTAssertGreaterThan(qr.y, 0)
            XCTAssertLessThan(qr.y + qr.sizeFrac * min(aspect, 1), 1)
            for el in layout.elements {
                XCTAssertGreaterThan(el.y, 0)
                XCTAssertLessThan(el.y, 1)
            }
        }
    }

    func testSitsBetweenTheHeadlineAndTheBody() throws {
        let layout = ctaLayout(cta(), portrait)
        let qr = try XCTUnwrap(layout.qr)
        let headline = layout.elements[0]
        let body = try XCTUnwrap(layout.elements.first { $0.sizeFrac < headline.sizeFrac })
        XCTAssertGreaterThan(qr.y, headline.y)
        XCTAssertLessThan(qr.y, body.y)
    }
}
