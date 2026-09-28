// `readout-store.ts` has no spec of its own on the web; these pin its rules —
// a store that tells its listeners of a change and of nothing else. The
// readouts are `Render/Clipping.swift`'s.

import XCTest
@testable import AtelierKit

final class ReadoutStoreTests: XCTestCase {
    func testStartsEmptyAndHandsBackWhatWasSet() {
        let store = createReadoutStore()
        XCTAssertNil(store.get())
        let readout = StageReadout(readout: .value(r: 12, g: 128, b: 255), before: false)
        store.set(readout)
        XCTAssertEqual(store.get(), readout)
        store.set(nil)
        XCTAssertNil(store.get())
    }

    func testTellsItsListenersOfAChangeAndNotOfTheSameReadoutAgain() {
        let store = createReadoutStore()
        var ticks = 0
        let off = store.subscribe { ticks += 1 }
        store.set(StageReadout(readout: .value(r: 1, g: 2, b: 3), before: true))
        store.set(StageReadout(readout: .value(r: 1, g: 2, b: 3), before: true))
        XCTAssertEqual(ticks, 1)
        // The same pixel on the other side of the divider is a change.
        store.set(StageReadout(readout: .value(r: 1, g: 2, b: 3), before: false))
        XCTAssertEqual(ticks, 2)
        // A clip mark is a readout of its own.
        store.set(StageReadout(readout: .clip(.white), before: false))
        store.set(StageReadout(readout: .clip(.white), before: false))
        XCTAssertEqual(ticks, 3)
        store.set(nil)
        store.set(nil)
        XCTAssertEqual(ticks, 4)
        off()
        store.set(StageReadout(readout: .clip(.black), before: false))
        XCTAssertEqual(ticks, 4)
    }
}
