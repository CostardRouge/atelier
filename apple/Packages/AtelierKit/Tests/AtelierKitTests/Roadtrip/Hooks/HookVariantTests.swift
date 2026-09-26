// Port of `src/shared/roadtrip/hooks/hook-variant.test.ts` — the registry,
// `resolveHook`, `foldHook` and choosing a variant. Its `defaults` cases are
// `HookVariantStoredTests`. The web's `paint` closures become DRAWINGS handed
// to a painter (`HookVariant.swift`'s header), so "paints every layer in
// order" is asserted through a recording painter.

import XCTest
@testable import AtelierKit

private let content = BadgeContent(
    kicker: "Australia",
    label: "Day",
    headline: "27",
    counter: "of 104",
    caption: "in Karijini",
    timing: "515 days ago",
    exif: nil
)

private let ctx = HookContext(aspect: 9.0 / 16, durationSeconds: 4, date: "2025-04-17", content: content)

/// A drawing that says which layer it came from.
private struct NamedDrawing: HookDrawing {
    let name: String
}

final class HookVariantRegistryTests: XCTestCase {
    func testHoldsTheBadgeAndEveryEntryHasAUniqueId() {
        XCTAssertNotNil(hookVariantById(defaultHookId))
        let ids = hookVariants.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
    }

    func testLeavesTheBadgeDrawingAndSayingExactlyNothing() {
        let hook = resolveHook(defaultHookLayers(), ctx)
        XCTAssertEqual(hook.seconds, 0)
        XCTAssertFalse(hook.ownsFrame)
        XCTAssertEqual(hook.contentAt(content, 0), content)
        XCTAssertEqual(hook.score(), [])
    }
}

final class HookVariantResolveTests: XCTestCase {
    func testSkipsAnIdThisBuildDoesNotKnow() {
        let hook = resolveHook([HookLayer(id: "from-a-newer-build", options: ["anything": 1])], ctx)
        XCTAssertEqual(hook.seconds, 0)
        XCTAssertEqual(hook.contentAt(content, 0), content)
    }

    func testFallsBackToTheBadgeWhenNothingResolves() {
        XCTAssertEqual(resolveHook([], ctx).contentAt(content, 0), content)
        XCTAssertEqual(resolveHook(nil, ctx).contentAt(content, 0), content)
    }
}

final class HookVariantFoldTests: XCTestCase {
    func testTakesTheLongestLayersLife() {
        let hook = foldHook([HookRender(seconds: 1.2), HookRender(seconds: 2.4)], false)
        XCTAssertEqual(hook.seconds, 2.4)
    }

    func testRewritesAPieceAtATime() {
        let hook = foldHook([HookRender(seconds: 2, content: { t in [.headline: .text(t < 1 ? "14" : "27")] })], false)
        XCTAssertEqual(hook.contentAt(content, 0)?.headline, "14")
        XCTAssertEqual(hook.contentAt(content, 1.5)?.headline, "27")
        // Everything it did not speak about is untouched.
        XCTAssertEqual(hook.contentAt(content, 0)?.caption, "in Karijini")
    }

    func testHidesAPieceWithNullAndLeavesOneItOmitsAlone() {
        let hook = foldHook([HookRender(content: { _ in [.timing: .hide] })], false)
        let out = hook.contentAt(content, 0)
        XCTAssertNil(out?.timing)
        XCTAssertEqual(out?.kicker, "Australia")
    }

    func testRefusesToHideTheHeadlineABadgeWithoutItsNumeralIsNotOne() {
        let hook = foldHook([HookRender(content: { _ in [.headline: .hide] })], false)
        XCTAssertEqual(hook.contentAt(content, 0)?.headline, "27")
    }

    func testResolvesACollisionToTheLastLayerThatSpeaks() {
        let hook = foldHook([
            HookRender(content: { _ in [.caption: .text("first")] }),
            HookRender(content: { _ in [.caption: .text("last")] }),
        ], false)
        XCTAssertEqual(hook.contentAt(content, 0)?.caption, "last")
    }

    func testNeverInventsContentOutOfNothing() {
        let hook = foldHook([HookRender(content: { _ in [.headline: .text("27")] })], false)
        XCTAssertNil(hook.contentAt(nil, 0))
    }

    func testPaintsEveryLayerInOrderAtTheFrameItIsGiven() {
        final class Recorder { var painted: [String] = [] }
        let recorder = Recorder()
        let hook = foldHook([
            HookRender(drawing: NamedDrawing(name: "a")),
            HookRender(),
            HookRender(drawing: NamedDrawing(name: "b")),
        ], true)
        hook.paint(recorder, 0.5, FrameBox(width: 1080, height: 1920)) { g, drawing, t, frame in
            guard let named = drawing as? NamedDrawing else { return XCTFail("an unknown drawing") }
            g.painted.append(named.name == "a" ? "a:\(t):\(Int(frame.width))" : named.name)
        }
        XCTAssertEqual(recorder.painted, ["a:0.5:1080", "b"])
        XCTAssertTrue(hook.ownsFrame)
    }

    func testMergesTheLayersEventsIntoOneBedInTimeOrder() {
        let hook = foldHook([
            HookRender(score: { [SoundEvent(at: 0.4, voice: "tick")] }),
            HookRender(score: { [SoundEvent(at: 0.1, voice: "wood"), SoundEvent(at: 0.9, voice: "seat")] }),
        ], false)
        XCTAssertEqual(hook.score().map(\.at), [0.1, 0.4, 0.9])
    }
}

final class HookVariantChoiceTests: XCTestCase {
    private let scrub = HookVariant(
        id: "scrub",
        name: "Défilé",
        tagline: "",
        defaults: ["mode": "from-start", "stops": 12],
        needs: HookNeeds(),
        owns: .frame,
        prepare: { _, _ in HookRender(seconds: 0) }
    )

    private var badge: HookVariant {
        guard let badge = hookVariantById(defaultHookId) else {
            preconditionFailure("the badge variant must be registered")
        }
        return badge
    }

    func testStartsANewlyChosenVariantFromItsOwnDefaults() {
        XCTAssertEqual(setHookVariant(defaultHookLayers(), scrub),
                       [HookLayer(id: "scrub", options: ["mode": "from-start", "stops": 12])])
    }

    func testKeepsTheSettingsWhenTheCardAlreadyChosenIsClickedAgain() {
        let tuned = [HookLayer(id: "scrub", options: ["mode": "run-up", "stops": 6])]
        XCTAssertEqual(setHookVariant(tuned, scrub), tuned)
    }

    func testDropsAVariantsSettingsWhenAnotherOneIsChosen() {
        let tuned = [HookLayer(id: "scrub", options: ["mode": "run-up", "stops": 6])]
        XCTAssertEqual(setHookVariant(tuned, badge), [HookLayer(id: defaultHookId, options: [:])])
    }

    func testReplacesTheFirstLayerOnlySoAStackKeepsWhatSitsBehindIt() {
        let stack = [
            HookLayer(id: defaultHookId, options: [:]),
            HookLayer(id: "route", options: ["opacity": 0.6]),
        ]
        XCTAssertEqual(setHookVariant(stack, scrub), [
            HookLayer(id: "scrub", options: ["mode": "from-start", "stops": 12]),
            HookLayer(id: "route", options: ["opacity": 0.6]),
        ])
    }

    /// The web checks identity (`not.toBe`); a Swift record is a value, so the
    /// same promise is that editing the layer's options leaves the defaults alone.
    func testNeverSharesAnOptionsObjectWithTheDefaultsItCameFrom() {
        var layers = setHookVariant([], scrub)
        layers[0].options["stops"] = 3
        XCTAssertEqual(scrub.defaults["stops"], 12)
    }

    func testWritesAPanelsOptionsToTheFirstLayerAndLeavesTheRestOfAStackAlone() {
        let stack = [
            HookLayer(id: "scrub", options: ["stops": 12]),
            HookLayer(id: "route", options: ["opacity": 0.6]),
        ]
        XCTAssertEqual(setHookOptions(stack, ["stops": 8]), [
            HookLayer(id: "scrub", options: ["stops": 8]),
            HookLayer(id: "route", options: ["opacity": 0.6]),
        ])
    }

    func testGivesOptionsWithNowhereToGoTheDefaultLayer() {
        XCTAssertEqual(setHookOptions([], ["stops": 8]), [HookLayer(id: defaultHookId, options: ["stops": 8])])
    }
}
