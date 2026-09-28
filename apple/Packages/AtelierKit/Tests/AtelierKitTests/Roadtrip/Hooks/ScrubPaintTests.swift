// `hooks/scrub-paint.ts` has no web spec; these pin the rules its header
// states, read off `scrubFrame`: a flash only while sweeping, a dark frame for
// a stop with nothing to show, the dip on a landing, the band that is drawn
// being the band a click grabs, ticks growing away from the edge and turning
// the passed colour behind the head, and the head's three shapes.

import XCTest
@testable import AtelierKit

private func calendar(_ total: Int, _ told: [Int], _ legs: [Int] = [1]) -> [HookDay] {
    (0..<total).map { i in
        let isTold = told.contains(i + 1)
        let pieces = isTold
            ? [HookDayPiece(id: "p\(i + 1)", media: SavedMediaRef(name: "p\(i + 1).jpg", size: 1, lastModified: 0))]
            : []
        return HookDay(date: addDays("2025-03-01", i)!, dayNumber: i + 1, told: isTold,
                       legStart: legs.contains(i + 1), pieces: pieces)
    }
}

private let frame1080 = FrameBox(width: 1080, height: 1920)

final class ScrubPaintFrameTests: XCTestCase {
    private let cal = calendar(30, [3, 8, 14, 20], [1, 14])
    private var opts: ScrubOptions {
        var o = scrubDefaults
        o.sweepSeconds = 2
        return o
    }
    private var plan: ScrubPlan { scrubPlan(cal, cal[26].date, opts)! }
    private let key3 = hookPictureKey(SavedMediaRef(name: "p3.jpg", size: 1, lastModified: 0))

    func testDrawsNothingOnAFrameWithNoArea() {
        XCTAssertNil(scrubFrame(plan, opts, nil, 0, FrameBox(width: 0, height: 1920)))
    }

    func testFlashesAStopsPictureOnlyWhenTheShellDecodedOneAndGoesDarkOtherwise() {
        let at3 = plan.stops[1].at
        XCTAssertEqual(plan.stops[1].dayNumber, 3)
        let pictures = [key3: HookPicture(width: 1080, height: 1920)]
        XCTAssertEqual(scrubFrame(plan, opts, pictures, at3 + 0.1, frame1080)?.flash, .picture(key: key3))
        XCTAssertEqual(scrubFrame(plan, opts, nil, at3 + 0.1, frame1080)?.flash, .empty)
        XCTAssertEqual(scrubFrame(plan, opts, [key3: HookPicture(width: 0, height: 0)], at3 + 0.1, frame1080)?.flash, .empty)
        // Day 1 was told by nobody: it sweeps through dark.
        XCTAssertEqual(scrubFrame(plan, opts, pictures, 0, frame1080)?.flash, .empty)
    }

    func testLeavesThePieceOwnPictureAloneAtRestAndWithTheFlashOff() {
        XCTAssertNil(scrubFrame(plan, opts, nil, plan.endSeconds, frame1080)?.flash)
        var off = opts
        off.flash = false
        XCTAssertNil(scrubFrame(plan, off, nil, 0.5, frame1080)?.flash)
    }

    func testDipsOnALandingButNotOnTheFirstStopAndFadesOutOverSixtyMs() {
        XCTAssertEqual(scrubFrame(plan, opts, nil, 0, frame1080)?.dipAlpha, 0)
        let landing = plan.stops[2].at
        assertClose(scrubFrame(plan, opts, nil, landing, frame1080)!.dipAlpha, scrubDipAlpha, 9)
        assertClose(scrubFrame(plan, opts, nil, landing + 0.03, frame1080)!.dipAlpha, scrubDipAlpha / 2, 6)
        XCTAssertEqual(scrubFrame(plan, opts, nil, landing + 0.061, frame1080)?.dipAlpha, 0)
    }

    func testDrawsTheBandTheStageGrabsAndTheTrackOnlyWhenAsked() {
        var o = opts
        o.tapeBackground = true
        let f = scrubFrame(plan, o, nil, 0, frame1080)!
        XCTAssertEqual(f.band?.rect, tapeBox(1080, 1920, o.tapeGeometryOptions))
        XCTAssertEqual(f.band?.radius, 8)
        XCTAssertEqual(f.band?.alpha, o.backgroundOpacity)
        XCTAssertNil(f.band?.gradient)
        let g = tapeGeometry(1080, 1920, o.tapeGeometryOptions)
        XCTAssertEqual(f.track?.rect, Rect(x: g.x0, y: g.baseline - 0.75, width: g.length, height: 1.5))
        o.showTrack = false
        o.tapeBackground = false
        let bare = scrubFrame(plan, o, nil, 0, frame1080)!
        XCTAssertNil(bare.band)
        XCTAssertNil(bare.track)
    }

    func testFadesTheBandAndTheTrackToNothingAtTheEndsWithThirteenStops() {
        var o = opts
        o.tapeBackground = true
        o.edgeFade = true
        let f = scrubFrame(plan, o, nil, 0, frame1080)!
        let track = f.track!.gradient!
        XCTAssertEqual(track.count, scrubFadeSteps + 1)
        XCTAssertEqual(track.first?.alpha, 0)
        XCTAssertEqual(track.last?.alpha, 0)
        XCTAssertEqual(track[6].alpha, o.tickOpacity)
        let band = f.band!.gradient!
        XCTAssertEqual(band.count, 13)
        XCTAssertEqual(band.first?.alpha, 0)
        XCTAssertEqual(band[6].alpha, o.backgroundOpacity)
    }

    func testGrowsTheTicksAwayFromTheEdgeTallerAtALegAndPassedBehindTheHead() {
        let mid = scrubFrame(plan, opts, nil, plan.stops[2].at, frame1080)!
        let g = tapeGeometry(1080, 1920, opts.tapeGeometryOptions)
        for tick in mid.ticks {
            // A bottom tape: every tick stands ON the baseline, reaching up.
            XCTAssertEqual(tick.rect.maxY, g.baseline, accuracy: 1e-9)
            XCTAssertEqual(tick.rect.height, tick.leg ? g.tallTick : g.shortTick)
            XCTAssertEqual(tick.passed, tick.day <= 8)
            XCTAssertEqual(tick.color, tick.passed ? opts.passedColor : opts.tickColor)
            XCTAssertEqual(tick.alpha, tick.passed ? 0.95 : min(1, opts.tickOpacity + (tick.leg ? 0.25 : 0)), accuracy: 1e-12)
        }
        XCTAssertTrue(mid.ticks.contains { $0.day == 14 && $0.leg })

        var top = opts
        top.tape = .top
        let t = scrubFrame(plan, top, nil, 0, frame1080)!
        let gt = tapeGeometry(1080, 1920, top.tapeGeometryOptions)
        XCTAssertTrue(t.ticks.allSatisfy { $0.rect.minY == gt.baseline })
    }

    func testPutsTheHeadOnTheDayItReadsInEachOfItsThreeShapes() {
        let g = tapeGeometry(1080, 1920, opts.tapeGeometryOptions)
        let rest = plan.endSeconds + 1
        let hx = g.x0 + g.length * tapeFraction(27, 30)
        let bar = scrubFrame(plan, opts, nil, rest, frame1080)!.head
        XCTAssertEqual(bar.shape, .bar(Rect(x: hx - 2.5, y: g.baseline - g.headTall + 6, width: 5, height: g.headTall), radius: 2.5))
        XCTAssertEqual(bar.color, opts.passedColor)
        XCTAssertEqual(bar.alpha, 1)
        XCTAssertEqual(bar.glowBlur, 14)

        var o = opts
        o.headStyle = .dot
        o.headGlow = false
        let dot = scrubFrame(plan, o, nil, rest, frame1080)!.head
        XCTAssertEqual(dot.shape, .dot(center: Point(hx, g.baseline - g.shortTick - 9), radius: 7))
        XCTAssertNil(dot.glowBlur)

        o.headStyle = .needle
        let needle = scrubFrame(plan, o, nil, rest, frame1080)!.head
        XCTAssertEqual(needle.shape, .needle(tip: Point(hx, g.baseline - 4),
                                             left: Point(hx - 7, g.baseline - g.headTall),
                                             right: Point(hx + 7, g.baseline - g.headTall)))
    }

    func testReadsTheDrawingThePrepareHandedThePainter() {
        let pictures = [key3: HookPicture(width: 10, height: 10)]
        let drawing = ScrubDrawing(plan: plan, options: opts, pictures: pictures)
        let t = plan.stops[1].at + 0.1
        XCTAssertEqual(drawing.frame(at: t, frame1080), scrubFrame(plan, opts, pictures, t, frame1080))
        XCTAssertEqual(drawing.frame(at: t, frame1080)?.flash, .picture(key: key3))
    }
}
