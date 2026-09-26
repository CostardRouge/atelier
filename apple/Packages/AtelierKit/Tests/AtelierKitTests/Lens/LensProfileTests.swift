// Port of `src/shared/lens/lens-profile.test.ts`, first half (the second,
// about which Lensfun files a lookup asks for, is `LensfunSourceTests.swift`).

import Foundation
import XCTest
@testable import AtelierKit

private let applied = LensProfileApplied(
    lens: "Sony FE 24-70mm f/4 ZA OSS",
    camera: "Sony ILCE-7CM2",
    focal: 24,
    aperture: 4,
    terms: LensProfileTerms(distortion: [0.078, -0.28, 0.15, 0], tcaRed: [1.0003, 0, 0.0005],
                            tcaBlue: [1, 0, -0.0002], vignette: [0, 0, 0]),
    has: LensProfileHas(distortion: true, tca: true, vignette: false),
    onRender: false
)

final class LensProfileOnAPictureTests: XCTestCase {
    func testReadsBackWhatItWroteAndKeepsNeverDecidedApartFromTakenOff() {
        let roundTripped = JSONValue.parse(applied.json.serialized())
        XCTAssertEqual(readLensProfile(roundTripped), .some(applied))
        // Absent: never decided.
        let absent = readLensProfile(nil)
        XCTAssertTrue(absent == nil, "absent reads back as absent")
        // Null: taken off.
        let off = readLensProfile(.null)
        XCTAssertTrue(off != nil && off! == nil, "null reads back as null")
        let broken = readLensProfile(["lens": "x", "focal": 24, "terms": ["distortion": [1, 2]]])
        XCTAssertTrue(broken != nil && broken! == nil, "a broken record reads back as null")
    }

    func testDrawsOnTheSensorByItselfAndOnACameraRenderOnlyWhereTheAuthorSaidSo() {
        XCTAssertEqual(profileInEffect(applied, true), applied.terms)
        XCTAssertNil(profileInEffect(applied, false))
        var onRender = applied
        onRender.onRender = true
        XCTAssertEqual(profileInEffect(onRender, false), applied.terms)
        XCTAssertNil(profileInEffect(nil, true))
        // The web's `undefined` and `null` are one Swift nil here.
        let undecided: LensProfileApplied? = nil
        XCTAssertNil(profileInEffect(undecided, true))
    }

    func testSaysWhatItCorrectsAndKeysALookupOnTheBodyAndTheLensAsTheExifNamesThem() {
        XCTAssertEqual(describeProfileParts(applied.has), "distortion · fringing")
        XCTAssertEqual(lensKey("SONY", "ILCE-7CM2", "FE 24-70mm F4 ZA OSS"),
                       lensKey("Sony", "ilce-7cm2", "FE 24-70mm F4 ZA OSS"))
    }
}
