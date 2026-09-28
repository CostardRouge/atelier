// What a roll keeps on, and reads from, a Winnow — against the stub instance
// of `SourcesStubs.swift`, extended with one asset:
//
// - a new roll kept on an instance is written THERE first, and nothing is
//   kept here when the instance refuses it;
// - a move goes through the portable file, so the pictures get fresh ids —
//   and the locator this device keeps under a picture's id follows it;
// - a picture of the roll is fetched from the id its ref names, as its proxy,
//   vouched for with the ORIGINAL's identity; an id the instance no longer
//   holds is no file at all;
// - a file fetched for the session is read as the picture's bytes and never
//   becomes a locator, so nothing of it outlives the session;
// - the preset book moves onto an instance only by the gesture, and a stale
//   write there is merged by name and pushed again — never shown.

import AtelierKit
import Foundation
import XCTest
@testable import Atelier

/// Asset 7 as the instance lists it: a DJI photograph, its hash, its size.
private func assetSeven() -> JSONValue {
    [
        "id": 7, "filename": "DJI_0101.JPG", "ext": "jpg", "media_type": "photo", "content_hash": "abc",
        "width": 4032, "height": 3024, "file_size": 9_000_000, "iso": 100,
    ]
}

/// A develop worth saving as a preset.
private func presetLight(_ exposure: Double) -> DevelopSettings {
    var settings = DevelopSettings.default
    settings.exposure = exposure
    return settings
}

final class RollWinnowTests: XCTestCase {
    // XCTest makes a fresh instance per case, so these are each case's own.
    private let bucket = StubDocBucket()
    private let root = sourcesScratch()
    /// What the stub serves as asset 7's proxy.
    private let proxyBytes = Data("RIFF stand-in for a WebP".utf8)

    /// The stub bucket, answering asset 7 and its proxy besides; any other
    /// asset is a 404, as the bucket answers every path it does not keep.
    private func instance() -> WinnowTransport {
        let bucket = self.bucket
        let proxy = proxyBytes
        return { request in
            switch request.path {
            case "/api/assets/7":
                return .json(["asset": assetSeven()])
            case "/api/assets/7/proxy":
                return WinnowResponse(status: 200, headers: ["content-type": "image/webp"], body: proxy)
            default:
                return try await bucket.transport(request)
            }
        }
    }

    @MainActor private func connected() async -> ConnectionStore {
        let connections = ConnectionStore(root: root, credentials: MemoryCredentials(), transport: instance())
        _ = await connections.connect(address: "https://w.example", token: "tok")
        return connections
    }

    @MainActor private func makeDocuments() async -> RollDocuments {
        let connections = await connected()
        return RollDocuments(rolls: RollStore(root: root), connections: connections)
    }

    // MARK: - rolls kept there

    @MainActor func testANewRollKeptOnAnInstanceIsWrittenThereFirst() async throws {
        let documents = await makeDocuments()
        XCTAssertTrue(documents.documentSources.contains { $0.id == "w.example" })
        let created = await documents.create(name: "Kalbarri", sourceId: "w.example", ticked: [])
        let made = try XCTUnwrap(created)
        XCTAssertEqual(made.sourceId, "w.example")
        XCTAssertEqual(bucket.rows[made.id]?.kind, "roll")
        XCTAssertEqual(bucket.rows[made.id]?.doc, made.wireDoc)
        XCTAssertEqual(documents.rolls.roll(made.id), made, "the editor's store holds the mirror")
        XCTAssertEqual(documents.documents.getSyncRecord(made.id)?.status, .synced)
    }

    @MainActor func testARefusedCreationKeepsNothingHere() async {
        let documents = await makeDocuments()
        bucket.refuseWrites = true
        let created = await documents.create(name: "Kalbarri", sourceId: "w.example", ticked: [])
        XCTAssertNil(created)
        XCTAssertTrue(documents.rolls.rolls.isEmpty)
        XCTAssertTrue(documents.gallery.notice?.hasSuffix("nothing was created.") ?? false,
                      documents.gallery.notice ?? "no sentence")
    }

    @MainActor func testAMoveGivesFreshPictureIdsAndTheLocatorFollowsThem() async throws {
        let documents = await makeDocuments()
        let doc = documents.rolls.create(name: "Here")
        guard case .added(let oldId) = documents.rolls.addPicture(to: doc.id, data: Data("jpeg".utf8), name: "IMG_1.JPG") else {
            return XCTFail("the picture is added")
        }
        let local = try XCTUnwrap(documents.rolls.roll(doc.id))
        await documents.move(local, to: "w.example")

        let moved = try XCTUnwrap(documents.rolls.roll(doc.id))
        XCTAssertEqual(moved.sourceId, "w.example")
        XCTAssertNotNil(bucket.rows[doc.id], "the target was written")
        let newId = try XCTUnwrap(moved.pictures.first?.id)
        XCTAssertNotEqual(newId, oldId, "through the portable file: a fresh picture id")
        XCTAssertNotNil(documents.rolls.locator(doc.id, newId), "what this device keeps under the id follows it")
        XCTAssertNil(documents.rolls.locator(doc.id, oldId))
    }

    // MARK: - pictures fetched from there

    @MainActor func testAPictureIsFetchedAsItsProxyVouchedForWithTheOriginal() async throws {
        let connections = await connected()
        let ref = SavedMediaRef(name: "DJI_0101.webp", size: 0, lastModified: 0, assetId: "w.example/7", hash: "abc")
        let answer = try await RollWinnow.fetchStill(ref, connections: connections, scope: nil)
        let fetched = try XCTUnwrap(answer)
        XCTAssertEqual(try Data(contentsOf: fetched.url), proxyBytes)
        XCTAssertEqual(fetched.url.lastPathComponent, "DJI_0101.webp")
        XCTAssertTrue(fetched.owned, "a file the roll wrote is the roll's to delete")
        XCTAssertEqual(fetched.identity.assetId, "w.example/7")
        XCTAssertEqual(fetched.identity.hash, "abc")
        XCTAssertEqual(fetched.identity.origin?.fidelity, .proxy)
        XCTAssertEqual(fetched.identity.origin?.name, "DJI_0101.JPG", "the CAPTURE's name, never the proxy's")
        XCTAssertTrue(fetched.identity.originalUrl?.hasSuffix("/api/assets/7/download") ?? false)
    }

    @MainActor func testAnIdTheInstanceNoLongerHoldsIsNoFile() async throws {
        let connections = await connected()
        let gone = SavedMediaRef(name: "DJI_0102.webp", size: 0, lastModified: 0, assetId: "w.example/8", hash: nil)
        let answer = try await RollWinnow.fetchStill(gone, connections: connections, scope: nil)
        XCTAssertNil(answer)
        let elsewhere = SavedMediaRef(name: "DJI_0103.webp", size: 0, lastModified: 0, assetId: "other.example/7", hash: nil)
        let unasked = try await RollWinnow.fetchStill(elsewhere, connections: connections, scope: nil)
        XCTAssertNil(unasked, "an instance nobody connected is never asked")
    }

    @MainActor func testAFileFetchedForTheSessionIsReadButNeverBecomesALocator() throws {
        let rolls = RollStore(root: root)
        let doc = rolls.create(name: "Roll")
        let ref = SavedMediaRef(name: "DJI_0101.webp", size: 0, lastModified: 0, assetId: "w.example/7", hash: "abc")
        guard case .added(let id) = rolls.addRef(to: doc.id, ref) else { return XCTFail("the ref is added") }
        let picture = try XCTUnwrap(rolls.roll(doc.id)?.pictures.first)
        XCTAssertNil(rolls.bytesSource(doc.id, id))
        XCTAssertEqual(rolls.availability(doc.id, picture), .unconnected(sourceId: "w.example"))

        let file = sourcesScratch().appendingPathComponent("DJI_0101.webp")
        try proxyBytes.write(to: file)
        rolls.holdSession(doc.id, [id], file)
        XCTAssertEqual(rolls.availability(doc.id, picture), .ready)
        guard case .file(let url)? = rolls.bytesSource(doc.id, id) else { return XCTFail("read from the session file") }
        XCTAssertEqual(try RollStore.bytes(of: .file(url), mediaDirectory: rolls.mediaDirectory), proxyBytes)
        XCTAssertNil(rolls.locator(doc.id, id), "a fetched file is never a locator")

        rolls.flush()
        let reopened = RollStore(root: root)
        XCTAssertNil(reopened.bytesSource(doc.id, id), "nothing of the session outlives it")
        XCTAssertEqual(rolls.releaseSession(doc.id, [id]), [file])
    }

    // MARK: - the preset book there

    /// The stub's sheet, its bucket keeping preset books too.
    private func keepPresets() {
        bucket.sheet = [
            "api": ["version": 1],
            "documents": ["bucket": true, "kinds": ["trip", "project", "roll", "presets"]],
            "viewer": ["id": 1, "username": "steeve", "role": "admin"],
        ]
    }

    @MainActor func testTheBookMovesOntoAnInstanceByTheGestureAlone() async throws {
        keepPresets()
        let connections = await connected()
        let presets = PresetBookStore(root: sourcesScratch(), connections: connections)
        XCTAssertTrue(presets.save(name: "Warm", settings: presetLight(0.5)))
        XCTAssertEqual(presets.keptOn, "on this device")
        XCTAssertNil(presets.status())
        XCTAssertTrue(bucket.requests("PUT").isEmpty, "a book kept here writes nowhere")
        XCTAssertTrue(presets.sources.contains { $0.id == "w.example" })

        let problem = await presets.keepOn("w.example")
        XCTAssertNil(problem)
        XCTAssertEqual(presets.keptOn, "on w.example")
        XCTAssertEqual(presets.record?.status, .synced)
        let row = try XCTUnwrap(bucket.rows[presets.book.id])
        XCTAssertEqual(row.kind, presetBookKind)
        let there = try bookFromWire(row.doc, presets.book.id, "w.example")
        XCTAssertEqual(there.presets.map(\.name), ["Warm"])
    }

    @MainActor func testAStaleWriteOfTheBookIsMergedByNameNeverShown() async throws {
        keepPresets()
        let connections = await connected()
        let presets = PresetBookStore(root: sourcesScratch(), connections: connections)
        presets.save(name: "Warm", settings: presetLight(0.5))
        _ = await presets.keepOn("w.example")
        let bookId = presets.book.id

        // Another device saved "Cold" there meanwhile.
        let theirs = savePresetInBook(presets.book, "Cold", presetLight(-0.5), "their-preset")
        bucket.changeElsewhere(bookId, bookToWire(theirs))

        presets.save(name: "Dusk", settings: presetLight(-1))
        XCTAssertEqual(presets.record?.status, .dirty)
        await presets.pushBook(force: true)

        XCTAssertEqual(presets.record?.status, .synced, "a list of names always merges: no conflict is handed to a person")
        XCTAssertEqual(presets.presets.map(\.name), ["Warm", "Cold", "Dusk"], "the server's order, ours appended")
        let stored = try XCTUnwrap(bucket.rows[bookId]?.doc)
        let there = try bookFromWire(stored, bookId, "w.example")
        XCTAssertEqual(there.presets.map(\.name), ["Warm", "Cold", "Dusk"])
        XCTAssertEqual(bucket.requests("PUT").last?.header("If-Match"), "\"e2\"",
                       "pushed again over the revision it merged")
    }
}
