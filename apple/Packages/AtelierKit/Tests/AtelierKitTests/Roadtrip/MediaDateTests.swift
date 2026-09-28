// Port of `src/shared/roadtrip/media-date.test.ts`, case for case. The web
// builds a local instant with `new Date(y, m, d, h)` in the test runner's own
// zone; here the zone is handed in, so the cases pin one (Perth, where the
// maintainer's trip is) and the instant is built in it. The file's head is
// what the app would read — none here, as the web's proxies carry no EXIF —
// and the vouched identity lives in a registry of the spec's own.

import Foundation
import XCTest
@testable import AtelierKit

private let perth = TimeZone(identifier: "Australia/Perth")!

/// Epoch milliseconds of a wall-clock moment in `zone` — `new Date(y, m-1, d, h, …).getTime()`.
private func localMs(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0,
                     in zone: TimeZone = perth) -> Double {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    return date.timeIntervalSince1970 * 1000
}

/// `Date.parse('2025-11-17T23:30:00Z')`.
private let lateUtc = 1_763_422_200_000.0

final class MediaDateExifDateTimeTests: XCTestCase {
    func testReadsTheDayOutOfTheCamerasOwnFormat() {
        XCTAssertEqual(isoFromExifDateTime("2025:11:17 08:42:13"), "2025-11-17")
    }

    func testTakesTheDateAsWrittenNeverConverted() {
        // 23:59 local is still that day — a UTC conversion would move it, and the
        // day a picture belongs to is the day it was where it was taken.
        XCTAssertEqual(isoFromExifDateTime("2025:03:27 23:59:59"), "2025-03-27")
    }

    func testAcceptsTheDashedSpellingSomeWritersUse() {
        XCTAssertEqual(isoFromExifDateTime("2025-11-17 08:42:13"), "2025-11-17")
    }

    func testRefusesACameraWithAFlatClockRatherThanInventingADay() {
        XCTAssertNil(isoFromExifDateTime("0000:00:00 00:00:00"))
    }

    func testRefusesADayThatDoesNotExist() {
        XCTAssertNil(isoFromExifDateTime("2025:02:30 10:00:00"))
    }

    func testIsNilForNothingAtAll() {
        XCTAssertNil(isoFromExifDateTime(nil))
        XCTAssertNil(isoFromExifDateTime(""))
        XCTAssertNil(isoFromExifDateTime("not a date"))
    }
}

final class MediaDateTimestampTests: XCTestCase {
    func testGivesTheCalendarDayTheInstantFellOn() {
        XCTAssertEqual(isoFromTimestamp(localMs(2026, 7, 14, 12), timeZone: perth), "2026-07-14")
    }

    func testPadsASingleDigitMonthAndDay() {
        XCTAssertEqual(isoFromTimestamp(localMs(2026, 1, 5, 9), timeZone: perth), "2026-01-05")
    }

    func testIsNilWhenThereIsNoTimestamp() {
        XCTAssertNil(isoFromTimestamp(0))
        XCTAssertNil(isoFromTimestamp(.nan))
    }
}

final class MediaDateReadCaptureTests: XCTestCase {
    // A Winnow photo proxy: a re-encode with no EXIF of its own, whose file
    // timestamp is the capture instant read in the READER's zone — so the
    // fallback can name the wrong calendar day, and calls it a weak guess even
    // when it lands on the right one.
    private func proxy(_ name: String = "DJI_0042.webp") -> SavedMediaRef {
        SavedMediaRef(name: name, size: 64, lastModified: lateUtc)
    }

    func testTakesTheDayTheSourceReadAtIngestWhenTheFileCarriesNoExif() {
        let identities = MediaIdentities()
        let file = proxy()
        identities.register(file, KnownIdentity(
            assetId: "winnow.example/42",
            origin: MediaOrigin(sourceId: "winnow.example", fidelity: .proxy, width: 4000, height: 3000),
            exif: ExifData(dateTimeOriginal: "2025:11:17 23:30:00")
        ))
        XCTAssertEqual(readCaptureDate(file, head: Data(count: 64), identities: identities, timeZone: perth),
                       CaptureDate(date: "2025-11-17", source: .source, via: "winnow.example"))
    }

    func testFallsThroughToTheFilesOwnDateWhenNoSourceVouchedForIt() {
        // A different name, so it is a different `fileIdentity` from the one
        // above — the vouched map is keyed on name + size + lastModified.
        let alone = proxy("DJI_0043.webp")
        let day = isoFromTimestamp(lateUtc, timeZone: perth)
        XCTAssertEqual(readCaptureDate(alone, head: Data(count: 64), identities: MediaIdentities(), timeZone: perth),
                       day.map { CaptureDate(date: $0, source: .file) })
        // Read in Perth, 23:30 UTC is already the next morning: the weak guess
        // names the wrong day, which is why it is labelled `file`.
        XCTAssertEqual(day, "2025-11-18")
    }
}

// No web case: the file's own EXIF wins over the source's, the date and the
// position alike, and the position falls back to the source's record.
final class MediaDateCaptureRungsTests: XCTestCase {
    /// A little-endian TIFF head with an EXIF IFD holding `DateTimeOriginal`
    /// and a GPS IFD at 31°57′S 115°52′E (Perth), as a camera writes one.
    private func tiffHead() -> Data {
        var b: [UInt8] = []
        func u16(_ v: Int) { b += [UInt8(v & 0xff), UInt8((v >> 8) & 0xff)] }
        func u32(_ v: Int) { b += [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)] }
        // Header: II, 42, IFD0 at 8.
        b += [0x49, 0x49]; u16(42); u32(8)
        // IFD0 at 8: two entries (ExifIFD pointer, GPS pointer), next 0.
        u16(2)
        u16(0x8769); u16(4); u32(1); u32(38) // Exif IFD at 38
        u16(0x8825); u16(4); u32(1); u32(76) // GPS IFD at 76
        u32(0)
        // Exif IFD at 38: one entry, DateTimeOriginal ASCII[20] at 56.
        u16(1)
        u16(0x9003); u16(2); u32(20); u32(56)
        u32(0)
        // 56: the date (20 bytes, NUL-terminated).
        b += Array("2025:11:02 07:14:00".utf8) + [0]
        // GPS IFD at 76: four entries, rationals from 130.
        u16(4)
        u16(1); u16(2); u32(2); b += Array("S".utf8) + [0, 0, 0]
        u16(2); u16(5); u32(3); u32(130)
        u16(3); u16(2); u32(2); b += Array("E".utf8) + [0, 0, 0]
        u16(4); u16(5); u32(3); u32(154)
        u32(0)
        // 130: 31/1, 57/1, 0/1 ; 154: 115/1, 52/1, 0/1.
        for (n, d) in [(31, 1), (57, 1), (0, 1), (115, 1), (52, 1), (0, 1)] { u32(n); u32(d) }
        return Data(b)
    }

    func testTheFilesOwnExifWinsOverTheSourcesRecord() throws {
        let identities = MediaIdentities()
        let file = SavedMediaRef(name: "DJI_0101.JPG", size: 10, lastModified: lateUtc)
        identities.register(file, KnownIdentity(
            origin: MediaOrigin(sourceId: "winnow.example", fidelity: .proxy),
            exif: ExifData(dateTimeOriginal: "2025:11:17 23:30:00", gps: GpsCoord(lat: -27.7, lon: 114.2))
        ))
        let capture = readCapture(file, head: tiffHead(), identities: identities, timeZone: perth)
        XCTAssertEqual(capture.date, CaptureDate(date: "2025-11-02", source: .exif))
        let coords = try XCTUnwrap(capture.coords)
        assertClose(coords.lat, -(31 + 57.0 / 60), 6)
        assertClose(coords.lon, 115 + 52.0 / 60, 6)
    }

    func testThePositionFallsBackToTheSourcesRecordAndNeverToAGuess() {
        let identities = MediaIdentities()
        let file = SavedMediaRef(name: "DJI_0102.webp", size: 10, lastModified: lateUtc)
        identities.register(file, KnownIdentity(exif: ExifData(gps: GpsCoord(lat: -27.7, lon: 114.2))))
        XCTAssertEqual(readCapture(file, head: nil, identities: identities, timeZone: perth).coords,
                       GeoPoint(lat: -27.7, lon: 114.2))
        XCTAssertNil(readCapture(file, head: nil, identities: MediaIdentities(), timeZone: perth).coords)
    }
}
