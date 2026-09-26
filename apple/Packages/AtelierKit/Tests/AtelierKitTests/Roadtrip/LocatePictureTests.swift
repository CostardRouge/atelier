// Port of `src/shared/roadtrip/locate-picture.test.ts`, case for case. The
// web's `toBe` (the very same leg) is value equality here.

import Foundation
import XCTest
@testable import AtelierKit

private let kalbarriCity = GazetteerCity(name: "Kalbarri", country: "AU", lat: -27.7105, lon: 114.165,
                                         population: 2602, section: false)
private let perthCity = GazetteerCity(name: "Perth", country: "AU", lat: -31.9522, lon: 115.8614,
                                      population: 1_896_548, section: false)
private let cities = [kalbarriCity, perthCity]

/// Where a picture taken at Kalbarri says it was.
private let atKalbarri = GeoPoint(lat: -27.7098, lon: 114.1662)

private func trip(_ stages: [TripStage] = []) -> TripDoc {
    var doc = createTripDoc("Australia", "2025-11-01", "2025-11-30")
    doc.stages = stages
    return doc
}

private func locate(_ doc: TripDoc, _ date: String?, _ coords: GeoPoint? = atKalbarri) -> PictureLocation {
    locatePicture(LocateInput(trip: doc, date: date, coords: coords, cities: cities))
}

final class LocatePictureRefusalTests: XCTestCase {
    func testSaysNothingAboutAPictureWhoseExifHoldsNoPosition() {
        let result = locate(trip(), "2025-11-03", nil)
        XCTAssertEqual(result.silence, .noPosition)
        XCTAssertNil(result.proposal)
        XCTAssertNil(result.city)
    }

    func testRefusesNullIslandWhichIsACameraWithNoFix() {
        let result = locate(trip(), "2025-11-03", GeoPoint(lat: 0, lon: 0))
        XCTAssertEqual(result.silence, .nullIsland)
        XCTAssertNil(result.proposal)
    }

    func testRefusesCoordinatesThatAreNotOnTheGlobe() {
        XCTAssertEqual(locate(trip(), "2025-11-03", GeoPoint(lat: 99, lon: 12)).silence, .noPosition)
        XCTAssertEqual(locate(trip(), "2025-11-03", GeoPoint(lat: .nan, lon: 12)).silence, .noPosition)
    }

    func testHasNoLegToOfferToWhenNothingSaysWhichDayThePictureIs() {
        let result = locate(trip(), nil)
        XCTAssertEqual(result.silence, .noDate)
        // The name is still looked up: the author learns where it was even when
        // nothing can be written down.
        XCTAssertEqual(result.city?.name, "Kalbarri")
    }

    func testRefusesADateThatIsNotACalendarDayRatherThanSlicingOneOut() {
        XCTAssertEqual(locate(trip(), "2025-11-03T07:14:00Z").silence, .noDate)
        XCTAssertEqual(locate(trip(), "2025-02-30").silence, .noDate)
    }

    func testCallsOutAPictureDatedOutsideTheTripInsteadOfClampingIt() {
        let result = locate(trip(), "2024-06-02")
        XCTAssertEqual(result.silence, .outsideTrip)
        XCTAssertEqual(result.date, "2024-06-02")
        XCTAssertNil(result.proposal)
    }

    func testOffersNoPlaceWhenNothingInTheIndexIsNearEnoughToNameOne() {
        let result = locate(trip(), "2025-11-03", GeoPoint(lat: -31.5, lon: 128.9))
        XCTAssertEqual(result.silence, .noName)
        XCTAssertNil(result.city)
    }

    func testSaysSoWhenTheLegOfThatDayAlreadyNamesThePlace() {
        let stage = createTripStage("", "", "2025-11-02", "2025-11-06",
                                    places: [createTripPlace("Kalbarri", "", coords: GeoPoint(lat: -27.7105, lon: 114.165))])
        let result = locate(trip([stage]), "2025-11-03")
        XCTAssertEqual(result.silence, .already)
        XCTAssertNil(result.proposal)
        XCTAssertEqual(result.stage?.id, stage.id)
    }
}

final class LocatePictureNamingTests: XCTestCase {
    private func nameless() -> TripStage { createTripStage("", "", "2025-11-02", "2025-11-06") }

    func testGivesALegThatNamesNothingThePicturesPlace() throws {
        let stage = nameless()
        let doc = trip([stage])
        let result = locate(doc, "2025-11-03")

        XCTAssertNil(result.silence)
        XCTAssertEqual(result.proposal?.id, .name)
        XCTAssertTrue(result.proposal?.label.contains("Kalbarri") == true)

        let applied = try XCTUnwrap(result.proposal).apply(doc)
        XCTAssertEqual(applied.selectedId, stage.id)
        XCTAssertEqual(applied.stages[0].places.map(\.name), ["Kalbarri"])
        // The label DERIVES — the name is never written onto the leg.
        XCTAssertEqual(applied.stages[0].name, "")
        XCTAssertEqual(stageLabel(applied.stages[0]), "Kalbarri")
    }

    func testWritesTheCitysOwnCoordinatesAndNoCountry() throws {
        let doc = trip([nameless()])
        let stages = try XCTUnwrap(locate(doc, "2025-11-03").proposal).apply(doc).stages
        XCTAssertEqual(stages[0].places[0].coords, GeoPoint(lat: -27.7105, lon: 114.165))
        XCTAssertEqual(stages[0].places[0].region, "")
        XCTAssertFalse(stages[0].json.serialized().contains("AU"))
    }

    func testJoinsTheRouteOfALegThatAlreadyNamesPlaces() throws {
        let stage = createTripStage("", "", "2025-11-02", "2025-11-06",
                                    places: [createTripPlace("Perth", "", coords: GeoPoint(lat: -31.9522, lon: 115.8614))])
        let doc = trip([stage])
        let result = locate(doc, "2025-11-03")

        XCTAssertEqual(result.proposal?.id, .route)
        let stages = try XCTUnwrap(result.proposal).apply(doc).stages
        XCTAssertEqual(stages[0].places.map(\.name), ["Perth", "Kalbarri"])
        XCTAssertEqual(stageLabel(stages[0]), "Perth → Kalbarri")
    }

    func testTouchesNoOtherLeg() throws {
        let before = createTripStage("", "", "2025-11-01", "2025-11-01", places: [createTripPlace("Perth", "", coords: nil)])
        let stage = createTripStage("", "", "2025-11-02", "2025-11-06")
        let doc = trip([before, stage])
        let stages = try XCTUnwrap(locate(doc, "2025-11-03").proposal).apply(doc).stages
        XCTAssertEqual(stages[0], before)
    }

    func testAnswersAboutTheLastLegCoveringTheDayAsEveryReaderDoes() {
        let first = createTripStage("", "", "2025-11-01", "2025-11-03")
        let second = createTripStage("", "", "2025-11-03", "2025-11-08")
        XCTAssertEqual(locate(trip([first, second]), "2025-11-03").stage?.id, second.id)
    }
}

final class LocatePictureUncoveredDayTests: XCTestCase {
    func testStartsOneThereCarryingThePlace() throws {
        let doc = trip()
        let result = locate(doc, "2025-11-03")

        XCTAssertEqual(result.proposal?.id, .start)
        XCTAssertNil(result.stage)

        let applied = try XCTUnwrap(result.proposal).apply(doc)
        XCTAssertEqual(applied.stages.count, 1)
        XCTAssertEqual(applied.stages[0].id, applied.selectedId)
        XCTAssertEqual(applied.stages[0].startDate, "2025-11-03")
        XCTAssertEqual(applied.stages[0].places.map(\.name), ["Kalbarri"])
    }

    func testRunsToTheDayBeforeTheNextLegAndSaysSoBeforeItIsAccepted() throws {
        let next = createTripStage("", "", "2025-11-10", "2025-11-14")
        let doc = trip([next])
        let result = locate(doc, "2025-11-03")

        XCTAssertTrue(result.proposal?.detail.contains("9 Nov 2025") == true)
        let applied = try XCTUnwrap(result.proposal).apply(doc)
        let minted = try XCTUnwrap(applied.stages.first { $0.id == applied.selectedId })
        XCTAssertEqual(minted.endDate, "2025-11-09")
        // The leg it was offered beside is untouched.
        XCTAssertEqual(applied.stages.first { $0.id == next.id }, next)
    }

    func testAppliesAgainstTheTripItIsHandedNotACopyTakenEarlier() throws {
        let doc = trip()
        let proposal = try XCTUnwrap(locate(doc, "2025-11-03").proposal)
        var meanwhile = doc
        meanwhile.stages = [createTripStage("", "", "2025-11-08", "2025-11-12")]
        let applied = proposal.apply(meanwhile)
        XCTAssertEqual(applied.stages.count, 2)
        XCTAssertEqual(applied.stages.first { $0.id == applied.selectedId }?.endDate, "2025-11-07")
    }
}

final class LocatePictureMeasureTests: XCTestCase {
    func testReportsHowFarTheNamedCityIsFromThePicture() throws {
        let result = locate(trip(), "2025-11-03")
        let km = try XCTUnwrap(result.km)
        XCTAssertLessThan(km, 2)
    }

    func testNamesNothingAtAllWithAnEmptyIndexAndRefusesToInvent() {
        let result = locatePicture(LocateInput(trip: trip(), date: "2025-11-03", coords: atKalbarri, cities: []))
        XCTAssertEqual(result.silence, .noName)
        XCTAssertNil(result.city)
    }

    func testHoldsTheContestTheDeductionHoldsTheNearerPlaceNotTheBigger() {
        XCTAssertEqual(locate(trip(), "2025-11-03", GeoPoint(lat: -31.95, lon: 115.86)).city?.name, "Perth")
    }
}
