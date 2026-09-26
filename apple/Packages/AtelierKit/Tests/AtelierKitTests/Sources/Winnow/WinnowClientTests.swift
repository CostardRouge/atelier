// Port of `src/shared/sources/winnow/client.test.ts` — against a stub
// transport, as the web's run against a stub fetch — plus a few specs of the
// file bucket and of cancellation, which the web's file does not carry.

import Foundation
import XCTest
@testable import AtelierKit

private func ok(_ body: JSONValue) -> WinnowResponse { .json(body) }

private func clientWith(_ answer: @escaping @Sendable (WinnowRequest, Int) throws -> WinnowResponse) -> (WinnowClient, WinnowStub) {
    let stub = WinnowStub(answer)
    return (stub.client(), stub)
}

final class WinnowNormalizeBaseUrlTests: XCTestCase {
    func testKeepsTheOriginOnlyLowercasedNoTrailingSlash() throws {
        XCTAssertEqual(try normalizeBaseUrl(" https://Winnow.Example/ "), "https://winnow.example")
    }

    func testRefusesAPathOrAQueryAnInstanceIsAnOrigin() {
        for bad in ["https://winnow.example/library", "https://winnow.example/?x=1"] {
            XCTAssertThrowsError(try normalizeBaseUrl(bad)) { error in
                XCTAssertTrue((error as? WinnowAddressError)?.message.contains("origin only") == true, bad)
            }
        }
    }

    func testRefusesPlainHttpExceptOnLocalhost() throws {
        XCTAssertThrowsError(try normalizeBaseUrl("http://winnow.example")) { error in
            XCTAssertTrue((error as? WinnowAddressError)?.message.contains("https") == true)
        }
        XCTAssertEqual(try normalizeBaseUrl("http://localhost:3000"), "http://localhost:3000")
    }

    func testNamesASourceByItsHost() {
        XCTAssertEqual(sourceIdFor("https://winnow.steeve.website"), "winnow.steeve.website")
    }
}

final class WinnowClientURLTests: XCTestCase {
    private let c = WinnowStub(status: 500).client()

    func testBuildsTheFileRoutesWinnowActuallyServes() {
        XCTAssertEqual(c.thumbUrl(12), "\(winnowBase)/api/assets/12/thumb")
        XCTAssertEqual(c.proxyUrl(12), "\(winnowBase)/api/assets/12/proxy")
        XCTAssertEqual(c.originalUrl(12), "\(winnowBase)/api/assets/12/download")
        XCTAssertEqual(c.sidecarUrl(7), "\(winnowBase)/api/sidecars/7/download")
        XCTAssertEqual(c.loginUrl(), "\(winnowBase)/login")
        // A PAGE, not an API route: where "Open in Winnow" sends you.
        XCTAssertEqual(c.sessionUrl(31), "\(winnowBase)/sessions/31")
    }

    func testKeepsTheFirstThumbnailRequestPlainSoItStaysCacheable() {
        XCTAssertEqual(c.thumbRetryUrl(12, 0), "\(winnowBase)/api/assets/12/thumb")
        XCTAssertEqual(c.thumbRetryUrl(12, -1), "\(winnowBase)/api/assets/12/thumb")
    }

    func testAsksThePlainUrlAgainOnTheFirstRetryTheHealReplacedTheEntry() {
        XCTAssertEqual(c.thumbRetryUrl(12, 1), "\(winnowBase)/api/assets/12/thumb")
    }

    func testDiscriminatesTheLaterRetriesForARequestThatWasMerelyShed() {
        XCTAssertEqual(c.thumbRetryUrl(12, 2), "\(winnowBase)/api/assets/12/thumb?retry=2")
        XCTAssertEqual(c.thumbRetryUrl(12, 3), "\(winnowBase)/api/assets/12/thumb?retry=3")
    }

    func testDropsEmptyQueryValuesInsteadOfSendingUndefined() {
        XCTAssertEqual(c.url("/api/x", [("a", "1"), ("b", nil), ("c", nil), ("d", "")]), "\(winnowBase)/api/x?a=1")
    }
}

// MARK: - the timeline chapter

/// One chapter of `GET /api/assets/timeline`, exactly as Winnow's
/// `lib/timeline.ts` assembles it.
private let chapterWire: [String: JSONValue] = [
    "key": "2025-11-04T22:00:00.000Z",
    "name": "Kalbarri",
    "started_at": "2025-11-04T22:00:00.000Z",
    "ended_at": "2025-11-08T09:30:00.000Z",
    "count": 120,
    "places": ["Kalbarri", "Northampton"],
    "devices": ["DJI Mini 4 Pro"],
    "sessions": [["id": 3, "name": "nov-kalbarri"]],
    "tz_offset_hours": 8,
    "place_inferred": false,
    "ungeotagged": 4,
    "absorbed": 0,
    "override_id": nil,
    "place_label": nil,
    "place_lat": nil,
    "place_lon": nil,
    "break_id": nil,
    "cover_id": 9001,
    "sample_ids": [1, 2, 3],
]

private func wire(_ change: [String: JSONValue] = [:]) -> JSONValue {
    .object(chapterWire.merging(change) { _, new in new })
}

final class WinnowChapterFromWireTests: XCTestCase {
    func testReadsTheWireKeysWinnowReallySendsIntoAteliersOwnShape() {
        XCTAssertEqual(chapterFromWire(wire()), WinnowChapter(
            id: "2025-11-04T22:00:00.000Z",
            // Derived, so the name is only the dominant place: not a title.
            title: nil,
            // 22:00 UTC is already the 5th at UTC+8.
            startDate: "2025-11-05",
            endDate: "2025-11-08",
            places: [WinnowChapterPlace(name: "Kalbarri", region: nil, lat: nil, lon: nil)],
            revision: "2025-11-04T22:00:00.000Z|2025-11-08T09:30:00.000Z|120",
            assetCount: 120,
            photoCount: nil,
            videoCount: nil,
            coverId: 9001,
            tzOffsetHours: 8,
            placeInferred: false,
            authored: false
        ))
    }

    func testTurnsAnInstantIntoTheDayItWasLivedWithTheChaptersOwnOffset() {
        // 23:00 UTC on the 11th is the 12th in Perth.
        let perth = chapterFromWire(wire(["started_at": "2026-02-11T23:00:00Z"]))
        XCTAssertEqual(perth?.startDate, "2026-02-12")
        // With no position there is no offset to apply: UTC, and the nil says so.
        let nowhere = chapterFromWire(wire(["started_at": "2026-02-11T23:00:00Z", "tz_offset_hours": nil]))
        XCTAssertEqual(nowhere?.startDate, "2026-02-11")
        XCTAssertNil(nowhere?.tzOffsetHours)
    }

    func testCarriesOnePlaceWinnowOrdersThemByWeightAndARouteWouldBeInvented() {
        XCTAssertEqual(chapterFromWire(wire())?.places.map(\.name), ["Kalbarri"])
    }

    func testTakesAnAuthoredChapterAsADecisionItsTitleAndTheLocatedPlace() {
        let named = chapterFromWire(wire([
            "name": "The Red Centre",
            "override_id": 4,
            "places": ["Uluru"],
            "place_label": "Uluru-Kata Tjuta",
            "place_lat": -25.34,
            "place_lon": 131.03,
        ]))
        XCTAssertEqual(named?.authored, true)
        XCTAssertEqual(named?.title, "The Red Centre")
        XCTAssertEqual(named?.places, [WinnowChapterPlace(name: "Uluru-Kata Tjuta", region: nil, lat: -25.34, lon: 131.03)])
    }

    func testIsNilWithoutAKeyAndEmptyHandedButSoundWithNothingElse() {
        XCTAssertNil(chapterFromWire(["name": "x"]))
        XCTAssertNil(chapterFromWire(nil))
        XCTAssertNil(chapterFromWire(.null))
        XCTAssertEqual(chapterFromWire(["key": "a"]), WinnowChapter(
            id: "a", title: nil, startDate: nil, endDate: nil, places: [], revision: "||0", assetCount: 0,
            photoCount: nil, videoCount: nil, coverId: nil, tzOffsetHours: nil, placeInferred: false, authored: false
        ))
    }

    func testIsWhatTheRoadTripImportTakesUnchanged() {
        // The web pins this structurally against `TimelineChapter`, which the
        // kernel does not carry yet; the field it reads is pinned here, and the
        // hand-over is checked when `timeline-import.ts` is ported.
        let chapter = chapterFromWire(wire())
        XCTAssertEqual(chapter?.startDate, "2025-11-05")
    }

    func testOffersNoLegAnywhereWhileTheTimelineSwitchIsOff() {
        let caps = { (media: JSONValue) in readWinnowCapabilities(["media": media]) }
        XCTAssertFalse(timelineSyncEnabled)
        XCTAssertFalse(hasTimeline(caps(["timeline": true])))
        XCTAssertFalse(hasTimeline(caps([:])))
        XCTAssertFalse(hasTimeline(nil))
        XCTAssertFalse(hasTimeline(caps(["timeline": false])))
    }

    func testAsksForALegByItsCalendarDaysThereIsNoChapterFilter() throws {
        let days = try XCTUnwrap(chapterFromWire(wire()).flatMap(chapterDays))
        XCTAssertEqual(days.dateFrom, "2025-11-05")
        XCTAssertEqual(days.dateTo, "2025-11-08")
        XCTAssertNil(chapterFromWire(["key": "a"]).flatMap(chapterDays))
    }
}

// MARK: - requests

final class WinnowClientRequestTests: XCTestCase {
    func testSendsTheCookieSameSiteAndAsksForJSON() async throws {
        let (c, stub) = clientWith { _, _ in ok(["api": ["version": 1]]) }
        _ = try await c.capabilities()
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(req.url, "\(winnowBase)/api/capabilities")
        XCTAssertEqual(req.credentials, .include)
        XCTAssertEqual(req.header("accept"), "application/json")
    }

    func testSendsABearerTokenAndNoCookieInTokenMode() async throws {
        let stub = WinnowStub(json: [:])
        _ = try await stub.client(auth: .token("abc")).capabilities()
        let req = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(req.credentials, .omit)
        XCTAssertEqual(req.header("authorization"), "Bearer abc")
    }

    func testAsksTheCalendarAndTheDayListTheWayWinnowFilters() async throws {
        let (c, stub) = clientWith { _, _ in ok(["assets": [], "next_cursor": nil]) }
        _ = try await c.calendar("2025-07-01", "2025-07-31")
        _ = try await c.assets(AssetQuery(dateFrom: "2025-07-09", dateTo: "2025-07-09", cursor: "abc"))
        let reqs = stub.requests
        XCTAssertEqual(reqs[0].path, "/api/assets/calendar")
        XCTAssertEqual(reqs[0].queryDictionary, ["from": "2025-07-01", "to": "2025-07-31", "collapse": "1"])
        XCTAssertEqual(reqs[1].path, "/api/assets")
        XCTAssertEqual(reqs[1].queryDictionary, [
            "date_from": "2025-07-09",
            "date_to": "2025-07-09",
            "cursor": "abc",
            "limit": "200",
            "collapse": "1",
            "sort_dir": "asc",
        ])
    }

    func testCarriesTheSameFiltersToTheCalendarTheDayAndTheSessions() async throws {
        let (c, stub) = clientWith { _, _ in ok(["assets": [], "next_cursor": nil, "sessions": []]) }
        let filter = FilterQuery(mediaType: .video, ext: "mp4", device: "DJI Mini 4 Pro")
        _ = try await c.calendar("2025-07-01", "2025-07-31", filter)
        _ = try await c.assets(AssetQuery(sessionId: 9, filter: filter))
        _ = try await c.sessions(filter)
        let params = stub.requests.map(\.queryDictionary)
        for p in params {
            XCTAssertEqual(p["media_type"], "video")
            XCTAssertEqual(p["ext"], "mp4")
            XCTAssertEqual(p["device"], "DJI Mini 4 Pro")
        }
        XCTAssertEqual(params[1]["session_id"], "9")
        XCTAssertEqual(stub.requests[2].path, "/api/sessions")
        // A space in a value is sent the way `URLSearchParams` writes it.
        XCTAssertTrue(stub.requests[0].url.contains("device=DJI+Mini+4+Pro"))
    }

    func testSendsTheHalfOfTheLibraryAsWinnowsKindEverywhereTheFiltersGo() async throws {
        let (c, stub) = clientWith { _, _ in ok(["assets": [], "next_cursor": nil, "sessions": []]) }
        _ = try await c.calendar("2025-07-01", "2025-07-31", FilterQuery(half: .final))
        _ = try await c.assets(AssetQuery(dateFrom: "2025-07-09", dateTo: "2025-07-09", filter: FilterQuery(half: .incoming)))
        _ = try await c.assets(AssetQuery(dateFrom: "2025-07-09", dateTo: "2025-07-09"))
        let params = stub.requests.map(\.queryDictionary)
        XCTAssertEqual(params[0]["kind"], "final")
        XCTAssertEqual(params[1]["kind"], "incoming")
        // No half asked for is BOTH halves: the parameter must be absent, not empty.
        XCTAssertNil(params[2]["kind"])
    }

    func testCollapsesAnEmptySpanToNilAFilterMatchingNothingCrashedThePicker() async throws {
        let c = WinnowStub(json: ["days": [], "bounds": ["min": nil, "max": nil]]).client()
        let cal = try await c.calendar("2026-09-01", "2026-09-30")
        XCTAssertEqual(cal, WinnowCalendar(days: [], bounds: nil))
    }

    func testKeepsARealSpanAndSurvivesABodyMissingDaysOrBounds() async throws {
        let full = WinnowStub(json: [
            "days": [["date": "2025-07-09", "count": 3, "cover_id": 1]],
            "bounds": ["min": "2010-11-05", "max": "2026-08-15"],
        ]).client()
        let cal = try await full.calendar("2025-07-01", "2025-07-31")
        XCTAssertEqual(cal, WinnowCalendar(days: [WinnowCalendarDay(date: "2025-07-09", count: 3, coverId: 1)],
                                           bounds: CalendarBounds(min: "2010-11-05", max: "2026-08-15")))
        let empty = try await WinnowStub(json: [:]).client().calendar("2025-07-01", "2025-07-31")
        XCTAssertEqual(empty, WinnowCalendar(days: [], bounds: nil))
    }

    func testReadsTheFacetSliceItOffersToleratingAMissingKey() async throws {
        let c = WinnowStub(json: ["extensions": [["value": "hif", "count": 3]]]).client()
        let facets = try await c.facets()
        XCTAssertEqual(facets, WinnowFacets(mediaTypes: [], extensions: [ValueCount(value: "hif", count: 3)], devices: []))
    }

    func testFollowsNextCursorSoA300MediaDayIsNotShownTwoThirdsFull() async throws {
        let pages: [String: JSONValue] = [
            "": ["assets": [["id": 1], ["id": 2]], "next_cursor": "p2"],
            "p2": ["assets": [["id": 3]], "next_cursor": nil],
        ]
        let (c, stub) = clientWith { req, _ in ok(pages[req.queryValue("cursor") ?? ""] ?? [:]) }
        let rows = try await c.allAssets(AssetQuery(dateFrom: "2025-07-09", dateTo: "2025-07-09"))
        XCTAssertEqual(rows.map(\.id), [1, 2, 3])
        XCTAssertEqual(stub.requests.count, 2)
    }

    func testStopsAtTheCapEvenWhenTheServerKeepsOfferingACursor() async throws {
        let stub = WinnowStub(json: ["assets": [["id": 1], ["id": 2]], "next_cursor": "more"])
        let rows = try await stub.client().allAssets(AssetQuery(), cap: 3)
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(stub.requests.count, 2)
    }

    func testSendsAnExplicitIdSetTheWayWinnowsIntListReadsItCommaSeparated() async throws {
        let stub = WinnowStub(json: ["assets": [], "next_cursor": nil])
        _ = try await stub.client().assets(AssetQuery(ids: [42, 7]))
        XCTAssertEqual(stub.requests[0].queryValue("ids"), "42,7")
        // An empty set sends nothing — `ids=` would be "match nothing" server-side.
        _ = try await stub.client().assets(AssetQuery(ids: []))
        XCTAssertNil(stub.requests[1].queryValue("ids"))
    }

    func testReResolvesASetOfIdsInTheOrderAskedFetchingACollapsedAwayOneOnItsOwn() async throws {
        let (c, stub) = clientWith { req, _ in
            if req.path == "/api/assets" { return ok(["assets": [["id": 7]], "next_cursor": nil]) }
            if req.path == "/api/assets/42" { return ok(["asset": ["id": 42]]) }
            return WinnowResponse(status: 404)
        }
        let rows = try await c.assetsByIds([42, 7, 99])
        XCTAssertEqual(rows.map(\.id), [42, 7])
        XCTAssertEqual(stub.requests.map(\.path), ["/api/assets", "/api/assets/42", "/api/assets/99"])
    }

    func testReadsASingleAssetAsAssetAndA404AsGoneRatherThanAnError() async throws {
        let found = try await WinnowStub(json: ["asset": ["id": 3]]).client().asset(3)
        XCTAssertEqual(found, WinnowAssetRow(id: 3))
        let gone = try await WinnowStub(status: 404).client().asset(3)
        XCTAssertNil(gone)
        let broken = await winnowError { try await WinnowStub(status: 500).client().asset(3) }
        XCTAssertEqual(broken?.kind, .protocol)
        XCTAssertEqual(broken?.status, 500)
    }

    func testMaps401ToUnauthenticatedTheUserMustSignInOnTheInstance() async {
        let err = await winnowError { try await WinnowStub(status: 401).client().capabilities() }
        XCTAssertEqual(err?.kind, .unauthenticated)
        XCTAssertEqual(err?.status, 401)
    }

    func testMaps403ToForbidden404ToNotfoundAndOtherFailuresToProtocol() async {
        let forbidden = await winnowError { try await WinnowStub(status: 403).client().capabilities() }
        XCTAssertEqual(forbidden?.kind, .forbidden)
        let missing = await winnowError { try await WinnowStub(status: 404).client().capabilities() }
        XCTAssertEqual(missing?.kind, .notfound)
        XCTAssertEqual(missing?.status, 404)
        let broken = await winnowError { try await WinnowStub(status: 500).client().capabilities() }
        XCTAssertEqual(broken?.kind, .protocol)
        XCTAssertEqual(broken?.status, 500)
    }

    func testCarriesTheInstancesOwnReasonIntoTheMessageClamped() async {
        // What a pack push actually got: the status alone sent the maintainer
        // to the network tab.
        let refused = WinnowStub { _, _ in
            .json(["error": "the body does not hash to that id"], status: 400)
        }
        let err = await winnowError { try await refused.client().capabilities() }
        XCTAssertTrue(err?.message.contains("the body does not hash to that id") == true)
        XCTAssertEqual(err?.status, 400)

        // A proxy's HTML page, a bare body and a blank reason say nothing.
        func quiet(_ body: String, _ type: String = "text/html") async -> String? {
            let stub = WinnowStub(status: 502, headers: ["content-type": type], text: body)
            return await winnowError { try await stub.client().capabilities() }?.message
        }
        let html = await quiet("<html>Bad gateway</html>")
        XCTAssertEqual(html, "\(winnowBase)/api/capabilities answered 502.")
        let bare = await quiet("")
        XCTAssertEqual(bare, "\(winnowBase)/api/capabilities answered 502.")
        let blank = await quiet(#"{"error":"  "}"#, "application/json")
        XCTAssertEqual(blank, "\(winnowBase)/api/capabilities answered 502.")

        let long = WinnowStub { _, _ in
            WinnowResponse(status: 400, text: JSONValue.object(["error": .string(String(repeating: "x", count: 400))]).serialized())
        }
        let longErr = await winnowError { try await long.client().capabilities() }
        XCTAssertLessThan(longErr?.message.count ?? 999, 260)
    }

    func testMapsAThrownFetchCORSRefusalOfflineBadHostToUnreachable() async {
        let stub = WinnowStub { _, _ in throw WinnowFetchFailed() }
        let err = await winnowThrown { try await stub.client().capabilities() }
        let winnow = err as? WinnowError
        XCTAssertNotNil(winnow)
        XCTAssertEqual(winnow?.kind, .unreachable)
        XCTAssertTrue(winnow?.message.contains(winnowBase) == true)
    }

    func testRejectsA200ThatIsNotJSONAsAProtocolError() async {
        let err = await winnowError { try await WinnowStub(status: 200, text: "<html>").client().capabilities() }
        XCTAssertEqual(err?.kind, .protocol)
    }

    func testKnowsAViewerCannotWriteBack() {
        let caps = { (role: String?) in
            readWinnowCapabilities(["viewer": role.map { ["id": 1, "username": "x", "role": .string($0)] } ?? .null])
        }
        XCTAssertTrue(canWriteBack(caps("admin")))
        XCTAssertTrue(canWriteBack(caps("editor")))
        XCTAssertFalse(canWriteBack(caps("viewer")))
        XCTAssertFalse(canWriteBack(caps(nil)))
        XCTAssertFalse(canWriteBack(nil))
    }

    func testTurnsABodyIntoAFileWithTheNameTypeAndDateItWasTold() async throws {
        let c = WinnowStub { _, _ in WinnowResponse(status: 200, body: Data([1, 2, 3])) }.client()
        let file = try await c.fetchFile(c.proxyUrl(1), name: "DJI_0001.mp4", type: "video/mp4", lastModified: 1234)
        XCTAssertEqual(file.name, "DJI_0001.mp4")
        XCTAssertEqual(file.type, "video/mp4")
        XCTAssertEqual(file.size, 3)
        XCTAssertEqual(file.lastModified, 1234)
    }
}

// MARK: - a read that throws is asked again past the cache

final class WinnowClientReplayTests: XCTestCase {
    func testReplaysItWithCacheReloadAndTheAnswerStands() async throws {
        let stub = WinnowStub { _, index in
            if index == 0 { throw WinnowFetchFailed() }
            return .json(["api": ["version": 1]])
        }
        let caps = try await stub.client().capabilities()
        XCTAssertEqual(caps.api?.version, 1)
        XCTAssertEqual(stub.requests.map(\.reloadCache), [false, true])
    }

    func testSaysSoWhenEvenThatFailsSoAReportIsNotAmbiguous() async {
        let stub = WinnowStub { _, _ in throw WinnowFetchFailed() }
        let err = await winnowError { try await stub.client().capabilities() }
        XCTAssertEqual(err?.kind, .unreachable)
        XCTAssertTrue(err?.message.contains("past this browser") == true)
    }

    func testNeverReplaysAWriteItMayHaveLanded() async {
        let stub = WinnowStub { _, _ in throw WinnowFetchFailed() }
        let err = await winnowError { try await stub.client().reconcile() }
        XCTAssertEqual(err?.kind, .unreachable)
        XCTAssertEqual(stub.requests.count, 1)
    }

    func testDoesNotReplayAnAnswerA401IsNotACacheToBypass() async {
        let stub = WinnowStub(status: 401)
        let err = await winnowError { try await stub.client().capabilities() }
        XCTAssertEqual(err?.kind, .unauthenticated)
        XCTAssertEqual(stub.requests.count, 1)
    }

    func testRethrowsACancellationUntouchedAndNeverAsksAgain() async {
        // The person's own doing (the web's AbortError): never `unreachable`,
        // never replayed.
        let stub = WinnowStub { _, _ in throw CancellationError() }
        let err = await winnowThrown { try await stub.client().capabilities() }
        XCTAssertTrue(err is CancellationError)
        XCTAssertEqual(stub.requests.count, 1)
    }
}

final class WinnowClientHealTests: XCTestCase {
    func testAsksPastTheCacheWithTheInstancesCredentials() throws {
        throw XCTSkip("`heal` is `cache-heal.ts` — replacing a browser cache entry stored without its CORS headers; the app's transport owns its cache")
    }
}

// MARK: - the document bucket

private let docRow: JSONValue = [
    "id": "t1", "kind": "trip", "version": 10, "updated_at": "2026-09-06T10:00:00Z", "etag": "e1", "doc": ["name": "A"],
]

private let docRowRead = WinnowDocRow(id: "t1", kind: "trip", version: 10, updatedAt: "2026-09-06T10:00:00Z", etag: "e1",
                                      doc: ["name": "A"])

final class WinnowDocumentBucketTests: XCTestCase {
    func testListsOneKindUnderTheAppNamespaceWithTheCookie() async throws {
        let stub = WinnowStub(json: ["docs": [docRow]])
        let docs = try await stub.client().listDocs("atelier", "trip")
        XCTAssertEqual(docs, [docRowRead])
        let req = stub.requests[0]
        XCTAssertEqual(req.path, "/api/apps/atelier/docs")
        XCTAssertEqual(req.queryValue("kind"), "trip")
        XCTAssertEqual(req.credentials, .include)
    }

    func testListsNothingWhenTheBodyHasNoDocs() async throws {
        let docs = try await WinnowStub(json: [:]).client().listDocs("atelier", "trip")
        XCTAssertEqual(docs, [])
    }

    func testGetsARowAndTrustsTheETagHeaderOverTheBody() async throws {
        let stub = WinnowStub { _, _ in WinnowResponse(status: 200, headers: ["etag": "\"e2\""], text: docRow.serialized()) }
        let r = try await stub.client().getDoc("atelier", "t1", ifNoneMatch: "\"e1\"")
        var expected = docRowRead
        expected.etag = "\"e2\""
        XCTAssertEqual(r, .row(expected))
        XCTAssertEqual(stub.requests[0].path, "/api/apps/atelier/docs/t1")
        XCTAssertEqual(stub.requests[0].header("if-none-match"), "\"e1\"")
    }

    func testSendsNoIfNoneMatchWhenItHoldsNoEtag() async throws {
        let stub = WinnowStub(json: docRow)
        _ = try await stub.client().getDoc("atelier", "t1")
        XCTAssertNil(stub.requests[0].header("if-none-match"))
    }

    func testReadsA304AsOursIsCurrentNothingDownloaded() async throws {
        let r = try await WinnowStub(status: 304).client().getDoc("atelier", "t1", ifNoneMatch: "e1")
        XCTAssertEqual(r, .notModified)
    }

    func testARowThatIsNotOursIsNotfoundNeverForbidden() async {
        let stub = WinnowStub(status: 404, text: #"{"error":"Not found"}"#)
        let err = await winnowError { try await stub.client().getDoc("atelier", "someone-elses") }
        XCTAssertEqual(err?.kind, .notfound)
    }

    func testPUTsJSONWithIfMatchAndReturnsTheAcknowledgedRevision() async throws {
        let stub = WinnowStub { _, _ in
            WinnowResponse(status: 200, headers: ["etag": "e2"],
                           text: #"{"etag":"e2","updated_at":"2026-09-06T10:01:00Z"}"#)
        }
        let r = try await stub.client().putDoc("atelier", "t1", DocBody(kind: "trip", version: 10, doc: ["name": "A"]),
                                               ifMatch: "e1")
        XCTAssertEqual(r, PutDocResult(etag: "e2", updatedAt: "2026-09-06T10:01:00Z"))
        let req = stub.requests[0]
        XCTAssertEqual(req.method, "PUT")
        XCTAssertEqual(req.header("if-match"), "e1")
        XCTAssertEqual(req.header("content-type"), "application/json")
        guard case .text(let text)? = req.body else { return XCTFail("a JSON text body") }
        XCTAssertEqual(JSONValue.parse(text), ["kind": "trip", "version": 10, "doc": ["name": "A"]])
    }

    func testAFirstPushCarriesNoIfMatchTheServerRefusesIfARowExists() async throws {
        let stub = WinnowStub(json: ["etag": "e1", "updated_at": "x"])
        _ = try await stub.client().putDoc("atelier", "t1", DocBody(kind: "trip", version: 10, doc: [:]), ifMatch: nil)
        XCTAssertNil(stub.requests[0].header("if-match"))
    }

    func testMapsA412ToConflictCarryingTheServersRevision() async {
        let stub = WinnowStub(status: 412, text: #"{"error":"stale","etag":"e9","updated_at":"2026-09-06T14:02:00Z"}"#)
        let err = await winnowError {
            try await stub.client().putDoc("atelier", "t1", DocBody(kind: "trip", version: 10, doc: [:]), ifMatch: "e1")
        }
        XCTAssertEqual(err?.kind, .conflict)
        XCTAssertEqual(err?.status, 412)
        XCTAssertEqual(err?.theirs, ConflictInfo(etag: "e9", updatedAt: "2026-09-06T14:02:00Z"))
    }

    func testRefusesAnOversizeBodyBEFOREAnyBytesTravel() async {
        let stub = WinnowStub(json: [:])
        let big = DocBody(kind: "trip", version: 10, doc: ["pad": .string(String(repeating: "x", count: 2000))])
        let err = await winnowError { try await stub.client().putDoc("atelier", "t1", big, ifMatch: nil, maxBytes: 1024) }
        XCTAssertEqual(err?.kind, .protocol)
        XCTAssertEqual(err?.status, 413)
        XCTAssertEqual(stub.requests.count, 0)
    }

    func testMapsTheServersOwn413ToProtocol() async {
        let err = await winnowError {
            try await WinnowStub(status: 413).client().putDoc("atelier", "t1", DocBody(kind: "trip", version: 10, doc: [:]),
                                                              ifMatch: nil)
        }
        XCTAssertEqual(err?.kind, .protocol)
        XCTAssertEqual(err?.status, 413)
    }

    func testAPUTAcknowledgedWithoutAnEtagIsAProtocolErrorNothingToGuardTheNextWriteWith() async {
        let err = await winnowError {
            try await WinnowStub(json: ["updated_at": "x"]).client().putDoc(
                "atelier", "t1", DocBody(kind: "trip", version: 10, doc: [:]), ifMatch: nil)
        }
        XCTAssertEqual(err?.kind, .protocol)
    }

    func testDELETEsWithIfMatchARowAlreadyGoneIsNotfound() async throws {
        let stub = WinnowStub(status: 204)
        try await stub.client().deleteDoc("atelier", "t1", ifMatch: "e1")
        let req = stub.requests[0]
        XCTAssertEqual(req.method, "DELETE")
        XCTAssertEqual(req.path, "/api/apps/atelier/docs/t1")
        XCTAssertEqual(req.header("if-match"), "e1")
        let err = await winnowError { try await WinnowStub(status: 404).client().deleteDoc("atelier", "t1", ifMatch: "e1") }
        XCTAssertEqual(err?.kind, .notfound)
    }

    func testStampsAnAcknowledgementThatNamesNoTimeWithTheClientsOwnClock() async throws {
        // The web reads `new Date().toISOString()` there; the clock is injected.
        let stub = WinnowStub(json: ["etag": "e1"])
        let c = stub.client(now: { 1_757_152_860_000 })
        let r = try await c.putDoc("atelier", "t1", DocBody(kind: "trip", version: 10, doc: [:]), ifMatch: nil)
        XCTAssertEqual(r.updatedAt, "2025-09-06T10:01:00.000Z")
    }
}

// MARK: - geo days, the timeline, finals

final class WinnowClientGeoAndTimelineTests: XCTestCase {
    func testAsksForOnePositionPerDayAndNeverNarrowsToWhatIsAlreadyPlaced() async throws {
        let stub = WinnowStub(json: ["days": []])
        _ = try await stub.client().geoDays(DaySpan(from: "2025-11-02", to: "2026-02-11"))
        let req = stub.requests[0]
        XCTAssertEqual(req.path, "/api/assets/geo")
        // `has_gps` would drop the DECLARED GAPS: the whole query is pinned.
        XCTAssertEqual(req.queryDictionary, ["date_from": "2025-11-02", "date_to": "2026-02-11", "by": "day"])
    }

    func testHandsTheDayRowsOnAsTheInstanceSentThem() async throws {
        let stub = WinnowStub(json: ["days": [
            ["date": "2025-11-02", "lat": -31.95, "lon": 115.86, "count": 120, "measured": 40, "source": "measured"],
            ["date": "2025-11-03", "lat": nil, "lon": nil, "count": 84, "measured": 0, "source": nil],
        ]])
        let days = try await stub.client().geoDays(DaySpan(from: "2025-11-02", to: "2025-11-03"))
        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days[1].date, "2025-11-03")
        XCTAssertNil(days[1].lat)
        XCTAssertNil(days[1].source)
        XCTAssertEqual(days[0], WinnowGeoDay(date: "2025-11-02", lat: -31.95, lon: 115.86, count: 120, measured: 40,
                                             source: .measured))
    }

    func testAsksTheRealTimelineRouteUnderTheSameFilters() async throws {
        let stub = WinnowStub(json: ["chapters": []])
        _ = try await stub.client().timeline(FilterQuery(mediaType: .video))
        XCTAssertEqual(stub.requests[0].path, "/api/assets/timeline")
        XCTAssertEqual(stub.requests[0].queryDictionary, ["media_type": "video"])
    }

    func testDropsAChapterItCannotReadRatherThanHalfShowingIt() async throws {
        let stub = WinnowStub(json: ["chapters": [["key": "2026-02-12T00:00:00Z"], ["name": "no key"], "junk"]])
        let chapters = try await stub.client().timeline()
        XCTAssertEqual(chapters.map(\.id), ["2026-02-12T00:00:00Z"])
    }

    func testReadsAChapterAsWinnowReallySendsOneKeyInstantsDominantPlace() async throws {
        let stub = WinnowStub(json: ["chapters": [[
            "key": "2026-02-11T23:10:00.000Z",
            "name": "Kalbarri",
            "started_at": "2026-02-11T23:10:00.000Z",
            "ended_at": "2026-02-14T08:00:00.000Z",
            "count": 214,
            "places": ["Kalbarri", "Northampton"],
            "tz_offset_hours": 8,
            "place_inferred": false,
            "override_id": nil,
            "cover_id": 91,
        ]]])
        let chapters = try await stub.client().timeline()
        let ch = try XCTUnwrap(chapters.first)
        // 23:10 UTC is already the 12th where the photographer stood.
        XCTAssertEqual(ch.startDate, "2026-02-12")
        XCTAssertEqual(ch.endDate, "2026-02-14")
        XCTAssertEqual(ch.tzOffsetHours, 8)
        XCTAssertNil(ch.title)
        XCTAssertFalse(ch.authored)
        XCTAssertEqual(ch.places, [WinnowChapterPlace(name: "Kalbarri", region: nil, lat: nil, lon: nil)])
        XCTAssertEqual(ch.assetCount, 214)
        XCTAssertNil(ch.photoCount)
        XCTAssertEqual(ch.coverId, 91)
        XCTAssertEqual(ch.revision, "2026-02-11T23:10:00.000Z|2026-02-14T08:00:00.000Z|214")
    }

    func testTakesAHumanNamedChapterAsATitleWithTheLocationTheyChose() async throws {
        let stub = WinnowStub(json: ["chapters": [[
            "key": "k",
            "name": "The Red Centre",
            "started_at": "2026-03-01T02:00:00.000Z",
            "ended_at": "2026-03-02T02:00:00.000Z",
            "count": 12,
            "places": ["Uluru"],
            "place_label": "Uluru-Kata Tjuta",
            "place_lat": -25.34,
            "place_lon": 131.03,
            "tz_offset_hours": 9,
            "override_id": 4,
        ]]])
        let chapters = try await stub.client().timeline()
        let ch = try XCTUnwrap(chapters.first)
        XCTAssertTrue(ch.authored)
        XCTAssertEqual(ch.title, "The Red Centre")
        XCTAssertEqual(ch.places, [WinnowChapterPlace(name: "Uluru-Kata Tjuta", region: nil, lat: -25.34, lon: 131.03)])
    }

    func testReadsAChapterWithNoPositionAtUTCAndSaysTheOffsetIsUnknown() async throws {
        let stub = WinnowStub(json: ["chapters": [[
            "key": "k",
            "started_at": "2026-02-11T23:10:00.000Z",
            "ended_at": "2026-02-11T23:40:00.000Z",
            "count": 3,
            "places": ["Kalbarri"],
            "tz_offset_hours": nil,
            "place_inferred": true,
        ]]])
        let chapters = try await stub.client().timeline()
        let ch = try XCTUnwrap(chapters.first)
        XCTAssertNil(ch.tzOffsetHours)
        XCTAssertEqual(ch.startDate, "2026-02-11")
        XCTAssertTrue(ch.placeInferred)
    }

    func testUploadsFinalsAsMultipartFilesPlusParallelPathsWithTheCaptureIdAlongside() async throws {
        let stub = WinnowStub(json: ["staged": 2])
        let answer = try await stub.client().upload(
            [
                UploadItem(name: "a.mp4", contents: .data(Data(count: 3)), path: "7/a.mp4"),
                UploadItem(name: "b.mp4", contents: .data(Data(count: 4)), path: "7/b.mp4"),
            ],
            UploadOptions(originalAssetId: 42, chapterId: "7")
        )
        XCTAssertEqual(answer, ["staged": 2])
        let req = stub.requests[0]
        XCTAssertEqual(req.url, "\(winnowBase)/api/upload")
        XCTAssertEqual(req.method, "POST")
        XCTAssertEqual(req.credentials, .include)
        guard case .form(let parts)? = req.body else { return XCTFail("a multipart body") }
        var files: [String] = []
        var fields: [String: [String]] = [:]
        for part in parts {
            switch part {
            case .file(let name, let filename, _): if name == "files" { files.append(filename) }
            case .field(let name, let value): fields[name, default: []].append(value)
            }
        }
        XCTAssertEqual(files, ["a.mp4", "b.mp4"])
        XCTAssertEqual(fields["paths"], ["7/a.mp4", "7/b.mp4"])
        XCTAssertEqual(fields["original_asset_id"], ["42"])
        XCTAssertEqual(fields["chapter_id"], ["7"])
    }

    func testSendsNoCaptureIdOrChapterItDoesNotHave() async throws {
        let stub = WinnowStub(status: 204)
        let answer = try await stub.client().upload([UploadItem(name: "a.mp4", contents: .data(Data()), path: "a.mp4")])
        XCTAssertNil(answer)
        guard case .form(let parts)? = stub.requests[0].body else { return XCTFail("a multipart body") }
        let names = parts.compactMap { part -> String? in
            if case .field(let name, _) = part { return name }
            return nil
        }
        XCTAssertFalse(names.contains("original_asset_id"))
        XCTAssertFalse(names.contains("chapter_id"))
    }

    func testReconcilesWithAnEmptyJSONBody() async throws {
        let stub = WinnowStub(json: ["linked": 1])
        let answer = try await stub.client().reconcile()
        XCTAssertEqual(answer, ["linked": 1])
        let req = stub.requests[0]
        XCTAssertEqual(req.url, "\(winnowBase)/api/reconcile")
        XCTAssertEqual(req.method, "POST")
        XCTAssertEqual(req.body, .text("{}"))
    }
}

// MARK: - bucketHolds

final class WinnowBucketHoldsTests: XCTestCase {
    private func withDocs(_ documents: JSONValue) -> WinnowCapabilities {
        readWinnowCapabilities(["documents": documents])
    }

    func testKeepsOnlyTheKindsItsBucketLists() {
        let caps = withDocs(["bucket": true, "kinds": ["trip", "project", "roll"]])
        XCTAssertTrue(bucketHolds(caps, "roll"))
        XCTAssertFalse(bucketHolds(caps, "presets"))
    }

    func testReadsABucketThatPredatesTheListAsTheFirstTwoKinds() {
        let caps = withDocs(["bucket": true])
        XCTAssertTrue(bucketHolds(caps, "trip"))
        XCTAssertTrue(bucketHolds(caps, "project"))
        XCTAssertFalse(bucketHolds(caps, "roll"))
    }

    func testKeepsNothingWithoutABucketOrCapabilities() {
        XCTAssertFalse(bucketHolds(withDocs(["bucket": false, "kinds": ["roll"]]), "roll"))
        XCTAssertFalse(bucketHolds(nil, "trip"))
    }
}

// MARK: - beyond the web's file: the file bucket, the head, a connection

final class WinnowFileBucketTests: XCTestCase {
    func testListsTheBlobsItHoldsIdsAndSizesNeverBytes() async throws {
        let stub = WinnowStub(json: [
            "files": [["id": "abc", "bytes": 12, "mediaType": "application/octet-stream", "createdAt": "2026-09-20T00:00:00Z"]],
            "used": 12, "quota": 536_870_912,
        ])
        let list = try await stub.client().listAppFiles("atelier")
        XCTAssertEqual(stub.requests[0].path, "/api/apps/atelier/files")
        XCTAssertEqual(list, AppFileList(files: [AppFileRow(id: "abc", bytes: 12, mediaType: "application/octet-stream",
                                                            createdAt: "2026-09-20T00:00:00Z")],
                                         used: 12, quota: 536_870_912, maxBytes: nil))
    }

    func testReadsAHashThisAccountDoesNotHoldAsNilNotAFailure() async throws {
        let missing = try await WinnowStub(status: 404).client().getAppFile("atelier", "abc")
        XCTAssertNil(missing)
        let held = try await WinnowStub { _, _ in WinnowResponse(status: 200, body: Data([9, 8])) }.client()
            .getAppFile("atelier", "abc")
        XCTAssertEqual(held, Data([9, 8]))
    }

    func testRefusesALookOverTheCapBeforeSendingAndPutsUnderItsHash() async throws {
        let stub = WinnowStub(json: ["created": true])
        let err = await winnowError { try await stub.client().putAppFile("atelier", "abc", Data(count: 10), maxBytes: 4) }
        XCTAssertEqual(err?.status, 413)
        XCTAssertTrue(err?.message.hasPrefix("This look is 10 B") == true)
        XCTAssertEqual(stub.requests.count, 0)
        let created = try await stub.client().putAppFile("atelier", "abc", Data(count: 3))
        XCTAssertTrue(created)
        let req = stub.requests[0]
        XCTAssertEqual(req.method, "PUT")
        XCTAssertEqual(req.path, "/api/apps/atelier/files/abc")
        XCTAssertEqual(req.header("content-type"), "application/octet-stream")
        XCTAssertEqual(req.body, .bytes(Data(count: 3)))
    }

    func testAsksForAHeadPolitelyAndKeepsOnlyTheBytesAskedFor() async throws {
        let stub = WinnowStub { _, _ in WinnowResponse(status: 200, body: Data(repeating: 7, count: 10)) }
        let c = stub.client()
        let head = try await c.fetchHead(c.originalUrl(42), bytes: 4)
        XCTAssertEqual(head, Data(repeating: 7, count: 4))
        let req = stub.requests[0]
        XCTAssertEqual(req.path, "/api/assets/42/download")
        XCTAssertEqual(req.header("range"), "bytes=0-3")
        XCTAssertEqual(req.maxBodyBytes, 4)
    }

    func testEncodesAnIdIntoItsPathTheWayEncodeURIComponentDoes() async throws {
        let stub = WinnowStub(status: 204)
        try await stub.client().deleteDoc("atelier", "a b/c", ifMatch: nil)
        XCTAssertEqual(stub.requests[0].path, "/api/apps/atelier/docs/a%20b%2Fc")
    }

    func testMirrorsAConnectionIntoTheSourceRegistryAsTheStoreDoes() {
        let caps = readWinnowCapabilities(["documents": ["bucket": true], "scheduling": ["reminders": false]])
        let info = toSourceInfo(WinnowConnection(id: "winnow.example", baseUrl: winnowBase, capabilities: caps, connectedAt: 1))
        XCTAssertEqual(info, SourceInfo(id: "winnow.example", label: "winnow.example", kind: .winnow,
                                        capabilities: SourceCapabilities(media: true, documents: true, scheduling: false)))
        let bare = toSourceInfo(WinnowConnection(id: "w", baseUrl: "https://w", connectedAt: 1))
        XCTAssertFalse(bare.capabilities.documents)
    }
}
