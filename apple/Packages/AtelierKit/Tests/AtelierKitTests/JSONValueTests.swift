// The one type every document reader takes: what it must tell apart, and how
// it writes so a document made here diffs cleanly against the web app's.

import XCTest
@testable import AtelierKit

final class JSONValueTests: XCTestCase {
    func testParsesEveryKindAndTellsANumberFromABool() {
        let v = JSONValue.parse(#"{"a": 1, "b": true, "c": null, "d": "x", "e": [1, 2.5], "f": {}}"#)
        let o = v?.objectValue
        XCTAssertEqual(o?["a"], .number(1))
        XCTAssertEqual(o?["b"], .bool(true))
        XCTAssertEqual(o?["c"], .null)
        XCTAssertEqual(o?["d"], "x")
        XCTAssertEqual(o?["e"], [1, 2.5])
        XCTAssertEqual(o?["f"], [:])
        XCTAssertNil(o?["a"]?.boolValue)
        XCTAssertNil(o?["b"]?.finiteNumber)
        XCTAssertEqual(o?["a"]?.finiteNumber, 1)
        XCTAssertTrue(o?["c"]?.isNull == true)
    }

    func testWritesWholeNumbersTheWayJavaScriptDoesAndSortsItsKeys() {
        XCTAssertEqual(JSONValue.object(["n": 1, "f": 1.5, "z": 0, "neg": -3]).serialized(), #"{"f":1.5,"n":1,"neg":-3,"z":0}"#)
    }

    func testDoesNotEscapeASlashInAnAssetId() {
        XCTAssertEqual(JSONValue.object(["assetId": "winnow.example/7"]).serialized(), #"{"assetId":"winnow.example/7"}"#)
    }

    func testRoundTripsADocumentAndRefusesJunk() {
        let doc: JSONValue = ["pictures": [["id": "p", "develop": nil, "x": 0.25, "on": false]], "name": "Islande — jour 3"]
        XCTAssertEqual(JSONValue.parse(doc.serialized()), doc)
        XCTAssertEqual(JSONValue.parse(doc.serialized(pretty: true)), doc)
        XCTAssertNil(JSONValue.parse("{nope"))
        XCTAssertNil(JSONValue.parse(""))
    }

    func testANonFiniteNumberIsNotANumberAReaderTakes() {
        XCTAssertNil(JSONValue.number(.nan).finiteNumber)
        XCTAssertNil(JSONValue.number(.infinity).finiteNumber)
        XCTAssertEqual(JSONValue.number(-2).finiteNumber, -2)
    }
}
