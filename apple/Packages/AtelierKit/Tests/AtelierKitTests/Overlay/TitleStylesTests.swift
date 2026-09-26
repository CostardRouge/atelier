// Port of `src/shared/overlay/title-styles.test.ts`, plus the theme's JSON round trip.

import Foundation
import XCTest
@testable import AtelierKit

private func baseStyle(_ change: (inout TitleStyle) -> Void = { _ in }) -> TitleStyle {
    var s = TitleStyle(
        fontFamily: .spaceGrotesk, weight: 600, italic: false, uppercase: false, letterSpacingEm: 0, color: "#ffffff",
        sizeScale: 1, legibility: LegibilityStyle(mode: .shadow, color: "rgba(0,0,0,0.65)", padFrac: 0.3),
        glowAmount: 0, glowWarmth: 0.5
    )
    change(&s)
    return s
}

final class TitleStylePresetsTests: XCTestCase {
    func testHaveUniqueIdsAndOnlyCuratedFonts() {
        let ids = titleStylePresets.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        for p in titleStylePresets {
            XCTAssertTrue(curatedFonts.contains(p.style.fontFamily), p.id)
        }
    }

    func testIncludeTheThreeSignatureLooksPlusNeutral() {
        for id in ["neutral", "or-cine", "pixel-crt", "plein-cadre"] {
            XCTAssertNotNil(presetById(id), id)
        }
    }

    func testThemeFromPresetCopiesSoTweaksNeverTouchThePreset() throws {
        var theme = try XCTUnwrap(themeFromPreset("or-cine"))
        theme.style.color = "#000000"
        XCTAssertNotEqual(try XCTUnwrap(presetById("or-cine")).style.color, "#000000")
    }
}

final class GlowLayersForTests: XCTestCase {
    func testIsFullyOffAtAmount0() {
        let g = glowLayersFor(baseStyle { $0.glowAmount = 0 })
        XCTAssertEqual(g.haloAlpha, 0)
        XCTAssertEqual(g.bleedRadiusFrac, 0)
        XCTAssertEqual(g.grainAlpha, 0)
    }

    func testGrowsEveryLayerWithTheAmount() {
        let low = glowLayersFor(baseStyle { $0.glowAmount = 0.2 })
        let high = glowLayersFor(baseStyle { $0.glowAmount = 0.9 })
        XCTAssertGreaterThan(high.bleedRadiusFrac, low.bleedRadiusFrac)
        XCTAssertGreaterThan(high.haloRadiusFrac, low.haloRadiusFrac)
        XCTAssertGreaterThan(high.grainAlpha, low.grainAlpha)
    }

    func testLetsTheAdvancedPerLayerOverrideWin() {
        let g = glowLayersFor(baseStyle { $0.glowAmount = 0.5; $0.glowLayers = GlowLayerOverrides(bleedRadiusFrac: 2) })
        XCTAssertEqual(g.bleedRadiusFrac, 2)
        XCTAssertGreaterThan(g.haloRadiusFrac, 0) // others still derived
    }
}

final class ColourHelpersTests: XCTestCase {
    func testParsesShortAndLongHex() {
        XCTAssertEqual(hexToRgb("#fff"), [255, 255, 255])
        XCTAssertEqual(hexToRgb("#f01d0e"), [240, 29, 14])
        XCTAssertNil(hexToRgb("not-a-colour"))
    }

    func testWarmDriftCollapsesBlueAndNeverExceedsChannelBounds() {
        let rgb = warmDrift("#f01d0e", 1)
        XCTAssertLessThan(rgb[2], 14)
        XCTAssertGreaterThanOrEqual(rgb[0], 240)
        XCTAssertLessThanOrEqual(rgb[1], 255)
        // zero warmth = identity
        XCTAssertEqual(warmDrift("#f01d0e", 0), [240, 29, 14])
    }

    // Beyond the web spec: the two `rgba()` writers print alphas as JS does.
    func testWritesRgbaTheWayTheWebDoes() {
        XCTAssertEqual(withAlpha("#f01d0e", 0.5), "rgba(240,29,14,0.5)")
        XCTAssertEqual(withAlpha("nope", 1), "rgba(255,255,255,1)")
        XCTAssertEqual(halolight("#000000", 0.25), "rgba(140,140,140,0.25)")
    }
}

final class ResolveElementStyleTests: XCTestCase {
    func testWithoutAThemeUsesTheElementExactlyAsBeforeThemesExisted() {
        var el = createTextElement("hello")
        el.color = "#123456"
        let st = resolveElementStyle(el, nil)
        XCTAssertEqual(st.color, "#123456")
        XCTAssertEqual(st.sizeFrac, el.sizeFrac)
        XCTAssertNil(st.glow)
        XCTAssertFalse(st.uppercase)
    }

    func testUnderAThemeAnElementWithNoOverridesIsFullyThemed() throws {
        let theme = try XCTUnwrap(themeFromPreset("pixel-crt"))
        let st = resolveElementStyle(createTextElement("hello"), theme)
        XCTAssertEqual(st.fontFamily, .vt323)
        XCTAssertEqual(st.color, theme.style.color)
        XCTAssertNotNil(st.glow)
    }

    func testAnOverriddenKeyKeepsTheElementValueOthersStayThemed() throws {
        let theme = try XCTUnwrap(themeFromPreset("pixel-crt"))
        var el = createTextElement("hello")
        el.color = "#00ff00"
        el.styleOverrides = ["color"]
        let st = resolveElementStyle(el, theme)
        XCTAssertEqual(st.color, "#00ff00")
        XCTAssertEqual(st.fontFamily, .vt323)
    }

    func testTheThemeSizeIsAMultiplierOverTheElementSizeNeverAbsolute() throws {
        let theme = try XCTUnwrap(themeFromPreset("pixel-crt")) // sizeScale 1.15
        var el = createTextElement("hello")
        el.sizeFrac = 0.04
        assertClose(resolveElementStyle(el, theme).sizeFrac, 0.04 * 1.15, 6)
    }

    func testUppercaseAndLetterSpacingResolveFromTheTheme() throws {
        let theme = try XCTUnwrap(themeFromPreset("plein-cadre"))
        let st = resolveElementStyle(createTextElement("hello"), theme)
        XCTAssertTrue(st.uppercase)
        assertClose(st.letterSpacingEm, -0.01, 6)
    }

    func testAGlowOverrideAt0KillsTheThemeGlowForThatElement() throws {
        let theme = try XCTUnwrap(themeFromPreset("pixel-crt"))
        var el = createTextElement("hello")
        el.styleOverrides = ["glow"]
        el.glowAmount = 0
        XCTAssertNil(resolveElementStyle(el, theme).glow)
    }
}

final class StyleThemeJSONTests: XCTestCase {
    func testRoundTripsAThemeWithItsAdvancedLayers() throws {
        var theme = try XCTUnwrap(themeFromPreset("or-cine"))
        theme.style.glowLayers = GlowLayerOverrides(haloAlpha: 0.9)
        let back = try XCTUnwrap(readStyleTheme(theme.json))
        XCTAssertEqual(back, theme)
        XCTAssertEqual(theme.json.objectValue?["style"]?.objectValue?["fontFamily"], "Instrument Serif")
        XCTAssertNil(readStyleTheme(["presetId": "neutral"]))
    }
}
