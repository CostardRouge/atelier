// Port of `src/shared/roadtrip/hook-scene.test.ts` — every case: the badge as
// a Studio scene, the scrim standing in for the shades, a send and an unlink,
// the call to action as the project's outro, and the hook picture's develop.
// The web's "does not mutate" cases hold by value semantics and are kept as
// the same assertions.

import XCTest
@testable import AtelierKit

private func badge() -> [OverlayElement] {
    var kicker = createTextElement(id: "kicker")
    kicker.text = "Australia"
    var headline = createTextElement(id: "headline")
    headline.text = "27"
    headline.window = TimeWindow(start: 0.2, end: nil)
    return [kicker, headline]
}

private func project(_ change: (inout ProjectDoc) -> Void = { _ in }) -> ProjectDoc {
    var doc = ProjectDoc(version: 1, id: "p1", name: "DJI_0042", createdAt: 1, updatedAt: 1,
                         settings: ProjectSettings(aspectId: "source"),
                         elements: [createTextElement("ALT", id: "telemetry-alt")], scenes: [],
                         exportPrefs: ExportPrefs(variants: []))
    change(&doc)
    return doc
}

private func cta(_ change: (inout CtaSlide) -> Void = { _ in }) -> CtaSlide {
    var card = defaultCta
    change(&card)
    return card
}

final class HookSceneInjectionTests: XCTestCase {
    func testPutsEveryElementInTheHookScene() {
        let injection = hookInjection(badge(), 4)
        XCTAssertEqual(injection.scene.id, hookSceneId)
        for el in injection.elements { XCTAssertEqual(el.sceneId, hookSceneId) }
    }

    func testNamesItsElementsSoASecondSendCanFindThem() {
        let elements = hookInjection(badge(), 4).elements
        XCTAssertEqual(elements.map(\.id), ["\(hookElementPrefix)kicker", "\(hookElementPrefix)headline"])
        XCTAssertTrue(elements.allSatisfy(isHookElement))
    }

    func testKeepsTheElementWindowsWhichASceneReadsAsOffsetsWithinIt() {
        XCTAssertEqual(hookInjection(badge(), 4).elements[1].window, TimeWindow(start: 0.2, end: nil))
    }

    func testGivesTheSceneTheHooksOwnDuration() {
        XCTAssertEqual(hookInjection(badge(), 6).scene.end, 6)
    }

    func testFallsBackToASaneDurationRatherThanAZeroLengthScene() {
        for bad in [0, -3, Double.nan, Double.infinity] {
            XCTAssertGreaterThan(hookInjection(badge(), bad).scene.end, 0)
        }
    }

    func testHoldsTheTelemetryBackWhileTheHookRuns() {
        XCTAssertTrue(hookInjection(badge(), 4).scene.solo)
    }

    func testDoesNotMutateTheBadgeItWasGiven() {
        let source = badge()
        _ = hookInjection(source, 4)
        XCTAssertEqual(source[0].id, "kicker")
        XCTAssertNil(source[0].sceneId)
    }
}

final class HookSceneScrimTests: XCTestCase {
    func testIsNothingWhenThereIsNothingToStandInFor() {
        XCTAssertNil(scrimFromShades([]))
        XCTAssertNil(scrimFromShades([createShade(strength: 0)]))
    }

    func testTakesTheStrongestShadesColour() throws {
        let scrim = try XCTUnwrap(scrimFromShades([
            createShade(strength: 0.2, color: "#111111"),
            createShade(strength: 0.8, color: "#402010"),
        ]))
        XCTAssertEqual(scrim.color, "#402010")
    }

    func testHoldsTheVeilBackBecauseAFlatOneReadsHeavierThanAGradient() throws {
        let scrim = try XCTUnwrap(scrimFromShades([createShade(strength: 0.8)]))
        XCTAssertGreaterThan(scrim.opacity, 0)
        XCTAssertLessThan(scrim.opacity, 0.8)
    }

    func testNeverAsksForMoreThanOpaque() throws {
        XCTAssertLessThanOrEqual(try XCTUnwrap(scrimFromShades([createShade(strength: 5)])).opacity, 1)
    }
}

final class HookSceneWithHookTests: XCTestCase {
    func testAddsTheBadgeWithoutTouchingWhatTheStudioAlreadyHad() {
        let doc = withHook(project(), hookInjection(badge(), 4))
        XCTAssertTrue(doc.elements.map(\.id).contains("telemetry-alt"))
        XCTAssertEqual(doc.elements.filter(isHookElement).count, 2)
        XCTAssertTrue(hasHook(doc))
    }

    func testDrawsTheHookLastOverTheTelemetry() {
        let doc = withHook(project(), hookInjection(badge(), 4))
        XCTAssertTrue(isHookElement(doc.elements[doc.elements.count - 1]))
    }

    func testReplacesAHookSentBeforeInsteadOfStackingASecondBadge() {
        let once = withHook(project(), hookInjection(badge(), 4))
        let twice = withHook(once, hookInjection(badge(), 6))
        XCTAssertEqual(twice.elements.filter(isHookElement).count, 2)
        XCTAssertEqual(twice.scenes.filter { $0.id == hookSceneId }.count, 1)
        XCTAssertEqual(twice.scenes.first { $0.id == hookSceneId }?.end, 6)
    }

    func testLeavesTheAuthorsOwnIntroSceneAlone() {
        let withIntro = project { $0.scenes = [createIntroScene(end: 3)] }
        let doc = withHook(withIntro, hookInjection(badge(), 4))
        XCTAssertTrue(doc.scenes.map(\.id).contains("intro"))
        XCTAssertEqual(doc.scenes.count, 2)
    }

    func testDoesNotMutateTheProjectItWasGiven() {
        let before = project()
        let count = before.elements.count
        _ = withHook(before, hookInjection(badge(), 4))
        XCTAssertEqual(before.elements.count, count)
        XCTAssertEqual(before.scenes.count, 0)
    }
}

final class HookSceneWithoutHookTests: XCTestCase {
    func testTakesTheBadgeBackOutAndLeavesTheRest() {
        let doc = withoutHook(withHook(project(), hookInjection(badge(), 4)))
        XCTAssertEqual(doc.elements.map(\.id), ["telemetry-alt"])
        XCTAssertFalse(hasHook(doc))
    }

    func testKeepsTheAuthorsOwnIntro() {
        let doc = withoutHook(withHook(project { $0.scenes = [createIntroScene(end: 3)] }, hookInjection(badge(), 4)))
        XCTAssertEqual(doc.scenes.map(\.id), ["intro"])
    }

    func testIsTheSameDocumentWhenThereWasNoHookNoPointlessSave() {
        let before = project()
        XCTAssertEqual(withoutHook(before), before)
    }
}

final class HookSceneOutroTests: XCTestCase {
    func testLaysTheSameCardTheCarouselAppendsPrefixedAsTheBridges() throws {
        let card = try XCTUnwrap(ctaOutro(cta(), 9.0 / 16))
        XCTAssertEqual(card.background, defaultCta.background)
        XCTAssertGreaterThan(card.elements.count, 0)
        for el in card.elements { XCTAssertTrue(el.id.hasPrefix(hookElementPrefix)) }
        XCTAssertTrue(isRoadtripOutro(card))
    }

    func testCarriesTheQrAsItsUrlInTheCardsOwnInks() throws {
        let qr = try XCTUnwrap(try XCTUnwrap(ctaOutro(cta(), 9.0 / 16)).qr)
        XCTAssertEqual(qr.url, defaultCta.url)
        XCTAssertEqual(qr.dark, defaultCta.ink)
        XCTAssertEqual(qr.light, defaultCta.background)
    }

    func testACtaWithNothingToSayMakesNoCardTheDecksOwnRule() {
        XCTAssertNil(ctaOutro(cta {
            $0.headline = " "
            $0.body = ""
            $0.url = ""
        }, 9.0 / 16))
    }

    func testSendsIntoAnEmptySlotAndReplacesItsOwnCardOnAResend() throws {
        let first = try XCTUnwrap(withCtaOutro(project(), ctaOutro(cta(), 9.0 / 16)))
        XCTAssertTrue(isRoadtripOutro(first.outro))
        let second = try XCTUnwrap(withCtaOutro(first, ctaOutro(cta { $0.headline = "Nouveau" }, 9.0 / 16)))
        XCTAssertTrue(second.outro?.elements.contains { $0.text == "Nouveau" } == true)
    }

    func testUntickingTheCtaTakesASentCardBackOut() throws {
        let sent = try XCTUnwrap(withCtaOutro(project(), ctaOutro(cta(), 9.0 / 16)))
        let cleared = try XCTUnwrap(withCtaOutro(sent, nil))
        XCTAssertNil(cleared.outro)
    }

    func testNeverOverwritesAnOutroTheAuthorComposedThemselves() {
        let own = project { $0.outro = OutroCard(seconds: 3, background: "#000", elements: [], qr: nil) }
        XCTAssertNil(withCtaOutro(own, ctaOutro(cta(), 9.0 / 16)))
        // …and unticking the CTA leaves it alone rather than deleting it.
        XCTAssertEqual(withCtaOutro(own, nil), own)
        XCTAssertEqual(withoutCtaOutro(own), own)
    }

    func testUnlinkingStripsOnlyTheBridgesCard() throws {
        let sent = try XCTUnwrap(withCtaOutro(project(), ctaOutro(cta(), 9.0 / 16)))
        XCTAssertNil(withoutCtaOutro(sent).outro)
        let untouched = project()
        XCTAssertEqual(withoutCtaOutro(untouched), untouched)
    }
}

final class HookSceneDevelopTests: XCTestCase {
    private let lifted = dev { $0.exposure = 1 }

    private func withMedia(_ develops: [String: SavedDevelop] = [:]) -> ProjectDoc {
        project { $0.media = ProjectMedia(dirHandle: nil, files: [], activeId: nil, trims: [:], develops: develops) }
    }

    func testWritesItUnderTheMediaKeyMarkedWithItsHashNeverARawBase() {
        let raw = dev {
            $0.exposure = 1
            $0.base = .gain
            $0.rawGain = 2
        }
        let write = withHookDevelop(withMedia(), HookDevelop(name: "DJI_0042.JPG", hash: "h1", settings: raw))
        XCTAssertFalse(write.held)
        XCTAssertEqual(projectMediaKey("DJI_0042.JPG"), "dji_0042")
        XCTAssertEqual(write.doc.media.develops["dji_0042"], SavedDevelop(settings: lifted, hash: "h1", via: .roadtrip))
    }

    func testReplacesWhatItSentAndTakesItBackWhenTheHookIsAsShot() {
        let first = withHookDevelop(withMedia(), HookDevelop(name: "a.jpg", settings: lifted)).doc
        let second = withHookDevelop(first, HookDevelop(name: "a.jpg", settings: dev { $0.exposure = 2 })).doc
        XCTAssertEqual(second.media.develops["a"]?.settings.exposure, 2)
        let cleared = withHookDevelop(second, HookDevelop(name: "a.jpg", settings: nil)).doc
        XCTAssertNil(cleared.media.develops["a"])
        XCTAssertEqual(withHookDevelop(withMedia(), HookDevelop(name: "a.jpg", settings: nil)).doc.media.develops, [:])
    }

    func testNeverOverwritesADevelopTheAuthorSetInTheStudio() {
        let own = withMedia(["a": SavedDevelop(settings: dev { $0.exposure = -1 })])
        let write = withHookDevelop(own, HookDevelop(name: "a.jpg", settings: lifted))
        XCTAssertTrue(write.held)
        XCTAssertEqual(write.doc, own)
    }

    func testAnUnlinkTakesBackOnlyWhatTheBridgeWrote() {
        let doc = withMedia([
            "a": SavedDevelop(settings: lifted, via: .roadtrip),
            "b": SavedDevelop(settings: lifted),
        ])
        XCTAssertEqual(withoutHook(doc).media.develops, ["b": SavedDevelop(settings: lifted)])
    }
}
