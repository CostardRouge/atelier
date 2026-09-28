// The digest under `PartialHash.swift`, held to FIPS 180-4's published vectors
// — the kernel's own SHA-256 has no web twin, so its spec is the standard's.

import Foundation
import XCTest
@testable import AtelierKit

final class SHA256Tests: XCTestCase {
    func testTheEmptyMessage() {
        XCTAssertEqual(SHA256.hexDigest(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testAbc() {
        XCTAssertEqual(SHA256.hexDigest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    func testTwoBlocks() {
        // 56 bytes: the padding spills into a second block.
        XCTAssertEqual(
            SHA256.hexDigest("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        )
    }

    func testExactlyOneBlockOfPaddingBoundary() {
        // 64 bytes: the message fills a block and the padding is a whole new one.
        let text = String(repeating: "a", count: 64)
        XCTAssertEqual(SHA256.hexDigest(text), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb")
    }

    func testAMillionA() {
        let bytes = [UInt8](repeating: 0x61, count: 1_000_000)
        XCTAssertEqual(SHA256.hex(SHA256.digest(bytes)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
    }

    func testTheDecimalZeroThePartialHashPrefixes() {
        // sha256("0") — the empty file's whole message in `partialHash`.
        XCTAssertEqual(SHA256.hexDigest("0"), "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9")
    }

    func testDataAndBytesAgree() {
        let data = Data("abc".utf8)
        XCTAssertEqual(SHA256.digest(data), SHA256.digest(Array("abc".utf8)))
        XCTAssertEqual(SHA256.hexDigest(data), SHA256.hexDigest("abc"))
    }
}
