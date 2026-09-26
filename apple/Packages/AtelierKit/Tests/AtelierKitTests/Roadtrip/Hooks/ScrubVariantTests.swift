// The variants' faces — `badge.tsx` and `scrub.tsx` have no web spec of their
// own (their rules are exercised through `hook-context.test.ts` and the house
// style's), so these pin what each states: what Défilé needs, when it refuses,
// what it asks the shell for, what it hands the painter, the tape a drag
// moves — and the registry rule the house style leans on, that an option
// holding a LIST is content and must be declared so.

import XCTest
@testable import AtelierKit

private func calendar(_ total: Int, _ told: [Int] = []) -> [HookDay] {
    (0..<total).map { i in
        let isTold = told.contains(i + 1)
        let pieces = isTold
            ? [HookDayPiece(id: "p\(i + 1)", media: SavedMediaRef(name: "p\(i + 1).jpg", size: 1, lastModified: 0))]
            : []
        return HookDay(date: addDays("2025-03-01", i)!, dayNumber: i + 1, told: isTold, legStart: i == 0, pieces: pieces)
    }
}

private func context(_ cal: [HookDay]?, _ day: Int, counter: CounterMode = .day) -> HookContext {
    HookContext(aspect: 9.0 / 16, durationSeconds: 2, date: addDays("2025-03-01", day - 1)!,
                counterMode: counter, calendar: cal)
}

final class HookVariantFacesTests: XCTestCase {
    func testTheBadgeDrawsNothingSaysNothingAndLeavesThePictureAlone() {
        XCTAssertEqual(badgeVariant.id, defaultHookId)
        XCTAssertEqual(badgeVariant.owns, .layer)
        XCTAssertEqual(badgeVariant.defaults, [:])
        let render = badgeVariant.prepare([:], context(nil, 1))
        XCTAssertEqual(render.seconds, 0)
        XCTAssertNil(render.content)
        XCTAssertNil(render.drawing)
        XCTAssertNil(render.score)
    }

    func testTheRegistryIsTheWebsPickerOrderForTheVariantsWhosePlansAreHere() {
        XCTAssertEqual(hookVariants.map(\.id), ["badge", "scrub"])
    }

    /// The house style resets `contentKeys` to the defaults: a list of pictures
    /// or stops from one journey is nothing in the next.
    func testEveryDefaultThatIsAListIsDeclaredAsContent() {
        for variant in hookVariants {
            for (key, value) in variant.defaults where value.arrayValue != nil {
                XCTAssertTrue(variant.contentKeys?.contains(key) == true, "\(variant.id).\(key)")
            }
        }
    }

    func testDefileOwnsTheFrameAndSaysWhatItNeeds() {
        XCTAssertEqual(scrubVariant.owns, .frame)
        XCTAssertEqual(scrubVariant.needs, HookNeeds(coverage: true, stages: true, media: .day))
        XCTAssertEqual(scrubVariant.contentKeys, ["picked"])
        XCTAssertEqual(scrubOptions(scrubVariant.defaults), scrubDefaults)
    }

    func testDefileRefusesATripTooShortOrAPieceOutsideItAndWaitsForACalendar() {
        XCTAssertNil(hookUnmet(scrubVariant, context(nil, 1)))
        XCTAssertEqual(hookUnmet(scrubVariant, context(calendar(1), 1)), "Needs a trip of two days or more")
        XCTAssertEqual(hookUnmet(scrubVariant, context(calendar(5), 9)), "This piece is dated outside the trip")
        XCTAssertNil(hookUnmet(scrubVariant, context(calendar(5), 3)))
    }

    func testDefileAsksOnlyForThePicturesItsStopsFlashAndNothingWithTheFlashOff() {
        let cal = calendar(10, [2, 4])
        let wants = scrubVariant.wantsPictures?([:], context(cal, 8)) ?? []
        XCTAssertEqual(wants.map(\.ref.name), ["p2.jpg", "p4.jpg"])
        XCTAssertEqual(scrubVariant.wantsPictures?(["flash": false], context(cal, 8)), [])
        XCTAssertEqual(scrubVariant.wantsPictures?([:], context(nil, 8)), [])
    }

    func testDefileHandsThePainterThePlanItsNumeralAndItsTicksRead() {
        let cal = calendar(10, [2, 4])
        let render = scrubVariant.prepare([:], context(cal, 8))
        guard let drawing = render.drawing as? ScrubDrawing else { return XCTFail("a scrub draws a ScrubDrawing") }
        XCTAssertEqual(render.seconds, drawing.plan.endSeconds)
        XCTAssertEqual(render.score?().map(\.at), drawing.plan.stops.map(\.at))
        XCTAssertEqual(render.content?(0)[.headline], .text("1"))
        XCTAssertEqual(render.content?(render.seconds), [:])
        XCTAssertFalse(render.mixWithSource)
    }

    func testDefileMixesIntoAClipOnlyWhenAskedAndOnlyWithItsSoundOn() {
        let cal = calendar(10, [2, 4])
        XCTAssertTrue(scrubVariant.prepare(["mixWithClip": true], context(cal, 8)).mixWithSource)
        let silent = scrubVariant.prepare(["mixWithClip": true, "sound": false], context(cal, 8))
        XCTAssertFalse(silent.mixWithSource)
        XCTAssertNil(silent.score)
    }

    func testDefileGrabsItsTapeAndADragWritesTheOffsetsBack() {
        let cal = calendar(10)
        let frame = FrameBox(width: 1080, height: 1920)
        let box = scrubVariant.frameBox?([:], context(cal, 8), frame)
        XCTAssertEqual(box, tapeBox(1080, 1920, scrubDefaults.tapeGeometryOptions))
        XCTAssertNil(scrubVariant.frameBox?([:], context(cal, 20), frame))
        let moved = scrubVariant.moveBy?([:], 0.05, -0.1) ?? [:]
        assertClose(scrubOptions(moved).offsetX, 0.05, 9)
        assertClose(scrubOptions(moved).offsetY, -0.1, 9)
    }
}
