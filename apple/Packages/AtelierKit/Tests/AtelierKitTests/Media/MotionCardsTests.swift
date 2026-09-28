// Port of `src/shared/media/motion-cards.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let rest = framing { $0.scale = 1.4; $0.x = 0.1; $0.y = -0.02 }

private func card(_ scale: Double, _ x: Double, _ y: Double = 0) -> Framing {
    framing { $0.scale = scale; $0.x = x; $0.y = y }
}

private func key(_ at: Double, _ scale: Double, _ x: Double, _ y: Double) -> FramingKey {
    FramingKey(at: at, scale: scale, x: x, y: y)
}

final class ReadCardsTests: XCTestCase {
    func testReadsAStillPictureAsItsOneCardTheComposition() {
        XCTAssertEqual(readCards(rest, nil, 5), MotionCards(cards: [rest], holdSeconds: 0))
        XCTAssertEqual(cardLabel(0, 1), "Composition")
    }

    func testReadsOneCardPerRunOfEqualFramesTheRestLastAndTheFirstPauseAsTheHold() {
        let motion = FramingMotion(
            keys: [key(0, 2, 0.2, 0), key(0.1, 2, 0.2, 0), key(0.6, 1.4, 0.1, -0.02)],
            easing: .linear,
            start: .slide
        )
        let read = readCards(rest, motion, 5)
        XCTAssertEqual(read.cards.map(\.scale), [2, 1.4])
        XCTAssertEqual(read.cards[1], rest)
        assertClose(read.holdSeconds, 0.5, 6)
        XCTAssertEqual(cardLabel(0, 2), "Start")
        XCTAssertEqual(cardLabel(1, 2), "End")
        XCTAssertEqual(cardLabel(1, 3), "Stop 2")
    }
}

final class CardsMotionTests: XCTestCase {
    func testWritesOneCardAsNoMotionThePictureRestingOnIt() {
        let out = cardsMotion(rest, nil, [card(2, 0.3)], 0.4, 5)
        var want = rest
        want.scale = 2; want.x = 0.3; want.y = 0
        XCTAssertEqual(out, FramingWrite(framing: want, motion: nil))
    }

    func testRoundTripsCardsWrittenAsKeysReadBackAsTheSameCardsAndHold() {
        let cards = [card(2, 0.3), card(1.2, -0.1, 0.05), rest]
        let out = cardsMotion(rest, nil, cards, 0.4, 5)!
        XCTAssertTrue(hasMotion(out.motion))
        XCTAssertEqual(out.framing, rest)
        let back = readCards(out.framing, out.motion, 5)
        XCTAssertEqual(back.cards, cards)
        assertClose(back.holdSeconds, 0.4, 6)
        // Three arrivals, the first at 0, the last before the end of the span by its pause.
        let arrivals = arrivalMarks(out.framing, out.motion, 5)
        XCTAssertEqual(arrivals.count, 3)
        XCTAssertEqual(arrivals[0], 0)
        assertClose(arrivals[2], 5 - 0.4, 6)
    }

    func testSharesTheGlidesByHowFarTheViewTravelsTheZoomCountingForAPan() {
        // A long pan then a short one at the same zoom: the first hop takes longer.
        let out = cardsMotion(rest, nil, [card(2, 0.4), card(2, 0), card(2, -0.1)], 0, 4)!
        let marks = arrivalMarks(out.framing, out.motion, 4)
        let a = marks[0], b = marks[1], c = marks[2]
        XCTAssertGreaterThan(b - a, c - b)
        assertClose((b - a) / (c - b), 0.4 / 0.1, 1)
        // A push in with no pan still takes time.
        let push = cardsMotion(rest, nil, [card(1, 0), card(2, 0)], 0, 4)!
        XCTAssertEqual(arrivalMarks(push.framing, push.motion, 4), [0, 4])
        XCTAssertGreaterThan(framingAt(push.framing, push.motion, 2, 4).scale, 1)
    }

    func testShrinksThePausesBeforeTheGlidesDropUnderTheirFloor() {
        let cards = [card(2, 0.3), card(2, 0), card(2, -0.3), rest]
        let out = cardsMotion(rest, nil, cards, 2, 1)!
        // Four cards asked for 2 s of pause each on a 1 s slide: the hold gives
        // way, and the glides keep at least their floor between them.
        let back = readCards(out.framing, out.motion, 1)
        XCTAssertLessThan(back.holdSeconds, 0.01)
        let arrivals = arrivalMarks(out.framing, out.motion, 1)
        let glides = arrivals[arrivals.count - 1] - arrivals[0]
        XCTAssertGreaterThanOrEqual(glides, 3 * min(minGlideSeconds, 1.0 / 3) - 1e-6)
    }

    func testKeepsTheEasingAndTheStartOfTheMotionItRewrites() {
        let motion = FramingMotion(keys: [key(0, 2, 0, 0)], easing: .steps, steps: 4, start: .afterOpener)
        let out = cardsMotion(rest, motion, [card(2, 0), rest], 0, 5)!
        XCTAssertEqual(out.motion?.easing, .steps)
        XCTAssertEqual(out.motion?.steps, 4)
        XCTAssertEqual(out.motion?.start, .afterOpener)
    }
}

final class WriteCardTests: XCTestCase {
    private let motion = cardsMotion(rest, nil, [card(2, 0.3), card(1.2, -0.1), rest], 0.4, 5)!.motion!

    func testReframesOneCardAtTheInstantsItAlreadyHas() {
        let out = writeCard(rest, motion, 1, card(3, 0.05, 0.02))
        XCTAssertEqual(out.motion!.keys.map(\.at), motion.keys.map(\.at))
        let back = readCards(out.framing, out.motion, 5)
        XCTAssertEqual(back.cards[1], card(3, 0.05, 0.02))
        XCTAssertEqual(back.cards[0], card(2, 0.3))
        XCTAssertEqual(out.framing, rest)
    }

    func testWritesTheLastCardIntoTheFramingItsPauseIncluded() {
        var next = rest
        next.scale = 1.1; next.x = 0; next.y = 0
        let out = writeCard(rest, motion, 2, next)
        XCTAssertEqual(out.framing, next)
        XCTAssertEqual(readCards(out.framing, out.motion, 5).cards.count, 3)
        assertClose(readCards(out.framing, out.motion, 5).holdSeconds, 0.4, 6)
    }

    func testSendsRotationMirrorAndFitToTheRestWhicheverCardIsWritten() {
        var turned = card(2, 0.3)
        turned.rotation = 12
        turned.flipX = true
        let out = writeCard(rest, motion, 0, turned)
        XCTAssertEqual(out.framing.rotation, 12)
        XCTAssertTrue(out.framing.flipX)
        XCTAssertEqual(out.framing.scale, rest.scale)
    }

    func testIsThePlainWriteOnAStillPictureAndWritesNothingPastTheRow() {
        let next = card(2, 0.3)
        XCTAssertEqual(writeCard(rest, nil, 0, next), FramingWrite(framing: next, motion: nil))
        XCTAssertEqual(writeCard(rest, motion, 9, next), FramingWrite(framing: rest, motion: motion))
    }
}

final class InsertRemoveCardTests: XCTestCase {
    private let cards = [card(2, 0.3), rest]
    private let motion = cardsMotion(rest, nil, [card(2, 0.3), rest], 0, 5)!.motion

    func testAddsACardAfterTheSelectedOneATouchCloserSoItReadsAsItsOwn() {
        let out = insertCard(rest, motion, cards, 0, 5, 0)!
        XCTAssertEqual(out.selected, 1)
        let back = readCards(out.framing, out.motion, 5)
        XCTAssertEqual(back.cards.count, 3)
        assertClose(back.cards[1].scale, 2 * insertZoom, 6)
        assertClose(back.cards[1].x / back.cards[1].scale, 0.3 / 2, 6)
        XCTAssertEqual(back.cards[2], rest)
    }

    func testAddsBeforeTheRestWhenTheRestIsSelectedAndTheRestStaysLast() {
        let out = insertCard(rest, motion, cards, 0, 5, 1)!
        XCTAssertEqual(out.selected, 1)
        XCTAssertEqual(out.framing, rest)
        XCTAssertEqual(readCards(out.framing, out.motion, 5).cards.count, 3)
    }

    func testPullsOutInsteadWhenTheCardIsAlreadyAsCloseAsItGoes() {
        let close = [card(8, 0), rest]
        let out = insertCard(rest, cardsMotion(rest, nil, close, 0, 5)!.motion, close, 0, 5, 0)!
        assertClose(readCards(out.framing, out.motion, 5).cards[1].scale, 8 / insertZoom, 6)
    }

    func testRefusesANinthCard() {
        let many = (0..<maxCards).map { card(1 + Double($0) * 0.1, 0) }
        XCTAssertNil(insertCard(rest, nil, many, 0, 5, 0))
    }

    func testTakesACardOffNeverTheLastAndTheLastOneOffLeavesNoMotion() {
        let three = [card(2, 0.3), card(1.2, -0.1), rest]
        let m3 = cardsMotion(rest, nil, three, 0, 5)!.motion
        let out = removeCard(rest, m3, three, 0, 5, 1)!
        XCTAssertEqual(readCards(out.framing, out.motion, 5).cards, [card(2, 0.3), rest])
        XCTAssertEqual(out.selected, 1)
        XCTAssertNil(removeCard(rest, m3, three, 0, 5, 2))
        let last = removeCard(rest, motion, cards, 0, 5, 0)!
        XCTAssertNil(last.motion)
        XCTAssertEqual(last.framing, rest)
        XCTAssertEqual(last.selected, 0)
    }
}

final class CardAtNeedleTests: XCTestCase {
    func testFindsTheCardWhoseArrivalIsWithinTheSnapTheLastOwningTheEndOfTheSlide() {
        let arrivals = [0.0, 2, 4.6]
        XCTAssertEqual(cardAtNeedle(arrivals, 0.1, 0.15), 0)
        XCTAssertNil(cardAtNeedle(arrivals, 1, 0.15))
        XCTAssertEqual(cardAtNeedle(arrivals, 2.1, 0.15), 1)
        XCTAssertEqual(cardAtNeedle(arrivals, 4.5, 0.15), 2)
        XCTAssertEqual(cardAtNeedle(arrivals, 5, 0.15), 2)
        XCTAssertNil(cardAtNeedle([], 1, 0.15))
    }

    func testAgreesWithTheStarterItsTwoCardsSitAtTheTwoEnds() {
        let m = starterMotion(rest)
        let arrivals = arrivalMarks(rest, m, 5)
        XCTAssertEqual(cardAtNeedle(arrivals, 0, 0.15), 0)
        XCTAssertEqual(cardAtNeedle(arrivals, 5, 0.15), 1)
    }
}
