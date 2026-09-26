// Port of `src/shared/roadtrip/trip-places.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private func stage(_ name: String, _ places: [TripPlace], _ region: String = "") -> TripStage {
    createTripStage(name, region, "2025-11-02", "2025-11-20", places: places)
}

final class PlacesStageStartEndTests: XCTestCase {
    func testAreNilWhenTheStageNamesNoPlace() {
        let s = stage("", [])
        XCTAssertNil(stageStart(s))
        XCTAssertNil(stageEnd(s))
    }

    func testAreTheSamePlaceWhenThereIsOneYouDidNotGoAnywhere() {
        let s = stage("", [createTripPlace("Kalbarri")])
        XCTAssertEqual(stageStart(s)?.name, "Kalbarri")
        XCTAssertEqual(stageEnd(s)?.id, stageStart(s)?.id)
    }

    func testAreTheFirstAndLastOfTheOrderTheLegWasLived() {
        let s = stage("", [createTripPlace("Perth"), createTripPlace("Kalbarri"), createTripPlace("Exmouth")])
        XCTAssertEqual(stageStart(s)?.name, "Perth")
        XCTAssertEqual(stageEnd(s)?.name, "Exmouth")
    }

    func testSkipsARowSomeoneStartedButNeverNamed() {
        let s = stage("", [createTripPlace("   "), createTripPlace("Perth"), createTripPlace("")])
        XCTAssertEqual(stageStart(s)?.name, "Perth")
        XCTAssertEqual(stageEnd(s)?.name, "Perth")
    }
}

final class PlacesStageLabelTests: XCTestCase {
    func testIsEmptyWhenTheStageNamesNothingTheCallerMustFallBack() {
        XCTAssertEqual(stageLabel(stage("", [])), "")
    }

    func testDerivesOneNameFromOnePlace() {
        XCTAssertEqual(stageLabel(stage("", [createTripPlace("Kalbarri")])), "Kalbarri")
    }

    func testDerivesTheTwoEndsOfALegIgnoringWhatIsBetweenThem() {
        let s = stage("", [createTripPlace("Perth"), createTripPlace("Kalbarri"), createTripPlace("Cairns")])
        XCTAssertEqual(stageLabel(s), "Perth \(placeArrow) Cairns")
    }

    func testUsesAGeometricArrowNeverAnEmojiItIsDrawnOnACanvas() {
        // The measured trap: 📍 drew nothing at all where no colour-emoji font
        // existed. Anything here must be monochrome and present everywhere.
        XCTAssertEqual(placeArrow, "→")
    }

    func testTheAuthorsOwnNameAlwaysWinsOverTheDerivation() {
        let s = stage("The Red Centre", [createTripPlace("Alice Springs"), createTripPlace("Uluru")])
        XCTAssertEqual(stageLabel(s), "The Red Centre")
    }

    func testClearingThatNameGivesTheDerivedLabelBackNeverABlank() {
        let s = stage("   ", [createTripPlace("Perth"), createTripPlace("Cairns")])
        XCTAssertEqual(stageLabel(s), "Perth \(placeArrow) Cairns")
    }
}

final class PlacesStageRegionLabelTests: XCTestCase {
    func testPrefersTheStagesOwnRegion() {
        let s = stage("", [createTripPlace("Perth", "Somewhere else")], "Western Australia")
        XCTAssertEqual(stageRegionLabel(s), "Western Australia")
    }

    func testFallsBackToTheRegionItsPlacesAgreeOn() {
        let s = stage("", [createTripPlace("Perth", "Western Australia"), createTripPlace("Kalbarri", "Western Australia")])
        XCTAssertEqual(stageRegionLabel(s), "Western Australia")
    }

    func testSaysNothingWhenTheyDisagreeRatherThanPickingOne() {
        let s = stage("", [createTripPlace("Perth", "Western Australia"), createTripPlace("Cairns", "Queensland")])
        XCTAssertEqual(stageRegionLabel(s), "")
    }

    func testIsEmptyWhenNothingCarriesARegion() {
        XCTAssertEqual(stageRegionLabel(stage("", [createTripPlace("Perth")])), "")
    }
}

final class PlacesPlaceRegionLabelTests: XCTestCase {
    func testFallsBackToTheStagesRegionSoAnEmptyFieldIsNeverBlank() {
        let place = createTripPlace("Kalbarri")
        let s = stage("", [place], "Western Australia")
        XCTAssertEqual(placeRegionLabel(place, s), "Western Australia")
    }

    func testKeepsThePlacesOwnWhenItHasOne() {
        let place = createTripPlace("Cairns", "Queensland")
        let s = stage("", [place], "Western Australia")
        XCTAssertEqual(placeRegionLabel(place, s), "Queensland")
    }
}

final class PlacesTripRouteLabelTests: XCTestCase {
    private func doc() -> TripDoc { createTripDoc("Australie", "2025-11-02", "2026-02-14") }

    func testIsEmptyForATripWithNoStage() {
        XCTAssertEqual(tripRouteLabel(doc()), "")
    }

    func testRunsFromTheFirstPlaceOfTheFirstStageToTheLastOfTheLast() {
        var trip = doc()
        trip.stages = [
            createTripStage("", "", "2025-11-02", "2025-11-20", places: [createTripPlace("Perth"), createTripPlace("Kalbarri")]),
            createTripStage("", "", "2025-11-21", "2026-02-14", places: [createTripPlace("Darwin"), createTripPlace("Cairns")]),
        ]
        XCTAssertEqual(tripRouteLabel(trip), "Perth \(placeArrow) Cairns")
    }

    func testStepsOverAStageThatNamesNothingRatherThanLosingAnEnd() {
        var trip = doc()
        trip.stages = [
            createTripStage("", "", "2025-11-02", "2025-11-20", places: [createTripPlace("Perth")]),
            createTripStage("Driving", "", "2025-11-21", "2025-12-01", places: []),
            createTripStage("", "", "2025-12-02", "2026-02-14", places: [createTripPlace("Cairns")]),
        ]
        XCTAssertEqual(tripRouteLabel(trip), "Perth \(placeArrow) Cairns")
    }
}

final class PlacesFormatCoordsTests: XCTestCase {
    func testIsEmptyForAPlaceThatIsOnlyAName() {
        XCTAssertEqual(formatCoords(nil), "")
    }

    func testKeepsSixDecimalsAndTheSignAsTheExifReaderWritesThem() {
        XCTAssertEqual(formatCoords(GeoPoint(lat: -27.7099, lon: 114.165)), "-27.709900, 114.165000")
    }
}
