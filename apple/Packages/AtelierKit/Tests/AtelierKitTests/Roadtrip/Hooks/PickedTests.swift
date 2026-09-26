// Port of `src/shared/roadtrip/hooks/picked.test.ts`.

import XCTest
@testable import AtelierKit

private func ref(_ name: String) -> SavedMediaRef {
    SavedMediaRef(name: name, size: 10, lastModified: 0)
}

private func refJSON(_ name: String) -> JSONValue {
    ["name": .string(name), "size": 10, "lastModified": 0]
}

final class PickedReadCoordsTests: XCTestCase {
    func testReadsTwoFiniteNumbersInsideTheGlobe() {
        XCTAssertEqual(readCoords(["lat": -31.95, "lon": 115.86]), GeoPoint(lat: -31.95, lon: 115.86))
    }

    func testRefusesAnythingElseQuietly() {
        XCTAssertNil(readCoords(.null))
        XCTAssertNil(readCoords("here"))
        XCTAssertNil(readCoords(["lat": "1", "lon": 2]))
        XCTAssertNil(readCoords(["lat": .number(.nan), "lon": 2]))
        XCTAssertNil(readCoords(["lat": 91, "lon": 2]))
        XCTAssertNil(readCoords(["lat": 1, "lon": -181]))
    }
}

final class PickedReadPickedTests: XCTestCase {
    func testKeepsAPositionThatReadsAndDropsOneThatDoesNot() {
        let list = readPicked([
            ["ref": refJSON("a.jpg"), "date": "2025-03-02", "takenAt": 5, "coords": ["lat": 1, "lon": 2]],
            ["ref": refJSON("b.jpg"), "date": "2025-03-02", "coords": ["lat": "x"]],
            ["ref": refJSON("c.jpg"), "date": "2025-03-02"],
        ])
        XCTAssertEqual(list, [
            HookPickedPicture(ref: ref("a.jpg"), date: "2025-03-02", takenAt: 5, coords: GeoPoint(lat: 1, lon: 2)),
            HookPickedPicture(ref: ref("b.jpg"), date: "2025-03-02"),
            HookPickedPicture(ref: ref("c.jpg"), date: "2025-03-02"),
        ])
    }

    func testDropsAnEntryWithNoDayNoRefOrTheSamePictureTwice() {
        XCTAssertEqual(
            readPicked([
                ["ref": refJSON("a.jpg"), "date": "yesterday"],
                ["ref": .null, "date": "2025-03-02"],
                ["ref": refJSON("a.jpg"), "date": "2025-03-02"],
                ["ref": refJSON("a.jpg"), "date": "2025-03-03"],
                "junk",
            ]),
            [HookPickedPicture(ref: ref("a.jpg"), date: "2025-03-02")]
        )
        XCTAssertEqual(readPicked("all"), [])
    }

    func testKeepsARefsIdentityAndForgetsKeysItDoesNotKnow() {
        let one = readPicked([
            [
                "ref": ["name": "a.jpg", "size": 10, "lastModified": 0, "assetId": "host/1", "hash": "h", "extra": 1],
                "date": "2025-03-02",
                "mood": "sunny",
            ],
        ]).first
        XCTAssertEqual(one, HookPickedPicture(ref: SavedMediaRef(name: "a.jpg", size: 10, lastModified: 0,
                                                                 assetId: "host/1", hash: "h"),
                                              date: "2025-03-02"))
        XCTAssertEqual(one?.json, [
            "ref": ["name": "a.jpg", "size": 10, "lastModified": 0, "assetId": "host/1", "hash": "h"],
            "date": "2025-03-02",
        ])
    }
}

final class PickedSortTests: XCTestCase {
    func testOrdersByDayThenInstantThenNameAnUnknownInstantLast() {
        let sorted = sortPicked([
            HookPickedPicture(ref: ref("z.jpg"), date: "2025-03-02"),
            HookPickedPicture(ref: ref("b.jpg"), date: "2025-03-02", takenAt: 20),
            HookPickedPicture(ref: ref("a.jpg"), date: "2025-03-02", takenAt: 10),
            HookPickedPicture(ref: ref("early.jpg"), date: "2025-03-01", takenAt: 99),
        ])
        XCTAssertEqual(sorted.map(\.ref.name), ["early.jpg", "a.jpg", "b.jpg", "z.jpg"])
    }
}
