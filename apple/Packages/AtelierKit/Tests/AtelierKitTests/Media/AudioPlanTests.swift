// Port of `src/shared/media/audio-plan.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func plan(sourceAudio: Bool, retimed: Bool, bed: Bool, mix: Bool) -> AudioPlan {
    planAudio(AudioPlanInput(sourceAudio: sourceAudio, retimed: retimed, bed: bed, mix: mix))
}

final class PlanAudioTests: XCTestCase {
    func testCopiesAClipsOwnSoundWhenNothingElseWantsToBeHeard() {
        XCTAssertEqual(plan(sourceAudio: true, retimed: false, bed: false, mix: false), .copy(droppedBed: nil))
    }

    func testWritesNothingForASilentClipWithNothingToAdd() {
        XCTAssertEqual(plan(sourceAudio: false, retimed: false, bed: false, mix: true), .none)
    }

    func testGivesAClipWithNoMicrophoneTheBedAsItsTrackNoMixingNeeded() {
        XCTAssertEqual(plan(sourceAudio: false, retimed: false, bed: true, mix: false), .bed)
    }

    func testGivesAReTimedExportTheBedAloneSinceItNeverCarriesTheClipsSound() {
        XCTAssertEqual(plan(sourceAudio: true, retimed: true, bed: true, mix: true), .bed)
    }

    func testKeepsAClipsOwnSoundUntouchedByDefaultAndSaysTheTicksWereLeftOut() {
        XCTAssertEqual(plan(sourceAudio: true, retimed: false, bed: true, mix: false), .copy(droppedBed: bedKeptOut))
    }

    func testMixesOnlyWhenAskedAtNormalSpeedOverAClipThatHasSound() {
        XCTAssertEqual(plan(sourceAudio: true, retimed: false, bed: true, mix: true), .mix)
    }
}
