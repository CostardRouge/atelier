// `src/shared/roadtrip/badge-layout.ts`: every case of `badge-layout.test.ts`
// — the stored half (`BadgeLayoutStoredTests`: reading a cascade, the hook's
// two durations, a piece style's writer keeping "absent" and "null" apart)
// and the behaviour (the elements, per-piece styles, the drag, the settle
// time, the exit's window, the block's extent, the cascade).

import XCTest
@testable import AtelierKit

final class BadgeLayoutStoredTests: XCTestCase {
    func testReadsJunkAsNoCascadeAndAJunkStepAsAPlainFade() throws {
        XCTAssertNil(readCascade(nil))
        XCTAssertNil(readCascade(["stagger": [:]]))
        let read = try XCTUnwrap(readCascade([
            "step": ["preset": "zoom", "duration": -1, "easing": "wobble"],
            "stagger": ["order": "rows"],
        ]))
        XCTAssertEqual(read.step, AnimStep(preset: .fade, duration: 0, easing: .out))
        XCTAssertEqual(read.stagger, Stagger(each: 0.1, order: .rows))
    }

    func testAStepReadForTheBadgeKeepsNoDelayUnlikeAnOverlayElementsStep() throws {
        let raw: JSONValue = ["preset": "slide", "duration": 0.4, "easing": "out", "delay": 2, "inside": true]
        XCTAssertNil(readAnimStep(raw).delay)
        XCTAssertNil(readAnimStep(raw).inside)
        XCTAssertEqual(AnimStep(json: raw)?.delay, 2)
    }

    func testANewHookLastsTwoSecondsAndAStoredOneThatNeverSaidReadsFour() {
        XCTAssertEqual(defaultBadgeDuration, 2)
        XCTAssertEqual(legacyBadgeDuration, 4)
        XCTAssertEqual(defaultBadgeLayout, BadgeLayout(anchor: .bottomLeft, x: 0.07, y: 0.9, sizeFrac: 0.17))
    }

    func testAPieceStyleWritesBackAbsentAsAbsentAndNullAsNull() {
        let stored: JSONValue = [
            "textCase": "upper", "color": nil, "boxColor": "#000000", "boxPadFrac": 0.3,
            "animation": ["in": ["preset": "fade", "duration": 0.5, "easing": "out"], "out": nil],
        ]
        let style = readBadgePieceStyle(stored)
        XCTAssertEqual(style.color, .some(nil))
        XCTAssertTrue(style.borderColor == nil)
        XCTAssertEqual(style.json, stored)
    }

    func testPieceStylesKeepOnlyThePiecesTheBadgeHas() {
        let styles = readBadgePieceStyles(["headline": ["textCase": "lower"], "footer": ["textCase": "upper"], "caption": 3])
        XCTAssertEqual(Array(styles.keys), [.headline])
        XCTAssertEqual(badgePieceStylesJSON(styles), ["headline": ["textCase": "lower"]])
    }
}

// MARK: - the badge as elements

private let full = BadgeContent(
    kicker: "Australie", label: "Jour", headline: "27", counter: "sur 310", caption: "Kalbarri",
    timing: "il y a 9 mois", exif: "DJI Mini 4 Pro · 24 mm · ƒ/1.7 · 1/240 · ISO 100"
)

private let reel = 9.0 / 16
private let square = 1.0
private let landscape = 16.0 / 9

private func layout(_ change: (inout BadgeLayout) -> Void = { _ in }) -> BadgeLayout {
    var l = defaultBadgeLayout
    change(&l)
    return l
}

private func animated(_ inStep: AnimStep?, _ outStep: AnimStep?? = .none) -> BadgePieceStyle {
    let entrance: AnimStep?? = inStep.map { .some($0) } ?? .none
    return BadgePieceStyle(animation: .some(ElementAnimation(in: entrance, out: outStep)))
}

final class BadgeLayoutHeightFractionTests: XCTestCase {
    func testIsTheSizeItselfOnALandscapeFrameWhereTheShortSideIsTheHeight() {
        assertClose(heightFractionOf(0.17, landscape), 0.17, 6)
        assertClose(heightFractionOf(0.17, square), 0.17, 6)
    }

    func testShrinksAgainstHeightOnAPortraitFrameWhereTheShortSideIsTheWidth() {
        assertClose(heightFractionOf(0.17, reel), 0.17 * (9.0 / 16), 6)
    }
}

final class BadgeLayoutElementsTests: XCTestCase {
    func testEmitsOneTextElementPerPieceInReadingOrder() {
        let els = badgeElements(full, layout(), reel)
        XCTAssertEqual(els.count, 7)
        XCTAssertTrue(els.allSatisfy { $0.kind == .text })
        XCTAssertEqual(els.map(\.text), [
            "Australie", "Jour", "27", "sur 310", "Kalbarri", "il y a 9 mois",
            "DJI Mini 4 Pro · 24 mm · ƒ/1.7 · 1/240 · ISO 100",
        ])
    }

    func testMakesTheNumeralTheBiggestPieceByAWideMargin() throws {
        let els = badgeElements(full, layout(), reel)
        let headline = try XCTUnwrap(els.first { $0.text == "27" })
        for el in els where el.text != "27" { XCTAssertLessThan(el.sizeFrac, headline.sizeFrac / 3) }
    }

    func testSizesTheHeadlineExactlyAsAsked() throws {
        let els = badgeElements(full, layout { $0.sizeFrac = 0.2 }, reel)
        assertClose(try XCTUnwrap(els.first { $0.text == "27" }).sizeFrac, 0.2, 6)
    }

    func testStacksDownwardWithoutOverlapping() {
        let els = badgeElements(full, layout { $0.anchor = .topLeft; $0.y = 0.1 }, reel)
        for i in 1..<els.count { XCTAssertGreaterThan(els[i].y, els[i - 1].y) }
        assertClose(els[0].y, 0.1, 6)
    }

    func testSkipsAbsentPiecesEntirelyRatherThanReservingTheirSpace() {
        let els = badgeElements(BadgeContent(headline: "27"), layout(), reel)
        XCTAssertEqual(els.count, 1)
        XCTAssertEqual(els[0].text, "27")
    }

    func testGivesEveryPieceAStableIdSoAHitTestSurvivesTheNextRepaint() throws {
        let a = badgeElements(full, layout(), reel)
        let b = badgeElements(full, layout(), reel)
        XCTAssertEqual(a.map(\.id), b.map(\.id))
        XCTAssertEqual(Set(a.map(\.id)).count, a.count)
        for el in a {
            let piece = try XCTUnwrap(pieceFromElementId(el.id))
            XCTAssertEqual(pieceElementId(piece), el.id)
        }
        XCTAssertEqual(a.map { pieceFromElementId($0.id) }, [.kicker, .label, .headline, .counter, .caption, .timing, .exif])
    }

    func testKeepsEachIdOnItsPieceWhenOtherPiecesAreAbsent() {
        var bare = full
        bare.label = nil
        bare.counter = nil
        let els = badgeElements(bare, layout(), reel)
        XCTAssertEqual(els.map(\.id), [
            pieceElementId(.kicker), pieceElementId(.headline), pieceElementId(.caption),
            pieceElementId(.timing), pieceElementId(.exif),
        ])
        XCTAssertEqual(Set(els.map(\.id)).count, els.count)
    }

    func testRefusesAnIdThatIsNotAPieces() {
        XCTAssertNil(pieceFromElementId("piece:nope"))
        XCTAssertNil(pieceFromElementId("caption:0"))
        XCTAssertNil(pieceFromElementId(""))
    }

    func testHangsTheBlockAboveABottomAnchorSoItNeverRunsOffTheFrame() {
        let els = badgeElements(full, layout { $0.anchor = .bottomLeft; $0.y = 0.9 }, reel)
        let last = els[els.count - 1]
        // The block's foot lands at the anchor rather than starting there.
        XCTAssertLessThan(last.y, 0.9)
        XCTAssertLessThan(els[0].y, last.y)
    }

    func testCentresTheBlockAroundACentreAnchor() {
        let top = badgeElements(full, layout { $0.anchor = .topCenter; $0.y = 0.5 }, reel)
        let mid = badgeElements(full, layout { $0.anchor = .center; $0.y = 0.5 }, reel)
        let bottom = badgeElements(full, layout { $0.anchor = .bottomCenter; $0.y = 0.5 }, reel)
        XCTAssertLessThan(mid[0].y, top[0].y)
        XCTAssertLessThan(bottom[0].y, mid[0].y)
        // Centre sits exactly halfway between the two extremes.
        assertClose(mid[0].y, (top[0].y + bottom[0].y) / 2, 6)
    }

    func testGivesEveryLineTheAnchorsHorizontalSide() {
        let cases: [(OverlayAnchor, OverlayAnchor)] = [(.bottomLeft, .topLeft), (.bottomRight, .topRight), (.center, .topCenter)]
        for (anchor, side) in cases {
            XCTAssertTrue(badgeElements(full, layout { $0.anchor = anchor }, reel).allSatisfy { $0.anchor == side })
        }
    }

    func testKeepsTheSameXForEveryLine() {
        XCTAssertTrue(badgeElements(full, layout { $0.x = 0.07 }, reel).allSatisfy { $0.y >= 0 && $0.x == 0.07 })
    }

    func testSpacesAPortraitFrameMoreTightlyInYThanALandscapeOne() {
        // Same request, different frames: the sizes are equal (both fractions of
        // the short side) but the portrait stack covers less of the height.
        let portrait = badgeElements(full, layout { $0.anchor = .topLeft; $0.y = 0 }, reel)
        let wide = badgeElements(full, layout { $0.anchor = .topLeft; $0.y = 0 }, landscape)
        XCTAssertEqual(portrait.map(\.sizeFrac), wide.map(\.sizeFrac))
        let portraitSpan = portrait[portrait.count - 1].y
        let wideSpan = wide[wide.count - 1].y
        XCTAssertLessThan(portraitSpan, wideSpan)
        assertClose(portraitSpan, wideSpan * (9.0 / 16), 6)
    }

    func testLeavesEveryElementFullyThemedWhenNoPieceDeparts() {
        XCTAssertTrue(badgeElements(full, layout(), reel).allSatisfy { $0.styleOverrides?.isEmpty == true })
    }

    func testGivesEachElementADistinctId() {
        let els = badgeElements(full, layout(), reel)
        XCTAssertEqual(Set(els.map(\.id)).count, els.count)
    }
}

final class BadgeLayoutPieceStylesTests: XCTestCase {
    private func kickerOf(_ styles: BadgePieceStyles) -> OverlayElement {
        badgeElements(full, layout(), reel, styles)[0]
    }

    func testForcesTheCaseOnTheTextAndPinsUppercaseOff() {
        // Casing the string rather than the element is what stops a theme that
        // uppercases from undoing a deliberate lowercase.
        let upper = kickerOf([.kicker: BadgePieceStyle(textCase: .upper)])
        XCTAssertEqual(upper.text, "AUSTRALIE")
        XCTAssertEqual(upper.uppercase, false)
        XCTAssertTrue(upper.styleOverrides?.contains("uppercase") == true)
        XCTAssertEqual(kickerOf([.kicker: BadgePieceStyle(textCase: .lower)]).text, "australie")
    }

    func testLeavesCasingToTheThemeOnAsIs() {
        let el = kickerOf([.kicker: BadgePieceStyle(textCase: .asIs)])
        XCTAssertEqual(el.text, "Australie")
        XCTAssertFalse(el.styleOverrides?.contains("uppercase") == true)
    }

    func testPinsOnlyTheKeysAPieceActuallyDepartsOn() {
        let el = kickerOf([.kicker: BadgePieceStyle(color: .some("#ff0000"))])
        XCTAssertEqual(el.color, "#ff0000")
        XCTAssertEqual(el.styleOverrides, ["color"])
    }

    func testBuildsAFilledPanelFromABackgroundColour() {
        let el = kickerOf([.kicker: BadgePieceStyle(boxColor: .some("#d9442a"), boxPadFrac: 0.4, boxRadiusFrac: 2)])
        XCTAssertEqual(el.legibility.mode, .box)
        XCTAssertEqual(el.legibility.color, "#d9442a")
        XCTAssertEqual(el.legibility.padFrac, 0.4)
        XCTAssertEqual(el.legibility.radiusFrac, 2)
        XCTAssertTrue(el.styleOverrides?.contains("legibility") == true)
    }

    func testAllowsAnOutlineWithNoFillAHairlineFrameIsARealLook() {
        let el = kickerOf([.kicker: BadgePieceStyle(borderColor: .some("#ffffff"))])
        XCTAssertEqual(el.legibility.mode, .box)
        XCTAssertEqual(el.legibility.color, "rgba(0,0,0,0)")
        XCTAssertEqual(el.legibility.outlineColor, "#ffffff")
        XCTAssertGreaterThan(el.legibility.borderWidthFrac ?? 0, 0)
    }

    func testGivesAnAnimatedPieceAWindowToPlayInside() {
        let el = kickerOf([.kicker: animated(AnimStep(preset: .fade, duration: 0.4, easing: .out))])
        XCTAssertEqual(el.animation?.inStep?.preset, .fade)
        XCTAssertEqual(el.window, TimeWindow(start: 0, end: nil))
    }

    func testLeavesAnUnstyledPieceAloneEvenWhenItsNeighbourIsStyled() throws {
        let els = badgeElements(full, layout(), reel, [.kicker: BadgePieceStyle(color: .some("#ff0000"))])
        let headline = try XCTUnwrap(els.first { $0.text == "27" })
        XCTAssertEqual(headline.styleOverrides, [])
        XCTAssertNil(headline.window)
    }
}

final class BadgeLayoutMoveBlockTests: XCTestCase {
    func testAddsThePointersTravelToWhereTheAnchorStarted() {
        let moved = moveBlock(Point(0.2, 0.3), 0.1, 0.15)
        assertClose(moved.x, 0.3, 6)
        assertClose(moved.y, 0.45, 6)
    }

    func testNeverLeavesTheFrame() {
        XCTAssertEqual(moveBlock(Point(0.9, 0.1), 0.5, -0.5), Point(1, 0))
    }

    func testPullsOntoAnEdgeOrTheCentreWhenCloseUnlessAskedNotTo() {
        XCTAssertEqual(moveBlock(Point(0.48, 0.1), 0.01, -0.09), Point(0.5, 0))
        let free = moveBlock(Point(0.48, 0.1), 0.01, -0.09, false)
        assertClose(free.x, 0.49, 6)
        assertClose(free.y, 0.01, 6)
    }

    func testLeavesAPositionAloneWhenNothingIsClose() {
        XCTAssertEqual(moveBlock(Point(0.3, 0.7), 0, 0), Point(0.3, 0.7))
    }
}

final class BadgeLayoutSettleTests: XCTestCase {
    func testIsZeroWhenNothingIsAnimated() {
        XCTAssertEqual(badgeSettleSeconds([:]), 0)
    }

    func testIsTheLatestEntranceToFinishDelayIncluded() {
        assertClose(badgeSettleSeconds([
            .kicker: animated(AnimStep(preset: .fade, duration: 0.4, easing: .out)),
            .headline: animated(AnimStep(preset: .slide, duration: 0.5, easing: .out, delay: 0.8)),
        ]), 1.3, 6)
    }

    func testIgnoresExitsAStillWantsTheBadgeSettledNotGone() {
        XCTAssertEqual(badgeSettleSeconds([.kicker: animated(nil, .some(AnimStep(preset: .fade, duration: 3, easing: .in)))]), 0)
    }
}

final class BadgeLayoutExitWindowTests: XCTestCase {
    private func anim(_ out: Bool) -> BadgePieceStyles {
        let exit: AnimStep? = out ? AnimStep(preset: .fade, duration: 0.4, easing: .in) : nil
        return [.kicker: animated(AnimStep(preset: .fade, duration: 0.4, easing: .out), .some(exit))]
    }

    func testClosesTheWindowOnTheDurationWhenAPieceExits() {
        // Without an end the engine has nothing to lay the exit against.
        XCTAssertEqual(badgeElements(full, layout(), reel, anim(true), 6)[0].window, TimeWindow(start: 0, end: 6))
    }

    func testLeavesTheWindowOpenWhenAPieceOnlyEnters() {
        XCTAssertEqual(badgeElements(full, layout(), reel, anim(false), 6)[0].window, TimeWindow(start: 0, end: nil))
    }

    func testGivesAnUnanimatedPieceNoWindowAtAll() {
        XCTAssertNil(badgeElements(full, layout(), reel, anim(true), 6)[2].window)
    }
}

final class BadgeLayoutBlockExtentTests: XCTestCase {
    func testSpansTheBlockABottomAnchorHangsAboveIt() throws {
        let extent = try XCTUnwrap(badgeBlockExtent(full, layout { $0.anchor = .bottomLeft; $0.y = 0.9 }, reel))
        assertClose(extent.bottom, 0.9, 6)
        XCTAssertLessThan(extent.top, extent.bottom)
    }

    func testCarriesTheBadgesAnchorWhatAShadeFollowingItIsPlacedBy() {
        XCTAssertEqual(badgeBlockExtent(full, layout { $0.anchor = .topRight; $0.y = 0.1 }, reel)?.anchor, .topRight)
    }

    func testStartsAtATopAnchor() throws {
        assertClose(try XCTUnwrap(badgeBlockExtent(full, layout { $0.anchor = .topLeft; $0.y = 0.1 }, reel)).top, 0.1, 6)
    }

    func testAgreesWithWhereTheElementsActuallyLand() throws {
        let els = badgeElements(full, layout(), reel)
        let extent = try XCTUnwrap(badgeBlockExtent(full, layout(), reel))
        assertClose(els[0].y, extent.top, 6)
        XCTAssertLessThan(els[els.count - 1].y, extent.bottom)
    }

    func testGrowsWithTheNumeral() throws {
        let small = try XCTUnwrap(badgeBlockExtent(full, layout { $0.sizeFrac = 0.1 }, reel))
        let big = try XCTUnwrap(badgeBlockExtent(full, layout { $0.sizeFrac = 0.25 }, reel))
        XCTAssertGreaterThan(big.bottom - big.top, small.bottom - small.top)
    }

    func testIsNilWhenThereIsNothingToDraw() {
        XCTAssertNil(badgeBlockExtent(BadgeContent(headline: ""), layout(), reel))
    }
}

final class BadgeLayoutCascadeTests: XCTestCase {
    private let cascade = BadgeCascade(step: AnimStep(preset: .fade, duration: 0.4, easing: .out),
                                       stagger: Stagger(each: 0.1, order: .sequence))

    func testGivesEveryPieceTheOneEntranceDelayedByItsRank() {
        let els = badgeElements(full, layout(), reel, [:], 4, cascade)
        let delays = els.map { $0.animation?.inStep?.delay ?? -1 }
        XCTAssertEqual(delays.count, 7)
        for (got, want) in zip(delays, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) { assertClose(got, want, 9) }
        XCTAssertTrue(els.allSatisfy { $0.animation?.inStep?.preset == .fade })
        XCTAssertTrue(els.allSatisfy { $0.window == TimeWindow(start: 0, end: nil) })
    }

    func testReversesTheStackAndLandsTheWholeStackAtOnceOnColumns() {
        var reversedCascade = cascade
        reversedCascade.stagger = Stagger(each: 0.1, order: .reverse)
        let reversed = badgeElements(full, layout(), reel, [:], 4, reversedCascade)
        assertClose(reversed[0].animation?.inStep?.delay ?? -1, 0.6, 2)
        XCTAssertEqual(reversed[6].animation?.inStep?.delay, 0)
        var columnsCascade = cascade
        columnsCascade.stagger = Stagger(each: 0.1, order: .columns)
        let columns = badgeElements(full, layout(), reel, [:], 4, columnsCascade)
        XCTAssertTrue(columns.allSatisfy { $0.animation?.inStep?.delay == 0 })
    }

    func testKeepsAPiecesOwnExitAndGivesTheWindowAnEndForIt() throws {
        let styles: BadgePieceStyles = [.headline: animated(AnimStep(preset: .scale, duration: 1, easing: .in),
                                                             .some(AnimStep(preset: .fade, duration: 0.3, easing: .in)))]
        let els = badgeElements(full, layout(), reel, styles, 4, cascade)
        let headline = try XCTUnwrap(els.first { $0.id == pieceElementId(.headline) })
        XCTAssertEqual(headline.animation?.inStep?.preset, .fade) // the cascade's, not its own
        XCTAssertEqual(headline.animation?.outStep?.preset, .fade)
        XCTAssertEqual(headline.window, TimeWindow(start: 0, end: 4))
    }

    func testSettlesAfterTheLastPossibleRankPlusTheStepAndReadsJunkAsNone() throws {
        assertClose(badgeSettleSeconds([:], cascade), 0.6 + 0.4, 2)
        XCTAssertNil(readCascade(nil))
        XCTAssertNil(readCascade(["stagger": [:]]))
        let read = try XCTUnwrap(readCascade([
            "step": ["preset": "zoom", "duration": -1, "easing": "wobble"], "stagger": ["order": "rows"],
        ]))
        XCTAssertEqual(read.step, AnimStep(preset: .fade, duration: 0, easing: .out))
        XCTAssertEqual(read.stagger, Stagger(each: 0.1, order: .rows))
    }
}
