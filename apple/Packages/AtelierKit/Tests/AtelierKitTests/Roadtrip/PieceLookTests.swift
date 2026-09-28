// The Look tab's writes (`Roadtrip/PieceLook.swift`). The web writes these
// inline in `LookTab.tsx`, `PieceStylePanel.tsx` and `ShadesPanel.tsx` with no
// spec of their own, so this one pins their observable rules: the anchors'
// default positions, absent against `null` in a piece's departures, the
// cascade staying on with a still step, a hand-picked cell demoting Anchor to
// Edge, and a falloff drawn from the renderer's own stops.

import XCTest
@testable import AtelierKit

final class PieceLookPlacementTests: XCTestCase {
    func testEveryAnchorHasTheWebsDefaultPosition() {
        let want: [(OverlayAnchor, Double, Double)] = [
            (.topLeft, 0.07, 0.08), (.topCenter, 0.5, 0.08), (.topRight, 0.93, 0.08),
            (.centerLeft, 0.07, 0.5), (.center, 0.5, 0.5), (.centerRight, 0.93, 0.5),
            (.bottomLeft, 0.07, 0.92), (.bottomCenter, 0.5, 0.92), (.bottomRight, 0.93, 0.92),
        ]
        for (anchor, x, y) in want {
            let at = badgeAnchorPosition(anchor)
            XCTAssertEqual(at.x, x, anchor.rawValue)
            XCTAssertEqual(at.y, y, anchor.rawValue)
        }
    }

    func testPickingAnAnchorMovesTheBlockAndKeepsTheNumeral() {
        let layout = BadgeLayout(anchor: .bottomLeft, x: 0.3, y: 0.4, sizeFrac: 0.22)
        let next = badgeLayoutAnchored(layout, .topRight)
        XCTAssertEqual(next, BadgeLayout(anchor: .topRight, x: 0.93, y: 0.08, sizeFrac: 0.22))
    }
}

final class PieceLookStyleTests: XCTestCase {
    func testAnUntouchedStyleDoesNotDepart() {
        XCTAssertFalse(pieceStyleDeparts(BadgePieceStyle()))
    }

    func testAnInkSwitchedOffIsStillADeparture() {
        // `{ color: null }` has a key: the web's reset button shows for it.
        XCTAssertTrue(pieceStyleDeparts(BadgePieceStyle(color: .some(nil))))
        XCTAssertTrue(pieceStyleDeparts(BadgePieceStyle(textCase: .upper)))
    }

    func testNoneClearsAStep() {
        XCTAssertNil(pieceStepWithPreset(AnimStep(preset: .fade, duration: 1, easing: .in), .none))
        XCTAssertNil(pieceStepWithPreset(nil, .none))
    }

    func testAFirstPresetStartsFromAPlainHalfSecondFade() {
        XCTAssertEqual(pieceStepWithPreset(nil, .slide), AnimStep(preset: .slide, duration: 0.5, easing: .out))
    }

    func testAnotherPresetKeepsTheStepsKnobs() {
        let step = AnimStep(preset: .fade, duration: 1.2, easing: .back, direction: .left, delay: 0.3)
        var want = step
        want.preset = .scale
        XCTAssertEqual(pieceStepWithPreset(step, .scale), want)
    }

    func testAnEntranceKeepsTheExit() {
        let out = AnimStep(preset: .fade, duration: 0.4, easing: .in)
        let style = BadgePieceStyle(animation: .some(ElementAnimation(in: .some(nil), out: .some(out))))
        let entrance = AnimStep(preset: .wipe, duration: 0.6, easing: .out)
        let next = pieceStyleEntrance(style, entrance)
        XCTAssertEqual(next.animation, .some(ElementAnimation(in: .some(entrance), out: .some(out))))
    }

    func testAnExitKeepsTheEntrance() {
        let entrance = AnimStep(preset: .slide, duration: 0.5, easing: .out)
        let style = BadgePieceStyle(animation: .some(ElementAnimation(in: .some(entrance))))
        let out = AnimStep(preset: .fade, duration: 0.4, easing: .in)
        let next = pieceStyleExit(style, out)
        XCTAssertEqual(next.animation, .some(ElementAnimation(in: .some(entrance), out: .some(out))))
    }

    func testNeitherEndLeftWritesNullNotAnEmptyRecord() {
        let entrance = AnimStep(preset: .slide, duration: 0.5, easing: .out)
        let style = BadgePieceStyle(animation: .some(ElementAnimation(in: .some(entrance), out: .some(nil))))
        let next = pieceStyleEntrance(style, nil)
        XCTAssertEqual(next.animation, .some(nil))
        XCTAssertEqual(next.json.objectValue?["animation"], .null)
        XCTAssertEqual(pieceStyleExit(BadgePieceStyle(), nil).animation, .some(nil))
    }

    func testAStepWrittenOnAStyleWithNoAnimationWritesTheOtherEndNull() {
        let entrance = AnimStep(preset: .fade, duration: 0.5, easing: .out)
        let anim = pieceStyleEntrance(BadgePieceStyle(), entrance).animation
        XCTAssertEqual(anim, .some(ElementAnimation(in: .some(entrance), out: .some(nil))))
    }
}

final class PieceLookCascadeTests: XCTestCase {
    func testNoneKeepsTheCascadeOnWithAStillStep() {
        let next = cascadeWithStep(defaultCascade(), nil)
        XCTAssertEqual(next.step, AnimStep(preset: .none, duration: 0, easing: .linear))
        XCTAssertEqual(next.stagger, defaultCascade().stagger)
    }

    func testAStepIsWrittenWholeAndTheOrderKept() {
        let step = AnimStep(preset: .scale, duration: 0.8, easing: .spring)
        var cascade = defaultCascade()
        cascade.stagger.order = .centerOut
        let next = cascadeWithStep(cascade, step)
        XCTAssertEqual(next.step, step)
        XCTAssertEqual(next.stagger.order, .centerOut)
    }
}

final class PieceLookShadeTests: XCTestCase {
    func testTheRadiusShapesAreTheRadialAndTheCorners() {
        let round = ShadeDirection.allCases.filter(shadeIsRound)
        XCTAssertEqual(Set(round), [.radial, .topLeft, .topRight, .bottomLeft, .bottomRight])
    }

    func testAnAnchoredShadeShowsTheBadgesCell() {
        let shade = createShade(direction: .bottom, followAnchor: true)
        XCTAssertEqual(shadeShownDirection(shade, .topLeft), .topLeft)
        XCTAssertEqual(shadeShownDirection(shade, nil), .bottom)
    }

    func testABandSurvivesACentredBadge() {
        let shade = createShade(direction: .middleVertical, followAnchor: true)
        XCTAssertEqual(shadeShownDirection(shade, .center), .middleVertical)
    }

    func testAShadeNotAnchoredShowsItsOwnDirection() {
        let shade = createShade(direction: .left, followHook: true)
        XCTAssertEqual(shadeShownDirection(shade, .topRight), .left)
    }

    func testPickingACellByHandDemotesAnchorToEdge() {
        let shade = createShade(direction: .bottom, followAnchor: true)
        let next = shadeDirectionPicked(shade, .top)
        XCTAssertEqual(next.direction, .top)
        XCTAssertEqual(shadeFollow(next), .edge)
        XCTAssertEqual(next.followHook, true)
        XCTAssertEqual(next.followAnchor, false)
    }

    func testPickingACellLeavesAnotherFollowAlone() {
        let loose = shadeDirectionPicked(createShade(direction: .bottom), .left)
        XCTAssertEqual(shadeFollow(loose), .none)
        XCTAssertEqual(loose.followAnchor, false)
        let edge = shadeDirectionPicked(createShade(direction: .bottom, followHook: true), .right)
        XCTAssertEqual(shadeFollow(edge), .edge)
    }

    func testAPickedCellKeepsAnAbsentAnchorFlagAbsent() {
        // A shade stored before `followAnchor` existed writes back as it was.
        var old = createShade(direction: .bottom)
        old.followAnchor = nil
        XCTAssertNil(shadeDirectionPicked(old, .top).followAnchor)
    }

    func testTheFollowModeWritesBothFlags() {
        let shade = createShade()
        let anchor = shadeFollowing(shade, .anchor)
        XCTAssertEqual(anchor.followHook, false)
        XCTAssertEqual(anchor.followAnchor, true)
        let none = shadeFollowing(anchor, .none)
        XCTAssertEqual(none.followHook, false)
        XCTAssertEqual(none.followAnchor, false)
        XCTAssertEqual(shadeFollow(shadeFollowing(shade, .edge)), .edge)
    }

    func testAShadeIsCentredOnlyOnTheAxesItMoves() {
        var band = createShade(direction: .middleVertical)
        XCTAssertTrue(shadeCentred(band, .y))
        band.center = Point(0.2, 0.5)
        // A vertical band moves up and down only: its x is not its centre.
        XCTAssertTrue(shadeCentred(band, .y))
        band.center = Point(0.5, 0.3)
        XCTAssertFalse(shadeCentred(band, .y))
        var pool = createShade(direction: .radial)
        pool.center = Point(0.5, 0.7)
        XCTAssertFalse(shadeCentred(pool, .both))
        XCTAssertTrue(shadeCentred(pool, .x))
    }

    func testTheSoftFalloffIsDrawnFromTheHistoricalStops() {
        let stops = shadeFalloffStops(.soft)
        XCTAssertEqual(stops, [
            ShadeStop(at: 0, alpha: 1),
            ShadeStop(at: 0.55, alpha: 0.35),
            ShadeStop(at: 1, alpha: 0),
        ])
    }

    func testEveryFalloffRunsFromFullStrengthToClear() {
        for falloff in ShadeFalloff.allCases {
            let stops = shadeFalloffStops(falloff)
            XCTAssertGreaterThanOrEqual(stops.count, 3, falloff.rawValue)
            assertClose(stops.first?.alpha ?? -1, 1, 9)
            assertClose(stops.last?.alpha ?? -1, 0, 9)
            XCTAssertEqual(stops.first?.at, 0)
            XCTAssertEqual(stops.last?.at, 1)
        }
    }
}
