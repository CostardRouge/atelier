// `src/shared/overlay/camera-plate.ts`: every case of `camera-plate.test.ts`
// — `readPlateSpec` and `cameraWordsOf` (`CameraPlateStoredTests`, with the
// words as a trip STORES them), the runs of every layout
// (`CameraPlateRunsTests`) and the elements on a frame
// (`CameraPlateElementsTests`).

import XCTest
@testable import AtelierKit

final class CameraPlateStoredTests: XCTestCase {
    func testReadPlateSpecLandsJunkOnTheDefaultsFieldByField() {
        XCTAssertEqual(readPlateSpec(nil), defaultPlateSpec())
        XCTAssertEqual(
            readPlateSpec(["fields": ["iso", "nope", "iso"], "layout": "poster", "place": "middle", "size": 9]),
            CameraPlateSpec(fields: [.iso], layout: .line, place: .badge, size: 1.8)
        )
        let placed = readPlateSpec(["place": "top-left", "layout": "ledger"])
        XCTAssertEqual(placed.place, .cell(.topLeft))
        XCTAssertEqual(placed.layout, .ledger)
    }

    func testCameraWordsOfFillsEveryBlankWordWithTheEnglishDefault() {
        XCTAssertEqual(cameraWordsOf(nil), defaultCameraWords)
        XCTAssertEqual(cameraWordsOf(CameraWords(shotOn: "  ", tags: [.iso: ""])), defaultCameraWords)
    }

    func testAStoredSetOfWordsKeepsWhatWasTypedBlanksIncluded() throws {
        let words = try XCTUnwrap(readCameraWords(["shotOn": "Pris au", "tags": ["iso": "", "lens": "Objectif"]]))
        XCTAssertEqual(words.tags[.iso], "")
        XCTAssertEqual(words.tags[.lens], "Objectif")
        XCTAssertEqual(words.tags[.body], "Camera")
        XCTAssertEqual(cameraWordsOf(words).tags[.iso], "ISO")
        XCTAssertNil(readCameraWords(nil))
    }

    func testTheSpecAndTheWordsWriteWhatTheyRead() {
        let spec = CameraPlateSpec(fields: [.body, .aperture], layout: .bar, place: .cell(.bottomCenter), size: 1.2)
        XCTAssertEqual(readPlateSpec(spec.json), spec)
        XCTAssertEqual(readCameraWords(frenchCameraWords.json), frenchCameraWords)
    }
}

// MARK: - the runs and the elements (the rest of camera-plate.test.ts)

/// The web spec's `DJI`: a drone still, no lens, a zero compensation.
let plateDji = ExifData(make: "DJI", model: "FC8482", iso: 100, exposureTime: 1.0 / 240, fNumber: 1.7,
                        focalLength: 6.72, focalLength35: 24, exposureBias: 0, relativeAltitude: 118)

/// The web spec's `SONY`: a body and a lens, −0.3 EV.
let plateSony = ExifData(make: "SONY", model: "ILCE-7CM2", lensModel: "FE 24-70mm F2.8 GM II", iso: 200,
                         exposureTime: 1.0 / 500, fNumber: 4, focalLength: 35, focalLength35: 35, exposureBias: -0.3)

private let allFields = CameraPlateSpec(fields: [.body, .lens, .focal35, .aperture, .shutter, .iso, .ev, .altitude],
                                        layout: .line, place: .badge, size: 1)

private func spec(_ change: (inout CameraPlateSpec) -> Void) -> CameraPlateSpec {
    var s = allFields
    change(&s)
    return s
}

/// A run's horizontal extent in U, relative to the plate's reference, when it is mono.
private func extent(_ r: PlateRun) -> (Double, Double) {
    let w = monoWidth(r.text, r.size, r.letterSpacingEm ?? 0)
    switch r.align {
    case .left: return (r.x, r.x + w)
    case .right: return (r.x - w, r.x)
    case .center: return (r.x - w / 2, r.x + w / 2)
    }
}

final class CameraPlateRunsTests: XCTestCase {
    func testIsAbsentWhenNoneOfTheChosenFieldsIsRecordedNeverABlankPlate() {
        for layout in plateLayouts {
            XCTAssertNil(plateRuns(cameraFacts(ExifData()), spec { $0.layout = layout.id }, defaultCameraWords, .left))
        }
        XCTAssertNil(plateRuns(cameraFacts(plateDji), spec { $0.fields = [.lens] }, defaultCameraWords, .left))
    }

    func testSetsTheLineAsOneRunTheFactsJoinedInTheChosenOrder() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.fields = [.iso, .aperture] }, defaultCameraWords, .right))
        XCTAssertEqual(p.runs.count, 1)
        XCTAssertEqual(p.runs[0].text, "ISO 200 · ƒ/4")
        XCTAssertEqual(p.runs[0].align, .right)
        XCTAssertEqual(p.runs[0].x, 0)
        XCTAssertEqual(p.runs[0].size, 1)
        XCTAssertEqual(p.height, 1)
    }

    func testDrawsSomethingForEveryLayoutOverARealPicture() throws {
        for layout in plateLayouts {
            let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = layout.id }, defaultCameraWords, .left))
            XCTAssertGreaterThan(p.runs.count, 0)
            XCTAssertGreaterThan(p.height, 0)
            for r in p.runs { XCTAssertFalse(r.text.trimmingCharacters(in: .whitespaces).isEmpty) }
        }
    }

    func testNeverLetsAPlatesColumnsTouchWhateverTheAlignment() throws {
        for align in PlateAlign.allCases {
            let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .plate }, defaultCameraWords, align))
            let values = p.runs.filter { $0.font == .mono && $0.size == 1.5 }.map(extent)
            for i in 1..<values.count { XCTAssertGreaterThan(values[i].0, values[i - 1].1) }
        }
    }

    func testEndsARightAlignedPlateOnItsReferenceAndStartsALeftOneThere() throws {
        let right = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .ledger }, defaultCameraWords, .right))
        let left = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .ledger }, defaultCameraWords, .left))
        assertClose(right.runs.map { extent($0).1 }.max()!, 0, 9)
        assertClose(left.runs.map { extent($0).0 }.min()!, 0, 9)
    }

    func testKeepsALedgersLabelsClearOfItsValuesOnEveryRow() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .ledger }, defaultCameraWords, .left))
        for i in stride(from: 0, to: p.runs.count, by: 2) {
            XCTAssertLessThan(extent(p.runs[i]).1, extent(p.runs[i + 1]).0)
        }
    }

    func testLabelsWithTheTripsOwnWords() throws {
        var tags = defaultCameraWords.tags
        tags[.aperture] = "Ouverture"
        let words = cameraWordsOf(CameraWords(shotOn: "", tags: tags))
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .ledger; $0.fields = [.aperture] }, words, .left))
        XCTAssertEqual(p.runs[0].text, "OUVERTURE")
        var french = words
        french.shotOn = "Pris au"
        let caption = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .caption; $0.fields = [.body, .iso] },
                                              french, .left))
        XCTAssertEqual(caption.runs[0].text, "Pris au SONY ILCE-7CM2")
        XCTAssertEqual(caption.runs[0].font, .serif)
        XCTAssertEqual(caption.runs[0].italic, true)
    }

    func testShowsAViewfinderTheExposureOnlyAndItsMeterEvenAtZero() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateDji), spec { $0.layout = .viewfinder }, defaultCameraWords, .left))
        let texts = p.runs.map(\.text)
        XCTAssertTrue(texts.contains("F1.7"))
        XCTAssertTrue(texts.contains("ISO100"))
        XCTAssertFalse(texts.contains { $0.contains("DJI") })
        let marker = try XCTUnwrap(p.runs.first { $0.text == "▲" })
        let scale = try XCTUnwrap(p.runs.first { $0.text.hasPrefix("−") })
        // Zero sits under the middle tick of the scale.
        assertClose(marker.x, scale.x + (1 + 6 + 0.5) * 0.6 * scale.size, 9)
    }

    func testPutsTheMeterWhereTheCameraWasArguedWith() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .viewfinder }, defaultCameraWords, .left))
        let marker = try XCTUnwrap(p.runs.first { $0.text == "▲" })
        let scale = try XCTUnwrap(p.runs.first { $0.text.hasPrefix("−") })
        // −0.3 EV is one third below zero: tick 5.
        assertClose(marker.x, scale.x + (1 + 5 + 0.5) * 0.6 * scale.size, 9)
    }

    func testBindsAnEdgeBarToTheTopOrBottomWhateverItWasPlacedAs() throws {
        let bottom = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .bar; $0.place = .badge }, defaultCameraWords, .left))
        XCTAssertEqual(bottom.edge, .bottom)
        let top = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .bar; $0.place = .cell(.topLeft) },
                                          defaultCameraWords, .left))
        XCTAssertEqual(top.edge, .top)
        XCTAssertEqual(top.runs.map(\.frameX), [0.05, 0.95])
    }

    func testSetsAnEdgeBarOnTwoLinesRatherThanLetItsEndsMeet() throws {
        let wide = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .bar }, defaultCameraWords, .left, 200))
        XCTAssertEqual(wide.height, 1)
        XCTAssertEqual(Set(wide.runs.map(\.y)).count, 2) // one line, the mono run nudged to its baseline
        let narrow = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .bar }, defaultCameraWords, .left, 30))
        XCTAssertGreaterThan(narrow.height, 2)
        XCTAssertEqual(narrow.runs.map(\.frameX), [0.05, 0.05])
        XCTAssertGreaterThan(narrow.runs[1].y, narrow.runs[0].y + 1)
    }

    func testRunsAMarginDownTheSideTheCellNamesTheRightByDefault() throws {
        let left = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .margin; $0.place = .cell(.topLeft) },
                                           defaultCameraWords, .center))
        XCTAssertEqual(left.edge, .left)
        XCTAssertEqual(left.place, .cell(.topLeft))
        XCTAssertTrue(left.runs.allSatisfy { $0.align == .left })
        let dflt = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .margin }, defaultCameraWords, .left))
        XCTAssertEqual(dflt.edge, .right)
        XCTAssertEqual(dflt.place, .cell(.centerRight))
    }
}

final class CameraPlateElementsTests: XCTestCase {
    func testPinsTheFacesAColumnDependsOnAndLeavesTheThemeTheRest() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .plate }, defaultCameraWords, .left))
        let els = plateElements(p, PlateOrigin(x: 0.1, top: 0.5), 0.02, 4.0 / 5, "piece:exif")
        let mono = els.filter { $0.fontFamily == .jetBrainsMono }
        XCTAssertGreaterThan(mono.count, 0)
        for e in mono {
            XCTAssertTrue(e.styleOverrides?.contains("fontFamily") == true)
            XCTAssertTrue(e.styleOverrides?.contains("letterSpacing") == true)
        }
        XCTAssertFalse(els[0].styleOverrides?.contains("fontFamily") == true)
        XCTAssertEqual(els.map(\.id), els.indices.map { $0 == 0 ? "piece:exif" : "piece:exif:\($0)" })
    }

    func testMeasuresAcrossInTheWidthAndDownInTheHeightOnAnyAspect() {
        let run = PlateRun(text: "x", x: 10, y: 10, size: 1, align: .left, font: .theme)
        let plate = PlateRuns(runs: [run], height: 1, place: .badge, edge: nil)
        let portrait = plateElements(plate, PlateOrigin(x: 0, top: 0), 0.01, 9.0 / 16, "p")[0]
        let landscape = plateElements(plate, PlateOrigin(x: 0, top: 0), 0.01, 16.0 / 9, "p")[0]
        // 0.1 of the shorter side: the width on a portrait frame, the height on a landscape one.
        assertClose(portrait.x, 0.1, 9)
        assertClose(portrait.y, 0.1 * (9.0 / 16), 9)
        assertClose(landscape.x, 0.1 * (9.0 / 16), 9)
        assertClose(landscape.y, 0.1, 9)
    }

    func testGridOriginHangsAPlateFromItsCellsColumnAndRowInsideTheFrame() throws {
        let p = try XCTUnwrap(plateRuns(cameraFacts(plateSony), spec { $0.layout = .tiers; $0.place = .cell(.bottomRight) },
                                        defaultCameraWords, .right))
        let o = gridOrigin(p, 0.02, 4.0 / 5)
        XCTAssertEqual(o.align, .right)
        assertClose(o.x, 0.93, 9)
        XCTAssertLessThan(o.top, 0.92)
        XCTAssertGreaterThan(o.top, 0.5)
    }
}
