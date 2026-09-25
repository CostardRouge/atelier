// `src/shared/media/export-tail.ts` is a type with no spec; this pins the
// contract the port keeps: the tail's frames are `framePlan`'s, starting
// where the footage ended, and nothing is appended for no time.

import Foundation
import XCTest
@testable import AtelierKit

final class ExportTailTests: XCTestCase {
    func testPlansItsFramesAfterTheFootagesLastFrame() {
        let tail = ExportTail<String>(seconds: 2, draw: { "card at \($0)" })
        let frames = tail.frames(fps: 25, startMicros: 12_000_000)
        XCTAssertEqual(frames.count, 50)
        XCTAssertEqual(frames[0].timestampMicros, 12_000_000)
        XCTAssertEqual(frames, framePlan(2, 25, 12_000_000))
    }

    func testHandsThePainterTheCardsOwnClock() {
        let tail = ExportTail<String>(seconds: 1, draw: { "card at \($0)" })
        let frames = tail.frames(fps: 30, startMicros: 5_000_000)
        XCTAssertEqual(tail.draw(frames[15].tSeconds), "card at 0.5")
    }

    func testAppendsNothingForNoTime() {
        XCTAssertEqual(ExportTail<String>(seconds: 0, draw: { _ in "" }).frames(fps: 30, startMicros: 0), [])
        XCTAssertEqual(ExportTail<String>(seconds: -1, draw: { _ in "" }).frames(fps: 30, startMicros: 0), [])
    }
}
