// Port of `src/shared/media/frame-grab.test.ts`, case for case.

import XCTest
@testable import AtelierKit

final class FrameGrabNameTests: XCTestCase {
    func testStampsSecondsUnderAMinute() {
        XCTAssertEqual(frameGrabName("DJI_0001", 7.6), "DJI_0001-frame-7s.jpg")
    }

    func testStampsMinutesAndZeroPaddedSecondsPastAMinute() {
        XCTAssertEqual(frameGrabName("vol", 72.4), "vol-frame-1m12s.jpg")
        XCTAssertEqual(frameGrabName("vol", 605), "vol-frame-10m05s.jpg")
    }

    func testDropsAnyExtensionFromTheBaseAndFloorsTheTime() {
        XCTAssertEqual(frameGrabName("clip.mp4", 0.9), "clip-frame-0s.jpg")
    }

    func testFallsBackOnAnEmptyBaseAndClampsNegativeTimes() {
        XCTAssertEqual(frameGrabName("   ", -3), "frame-frame-0s.jpg")
    }
}
