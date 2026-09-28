// Port of `src/shared/lib/wrap-text.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class WrapTextTests: XCTestCase {
    func testBreaksOnSpacesNeverMidWord() {
        XCTAssertEqual(wrapText("the quick brown fox jumps", maxChars: 10), ["the quick", "brown fox", "jumps"])
    }

    func testFillsEachLineUpToTheBudget() {
        for line in wrapText("a bb ccc dddd eeeee ffffff", maxChars: 12) {
            XCTAssertLessThanOrEqual(line.count, 12)
        }
    }

    func testLeavesASingleOverLongWordWhole() {
        // A broken URL is worse than one that overhangs, and the caller can see
        // it happen.
        XCTAssertEqual(wrapText("https://example.test/a/very/long/path", maxChars: 10), ["https://example.test/a/very/long/path"])
    }

    func testKeepsALineBreakTheAuthorTyped() {
        XCTAssertEqual(wrapText("one\ntwo three", maxChars: 20), ["one", "two three"])
    }

    func testWrapsInsideATypedParagraphToo() {
        XCTAssertEqual(wrapText("aaa bbb\nccc ddd", maxChars: 4), ["aaa", "bbb", "ccc", "ddd"])
    }

    func testDropsATrailingBlankLineNobodyAskedFor() {
        XCTAssertEqual(wrapText("one\n", maxChars: 20), ["one"])
    }

    func testCollapsesRunsOfWhitespace() {
        XCTAssertEqual(wrapText("one    two", maxChars: 20), ["one two"])
    }

    func testSurvivesAnEmptyStringAndANonsenseBudget() {
        XCTAssertEqual(wrapText("", maxChars: 10), [""])
        XCTAssertEqual(wrapText("one two", maxChars: 0), ["one", "two"])
        XCTAssertEqual(wrapText("one two", maxChars: -5), ["one", "two"])
    }
}

final class CharBudgetTests: XCTestCase {
    func testGivesMoreCharactersToAWiderFrame() {
        XCTAssertGreaterThan(charBudget(widthPx: 1000, fontPx: 40), charBudget(widthPx: 500, fontPx: 40))
    }

    func testGivesFewerToABiggerFont() {
        XCTAssertLessThan(charBudget(widthPx: 1000, fontPx: 80), charBudget(widthPx: 1000, fontPx: 40))
    }

    func testErrsLowOneWordEarlyIsInvisibleOneWordLateOverflows() {
        // A real sans averages nearer 0.5 em; budgeting at 0.55 wraps sooner.
        XCTAssertLessThan(Double(charBudget(widthPx: 1000, fontPx: 40)), 1000 / (40 * 0.5))
    }

    func testNeverReturnsZero() {
        XCTAssertGreaterThanOrEqual(charBudget(widthPx: 10, fontPx: 1000), 1)
        XCTAssertGreaterThanOrEqual(charBudget(widthPx: 100, fontPx: 0), 1)
    }
}
