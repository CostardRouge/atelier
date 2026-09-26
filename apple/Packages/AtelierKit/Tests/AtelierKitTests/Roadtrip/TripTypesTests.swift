// Port of `src/shared/roadtrip/trip-types.test.ts`, case for case, plus the
// round trip of a trip through its writer. The web builds its older-version
// fixtures by deleting fields off today's factories or by writing the stored
// object out by hand; here the same fixtures are JSON (`TripDoc.json` edited
// with `removing` / `setting`, or a literal), read through `readTripDoc`,
// which runs every migration first exactly as the web's store does.
//
// The web's `toBe(x)` on an object's identity becomes value equality here, and
// "shares no mutable state" is shown by editing one copy and watching the
// other; `'key' in record` becomes "the key is not in the record's JSON".

import Foundation
import XCTest
@testable import AtelierKit

// MARK: - helpers

/// One step into a JSON document: a key or an index.
private enum Step: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral {
    case key(String)
    case index(Int)
    init(stringLiteral value: String) { self = .key(value) }
    init(integerLiteral value: Int) { self = .index(value) }
}

/// `value` with the node at `path` rewritten by `change` (nil removes it).
private func edit(_ value: JSONValue, _ path: [Step], _ change: (JSONValue?) -> JSONValue?) -> JSONValue {
    guard let first = path.first else { return change(value) ?? .null }
    let rest = Array(path.dropFirst())
    switch first {
    case .key(let key):
        var o = value.objectValue ?? [:]
        o[key] = rest.isEmpty ? change(o[key]) : edit(o[key] ?? .object([:]), rest, change)
        return .object(o)
    case .index(let i):
        var a = value.arrayValue ?? []
        if rest.isEmpty {
            if let next = change(a[i]) { a[i] = next } else { a.remove(at: i) }
        } else {
            a[i] = edit(a[i], rest, change)
        }
        return .array(a)
    }
}

/// The web's `delete record.key`.
private func removing(_ value: JSONValue, _ path: Step...) -> JSONValue {
    edit(value, path) { _ in nil }
}

/// The web's `record.key = value`.
private func setting(_ value: JSONValue, _ path: Step..., to new: JSONValue) -> JSONValue {
    edit(value, path) { _ in new }
}

/// `migrateTripDoc` over a stored record.
private func migrate(_ value: JSONValue, file: StaticString = #filePath, line: UInt = #line) -> TripDoc {
    guard let doc = readTripDoc(value) else {
        XCTFail("not a trip", file: file, line: line)
        return createTripDoc("", "", "")
    }
    return doc
}

/// The JSON of a record, as a dictionary.
private func keys(_ value: JSONValue) -> [String: JSONValue] {
    value.objectValue ?? [:]
}

private func stage(_ startDate: String, _ endDate: String) -> TripStage {
    TripStage(id: "s1", name: "Kalbarri", region: "WA", startDate: startDate, endDate: endDate, places: [])
}

private let rec709 = OutputTransform.rec709ToSrgb

// MARK: - createTripDoc

final class TripTypesCreateTripDocTests: XCTestCase {
    func testIsBornAtTheCurrentVersionInEnglishWithASafeBadgeLook() {
        let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04")
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertEqual(doc.badgeWords.day, "Day")
        XCTAssertEqual(doc.theme?.presetId, "neutral")
    }

    func testTrimsWhatTheUserTyped() {
        XCTAssertEqual(createTripDoc("  Australie ", "2025-03-01", "2026-01-04").name, "Australie")
    }
}

// MARK: - createTripPost

final class TripTypesCreateTripPostTests: XCTestCase {
    func testStartsWithNoMediaAndTheDayCounter() {
        let post = createTripPost(.reel, "2025-03-27", "Cliffs")
        XCTAssertNil(post.media)
        XCTAssertEqual(post.badge.mode, .day)
        XCTAssertEqual(post.badge.timeAgo, .off)
        XCTAssertNil(post.publishedAt)
    }

    func testGivesEachPostItsOwnBadgeObjectNeverASharedOne() {
        var a = createTripPost(.reel, "2025-03-27", "A")
        let b = createTripPost(.reel, "2025-03-28", "B")
        a.badge.layout.x = 0.5
        XCTAssertNotEqual(b.badge.layout.x, 0.5)
    }

    func testNeverStartsWithAClosingCardWhateverTheKind() {
        // A carousel used to arrive with one. It is one click on the rail, and a
        // slide nobody composed does not belong in a deck by default.
        for kind in PostKind.allCases {
            XCTAssertFalse(createTripPost(kind, "2025-03-27", "A").includeCta)
        }
    }
}

// MARK: - migrateTripDoc (v1)

/// A v1 document: no badge fields anywhere.
private func v1() -> JSONValue {
    let post: JSONValue = [
        "id": "p1", "kind": "photo", "date": "2025-03-27", "endDate": nil, "title": "Cliffs",
        "publishedAt": nil, "createdAt": 0,
    ]
    return [
        "version": 1, "id": "t1", "name": "Australie", "destination": "Australia",
        "startDate": "2025-03-01", "endDate": "2026-01-04", "stages": [], "posts": [post],
        "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateV1Tests: XCTestCase {
    func testBringsAV1DocumentToTheCurrentVersion() {
        XCTAssertEqual(migrate(v1()).version, tripDocVersion)
    }

    func testGivesEveryExistingPostABadgeAndAnEmptyMediaHint() {
        let doc = migrate(v1())
        XCTAssertNil(doc.posts[0].media)
        XCTAssertEqual(doc.posts[0].badge.mode, .day)
    }

    func testKeepsEverythingAV1DocumentAlreadySaid() {
        let doc = migrate(v1())
        XCTAssertEqual(doc.name, "Australie")
        XCTAssertEqual(doc.posts[0].date, "2025-03-27")
        XCTAssertEqual(doc.posts[0].title, "Cliffs")
    }

    func testIsIdempotent() {
        let once = migrate(v1())
        XCTAssertEqual(migrateTripDoc(once), once)
        XCTAssertEqual(readTripDoc(once.json), once)
        let json = migrateTripJSON(keys(v1()))
        XCTAssertEqual(migrateTripJSON(json), json)
    }

    func testGivesAV1DocumentTheDefaultCar() {
        XCTAssertEqual(migrate(v1()).car, defaultCarSpec())
    }

    func testLeavesACurrentDocumentUntouched() {
        let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04")
        XCTAssertEqual(migrateTripDoc(doc), doc)
        XCTAssertEqual(migrateTripJSON(keys(doc.json)), keys(doc.json))
    }
}

// MARK: - v22 → v23, the camera credit is opt-in

/// A v22 trip: a piece and a remembered look, neither knowing the credit.
private func v22() -> JSONValue {
    let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04").json
    let post = createTripPost(.reel, "2025-03-27", "Cliffs")
    let defaults = removing(hookDefaultsFrom(post.badge).json, "showExif")
    let stored = removing(post.json, "badge", "showExif")
    let withPosts = setting(setting(doc, "version", to: 22), "posts", to: [stored])
    return setting(withPosts, "hookDefaults", to: ["reel": defaults])
}

final class TripTypesMigrateV22Tests: XCTestCase {
    func testLeavesEveryStoredBadgeSayingExactlyWhatItSaid() {
        let doc = migrate(v22())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertFalse(doc.posts[0].badge.showExif)
        XCTAssertEqual(doc.hookDefaults[.reel]?.showExif, false)
    }

    func testKeepsACreditAPieceAlreadyAskedFor() {
        let doc = setting(v22(), "posts", 0, "badge", "showExif", to: true)
        XCTAssertTrue(migrate(doc).posts[0].badge.showExif)
    }
}

// MARK: - v24 → v25, the badge may cascade

private func v24() -> JSONValue {
    let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04").json
    let post = removing(createTripPost(.reel, "2025-03-27", "Cliffs").json, "badge", "cascade")
    return setting(setting(doc, "version", to: 24), "posts", to: [post])
}

final class TripTypesMigrateV24Tests: XCTestCase {
    func testKeepsEveryBadgeOnItsPerPieceEntrances() {
        let doc = migrate(v24())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertNil(doc.posts[0].badge.cascade)
    }

    func testKeepsASoundCascadeAndRefusesJunk() {
        let cascade: JSONValue = [
            "step": ["preset": "fade", "duration": 0.4, "easing": "out"],
            "stagger": ["each": 0.2, "order": "rows"],
        ]
        let sound = setting(v24(), "posts", 0, "badge", "cascade", to: cascade)
        XCTAssertEqual(migrate(sound).posts[0].badge.cascade?.stagger.order, .rows)
        let junk = setting(v24(), "posts", 0, "badge", "cascade", to: "fast")
        XCTAssertNil(migrate(junk).posts[0].badge.cascade)
    }
}

// MARK: - v23 → v24, a slide may hold several pictures

private func v23() -> JSONValue {
    let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04").json
    var post = createTripPost(.carousel, "2025-03-27", "Cliffs")
    post.slides = [createPostSlide(nil)]
    let stored = removing(removing(post.json, "badge", "collage"), "slides", 0, "collage")
    return setting(setting(doc, "version", to: 23), "posts", to: [stored])
}

final class TripTypesMigrateV23Tests: XCTestCase {
    func testStartsEverySlideOnTheOnePictureItAlwaysHeld() {
        let doc = migrate(v23())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertNil(doc.posts[0].badge.collage)
        XCTAssertNil(doc.posts[0].slides[0].collage)
    }

    func testKeepsASoundCollageAndTurnsAnUnknownTemplateIntoNone() {
        var doc = setting(v23(), "posts", 0, "badge", "collage", to: ["template": "grid-2x2", "cells": []])
        doc = setting(doc, "posts", 0, "slides", 0, "collage", to: ["template": "from-the-future"])
        let migrated = migrate(doc)
        XCTAssertEqual(migrated.posts[0].badge.collage?.template, "grid-2x2")
        XCTAssertEqual(migrated.posts[0].badge.collage?.cells, [])
        XCTAssertNil(migrated.posts[0].slides[0].collage)
    }
}

// MARK: - v21 → v22, every picture may depart

/// A v21 trip: a grade on the trip and on the piece, none on a picture.
private func v21() -> JSONValue {
    let doc = createTripDoc("Australie", "2025-03-01", "2026-01-04").json
    var post = createTripPost(.carousel, "2025-03-27", "Cliffs")
    post.slides = [createPostSlide(nil)]
    let stored = removing(removing(post.json, "badge", "grade"), "slides", 0, "grade")
    return setting(setting(doc, "version", to: 21), "posts", to: [stored])
}

final class TripTypesMigrateV21Tests: XCTestCase {
    func testStartsEveryPictureOnFollowThePieceSoNothingChangesLook() {
        let doc = migrate(v21())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertNil(doc.posts[0].badge.grade)
        XCTAssertNil(doc.posts[0].slides[0].grade)
    }

    func testKeepsAGradeAPictureAlreadyCarriesAndRefusesJunk() {
        var doc = setting(v21(), "posts", 0, "badge", "grade", to: ["layers": [], "output": "rec709-to-srgb"])
        doc = setting(doc, "posts", 0, "slides", 0, "grade", to: "a look")
        let migrated = migrate(doc)
        XCTAssertEqual(migrated.posts[0].badge.grade, SavedGrade(layers: [], output: rec709, film: nil))
        XCTAssertEqual(migrated.posts[0].badge.grade?.json, ["layers": [], "output": "rec709-to-srgb", "film": nil])
        XCTAssertNil(migrated.posts[0].slides[0].grade)
    }
}

// MARK: - v20 → v21, the car is repaired

/// What the Itinerary branch stamped v19 — and main then stamped v20 — with no car.
private func carless(_ version: Int) -> JSONValue {
    let doc = removing(createTripDoc("Australie", "2025-03-01", "2026-01-04").json, "car")
    return setting(doc, "version", to: .number(Double(version)))
}

final class TripTypesMigrateV20Tests: XCTestCase {
    func testGivesACarlessV19OrV20TripTheDefaultCar() {
        XCTAssertEqual(migrate(carless(19)).car, defaultCarSpec())
        XCTAssertEqual(migrate(carless(20)).car, defaultCarSpec())
    }

    func testKeepsTheCarAV20TripAlreadyHas() {
        var doc = createTripDoc("Australie", "2025-03-01", "2026-01-04")
        var car = doc.car
        car.color = "#b3261e"
        car.finish = .gloss
        doc.car = car
        doc.version = 20
        let migrated = migrateTripDoc(doc)
        XCTAssertEqual(migrated.car, car)
        XCTAssertEqual(migrated.version, tripDocVersion)
    }
}

// MARK: - v19 → v20, the Route becomes an Itinerary

/// A piece composed with the retired `route` opener, on a trip with legs.
private func v18Route() -> JSONValue {
    let places: JSONValue = [
        ["id": "a", "name": "Perth", "region": "WA", "coords": ["lat": -31.95, "lon": 115.86]],
        ["id": "b", "name": "Kalbarri", "region": "WA", "coords": ["lat": -27.71, "lon": 114.16]],
        // Typed by hand, so it cannot be a point on a map.
        ["id": "c", "name": "Somewhere", "region": "", "coords": nil],
    ]
    let leg: JSONValue = [
        "id": "s1", "name": "", "region": "", "startDate": "2025-03-01", "endDate": "2025-03-20", "places": places,
    ]
    let routeOptions: JSONValue = [
        "position": "bottom", "size": 1.1, "pastColor": "#ffee00", "futureStyle": "faint", "drawSeconds": 3.2,
        "compass": true, "distance": "km", "sound": true, "kit": "wood",
    ]
    let coralBay: JSONValue = [
        "id": "p1", "kind": "reel", "date": "2025-03-12", "endDate": nil, "title": "Coral Bay",
        "publishedAt": nil, "createdAt": 0,
        "badge": ["hook": [["id": "route", "options": routeOptions]]],
    ]
    // A v18 document has a badge on every post; this one never left the plain opener.
    let plain: JSONValue = [
        "id": "p2", "kind": "photo", "date": "2025-03-13", "endDate": nil, "title": "",
        "publishedAt": nil, "createdAt": 0,
        "badge": ["hook": [["id": "badge", "options": [:]]]],
    ]
    return [
        "version": 18, "id": "t1", "name": "West coast", "destination": "Perth → Kalbarri",
        "startDate": "2025-03-01", "endDate": "2025-03-20", "stages": [leg],
        "hookDefaults": ["reel": ["hook": [["id": "route", "options": ["drawSeconds": 3]]]]],
        "posts": [coralBay, plain], "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateRouteTests: XCTestCase {
    func testConvertsTheLayerRatherThanDroppingThePieceBackToTheBadge() {
        XCTAssertEqual(migrate(v18Route()).posts[0].badge.hook[0].id, "map")
    }

    func testSeedsTheStopsFromTheTripsOwnLocatedPlacesInOrder() {
        let o = mapOptions(migrate(v18Route()).posts[0].badge.hook[0].options)
        XCTAssertEqual(o.stops.map(\.name), ["Perth", "Kalbarri"])
        XCTAssertEqual(o.stops[0].lat, -31.95)
        XCTAssertEqual(o.stops[0].lon, 115.86)
    }

    func testCarriesEveryOptionThatMeansTheSameThingInBoth() {
        let o = mapOptions(migrate(v18Route()).posts[0].badge.hook[0].options)
        XCTAssertEqual(o.position, .bottom)
        XCTAssertEqual(o.size, 1.1)
        XCTAssertEqual(o.pathColor, "#ffee00")
        XCTAssertEqual(o.aheadStyle, .faint)
        XCTAssertEqual(o.drawSeconds, 3.2)
        XCTAssertTrue(o.compass)
        XCTAssertEqual(o.distance, .km)
        XCTAssertTrue(o.sound)
        XCTAssertEqual(o.kit, .wood)
    }

    func testStartsWithThePicturesOffAndTheLineStraightWhatTheRouteDrew() {
        let o = mapOptions(migrate(v18Route()).posts[0].badge.hook[0].options)
        XCTAssertEqual(o.media, .off)
        XCTAssertEqual(o.curve, 0)
    }

    func testConvertsTheLookTheTripHandsToTheNextPieceToo() {
        XCTAssertEqual(migrate(v18Route()).hookDefaults[.reel]?.hook.first?.id, "map")
    }

    func testLeavesAPieceThatNeverUsedItAloneAndStaysIdempotent() {
        let doc = migrate(v18Route())
        XCTAssertEqual(doc.posts[1].badge.hook[0].id, "badge")
        XCTAssertEqual(migrateTripDoc(doc), doc)
    }
}

// MARK: - v2 → v3

/// A v2 document: the language enum, no overrides, no piece styles.
private func v2(_ badgeLanguage: String) -> JSONValue {
    let badge: JSONValue = [
        "mode": "day", "layout": ["anchor": "bottom-left", "x": 0.07, "y": 0.9, "sizeFrac": 0.17],
        "showAnniversary": false, "aspectId": "4:5", "videoTimeSeconds": 0,
    ]
    let post: JSONValue = [
        "id": "p1", "kind": "photo", "date": "2025-03-27", "endDate": nil, "title": "Cliffs", "media": nil,
        "badge": badge, "publishedAt": nil, "createdAt": 0,
    ]
    return [
        "version": 2, "id": "t2", "name": "Australie", "destination": "Australia",
        "startDate": "2025-03-01", "endDate": "2026-01-04", "stages": [], "badgeLanguage": .string(badgeLanguage),
        "theme": nil, "posts": [post], "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateV2Tests: XCTestCase {
    func testKeepsAFrenchDeckSayingExactlyWhatItSaid() {
        // The enum is translated into the vocabulary it stood for, never dropped —
        // a migration must not silently re-language published copy.
        let words = migrate(v2("fr")).badgeWords
        XCTAssertEqual(words.day, "Jour")
        XCTAssertEqual(words.of, "sur")
        XCTAssertEqual(words.at, "à")
    }

    func testLandsAnEnglishDeckOnTheEnglishWords() {
        let words = migrate(v2("en")).badgeWords
        XCTAssertEqual(words.day, "Day")
        XCTAssertEqual(words.of, "of")
    }

    func testDropsTheRetiredEnumRatherThanLeavingItToRotBesideTheWords() {
        let doc = migrate(v2("fr"))
        XCTAssertNil(keys(doc.json)["badgeLanguage"])
    }

    func testGivesEveryPostItsOverridesAndPieceStylesEmpty() {
        let doc = migrate(v2("en"))
        XCTAssertEqual(doc.posts[0].badge.textOverrides, [:])
        XCTAssertEqual(doc.posts[0].badge.pieceStyles, [:])
    }

    func testKeepsWhatTheV2BadgeAlreadySaid() {
        let badge = migrate(v2("en")).posts[0].badge
        XCTAssertEqual(badge.mode, .day)
        XCTAssertEqual(badge.aspectId, "4:5")
    }

    func testIsIdempotent() {
        let once = migrate(v2("fr"))
        XCTAssertEqual(migrateTripDoc(once), once)
    }
}

// MARK: - v3 → v4

/// A v3 document: the anniversary boolean, flat year words, no duration.
private func v3(_ showAnniversary: Bool, french: Bool = false) -> JSONValue {
    let words: JSONValue = french
        ? ["day": "Jour", "days": "Jours", "of": "sur", "at": "à", "yearAgo": "Il y a 1 an", "yearsAgo": "Il y a {n} ans"]
        : ["day": "Day", "days": "Days", "of": "of", "at": "in", "yearAgo": "1 year ago today", "yearsAgo": "{n} years ago today"]
    let badge: JSONValue = [
        "mode": "day", "layout": ["anchor": "bottom-left", "x": 0.07, "y": 0.9, "sizeFrac": 0.17],
        "showAnniversary": .bool(showAnniversary), "aspectId": "4:5", "videoTimeSeconds": 0,
        "textOverrides": [:], "pieceStyles": [:],
    ]
    let post: JSONValue = [
        "id": "p1", "kind": "photo", "date": "2025-03-27", "endDate": nil, "title": "Cliffs", "media": nil,
        "badge": badge, "publishedAt": nil, "createdAt": 0,
    ]
    return [
        "version": 3, "id": "t3", "name": "Australie", "destination": "Australia",
        "startDate": "2025-03-01", "endDate": "2026-01-04", "stages": [], "theme": nil,
        "badgeWords": words, "posts": [post], "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateV3Tests: XCTestCase {
    func testTurnsTheAnniversaryBooleanIntoAModeThatIsAlwaysTrue() {
        // The boolean fired on any date a year or more later; `auto` says the
        // truest striking thing about the gap on whatever day it is read.
        XCTAssertEqual(migrate(v3(true)).posts[0].badge.timeAgo, .auto)
        XCTAssertEqual(migrate(v3(false)).posts[0].badge.timeAgo, .off)
    }

    func testDropsTheRetiredBoolean() {
        let badge = migrate(v3(true)).posts[0].badge
        XCTAssertNil(keys(badge.json)["showAnniversary"])
    }

    func testGivesTheHookADurationSoAnExitAnimationHasSomethingToLandOn() {
        XCTAssertGreaterThan(migrate(v3(true)).posts[0].badge.durationSeconds, 0)
    }

    func testLeavesThePictureAloneNoShadeUntilOneIsAskedFor() {
        XCTAssertEqual(migrate(v3(true)).posts[0].badge.shades, [])
    }

    func testMovesTheYearLinesIntoTheTemporalVocabularyKeepingTheWords() {
        let fr = migrate(v3(true, french: true))
        XCTAssertEqual(fr.badgeWords.time.anniversary, "Il y a 1 an")
        XCTAssertEqual(fr.badgeWords.time.anniversaryPlural, "Il y a {n} ans")
        // …and the rest of the French vocabulary comes with them.
        XCTAssertEqual(fr.badgeWords.time.days, "jours")
    }

    func testLandsAnEnglishDeckOnTheEnglishTemporalWords() {
        XCTAssertEqual(migrate(v3(true)).badgeWords.time.days, "days")
    }

    func testGivesTheTripAPlaceMarker() {
        XCTAssertFalse(migrate(v3(true)).badgeWords.pin.isEmpty)
    }

    func testKeepsWhatTheV3BadgeAlreadySaid() {
        let badge = migrate(v3(true)).posts[0].badge
        XCTAssertEqual(badge.mode, .day)
        XCTAssertEqual(badge.aspectId, "4:5")
    }

    func testIsIdempotent() {
        let once = migrate(v3(true, french: true))
        XCTAssertEqual(migrateTripDoc(once), once)
    }
}

// MARK: - spanProblem / stageProblem

final class TripTypesSpanProblemTests: XCTestCase {
    func testPassesASoundSpan() {
        XCTAssertNil(spanProblem("2025-03-01", "2026-01-04"))
    }

    func testNamesWhatIsWrongInASentence() {
        XCTAssertTrue(spanProblem("", "2026-01-04")?.contains("start date") == true)
        XCTAssertTrue(spanProblem("2025-03-01", "")?.contains("end date") == true)
        XCTAssertTrue(spanProblem("2026-01-04", "2025-03-01")?.contains("ends before it starts") == true)
    }

    func testRejectsADateTheCalendarDoesNotHave() {
        XCTAssertTrue(spanProblem("2025-02-30", "2026-01-04")?.contains("start date") == true)
    }
}

final class TripTypesStageProblemTests: XCTestCase {
    let trip = createTripDoc("Australie", "2025-03-01", "2026-01-04")

    func testPassesAStageInsideTheTrip() {
        XCTAssertNil(stageProblem(trip, stage("2025-03-25", "2025-03-28")))
    }

    func testRefusesAStageThatStartsBeforeTheTrip() {
        XCTAssertTrue(stageProblem(trip, stage("2025-02-01", "2025-03-28"))?.contains("starts before the trip") == true)
    }

    func testRefusesAStageThatEndsAfterTheTrip() {
        XCTAssertTrue(stageProblem(trip, stage("2025-12-30", "2026-02-01"))?.contains("ends after the trip") == true)
    }
}

// MARK: - v5 → v6, the shades

/// A v5 document, with the vignette + scrim pair the shades replace.
private func v5(_ backdrop: JSONValue) -> JSONValue {
    let doc = createTripDoc("Australia", "2025-03-01", "2026-01-04").json
    let post = createTripPost(.photo, "2025-03-27", "A day").json
    let stored = setting(removing(post, "badge", "shades"), "badge", "backdrop", to: backdrop)
    return setting(setting(doc, "version", to: 5), "posts", to: [stored])
}

private func backdrop(_ gradient: String, _ strength: Double, _ color: String, _ from: String, _ vignette: Double) -> JSONValue {
    [
        "gradient": .string(gradient), "gradientStrength": .number(strength), "gradientColor": .string(color),
        "gradientFrom": .string(from), "vignette": .number(vignette),
    ]
}

final class TripTypesMigrateShadesTests: XCTestCase {
    func testCarriesAScrimOverAsTheEdgeShadeItAlwaysWas() {
        let shades = migrate(v5(backdrop("linear", 0.5, "#101010", "top", 0))).posts[0].badge.shades
        XCTAssertEqual(shades.count, 1)
        XCTAssertEqual(shades[0].direction, .top)
        XCTAssertEqual(shades[0].strength, 0.5)
        XCTAssertEqual(shades[0].color, "#101010")
        XCTAssertFalse(shades[0].followHook)
    }

    func testKeepsAnUnderTheHookScrimFollowingTheHook() {
        let shades = migrate(v5(backdrop("under", 0.6, "#000000", "bottom", 0))).posts[0].badge.shades
        XCTAssertEqual(shades[0].direction, .bottom)
        XCTAssertTrue(shades[0].followHook)
    }

    func testCarriesAVignetteOverAsAnInvertedRadial() {
        let shades = migrate(v5(backdrop("off", 0.65, "#000000", "bottom", 0.4))).posts[0].badge.shades
        XCTAssertEqual(shades.count, 1)
        XCTAssertEqual(shades[0].direction, .radial)
        XCTAssertTrue(shades[0].invert)
    }

    func testCarriesBothWhenBothWereOnWhichIsWhatCouldNotBeDoneBefore() {
        let shades = migrate(v5(backdrop("linear", 0.5, "#000000", "bottom", 0.3))).posts[0].badge.shades
        XCTAssertEqual(shades.count, 2)
    }

    func testLeavesAPostThatHadNeitherWithNothingAtAll() {
        let shades = migrate(v5(backdrop("off", 0.65, "#000000", "bottom", 0))).posts[0].badge.shades
        XCTAssertEqual(shades, [])
    }

    func testDropsTheRetiredFieldRatherThanCarryingTwoTruths() {
        let badge = migrate(v5(backdrop("linear", 0.5, "#000000", "bottom", 0))).posts[0].badge
        XCTAssertNil(keys(badge.json)["backdrop"])
        XCTAssertNil(badge.carried["backdrop"])
    }
}

// MARK: - hook defaults — the look a trip gives a new piece

private func composed() -> PostBadge {
    var badge = createTripPost(.reel, "2025-03-27", "A reel").badge
    badge.aspectId = "1:1"
    badge.mode = .stageDay
    badge.timeAgo = .daysAgo
    badge.showPin = true
    badge.durationSeconds = 6
    badge.layout.anchor = .topRight
    badge.layout.sizeFrac = 0.3
    badge.pieceStyles = [.headline: BadgePieceStyle(textCase: .upper)]
    badge.shades = [createShade(direction: .radial, strength: 0.4)]
    return badge
}

final class TripTypesHookDefaultsTests: XCTestCase {
    func testLiftsTheLookOutOfAPiece() {
        let d = hookDefaultsFrom(composed())
        XCTAssertEqual(d.aspectId, "1:1")
        XCTAssertEqual(d.mode, .stageDay)
        XCTAssertEqual(d.timeAgo, .daysAgo)
        XCTAssertTrue(d.showPin)
        XCTAssertEqual(d.durationSeconds, 6)
        XCTAssertEqual(d.layout.anchor, .topRight)
        XCTAssertEqual(d.pieceStyles[.headline]?.textCase, .upper)
        XCTAssertEqual(d.shades[0].direction, .radial)
    }

    func testGivesANewPieceThatLook() {
        let badge = defaultPostBadge(.reel, hookDefaultsFrom(composed()))
        XCTAssertEqual(badge.aspectId, "1:1")
        XCTAssertEqual(badge.layout.sizeFrac, 0.3)
        XCTAssertEqual(badge.shades[0].strength, 0.4)
    }

    func testNeverInheritsWhatBelongsToOneDay() {
        // A reference day, a clip's frame and the author's own words are facts
        // about the piece that was composed, not habits of the trip.
        var from = composed()
        from.referenceDate = "2026-01-01"
        from.videoTimeSeconds = 4.5
        let badge = defaultPostBadge(.reel, hookDefaultsFrom(from))
        XCTAssertNil(badge.referenceDate)
        XCTAssertEqual(badge.videoTimeSeconds, 0)
        XCTAssertEqual(badge.textOverrides, [:])
    }

    func testDoesNotShareMutableStateWithThePieceItCameFrom() {
        let source = composed()
        let d = hookDefaultsFrom(source)
        var badge = defaultPostBadge(.reel, d)
        badge.layout.sizeFrac = 0.9
        badge.shades[0].strength = 0.1
        XCTAssertEqual(d.layout.sizeFrac, 0.3)
        XCTAssertEqual(d.shades[0].strength, 0.4)
        XCTAssertEqual(source.layout.sizeFrac, 0.3)
    }

    func testGivesEachCopiedShadeItsOwnId() {
        let d = hookDefaultsFrom(composed())
        let a = defaultPostBadge(.reel, d)
        let b = defaultPostBadge(.reel, d)
        XCTAssertNotEqual(a.shades[0].id, b.shades[0].id)
    }

    func testFallsBackToTheFactoryLookWithNoDefaultSaved() {
        XCTAssertEqual(defaultPostBadge(.reel).aspectId, "9:16")
        XCTAssertEqual(defaultPostBadge(.reel, nil).shades, [])
    }

    func testStartsATripWithNoneADefaultNobodyChoseIsAFactorySetting() {
        XCTAssertTrue(createTripDoc("A", "2025-03-01", "2025-03-10").hookDefaults.isEmpty)
    }
}

// MARK: - duplicateTripPost

private func source() -> TripPost {
    var post = createTripPost(.carousel, "2025-07-09", "Kalbarri cliffs")
    post.projectId = "proj-1"
    post.publishedAt = 1_700_000_000_000
    post.badge.aspectId = "1:1"
    post.badge.shades = [createShade(strength: 0.4)]
    var one = createPostSlide()
    one.id = "s1"
    one.caption = "One"
    var two = createPostSlide()
    two.id = "s2"
    two.videoTimeSeconds = 2
    two.caption = "Two"
    post.slides = [one, two]
    return post
}

final class TripTypesDuplicateTripPostTests: XCTestCase {
    func testCarriesTheLookAndTheSlidesOverThatIsThePoint() {
        let copy = duplicateTripPost(source())
        XCTAssertEqual(copy.badge.aspectId, "1:1")
        XCTAssertEqual(copy.badge.shades[0].strength, 0.4)
        XCTAssertEqual(copy.slides.map(\.caption), ["One", "Two"])
        XCTAssertEqual(copy.date, "2025-07-09")
        XCTAssertEqual(copy.kind, .carousel)
    }

    func testSaysItIsACopy() {
        XCTAssertEqual(duplicateTripPost(source()).title, "Kalbarri cliffs (copy)")
    }

    func testLeavesAnUntitledPieceUntitledRatherThanNamingItCopy() {
        var blank = source()
        blank.title = "  "
        XCTAssertEqual(duplicateTripPost(blank).title, "")
    }

    func testHasNotBeenPublishedAndIsNotLinkedToAProject() {
        // Two pieces sending a hook into one project would overwrite each other.
        let copy = duplicateTripPost(source())
        XCTAssertNil(copy.publishedAt)
        XCTAssertNil(copy.projectId)
    }

    func testGivesNewIdsAllTheWayDown() {
        let from = source()
        let copy = duplicateTripPost(from)
        XCTAssertNotEqual(copy.id, from.id)
        XCTAssertNotEqual(copy.slides.map(\.id), from.slides.map(\.id))
        XCTAssertNotEqual(copy.badge.shades[0].id, from.badge.shades[0].id)
    }

    func testSharesNoMutableStateWithThePieceItCameFrom() {
        let from = source()
        var copy = duplicateTripPost(from)
        copy.badge.layout.sizeFrac = 0.9
        copy.slides[0].caption = "changed"
        XCTAssertNotEqual(from.badge.layout.sizeFrac, 0.9)
        XCTAssertEqual(from.slides[0].caption, "One")
    }
}

final class TripTypesNewTripLegsTests: XCTestCase {
    func testStartsWithNone() {
        // Creation used to take a From and a To and seed one leg over the whole
        // span from them; a place belongs to a leg now, and the legs are drawn on
        // the calendar. A day outside every leg names no place and says so.
        XCTAssertEqual(createTripDoc("Australie", "2025-11-02", "2026-02-14").stages, [])
    }
}

// MARK: - v8 → v9

private func v8() -> JSONValue {
    let doc = setting(createTripDoc("Australie", "2025-11-02", "2026-02-14").json, "version", to: 8)
    let leg: JSONValue = [
        "id": "s1", "name": "Kalbarri", "region": "Western Australia", "startDate": "2025-11-05", "endDate": "2025-11-09",
    ]
    return setting(doc, "stages", to: [leg])
}

final class TripTypesMigrateV8Tests: XCTestCase {
    func testGivesEveryStageAnEmptyListOfPlaces() {
        XCTAssertEqual(migrate(v8()).stages[0].places, [])
    }

    func testChangesNothingAStageAlreadySaid() {
        let leg = migrate(v8()).stages[0]
        XCTAssertEqual(leg.name, "Kalbarri")
        XCTAssertEqual(leg.region, "Western Australia")
        XCTAssertEqual(leg.startDate, "2025-11-05")
        XCTAssertEqual(leg.endDate, "2025-11-09")
    }

    func testReachesTheCurrentVersionAndIsIdempotent() {
        let once = migrate(v8())
        XCTAssertEqual(once.version, tripDocVersion)
        XCTAssertEqual(migrateTripDoc(once), once)
    }

    func testSurvivesADocumentWithNoStagesAtAll() {
        XCTAssertEqual(migrate(removing(v8(), "stages")).stages, [])
    }
}

// MARK: - v10 → v11, the source

private func v10() -> JSONValue {
    var doc = createTripDoc("Australie", "2025-11-02", "2026-02-14")
    doc.version = 10
    doc.stages = [createTripStage("Kalbarri", "WA", "2025-11-05", "2025-11-09")]
    return removing(doc.json, "sourceId")
}

final class TripTypesMigrateV10Tests: XCTestCase {
    func testFilesEveryTripWrittenBeforeSourcesExistedUnderThisBrowser() {
        XCTAssertEqual(migrate(v10()).sourceId, "local")
    }

    func testGivesNoExistingStageAnOriginNoneWasSeededFromAnywhere() {
        let leg = migrate(v10()).stages[0]
        XCTAssertNil(leg.origin)
        XCTAssertNil(keys(leg.json)["origin"])
    }

    func testKeepsASourceIdADocumentAlreadyCarries() {
        XCTAssertEqual(migrate(setting(v10(), "sourceId", to: "winnow.example")).sourceId, "winnow.example")
    }

    func testKeepsTheGradeAV10DocumentAlreadyCarries() {
        let doc = setting(v10(), "grade", to: ["layers": [], "output": "rec709-to-srgb"])
        XCTAssertEqual(migrate(doc).grade, SavedGrade(layers: [], output: rec709, film: nil))
        XCTAssertEqual(migrate(doc).grade.json, ["layers": [], "output": "rec709-to-srgb", "film": nil])
    }

    func testReachesTheCurrentVersionAndIsIdempotent() {
        let once = migrate(v10())
        XCTAssertEqual(once.version, tripDocVersion)
        XCTAssertEqual(migrateTripDoc(once), once)
    }
}

final class TripTypesCreateTripDocSourceTests: XCTestCase {
    func testIsThisBrowserUnlessToldOtherwise() {
        XCTAssertEqual(createTripDoc("A", "2025-03-01", "2025-03-10").sourceId, "local")
    }

    func testTakesTheSourceItIsCreatedIn() {
        XCTAssertEqual(createTripDoc("A", "2025-03-01", "2025-03-10", sourceId: "winnow.example").sourceId, "winnow.example")
    }
}

// MARK: - v9 → v10, the grade

private func v9() -> JSONValue {
    let doc = setting(removing(createTripDoc("Australie", "2025-11-02", "2026-02-14").json, "grade"), "version", to: 9)
    let post = removing(createTripPost(.reel, "2025-11-05", "Kalbarri").json, "grade")
    return setting(doc, "posts", to: [post])
}

final class TripTypesMigrateV9Tests: XCTestCase {
    func testGivesTheTripAnEmptyGradeAndEveryPostFollowsIt() {
        let doc = migrate(v9())
        XCTAssertEqual(doc.grade, emptyGrade())
        XCTAssertEqual(doc.grade.json, ["layers": [], "output": "none", "film": nil])
        XCTAssertNil(doc.posts[0].grade)
    }

    func testKeepsAGradeADocumentAlreadyCarries() {
        let layer: JSONValue = [
            "id": "l1", "source": "builtin:x", "name": "X", "customText": nil, "intensity": 0.8, "enabled": true,
        ]
        var doc = setting(v9(), "grade", to: ["layers": [layer], "output": "rec709-to-srgb"])
        doc = setting(doc, "posts", 0, "grade", to: ["layers": [], "output": "none"])
        let migrated = migrate(doc)
        XCTAssertEqual(migrated.grade.json, ["layers": [layer], "output": "rec709-to-srgb", "film": nil])
        XCTAssertEqual(migrated.posts[0].grade?.json, ["layers": [], "output": "none", "film": nil])
    }

    func testReachesTheCurrentVersionAndIsIdempotent() {
        let once = migrate(v9())
        XCTAssertEqual(once.version, tripDocVersion)
        XCTAssertEqual(migrateTripDoc(once), once)
    }
}

// MARK: - createTripStage

final class TripTypesCreateTripStageTests: XCTestCase {
    func testTakesNoPlaceByDefaultSoNothingExistingChangesShape() {
        XCTAssertEqual(createTripStage("Kalbarri", "WA", "2025-11-05", "2025-11-09").places, [])
    }

    func testMintsAFreshIdPerPlace() {
        XCTAssertNotEqual(createTripPlace("Perth").id, createTripPlace("Perth").id)
    }

    func testTrimsWhatWasTyped() {
        let place = createTripPlace("  Perth  ", "  WA  ")
        XCTAssertEqual(place.name, "Perth")
        XCTAssertEqual(place.region, "WA")
        XCTAssertNil(place.coords)
    }
}

// MARK: - framing (v12)

/// A v11 document: decks and grades exist, framing does not.
private func v11() -> JSONValue {
    let doc = setting(createTripDoc("Australia", "2025-08-24", "2025-09-23").json, "version", to: 11)
    var post = createTripPost(.carousel, "2025-08-24", "Kalbarri").json
    post = setting(post, "badge", to: removing(defaultPostBadge(.carousel).json, "framing"))
    post = setting(post, "slides", to: [["id": "s1", "media": nil, "videoTimeSeconds": 0, "caption": ""]])
    return setting(doc, "posts", to: [post])
}

final class TripTypesFramingTests: XCTestCase {
    func testGivesEveryPictureTheCentredCoverCropItAlreadyHad() {
        let doc = migrate(v11())
        XCTAssertEqual(doc.posts[0].badge.framing, .default)
        XCTAssertEqual(doc.posts[0].slides[0].framing, .default)
    }

    func testLeavesTheRestOfTheBadgeAlone() {
        // The migration blocks run in source order, not version order: this is
        // the regression that catches a framing block placed before the one that
        // builds the badge.
        let doc = migrate(v11())
        XCTAssertEqual(doc.posts[0].badge.mode, .day)
        XCTAssertEqual(doc.posts[0].badge.aspectId, "4:5")
    }

    func testIsNeverInheritedByTheNextPieceOfTheSameKind() {
        // A crop is about ONE photograph's subject; carrying it onto the next
        // picture is how a subject ends up out of frame.
        var badge = defaultPostBadge(.reel)
        badge.framing = framing { $0.scale = 2.5; $0.x = 0.2; $0.y = -0.1; $0.rotation = 12; $0.flipX = true; $0.fit = .contain }
        let defaults = hookDefaultsFrom(badge)
        XCTAssertNil(keys(defaults.json)["framing"])
        XCTAssertEqual(defaultPostBadge(.reel, defaults).framing, .default)
    }
}

// MARK: - v18 → v19, the trip's car

/// A v18 document: the car it was given, or today's factory car when none.
private func v18(_ car: JSONValue? = nil) -> JSONValue {
    let doc = setting(createTripDoc("Australie", "2025-03-01", "2026-01-04").json, "version", to: 18)
    guard let car else { return doc }
    return setting(doc, "car", to: car)
}

final class TripTypesMigrateCarTests: XCTestCase {
    func testLandsATripThatNeverHadACarOnTheDefaultOne() {
        let doc = migrate(v18())
        XCTAssertEqual(doc.car, defaultCarSpec())
        XCTAssertEqual(doc.version, tripDocVersion)
    }

    func testLandsJunkOnTheDefaultAndKeepsWhatAPartialSpecSays() {
        XCTAssertEqual(migrate(v18("black")).car, defaultCarSpec())
        XCTAssertEqual(migrate(v18(["color": "red", "gear": 3])).car, defaultCarSpec())
        let partial = migrate(v18(["color": "#ff0000", "gear": ["bullBar": false]])).car
        XCTAssertEqual(partial.color, "#ff0000")
        XCTAssertFalse(partial.gear.bullBar)
        XCTAssertTrue(partial.gear.spare)
        XCTAssertEqual(partial.finish, defaultCarSpec().finish)
    }

    func testIsIdempotent() {
        let once = migrate(v18(["color": "#1f3b2f"]))
        XCTAssertEqual(migrateTripDoc(once), once)
    }
}

// MARK: - v17 → v18, a mirror and a fit

/// A v17 document: framings that know pan, zoom and rotation, nothing else.
private func v17() -> JSONValue {
    let doc = setting(createTripDoc("Australie", "2025-03-01", "2026-01-04").json, "version", to: 17)
    var post = createTripPost(.carousel, "2025-03-27", "Cliffs").json
    let badge = setting(defaultPostBadge(.carousel).json, "framing", to: ["scale": 2, "x": 0.1, "y": -0.05, "rotation": 12])
    post = setting(post, "badge", to: badge)
    var slide = createPostSlide()
    slide.id = "s1"
    post = setting(post, "slides", to: [setting(slide.json, "framing", to: ["scale": 1, "x": 0, "y": 0, "rotation": 90])])
    return setting(doc, "posts", to: [post])
}

final class TripTypesMigrateMirrorTests: XCTestCase {
    func testKeepsEveryCropAndLandsItUnmirroredOnCover() {
        let doc = migrate(v17())
        XCTAssertEqual(doc.posts[0].badge.framing, framing { $0.scale = 2; $0.x = 0.1; $0.y = -0.05; $0.rotation = 12 })
        XCTAssertEqual(doc.posts[0].slides[0].framing, framing { $0.rotation = 90 })
        XCTAssertEqual(doc.posts[0].badge.aspectId, "4:5")
        XCTAssertEqual(doc.version, tripDocVersion)
    }
}

// MARK: - v16 → v17, a picture's own develop

/// A v16 document: a badge and a slide, but no develop and no presets.
private func v16(_ badgeDevelop: JSONValue? = nil, _ slideDevelop: JSONValue? = nil) -> JSONValue {
    var badge = removing(defaultPostBadge(.carousel).json, "develop")
    if let badgeDevelop { badge = setting(badge, "develop", to: badgeDevelop) }
    var slide = createPostSlide()
    slide.id = "s1"
    var slideJSON = removing(slide.json, "develop")
    if let slideDevelop { slideJSON = setting(slideJSON, "develop", to: slideDevelop) }
    let post = setting(setting(createTripPost(.carousel, "2025-03-27", "Cliffs").json, "badge", to: badge), "slides", to: [slideJSON])
    let doc = setting(createTripDoc("Australie", "2025-03-01", "2026-01-04").json, "version", to: 16)
    return removing(setting(doc, "posts", to: [post]), "developPresets")
}

final class TripTypesMigrateDevelopTests: XCTestCase {
    func testLeavesEveryPictureAsShotAndThePresetsEmpty() {
        let doc = migrate(v16())
        XCTAssertNil(doc.posts[0].badge.develop)
        XCTAssertNil(doc.posts[0].slides[0].develop)
        XCTAssertEqual(doc.developPresets, [])
        XCTAssertEqual(doc.version, tripDocVersion)
    }

    func testReadsAStoredDevelopThroughTheClampAndAnAllZeroOneAsNothing() {
        let doc = migrate(v16(["exposure": 9, "vibrance": "x"], ["exposure": 0]))
        XCTAssertEqual(doc.posts[0].badge.develop, dev { $0.exposure = 3 })
        XCTAssertNil(doc.posts[0].slides[0].develop)
    }

    func testKeepsADocumentThatAlreadySaysSoPresetsIncluded() {
        var doc = migrate(v16())
        doc.posts[0].slides[0].develop = dev { $0.highlights = -40 }
        doc.developPresets = [DevelopPreset(id: "p", name: "Dusk", settings: dev { $0.tint = 5 })]
        var older = doc
        older.version = 16
        let again = migrateTripDoc(older)
        XCTAssertEqual(again.posts[0].slides[0].develop, dev { $0.highlights = -40 })
        XCTAssertEqual(again.developPresets, doc.developPresets)
    }

    func testNeverHandsADevelopToANewPieceACorrectionIsNotAHabit() {
        var lit = defaultPostBadge(.reel)
        lit.develop = dev { $0.exposure = 1 }
        XCTAssertNil(defaultPostBadge(.reel, hookDefaultsFrom(lit)).develop)
        XCTAssertNil(createPostSlide().develop)
    }
}

// MARK: - v13 → v14, a slide says what it is

/// A v13 document: slides and a badge, but no medium and no screen time. Built
/// by REMOVING what v14 added, rather than by trusting today's factory: a
/// fixture that carries the new fields proves nothing about a document written
/// before they existed.
private func v13() -> JSONValue {
    var badge = defaultPostBadge(.carousel)
    badge.durationSeconds = 6
    let storedBadge = removing(removing(badge.json, "medium"), "hookSeconds")
    let defaults = removing(removing(hookDefaultsFrom(defaultPostBadge(.reel)).json, "medium"), "hookSeconds")
    let post: JSONValue = [
        "id": "p1", "kind": "carousel", "date": "2025-03-27", "endDate": nil, "title": "Cliffs", "media": nil,
        "badge": storedBadge, "slides": [["id": "s1", "media": nil, "videoTimeSeconds": 0, "caption": ""]],
        "includeCta": false, "projectId": nil, "grade": nil, "publishedAt": nil, "createdAt": 0,
    ]
    return [
        "version": 13, "id": "t1", "name": "Australie", "destination": "Australia",
        "startDate": "2025-03-01", "endDate": "2026-01-04", "stages": [], "posts": [post],
        "hookDefaults": ["reel": defaults], "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateMediumTests: XCTestCase {
    func testFilesEverySlideAsAutoWhichDeliversExactlyWhatItDidBefore() {
        let doc = migrate(v13())
        XCTAssertEqual(doc.posts[0].badge.medium, .auto)
        XCTAssertEqual(doc.posts[0].slides[0].medium, .auto)
    }

    func testGivesTheHookTheScreenTimeTheSliderUsedToOffer() {
        // duration + a beat: the badge's own hold is what it was always derived
        // from, so no stored piece changes length.
        XCTAssertEqual(migrate(v13()).posts[0].badge.hookSeconds, 7)
    }

    func testGivesAContentSlideTheDefaultScreenTime() {
        XCTAssertEqual(migrate(v13()).posts[0].slides[0].seconds, defaultSlideSeconds)
    }

    func testFillsTheTripsRememberedDefaultsToo() {
        let kept = migrate(v13()).hookDefaults[.reel]
        XCTAssertEqual(kept?.medium, .auto)
        XCTAssertGreaterThan(kept?.hookSeconds ?? 0, 0)
    }

    func testLeavesADocumentThatAlreadySaysSoUntouched() {
        var doc = migrate(v13())
        doc.posts[0].badge.medium = .image
        doc.posts[0].slides[0].seconds = 8
        doc.version = 13
        let again = migrateTripDoc(doc)
        XCTAssertEqual(again.posts[0].badge.medium, .image)
        XCTAssertEqual(again.posts[0].slides[0].seconds, 8)
    }
}

// MARK: - v15 → v16, a clip slide has a speed

/// A v15 document: a hook on a clip and a content clip, no speed anywhere.
private func v15() -> JSONValue {
    var badge = defaultPostBadge(.reel)
    badge.videoTimeSeconds = 2
    badge.hookSeconds = 5
    let slide = removing(createPostSlide(SavedMediaRef(name: "B.MP4", size: 1, lastModified: 1)).json, "videoSpeed")
    let post: JSONValue = [
        "id": "p1", "kind": "reel", "date": "2025-03-27", "endDate": nil, "title": "Cliffs",
        "media": ["name": "A.MP4", "size": 1, "lastModified": 1], "badge": removing(badge.json, "videoSpeed"),
        "slides": [slide], "includeCta": false, "projectId": nil, "grade": nil, "publishedAt": nil, "createdAt": 0,
    ]
    return [
        "version": 15, "id": "t1", "name": "Australie", "destination": "Australia",
        "startDate": "2025-03-01", "endDate": "2026-01-04", "stages": [], "posts": [post],
        "hookDefaults": ["reel": hookDefaultsFrom(defaultPostBadge(.reel)).json],
        "cover": defaultTripCover().json, "grade": emptyGrade().json, "sourceId": "local",
        "badgeWords": defaultBadgeWords.json, "cta": defaultCta.json, "theme": nil, "createdAt": 0, "updatedAt": 0,
    ]
}

final class TripTypesMigrateSpeedTests: XCTestCase {
    func testPlaysEveryExistingClipAsShotSoNothingChangesLength() {
        let doc = migrate(v15())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertEqual(doc.posts[0].badge.videoSpeed, 1)
        XCTAssertEqual(doc.posts[0].slides[0].videoSpeed, 1)
        // The in point and the screen time are exactly what they were.
        XCTAssertEqual(doc.posts[0].badge.videoTimeSeconds, 2)
        XCTAssertEqual(doc.posts[0].badge.hookSeconds, 5)
    }

    func testGivesTheHookDefaultsNoSpeedItIsNeverInherited() {
        let kept = migrate(v15()).hookDefaults[.reel]
        XCTAssertNil(kept.map { keys($0.json)["videoSpeed"] } ?? nil)
    }

    func testKeepsASpeedADocumentAlreadyCarries() {
        var doc = migrate(v15())
        doc.posts[0].badge.videoSpeed = 2
        doc.version = 15
        XCTAssertEqual(migrateTripDoc(doc).posts[0].badge.videoSpeed, 2)
    }

    func testFillsAV1DocumentAllTheWayUpWithoutLeavingAHole() {
        // The v16 block runs LAST: on a v1 document the badge does not exist
        // until the v2 block builds it, and a block placed above would write
        // `{ videoSpeed }` over nothing.
        let post: JSONValue = [
            "id": "p1", "kind": "photo", "date": "2025-03-02", "endDate": nil, "title": "", "publishedAt": nil, "createdAt": 0,
        ]
        let first: JSONValue = [
            "version": 1, "id": "t1", "name": "A", "destination": "", "startDate": "2025-03-01", "endDate": "2025-03-10",
            "stages": [], "posts": [post], "createdAt": 0, "updatedAt": 0,
        ]
        let doc = migrate(first)
        XCTAssertEqual(doc.posts[0].badge.videoSpeed, 1)
        XCTAssertEqual(doc.posts[0].badge.mode, .day)
        XCTAssertGreaterThan(doc.posts[0].badge.hookSeconds, 0)
    }
}

// MARK: - v26 → v27, the stored destination is dropped

final class TripTypesMigrateDestinationTests: XCTestCase {
    func testDeletesTheKeyAV26DocumentCarried() {
        let v26 = setting(setting(createTripDoc("Australie", "2025-03-01", "2025-03-10").json, "version", to: 26),
                          "destination", to: "Perth → Cairns")
        let doc = migrate(v26)
        // Not merely absent from the type: gone from the record, so no later
        // reader can mistake a stale copy of the route for a fact.
        XCTAssertNil(keys(doc.json)["destination"])
        XCTAssertNil(doc.carried["destination"])
    }

    func testLeavesTheLegsWhichIsWhereTheRouteActuallyLivesUntouched() {
        // The web reads the route back through `tripRouteLabel` ("Perth →
        // Cairns"), a module not ported yet (`trip-places.ts`); what it reads —
        // the leg and its two places, in order — is what must come through.
        let leg = createTripStage("", "", "2025-03-01", "2025-03-10", places: [createTripPlace("Perth"), createTripPlace("Cairns")])
        var v26 = setting(createTripDoc("Australie", "2025-03-01", "2025-03-10").json, "version", to: 26)
        v26 = setting(setting(v26, "destination", to: "a line nothing derives"), "stages", to: [leg.json])
        let doc = migrate(v26)
        XCTAssertEqual(doc.stages, [leg])
        XCTAssertEqual(doc.stages[0].places.map(\.name), ["Perth", "Cairns"])
    }
}

// MARK: - v27 → v28, a picture may move in its frame

private func v27() -> JSONValue {
    let doc = setting(createTripDoc("Australie", "2025-03-01", "2026-01-04").json, "version", to: 27)
    var post = createTripPost(.carousel, "2025-03-27", "Cliffs")
    post.slides = [createPostSlide(nil)]
    var stored = setting(post.json, "badge", "collage", to: ["template": "grid-2x2", "cells": [[:]]])
    stored = removing(removing(stored, "badge", "motion"), "slides", 0, "motion")
    return setting(doc, "posts", to: [stored])
}

final class TripTypesMigrateMotionTests: XCTestCase {
    func testHoldsEveryPictureStillHookSlidesAndCells() {
        let doc = migrate(v27())
        XCTAssertEqual(doc.version, tripDocVersion)
        XCTAssertNil(doc.posts[0].badge.motion)
        XCTAssertNil(doc.posts[0].slides[0].motion)
        XCTAssertNil(doc.posts[0].badge.collage?.cells[0].motion)
        XCTAssertEqual(doc.posts[0].badge.collage?.cells.count, 1)
    }

    func testKeepsASoundMotionAndRefusesJunk() {
        let motion: JSONValue = ["keys": [["at": 0, "scale": 2, "x": 0, "y": 0]], "easing": "linear", "start": "slide"]
        var doc = setting(v27(), "posts", 0, "badge", "motion", to: motion)
        doc = setting(doc, "posts", 0, "slides", 0, "motion", to: ["keys": "fast"])
        let migrated = migrate(doc)
        XCTAssertEqual(migrated.posts[0].badge.motion?.keys, [FramingKey(at: 0, scale: 2, x: 0, y: 0)])
        XCTAssertNil(migrated.posts[0].slides[0].motion)
    }

    func testNeverGivesANewPieceAMotionToInherit() {
        let post = createTripPost(.reel, "2025-03-27", "Cliffs")
        XCTAssertNil(post.badge.motion)
        XCTAssertNil(createPostSlide(nil).motion)
        XCTAssertNil(keys(hookDefaultsFrom(post.badge).json)["motion"])
    }
}

// MARK: - the writer (no web twin): a trip reads back as itself

final class TripTypesRoundTripTests: XCTestCase {
    /// A trip that uses every record the document holds.
    private func realistic() -> TripDoc {
        var trip = createTripDoc("Australie", "2025-03-01", "2026-01-04", sourceId: "winnow.example", now: 1_750_000_000_000)
        trip.cameraNames = ["DJI FC8482": "DJI Mini 4 Pro"]
        trip.badgeWords = frenchBadgeWords
        trip.cover = TripCover(layout: .cover, pinned: ["p-missing"])
        trip.car.color = "#1f3b2f"
        trip.developPresets = [DevelopPreset(id: "d1", name: "Dusk", settings: dev { $0.exposure = 0.7 })]
        let leg = createTripStage("", "WA", "2025-03-01", "2025-03-20", places: [
            createTripPlace("Perth", "WA", coords: GeoPoint(lat: -31.95, lon: 115.86)),
            createTripPlace("Somewhere"),
        ])
        var seeded = createTripStage("The Red Centre", "", "2025-03-21", "2025-04-02")
        seeded.origin = StageOrigin(sourceId: "winnow.example", chapterId: "ch-12", importedAt: 1_749_000_000_000)
        trip.stages = [leg, seeded]
        var reel = createTripPost(.reel, "2025-03-12", "Coral Bay")
        reel.media = SavedMediaRef(name: "DJI_0101.MP4", size: 123_456, lastModified: 1_741_046_400_000, assetId: "a-1", hash: "h1")
        reel.badge.camera = readPlateSpec(["fields": ["body", "iso"], "layout": "ledger", "place": "top-left", "size": 1.2])
        reel.badge.shades = [
            createShade(direction: .middleVertical, reach: 1, strength: 0.9, falloff: .inOut, core: 0.3, center: Point(0.5, 0.62)),
            vignetteShade(0.4),
        ]
        reel.badge.cascade = defaultCascade()
        reel.badge.motion = starterMotion(reel.badge.framing)
        reel.badge.develop = dev { $0.exposure = 0.35 }
        reel.badge.textOverrides = [.kicker: "THE WEST", .caption: ""]
        reel.badge.pieceStyles = [
            .headline: BadgePieceStyle(textCase: .upper, color: .some("#ffcc00"),
                                       animation: .some(ElementAnimation(in: .some(defaultStep(.slide)), out: .some(nil)))),
            .caption: BadgePieceStyle(color: .some(nil), boxColor: .some("#000000"), boxPadFrac: 0.3),
        ]
        reel.badge.hook = [HookLayer(id: "map", options: ["stops": [], "futureKey": "kept"])]
        reel.projectId = "proj-1"
        reel.publishedAt = 1_760_000_000_000
        var carousel = createTripPost(.carousel, "2025-03-13", "Kalbarri", endDate: "2025-03-14")
        var slide = createPostSlide(SavedMediaRef(name: "DJI_0204.MP4", size: 99, lastModified: 3))
        slide.medium = .video
        slide.seconds = 6
        slide.collage = createCollage("grid-2x2")
        slide.collage?.enter = defaultCollageEnter()
        slide.collage?.exit = defaultCollageExit()
        slide.grade = SavedGrade(layers: [SavedLutLayer(id: "l1", source: "builtin:x", name: "X", intensity: 0.8)], output: rec709)
        carousel.slides = [slide]
        carousel.includeCta = true
        trip.posts = [reel, carousel]
        trip.hookDefaults = [.reel: hookDefaultsFrom(reel.badge)]
        trip.carried = ["futureTripField": ["a": 1]]
        return trip
    }

    func testReadThenWriteThenReadIsTheIdentity() throws {
        let trip = realistic()
        let read = try XCTUnwrap(readTripDoc(trip.json))
        XCTAssertEqual(read, trip)
        XCTAssertEqual(readTripDoc(read.json), read)
        XCTAssertEqual(read.json, trip.json)
    }

    func testSurvivesItsOwnTextByteForByte() throws {
        let text = realistic().json.serialized()
        let read = try XCTUnwrap(readTripDoc(JSONValue.parse(text)))
        XCTAssertEqual(read.json.serialized(), text)
    }

    func testCarriesWhatThisPortDoesNotKnowOnEveryRecordThatHeldIt() throws {
        var json = realistic().json
        json = setting(json, "stages", 0, "futureStageKey", to: 1)
        json = setting(json, "stages", 0, "places", 0, "futurePlaceKey", to: 2)
        json = setting(json, "posts", 0, "futurePostKey", to: 3)
        json = setting(json, "posts", 0, "badge", "futureBadgeKey", to: 4)
        json = setting(json, "posts", 0, "badge", "shades", 0, "futureShadeKey", to: 5)
        json = setting(json, "posts", 1, "slides", 0, "futureSlideKey", to: 6)
        json = setting(json, "hookDefaults", "reel", "futureLookKey", to: 7)
        let read = try XCTUnwrap(readTripDoc(json))
        XCTAssertEqual(read.json, json)
    }

    func testIsNotATripWhenItIsNotARecordOrNamesNoId() {
        XCTAssertNil(readTripDoc(nil))
        XCTAssertNil(readTripDoc("a trip"))
        XCTAssertNil(readTripDoc(removing(createTripDoc("A", "2025-03-01", "2025-03-10").json, "id")))
    }

    func testWritesNullsWhereTheWebWritesNullsAndOptionalFieldsOnlyWhenSet() {
        let post = createTripPost(.photo, "2025-03-02", "A")
        let o = keys(post.json)
        XCTAssertEqual(o["media"], JSONValue.null)
        XCTAssertEqual(o["endDate"], JSONValue.null)
        XCTAssertEqual(o["projectId"], JSONValue.null)
        let badge = keys(post.badge.json)
        for key in ["referenceDate", "motion", "develop", "grade", "cascade", "collage"] {
            XCTAssertEqual(badge[key], JSONValue.null, key)
        }
        XCTAssertNil(badge["camera"])
        XCTAssertNil(keys(createTripDoc("A", "2025-03-01", "2025-03-10").json)["cameraNames"])
        XCTAssertNil(keys(createTripStage("A", "", "2025-03-01", "2025-03-10").json)["origin"])
    }
}
