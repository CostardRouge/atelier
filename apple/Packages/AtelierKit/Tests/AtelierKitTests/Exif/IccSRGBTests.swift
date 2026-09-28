// Port of `src/shared/exif/icc-srgb.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private func bare() -> [UInt8] {
    [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]
}

/// The markers before the scan, in order.
private func markers(_ jpeg: [UInt8]) -> [UInt8] {
    var out: [UInt8] = []
    var at = 2
    while at + 4 <= jpeg.count && jpeg[at] == 0xff && jpeg[at + 1] != 0xda {
        out.append(jpeg[at + 1])
        at += 2 + ((Int(jpeg[at + 2]) << 8) | Int(jpeg[at + 3]))
    }
    return out
}

final class SrgbProfileTests: XCTestCase {
    func testIsAWellFormedIccV4DisplayProfileTheSameBytesEveryTime() {
        let p = srgbProfile()
        let view = ByteView(p)
        XCTAssertEqual(Int(view.uint32(0)), p.count)
        func text(_ at: Int) -> String { String(decoding: p[at..<(at + 4)], as: UTF8.self) }
        XCTAssertEqual([text(12), text(16), text(20), text(36)], ["mntr", "RGB ", "XYZ ", "acsp"])
        XCTAssertEqual(view.uint32(8), 0x0430_0000)
        // Ten tags, the three curves sharing one block.
        XCTAssertEqual(view.uint32(128), 10)
        let offsets = (0..<10).map { view.uint32(132 + $0 * 12 + 4) }
        XCTAssertEqual(Set(offsets[7...]).count, 1)
        XCTAssertEqual(srgbProfile(), p)
        // The web asserts the cached profile is the SAME object; an array is a
        // value here, so the port asserts what that buys — one set of bytes.
        XCTAssertEqual(srgbIcc(), srgbIcc())
        XCTAssertEqual(srgbIcc(), p)
    }
}

final class WithIccProfileTests: XCTestCase {
    func testGoesAfterTheExifAndTheXmpAndIsReadBackWhole() throws {
        let withExif = try withExifBlock(bare(), buildExifBlock(exifData { $0.make = "DJI" }))
        let tagged = try withIccProfile(try withXmpPacket(withExif, "<x/>"))
        XCTAssertEqual(markers(tagged), [0xe1, 0xe1, 0xe2, 0xdb])
        XCTAssertEqual(readIccProfile(tagged), srgbIcc())
        XCTAssertEqual(parseExif(tagged).make, "DJI")
    }

    func testReplacesAProfileRatherThanAddingASecondOneAndLeavesTheScanAlone() throws {
        let once = try withIccProfile(bare(), [1, 2, 3])
        let twice = try withIccProfile(once)
        XCTAssertEqual(markers(twice).filter { $0 == 0xe2 }.count, 1)
        XCTAssertEqual(readIccProfile(twice), srgbIcc())
        let b = bare()
        XCTAssertEqual(Array(twice[(twice.count - 7)...]), Array(b[(b.count - 7)...]))
    }

    func testFindsNothingInAnUntaggedFile() {
        XCTAssertNil(readIccProfile(bare()))
    }
}

/// Hex text as bytes — the golden below was written by the web module itself.
private func hexBytes(_ hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var it = hex.makeIterator()
    while let hi = it.next(), let lo = it.next() { out.append(UInt8(String([hi, lo]), radix: 16)!) }
    return out
}

/// This port's own case: the profile is the BROWSER's, all 520 bytes — the
/// golden is `srgbProfile()` as `icc-srgb.ts` built it.
final class SrgbProfileGoldenTests: XCTestCase {
    func testBuildsTheSameBytesAsTheWebModule() {
        XCTAssertEqual(srgbProfile().count, 520)
        XCTAssertEqual(srgbProfile(), hexBytes("0000020800000000043000006d6e74725247422058595a2007ea0009001700000000000061637370000000000000000000000000000000000000000000000000000000000000f6d6000100000000d32d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a64657363000000fc0000002463707274000001200000004c777470740000016c0000001463686164000001800000002c7258595a000001ac000000146758595a000001c0000000146258595a000001d40000001472545243000001e80000002067545243000001e80000002062545243000001e8000000206d6c756300000000000000010000000c656e5553000000080000001c00730052004700426d6c756300000000000000010000000c656e5553000000300000001c004e006f00200063006f0070007900720069006700680074002c002000750073006500200066007200650065006c007958595a20000000000000f6d6000100000000d32d736633320000000000010c43000005ddfffff326000007940000fd8bfffffb9ffffffda5000003de0000c07d58595a200000000000006fa4000038f60000038f58595a2000000000000062960000b787000018dc58595a2000000000000024a200000f830000b6cf706172610000000000030000000266660000f2a700000d59000013d000000a5b"))
    }
}
