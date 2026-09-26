// Port of `src/shared/lut/pack-remote.test.ts`, case for case, over the fake
// instance in `PackFakes.swift` — which refuses a body that does not hash to
// its path, as the real route does, so the 400 the first real push got is
// held here and not only against a live instance.

import XCTest
@testable import AtelierKit

private func pack(_ hashes: [String]) -> LutPackIndex {
    buildPackIndex(
        hashes.enumerated().map { PackFileEntry(path: "Creative/Look \($0.offset).cube", hash: $0.element) },
        BuildPackOptions(id: "pk_1", name: "AUTHENTIC", author: "Victor Jimenes")
    )
}

/// A look's bytes as the vault holds them: the ENCODED lattice, whose hash is
/// not the `.cube`'s. Distinct per look, so a spec can tell the id the push
/// writes under from the look's own hash — the whole of the bug.
private func bytesFor(_ hash: String) -> [UInt8] { Array("lattice:\(hash)".utf8) }
/// What the instance must end up calling that look's bytes.
private func blobOf(_ hash: String) -> String { sha256Hex(bytesFor(hash)) }

private func lattices(_ hashes: [String]) -> (String) async throws -> [UInt8]? {
    { hash in hashes.contains(hash) ? bytesFor(hash) : nil }
}

final class PushPackTests: XCTestCase {
    func testWritesEveryLatticeBeforeTheIndexThatNamesThem() async throws {
        let (host, client) = fakePackHost()
        _ = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"]))
        XCTAssertEqual(client.calls.filter { $0.hasPrefix("put-file") }.count, 2)
        // The index is last: a device reading it must never find a look that 404s.
        XCTAssertEqual(client.calls.last, "put-doc:pk_1")
        let file = try XCTUnwrap(client.calls.firstIndex(of: "put-file:\(blobOf("aa"))"))
        let doc = try XCTUnwrap(client.calls.firstIndex(of: "put-doc:pk_1"))
        XCTAssertLessThan(file, doc)
    }

    func testStoresEachLatticeUnderTheHashOfTheBytesItSends() async throws {
        let (host, client) = fakePackHost()
        _ = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"]))
        // The regression: the id was the SOURCE file's hash while the body is
        // the encoded lattice, so the instance refused every upload with a 400.
        XCTAssertEqual(client.files.keys.sorted(), [blobOf("aa"), blobOf("bb")].sorted())
        for (id, bytes) in client.files { XCTAssertEqual(sha256Hex(bytes), id) }
    }

    func testNamesThoseBlobsInTheIndexItPushesBesideTheSourceHashes() async throws {
        let (host, client) = fakePackHost()
        let result = try await pushPack(host, pack(["aa"]), latticeFor: lattices(["aa"]))
        let look = result.index.looks[0]
        XCTAssertEqual(look.hash, "aa")
        XCTAssertEqual(look.blob, blobOf("aa"))
        // And another device reads it from the instance, not from this one.
        XCTAssertEqual(migratePackIndex(client.docs["pk_1"])?.looks[0].blob, blobOf("aa"))
    }

    func testSendsOnlyWhatTheInstanceIsMissing() async throws {
        let (host, client) = fakePackHost(has: [blobOf("aa")])
        let result = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"]))
        XCTAssertEqual(result.reused, 1)
        XCTAssertEqual(result.sent, 1)
        XCTAssertFalse(client.calls.contains("put-file:\(blobOf("aa"))"))
        XCTAssertTrue(client.calls.contains("put-file:\(blobOf("bb"))"))
    }

    func testWritesOneFileForTwoLooksThatHoldTheSameLattice() async throws {
        let (host, client) = fakePackHost()
        let result = try await pushPack(host, pack(["aa", "bb"]), latticeFor: { _ in [7, 7, 7] })
        XCTAssertEqual(result.sent, 1)
        XCTAssertEqual(client.files.count, 1)
        let blob = sha256Hex([7, 7, 7] as [UInt8])
        XCTAssertEqual(result.index.looks.map(\.blob), [blob, blob])
    }

    func testSaysWhichLooksThisDeviceDoesNotHoldAndPushesTheRest() async throws {
        let (host, _) = fakePackHost()
        let result = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa"]))
        XCTAssertEqual(result.missingLocally, ["bb"])
        XCTAssertEqual(result.sent, 1)
    }

    func testPushesNothingTwiceAndReadsNothingBackOutOfTheVaultToFindOut() async throws {
        let (host, client) = fakePackHost()
        var asked: [String] = []
        let first = try await pushPack(host, pack(["aa"]), latticeFor: { hash in
            asked.append(hash)
            return bytesFor(hash)
        })
        client.calls.removeAll()
        asked.removeAll()
        // The index the first push RETURNED carries the blob, so the second
        // push answers from the listing alone rather than reading 40 MB of
        // lattices back out to hash them again.
        let second = try await pushPack(host, first.index, latticeFor: { hash in
            asked.append(hash)
            return bytesFor(hash)
        })
        XCTAssertEqual(second.sent, 0)
        XCTAssertEqual(second.reused, 1)
        XCTAssertEqual(asked, [])
        XCTAssertEqual(client.calls.filter { $0.hasPrefix("put-file") }, [])
    }

    func testReportsTheBytesItWroteNotTheBytesItNamed() async throws {
        let (host, _) = fakePackHost(has: [blobOf("aa")])
        let result = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"]))
        XCTAssertEqual(result.bytes, bytesFor("bb").count)
    }

    /// Not in the web spec: a first push is a CREATE (no `If-Match`), the next
    /// carries the etag the instance holds; the body is the web's envelope.
    func testCreatesTheDocumentThenReplacesItUnderItsEtag() async throws {
        let (host, client) = fakePackHost()
        var progress: [PushProgress] = []
        let first = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"]),
                                       onProgress: { progress.append($0) })
        _ = try await pushPack(host, first.index, latticeFor: lattices(["aa", "bb"]))
        XCTAssertEqual(client.ifMatches, [nil, "e1"])
        XCTAssertEqual(progress.map(\.done), [0, 1, 2])
        XCTAssertEqual(progress.last, PushProgress(done: 2, total: 2, bytes: bytesFor("aa").count + bytesFor("bb").count))
    }
}

final class FetchRemotePacksTests: XCTestCase {
    func testReadsBackWhatWasPushedAndRefusesJunk() async throws {
        let (host, client) = fakePackHost()
        _ = try await pushPack(host, pack(["aa"]), latticeFor: lattices(["aa"]))
        client.setDoc("junk", ["not": "a pack"])
        let back = try await fetchRemotePacks(host)
        XCTAssertEqual(back.map(\.id), ["pk_1"])
        XCTAssertEqual(back[0].looks[0].hash, "aa")
        // The blob survives the read too, or the device that adopts the pack
        // has no id to fetch the lattice under.
        XCTAssertEqual(back[0].looks[0].blob, blobOf("aa"))
        XCTAssertEqual(client.calls.last, "list-docs:\(packKind)")
    }
}

final class DeleteRemotePackTests: XCTestCase {
    func testTakesTheIndexAndTheLatticesNoOtherPackNames() async throws {
        let (host, client) = fakePackHost()
        let index = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"])).index
        try await deleteRemotePack(host, index, [blobOf("bb")])
        XCTAssertNil(client.docs["pk_1"])
        XCTAssertNil(client.files[blobOf("aa")])
        // Another pack still names it: the bytes stay.
        XCTAssertNotNil(client.files[blobOf("bb")])
    }

    func testTakesTheIndexFirstTheExactMirrorOfAPush() async throws {
        let (host, client) = fakePackHost()
        let index = try await pushPack(host, pack(["aa"]), latticeFor: lattices(["aa"])).index
        client.calls.removeAll()
        try await deleteRemotePack(host, index, [])
        // An index that still named a gone lattice would 404 on every picture;
        // one that has dropped a look whose bytes linger only wastes space.
        let doc = try XCTUnwrap(client.calls.firstIndex(of: "del-doc:pk_1"))
        let file = try XCTUnwrap(client.calls.firstIndex(of: "del-file:\(blobOf("aa"))"))
        XCTAssertLessThan(doc, file)
    }
}

final class DeleteRemoteLooksTests: XCTestCase {
    func testWritesTheIndexWithoutTheLookThenFreesItsLattice() async throws {
        let (host, client) = fakePackHost()
        let index = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"])).index
        let kept = index.looks[1]
        let next = withoutLooks(index, [index.looks[0].id])
        client.calls.removeAll()
        try await deleteRemoteLooks(host, next, [blobOf("aa")])

        // The pack is still there, one look lighter, and the surviving look's
        // bytes are untouched.
        XCTAssertEqual(migratePackIndex(client.docs["pk_1"])?.looks.map(\.id), [kept.id])
        XCTAssertNil(client.files[blobOf("aa")])
        XCTAssertNotNil(client.files[blobOf("bb")])
        let doc = try XCTUnwrap(client.calls.firstIndex(of: "put-doc:pk_1"))
        let file = try XCTUnwrap(client.calls.firstIndex(of: "del-file:\(blobOf("aa"))"))
        XCTAssertLessThan(doc, file)
    }

    func testFreesNothingTheCallerDidNotName() async throws {
        let (host, client) = fakePackHost()
        let index = try await pushPack(host, pack(["aa", "bb"]), latticeFor: lattices(["aa", "bb"])).index
        // A look dropped whose lattice another look shares: the index changes
        // and no byte moves.
        try await deleteRemoteLooks(host, withoutLooks(index, [index.looks[0].id]), [])
        XCTAssertEqual(client.files.count, 2)
    }
}

final class PackHostsTests: XCTestCase {
    /// Not in the web spec: an instance is offered only with a document bucket
    /// that lists `lutpack` AND the file bucket, in the connections' order.
    func testOffersOnlyAnInstanceWithBothBuckets() {
        let full = PackHostCandidate(sourceId: "a", documentsBucket: true, documentKinds: ["trip", "lutpack"],
                                     filesBucket: true, maxDocBytes: 1, maxFileBytes: 2)
        let noKind = PackHostCandidate(sourceId: "b", documentsBucket: true, documentKinds: ["trip"], filesBucket: true)
        let noFiles = PackHostCandidate(sourceId: "c", documentsBucket: true, documentKinds: ["lutpack"],
                                        filesBucket: false)
        let noDocs = PackHostCandidate(sourceId: "d", documentsBucket: false, documentKinds: ["lutpack"],
                                       filesBucket: true)
        let gone = PackHostCandidate(sourceId: "e", documentsBucket: true, documentKinds: ["lutpack"], filesBucket: true)
        XCTAssertTrue(canKeepPack(full))
        XCTAssertFalse(canKeepPack(noKind))
        XCTAssertFalse(canKeepPack(noFiles))
        XCTAssertFalse(canKeepPack(noDocs))
        let hosts = packHosts([noKind, full, noFiles, noDocs, gone]) { id in id == "e" ? nil : FakePackClient() }
        XCTAssertEqual(hosts.map(\.sourceId), ["a"])
        XCTAssertEqual(hosts[0].maxDocBytes, 1)
        XCTAssertEqual(hosts[0].maxFileBytes, 2)
        XCTAssertEqual(packHost("a", in: hosts)?.sourceId, "a")
        XCTAssertNil(packHost("b", in: hosts))
    }
}
