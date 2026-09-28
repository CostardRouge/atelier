// The stored half of `src/shared/roadtrip/day-badge.ts` and
// `src/shared/roadtrip/cta-slide.ts`: the badge's words and the closing card
// as a trip stores them. Neither web module reads them back on a current
// trip; these pin the port's reading of one.

import XCTest
@testable import AtelierKit

final class DayBadgeWordsTests: XCTestCase {
    func testEnglishIsTheDefaultAndFrenchIsAButtonNotALanguage() {
        XCTAssertEqual(defaultBadgeWords.day, "Day")
        XCTAssertNil(defaultBadgeWords.camera)
        XCTAssertEqual(frenchBadgeWords.of, "sur")
        XCTAssertEqual(frenchBadgeWords.time, frenchTimeAgoWords)
        XCTAssertEqual(frenchBadgeWords.camera, frenchCameraWords)
    }

    func testThePlaceMarkerIsAGlyphEveryFontHas() {
        XCTAssertEqual(defaultBadgeWords.pin, "\u{25C6}")
    }

    func testAMissingWordTakesItsEnglishDefaultAndATypedOneIsKeptBlankIncluded() {
        let words = readBadgeWords(["day": "Jour", "of": "", "time": ["agoTemplate": "il y a {n}"], "at": 3])
        XCTAssertEqual(words.day, "Jour")
        XCTAssertEqual(words.of, "")
        XCTAssertEqual(words.at, "in")
        XCTAssertEqual(words.time.agoTemplate, "il y a {n}")
        XCTAssertEqual(words.time.days, "days")
        XCTAssertNil(words.camera)
    }

    func testTheWordsWriteWhatTheyRead() {
        XCTAssertEqual(readBadgeWords(frenchBadgeWords.json), frenchBadgeWords)
        XCTAssertEqual(readBadgeWords(defaultBadgeWords.json).json, defaultBadgeWords.json)
    }
}

final class CtaSlideStoredTests: XCTestCase {
    func testTheCardASignatureIsMadeOf() {
        XCTAssertEqual(defaultCta.headline, "Made with Atelier")
        XCTAssertTrue(defaultCta.showQr)
        XCTAssertEqual(defaultCta.url, "https://atelier.steeve.website")
    }

    func testAMissingFieldTakesTheDefaultCardsAndTheCardWritesWhatItReads() {
        let card = readCtaSlide(["headline": "Fait avec Atelier", "url": "", "showQr": "yes"])
        XCTAssertEqual(card.headline, "Fait avec Atelier")
        XCTAssertEqual(card.url, "")
        XCTAssertTrue(card.showQr)
        XCTAssertEqual(card.ink, defaultCta.ink)
        XCTAssertEqual(readCtaSlide(card.json), card)
    }
}
