// The Itinerary's variant (`src/shared/roadtrip/hooks/map.tsx`'s non-UI half)
// has no web spec of its own; these pin what it declares and what `prepare`
// hands back — the rules its header names.

import XCTest
@testable import AtelierKit

private let itineraryContent = BadgeContent(label: "Day", headline: "12", caption: "Western Australia")

private func itineraryCtx(_ stages: [HookStage]? = nil) -> HookContext {
    HookContext(aspect: 9.0 / 16, durationSeconds: 4, date: "2025-03-12", content: itineraryContent, stages: stages)
}

private let itineraryStops: [MapStop] = [
    MapStop(id: "a", name: "Perth", lat: -31.95, lon: 115.86),
    MapStop(id: "b", name: " ", lat: -27.71, lon: 114.16),
    MapStop(id: "c", name: "Coral Bay", lat: -23.14, lon: 113.77),
]

private func itineraryOptions(_ change: (inout MapOptions) -> Void = { _ in }) -> HookOptions {
    var o = MapOptions.defaults
    o.stops = itineraryStops
    change(&o)
    return o.json.objectValue ?? [:]
}

final class MapVariantDeclarationTests: XCTestCase {
    func testIsRegisteredAfterDefileAndVireeInThePickersOrder() {
        XCTAssertEqual(hookVariantById("map")?.name, "Itinerary")
        XCTAssertEqual(hookVariants.last?.id, "map")
    }

    func testMayReplaceThePictureAndKeepsItsStopsOutOfAHouseStyle() {
        XCTAssertEqual(mapVariant.owns, .frame)
        XCTAssertEqual(mapVariant.contentKeys, ["stops"])
        XCTAssertEqual(mapVariant.needs, HookNeeds(stages: true, places: true, media: .day))
        XCTAssertEqual(mapOptions(mapVariant.defaults), MapOptions.defaults)
    }

    func testIsNeverUnmetAnEmptyItineraryIsNotARefusal() {
        XCTAssertNil(hookUnmet(mapVariant, itineraryCtx()))
    }
}

final class MapVariantPrepareTests: XCTestCase {
    func testPlaysNothingWithNoStop() {
        let render = mapVariant.prepare(MapOptions.defaults.json.objectValue ?? [:], itineraryCtx())
        XCTAssertEqual(render.seconds, 0)
        XCTAssertNil(render.drawing)
    }

    func testLastsAsLongAsItsClockAndDrawsTheSamePlan() {
        let options = itineraryOptions()
        let render = mapVariant.prepare(options, itineraryCtx())
        let o = mapOptions(options)
        let timing = mapTiming(planarHops(o.stops), o)
        XCTAssertEqual(render.seconds, timing.total)
        let drawing = render.drawing as? MapDrawing
        XCTAssertEqual(drawing?.timing, timing)
        XCTAssertEqual(drawing?.context, [])
    }

    func testNamesTheStopThePenIsAtAndLeavesTheCaptionAloneOnANamelessOne() {
        let render = mapVariant.prepare(itineraryOptions { $0.nameInBadge = true }, itineraryCtx())
        guard let drawing = render.drawing as? MapDrawing, let content = render.content else {
            return XCTFail("the caption follows the pen")
        }
        let arrivals = drawing.timing.arrivals
        XCTAssertEqual(content(0), [.caption: .text("Perth")])
        XCTAssertEqual(content(arrivals[1] + 0.01), [:])
        XCTAssertEqual(content(arrivals[2]), [.caption: .text("Coral Bay")])
        XCTAssertEqual(content(99), [.caption: .text("Coral Bay")])
        XCTAssertNil(mapVariant.prepare(itineraryOptions(), itineraryCtx()).content)
    }

    func testTicksOnlyWhileItDrawsAndMixesOnlyWhenAsked() {
        let sounding = mapVariant.prepare(itineraryOptions { $0.sound = true }, itineraryCtx())
        XCTAssertEqual(sounding.score?().count, 3)
        XCTAssertFalse(sounding.mixWithSource)
        let still = mapVariant.prepare(itineraryOptions { $0.sound = true; $0.draw = false }, itineraryCtx())
        XCTAssertNil(still.score)
        XCTAssertEqual(still.seconds, 0)
        let mixed = mapVariant.prepare(itineraryOptions { $0.sound = true; $0.mixWithClip = true }, itineraryCtx())
        XCTAssertTrue(mixed.mixWithSource)
    }

    func testHandsTheTripsOtherPlacesToTheContextLayerOnlyWhenAsked() {
        let stages = [HookStage(startDate: "2025-03-01", endDate: "2025-03-20", places: [
            HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
            HookStagePlace(name: "Exmouth", lat: -21.93, lon: 114.12),
        ])]
        let off = mapVariant.prepare(itineraryOptions(), itineraryCtx(stages)).drawing as? MapDrawing
        XCTAssertEqual(off?.context, [])
        let on = mapVariant.prepare(itineraryOptions { $0.context = true }, itineraryCtx(stages)).drawing as? MapDrawing
        XCTAssertEqual(on?.context.map(\.name), ["Exmouth"])
    }
}

final class MapVariantStageTests: XCTestCase {
    private let frame = FrameBox(width: 1080, height: 1920)

    func testCanBeGrabbedOnlyOnceItHasAStopAndThenByTheMapsOwnBox() {
        XCTAssertNil(mapVariant.frameBox?(MapOptions.defaults.json.objectValue ?? [:], itineraryCtx(), frame))
        let options = itineraryOptions()
        XCTAssertEqual(mapVariant.frameBox?(options, itineraryCtx(), frame), mapBox(1080, 1920, mapOptions(options)))
    }

    func testADragMovesTheMapAndKeepsEverythingElse() {
        let options = itineraryOptions()
        guard let moved = mapVariant.moveBy?(options, 0.1, -0.05) else { return XCTFail("the map can be moved") }
        let o = mapOptions(moved)
        assertClose(o.offsetX, 0.1, 9)
        assertClose(o.offsetY, -0.05, 9)
        XCTAssertEqual(o.stops, itineraryStops)
    }

    func testAsksForTheStopsPicturesOnceEachAndNoneWithThePicturesOff() {
        let picture = HookPickedPicture(ref: SavedMediaRef(name: "one.jpg", size: 1, lastModified: 0), date: "2025-03-04")
        let options = itineraryOptions { $0.stops[0].picture = picture; $0.stops[2].picture = picture }
        XCTAssertEqual(mapVariant.wantsPictures?(options, itineraryCtx()).map(\.ref.name), ["one.jpg"])
        let off = itineraryOptions { $0.stops[0].picture = picture; $0.media = .off }
        XCTAssertEqual(mapVariant.wantsPictures?(off, itineraryCtx()), [])
    }
}
