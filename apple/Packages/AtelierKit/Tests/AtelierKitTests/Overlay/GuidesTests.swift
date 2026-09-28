// Port of `src/shared/overlay/guides.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

final class SnapTests: XCTestCase {
    func testPullsACoordinateOntoAnEdgeOrTheCentreWhenItIsClose() {
        XCTAssertEqual(snap(0.01), 0)
        XCTAssertEqual(snap(0.99), 1)
        XCTAssertEqual(snap(0.51), 0.5)
    }

    func testLeavesACoordinateAloneElsewhere() {
        XCTAssertEqual(snap(0.3), 0.3)
        XCTAssertEqual(snap(0.47), 0.47)
    }

    func testTakesItsToleranceFromTheCaller() {
        XCTAssertEqual(snap(0.05, 0.1), 0)
        XCTAssertEqual(snap(0.05, 0.02), 0.05)
    }
}

final class SnapToGridTests: XCTestCase {
    func testSnapsToTheNearestDivisionWithinTolerance() {
        assertClose(snapToGrid(0.34, 3), 1.0 / 3, 2)
        XCTAssertEqual(snapToGrid(0.0, 3), 0)
        XCTAssertEqual(snapToGrid(1.0, 3), 1)
    }

    func testLeavesValuesThatAreNotCloseToAnyLine() {
        // Thirds are 0, .333, .667, 1 — 0.5 is far from all of them.
        XCTAssertEqual(snapToGrid(0.5, 3), 0.5)
    }

    func testTreatsASingleDivisionAsEdgesOnly() {
        XCTAssertEqual(snapToGrid(0.02, 1), 0)
        XCTAssertEqual(snapToGrid(0.99, 1), 1)
        XCTAssertEqual(snapToGrid(0.4, 1), 0.4)
    }

    func testReturnsTheInputWhenDivisionsBelow1() {
        XCTAssertEqual(snapToGrid(0.42, 0), 0.42)
    }
}

final class ClampDivisionsTests: XCTestCase {
    func testRoundsAndClampsTo1To12() {
        XCTAssertEqual(clampDivisions(0), 1)
        XCTAssertEqual(clampDivisions(3.4), 3)
        XCTAssertEqual(clampDivisions(99), 12)
        XCTAssertEqual(clampDivisions(.nan), 1)
    }
}

final class TargetFrameTests: XCTestCase {
    func testPillarboxesAVerticalTargetInsideALandscapeFrame() {
        let f = targetFrame(9.0 / 16, 1920, 1080)
        XCTAssertEqual(f.height, 1080)
        assertClose(f.width, 1080 * (9.0 / 16), 2) // 607.5
        assertClose(f.x, (1920 - 607.5) / 2, 2)
        XCTAssertEqual(f.y, 0)
    }

    func testLetterboxesAWiderTargetInsideASquareIshFrame() {
        let f = targetFrame(16.0 / 9, 1000, 1000)
        XCTAssertEqual(f.width, 1000)
        assertClose(f.height, 1000 / (16.0 / 9), 2) // 562.5
        XCTAssertEqual(f.x, 0)
        assertClose(f.y, (1000 - 562.5) / 2, 2)
    }

    func testFillsExactlyWhenTheAspectMatchesTheFrame() {
        let f = targetFrame(16.0 / 9, 1920, 1080)
        assertClose(f.width, 1920, 2)
        assertClose(f.height, 1080, 2)
        assertClose(f.x, 0, 2)
        assertClose(f.y, 0, 2)
    }
}

final class OrientationOfTests: XCTestCase {
    func testSortsPortraitLandscapeAndSquareIshAspects() {
        XCTAssertEqual(orientationOf(9.0 / 16), -1)
        XCTAssertEqual(orientationOf(16.0 / 9), 1)
        XCTAssertEqual(orientationOf(1), 0)
        XCTAssertEqual(orientationOf(4.0 / 5), -1)
    }

    func testTreatsAMissingOrNonsenseAspectAsSquare() {
        XCTAssertEqual(orientationOf(0), 0)
        XCTAssertEqual(orientationOf(.nan), 0)
        XCTAssertEqual(orientationOf(-2), 0)
    }
}

final class ShouldRotateSafeZoneTests: XCTestCase {
    func testAutoTurnsAPortraitTemplateOverALandscapeFrameAndBack() {
        XCTAssertTrue(shouldRotateSafeZone(.auto, 9.0 / 16, 16.0 / 9))
        XCTAssertTrue(shouldRotateSafeZone(.auto, 16.0 / 9, 9.0 / 16))
    }

    func testAutoLeavesATemplateWhoseOrientationAlreadyMatches() {
        XCTAssertFalse(shouldRotateSafeZone(.auto, 9.0 / 16, 9.0 / 16))
        XCTAssertFalse(shouldRotateSafeZone(.auto, 16.0 / 9, 16.0 / 9))
    }

    func testAutoStandsDownOnASquareFrameOrASquareTemplate() {
        XCTAssertFalse(shouldRotateSafeZone(.auto, 9.0 / 16, 1))
        XCTAssertFalse(shouldRotateSafeZone(.auto, 1, 16.0 / 9))
    }

    func testTheManualModesWinOverTheFrame() {
        XCTAssertFalse(shouldRotateSafeZone(.upright, 9.0 / 16, 16.0 / 9))
        XCTAssertTrue(shouldRotateSafeZone(.rotated, 9.0 / 16, 9.0 / 16))
    }
}

final class RotateSafeZoneTests: XCTestCase {
    private let preset = SafeZonePreset(id: "test", label: "Test", aspect: 9.0 / 16, deadzones: [
        GuideRect(x: 0, y: 0, w: 1, h: 0.08, label: "Top"),
        GuideRect(x: 0.84, y: 0.38, w: 0.16, h: 0.44, label: "Actions"),
    ])

    func testInvertsTheAspect() {
        assertClose(rotateSafeZone(preset).aspect, 16.0 / 9, 2)
    }

    func testCarriesTheTopBarOntoTheRightEdge() {
        let top = rotateSafeZone(preset).deadzones[0]
        assertClose(top.x, 0.92, 2)
        assertClose(top.y, 0, 2)
        assertClose(top.w, 0.08, 2)
        assertClose(top.h, 1, 2)
    }

    func testCarriesTheRightHandActionColumnOntoTheBottom() {
        let actions = rotateSafeZone(preset).deadzones[1]
        assertClose(actions.x, 0.18, 2)
        assertClose(actions.y, 0.84, 2)
        assertClose(actions.w, 0.44, 2)
        assertClose(actions.h, 0.16, 2)
    }

    func testKeepsEveryZoneInsideTheFrameAndItsLabelsIntact() {
        for r in rotateSafeZone(preset).deadzones {
            XCTAssertGreaterThanOrEqual(r.x, 0)
            XCTAssertGreaterThanOrEqual(r.y, 0)
            XCTAssertLessThanOrEqual(r.x + r.w, 1.0001)
            XCTAssertLessThanOrEqual(r.y + r.h, 1.0001)
        }
        XCTAssertEqual(rotateSafeZone(preset).deadzones[0].label, "Top")
    }

    func testTurnedFourTimesItIsBackWhereItStarted() {
        let back = rotateSafeZone(rotateSafeZone(rotateSafeZone(rotateSafeZone(preset))))
        assertClose(back.aspect, preset.aspect, 2)
        for (i, r) in back.deadzones.enumerated() {
            assertClose(r.x, preset.deadzones[i].x, 2)
            assertClose(r.y, preset.deadzones[i].y, 2)
            assertClose(r.w, preset.deadzones[i].w, 2)
            assertClose(r.h, preset.deadzones[i].h, 2)
        }
    }
}

final class ResolveSafeZoneTests: XCTestCase {
    private func guides(_ change: (inout GuidesState) -> Void) -> GuidesState {
        var g = GuidesState.default
        change(&g)
        return g
    }

    func testIsNilWithNoPresetPicked() {
        XCTAssertNil(resolveSafeZone(guides { $0.safeZone = "none" }, 16.0 / 9))
        XCTAssertNil(resolveSafeZone(guides { $0.safeZone = "nope" }, 16.0 / 9))
    }

    func testSpansALandscapeFrameInsteadOfBandingAcrossItsMiddle() throws {
        let reels = try XCTUnwrap(findSafeZone("reels"))
        let resolved = try XCTUnwrap(resolveSafeZone(guides { $0.safeZone = "reels" }, 16.0 / 9))
        assertClose(resolved.aspect, 16.0 / 9, 2)
        // With the template's aspect now the frame's, the target frame IS the frame.
        let f = targetFrame(resolved.aspect, 1920, 1080)
        assertClose(f.width, 1920, 2)
        assertClose(f.height, 1080, 2)
        // The upright template would have been pillarboxed to a middle band.
        XCTAssertLessThan(targetFrame(reels.aspect, 1920, 1080).width, 700)
    }

    func testLeavesTheTemplateAloneOverAMatchingFrame() {
        XCTAssertEqual(resolveSafeZone(guides { $0.safeZone = "reels" }, 9.0 / 16), findSafeZone("reels"))
    }

    func testUprightGetsTheAuthoredTemplateBackOverALandscapeFrame() {
        let resolved = resolveSafeZone(guides { $0.safeZone = "reels"; $0.safeZoneOrientation = .upright }, 16.0 / 9)
        XCTAssertEqual(resolved, findSafeZone("reels"))
    }

    // The web casts a legacy state lacking the field; the port's reader gives it `auto`.
    func testDefaultsToAutoForAStateWrittenBeforeTheFieldExisted() throws {
        let legacy = readGuidesState(["safeZone": "reels", "grid": ["show": false, "cols": 3, "rows": 3, "snap": false]])
        XCTAssertEqual(legacy.safeZoneOrientation, .auto)
        assertClose(try XCTUnwrap(resolveSafeZone(legacy, 16.0 / 9)).aspect, 16.0 / 9, 2)
        XCTAssertEqual(readGuidesState(legacy.json), legacy)
    }
}
