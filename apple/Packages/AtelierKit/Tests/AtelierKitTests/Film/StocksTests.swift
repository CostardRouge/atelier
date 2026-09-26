// Port of `src/shared/film/stocks.test.ts`. The web's `it.each` over the
// stocks is a loop here, each assertion naming its stock.

import XCTest
@testable import AtelierKit

private let midCode = fromLinear(midGrey, .srgb)
private func codes(_ v: Double) -> Double { v * 255 }
private func lum(_ p: RGB) -> Double { 0.2126 * p.0 + 0.7152 * p.1 + 0.0722 * p.2 }
private func chroma(_ p: RGB) -> Double { max(p.0, p.1, p.2) - min(p.0, p.1, p.2) }

final class FilmStocksTests: XCTestCase {
    func testHaveUniqueIdsAndScreenNamesAndEveryOneIsFoundById() {
        let ids = Set(filmStocks.map(\.id))
        let names = Set(filmStocks.map(\.name))
        XCTAssertEqual(ids.count, filmStocks.count)
        XCTAssertEqual(names.count, filmStocks.count)
        for s in filmStocks {
            XCTAssertEqual(filmStock(s.id), s)
            XCTAssertEqual(filmStock(s.id.rawValue), s)
        }
        XCTAssertNil(filmStock("velvia"))
    }

    func testEachIsExposureNeutralMidGreyKeepsItsLuminanceWithinACode() {
        for stock in filmStocks {
            let stage = filmStage(stock.response)
            let out = stage(midCode, midCode, midCode)
            let y = fromLinear(lum((pow(out.0, 2.2), pow(out.1, 2.2), pow(out.2, 2.2))), .gamma22)
            XCTAssertLessThan(abs(codes(y) - codes(midCode)), 1.5, stock.id.rawValue)
        }
    }

    func testEachButCrossProcessKeepsMidGreyCloseToNeutralInHue() {
        for stock in filmStocks where stock.id != .crossProcess {
            let stage = filmStage(stock.response)
            let out = stage(midCode, midCode, midCode)
            XCTAssertLessThan(codes(chroma(out)), 2.5, stock.id.rawValue)
        }
    }

    func testCrossProcessBreaksNeutralityOnPurpose() {
        let stage = filmStage(filmStock(.crossProcess)!.response)
        XCTAssertGreaterThan(codes(chroma(stage(midCode, midCode, midCode))), 2.5)
    }

    func testEachSurvivesTheLayerTextUnchangedEveryNumberIsInsideItsRange() {
        for stock in filmStocks {
            XCTAssertEqual(normaliseResponse(stock.response.json), stock.response, stock.id.rawValue)
            let settings = filmSettingsFor(stock.id)
            XCTAssertEqual(readFilmSettings(writeFilmSettings(settings)), settings, stock.id.rawValue)
        }
    }

    func testEachIsMonotoneInLuminanceAlongTheGreyRampAndNeverNaNs() {
        for stock in filmStocks {
            var prev = -1.0
            for i in 0...64 {
                let v = Double(i) / 64
                let out = filmLinear((v, v, v), stock.response)
                let y = lum(out)
                XCTAssertTrue(y.isFinite, stock.id.rawValue)
                XCTAssertGreaterThanOrEqual(y, prev - 1e-9, stock.id.rawValue)
                prev = y
            }
        }
    }

    func testEachDeclaresATextureEveryNumberOfWhichIsInsideItsRange() {
        for stock in filmStocks {
            XCTAssertEqual(normaliseFilmTexture(stock.texture.json), stock.texture, stock.id.rawValue)
            XCTAssertFalse(isSilentTexture(stock.texture), stock.id.rawValue)
        }
    }

    func testTheNegativesPrintTheReversalsDoNot() {
        for s in filmStocks {
            let negative = s.id.rawValue.hasPrefix("negative") || s.id.rawValue.hasPrefix("mono")
            XCTAssertEqual(s.response.print, negative, s.id.rawValue)
        }
    }

    func testNegativePortraitCrossesOverCoolShadowsWarmHighlights() {
        let r = filmStock(.negativePortrait)!.response
        let dark = filmLinear((0.015, 0.015, 0.015), r)
        let light = filmLinear((0.6, 0.6, 0.6), r)
        XCTAssertGreaterThan(dark.2, dark.0)
        XCTAssertGreaterThan(light.0, light.2)
    }

    func testCrossProcessCrossesTheOtherWayCyanShadowsYellowHighlights() {
        let r = filmStock(.crossProcess)!.response
        let dark = filmLinear((0.02, 0.02, 0.02), r)
        let light = filmLinear((0.55, 0.55, 0.55), r)
        XCTAssertGreaterThan(dark.2, dark.0)
        XCTAssertLessThan(light.2, light.1)
    }

    func testReversalVividHoldsMoreChromaOnASaturatedRedThanNegativePortrait() {
        let red: RGB = (0.7, 0.08, 0.06)
        let vivid = filmLinear(red, filmStock(.reversalVivid)!.response)
        let portrait = filmLinear(red, filmStock(.negativePortrait)!.response)
        XCTAssertGreaterThan(chroma(vivid) / lum(vivid), chroma(portrait) / lum(portrait))
    }

    func testMonochromeRendersOneValueOnEveryChannelAndAnOrangeFilterDarkensABlueSky() {
        let r = filmStock(.monoPanchromatic)!.response
        let sky = filmLinear((0.25, 0.4, 0.7), r)
        let skin = filmLinear((0.6, 0.4, 0.3), r)
        assertClose(sky.0, sky.1, 9)
        assertClose(sky.1, sky.2, 9)
        XCTAssertGreaterThan(lum(skin), lum(sky))
    }

    func testThePrintStocksHandACleanWhiteBack() {
        for s in filmStocks where s.response.print {
            XCTAssertGreaterThan(filmStage(s.response)(1, 1, 1).1, 0.995, s.id.rawValue)
        }
    }
}

final class FilmSettingsOverAStockTests: XCTestCase {
    func testSeedsACopySoADialNeverEditsTheRegistry() {
        var s = filmSettingsFor(.negativePortrait)
        s.response.dye = 99
        XCTAssertEqual(filmStock(.negativePortrait)!.response.dye, -5)
    }

    func testKnowsWhetherTheSettingsAreStillOnTheirStock() {
        var s = filmSettingsFor(.reversalVivid)
        XCTAssertTrue(onStock(s))
        s.response.curve.g.gamma += 0.05
        XCTAssertFalse(onStock(s))
    }

    func testDescribesTheStockItsDepartureOrAStockThisBuildLost() {
        var s = filmSettingsFor(.reversalNeutral)
        XCTAssertEqual(describeFilm(s), "Reversal · neutral")
        s.response.inhibition = 90
        XCTAssertEqual(describeFilm(s), "Reversal · neutral · adjusted")
        XCTAssertEqual(describeFilm(FilmSettings(stock: "gone", response: s.response)), "Film · adjusted")
    }

    func testTextureOfIsTheStocksOwnAndTheDefaultForAStockThisBuildDoesNotKnow() {
        XCTAssertEqual(textureOf("negative-portrait"), filmStock(.negativePortrait)!.texture)
        XCTAssertEqual(textureOf("gone"), defaultFilmTexture)
        XCTAssertEqual(filmGroupLabel, "FILM")
    }
}
