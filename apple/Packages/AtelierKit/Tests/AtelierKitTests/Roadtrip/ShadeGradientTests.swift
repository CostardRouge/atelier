// The behaviour half of `src/shared/roadtrip/shades.test.ts` — every case of
// `shadeGradient`, the grid, the follow modes and the fade's shape, one for
// one, same numbers. (The factory and reader cases are `ShadesTests.swift`.)

import XCTest
@testable import AtelierKit

/// The web's `shade(over)`: a fresh shade with a fixed id.
private func shadeOf(_ change: (inout Shade) -> Void = { _ in }) -> Shade {
    var s = createShade(id: "fixed")
    change(&s)
    return s
}

private let aBlock = HookBlock(top: 0.62, bottom: 0.88)

private func linearOf(_ g: ShadeGradient?, file: StaticString = #filePath, line: UInt = #line) -> LinearShade? {
    guard case .linear(let l)? = g else {
        XCTFail("not a linear shade", file: file, line: line)
        return nil
    }
    return l
}

private func radialOf(_ g: ShadeGradient?, file: StaticString = #filePath, line: UInt = #line) -> RadialShade? {
    guard case .radial(let r)? = g else {
        XCTFail("not a radial shade", file: file, line: line)
        return nil
    }
    return r
}

/// The alpha a gradient draws at `at`, interpolated between its stops as a canvas does.
private func alphaAt(_ stops: [ShadeStop], _ at: Double) -> Double {
    for i in 1..<stops.count {
        let a = stops[i - 1]
        let b = stops[i]
        if at <= b.at {
            let span = b.at - a.at
            return a.alpha + ((b.alpha - a.alpha) * (at - a.at)) / (span == 0 ? 1 : span)
        }
    }
    return stops[stops.count - 1].alpha
}

final class ShadeGradientNothingTests: XCTestCase {
    func testIsNilWithNoStrength() {
        XCTAssertNil(shadeGradient(shadeOf { $0.strength = 0 }))
    }

    func testIsNilWithNoReach() {
        XCTAssertNil(shadeGradient(shadeOf { $0.reach = 0 }))
        XCTAssertNil(shadeGradient(shadeOf { $0.direction = .radial; $0.reach = 0 }))
    }

    func testIsNilWhenDisabledEvenAtFullStrength() {
        XCTAssertNil(shadeGradient(shadeOf { $0.enabled = false }))
    }

    func testDrawsAShadeStoredBeforeTheSwitchExisted() {
        XCTAssertNotNil(shadeGradient(shadeOf { $0.enabled = nil }))
    }

    func testDrawsNothingRatherThanSomethingTransparent() {
        for d in shadeDirections {
            XCTAssertNil(shadeGradient(shadeOf { $0.direction = d.id; $0.strength = 0 }), d.id.rawValue)
        }
    }
}

final class ShadeGradientDirectionTests: XCTestCase {
    func testAnchorsAnEdgeShadeAtItsOwnEdge() throws {
        let top = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .top; $0.reach = 0.5 })))
        XCTAssertEqual(top.y0, 0)
        XCTAssertEqual(top.y1, 0.5)
        let bottom = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .bottom; $0.reach = 0.5 })))
        XCTAssertEqual(bottom.y0, 1)
        XCTAssertEqual(bottom.y1, 0.5)
        let left = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .left; $0.reach = 0.4 })))
        XCTAssertEqual(left.x0, 0)
        XCTAssertEqual(left.x1, 0.4)
        let right = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .right; $0.reach = 0.4 })))
        XCTAssertEqual(right.x0, 1)
        XCTAssertEqual(right.x1, 0.6)
    }

    func testRunsAMiddleBandEdgeToEdgeSymmetricAboutTheCentre() throws {
        let v = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .middleVertical; $0.reach = 0.6 })))
        XCTAssertEqual(v.y0, 0.2)
        XCTAssertEqual(v.y1, 0.8)
        let h = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .middleHorizontal; $0.reach = 0.6 })))
        XCTAssertEqual(h.x0, 0.2)
        XCTAssertEqual(h.x1, 0.8)
    }

    func testPeaksInTheMiddleOfABandAndClearsAtBothEnds() throws {
        for direction in [ShadeDirection.middleVertical, .middleHorizontal] {
            let g = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = direction; $0.strength = 0.8 }))
            let stops = g.stops
            XCTAssertEqual(stops[0].alpha, 0)
            XCTAssertEqual(stops[stops.count - 1].alpha, 0)
            let middle = try XCTUnwrap(stops.first { $0.at == 0.5 })
            assertClose(middle.alpha, 0.8, 6)
        }
    }

    func testInvertsABandIntoAClearMiddleWithDarkAtBothEnds() throws {
        let g = try XCTUnwrap(shadeGradient(shadeOf {
            $0.direction = .middleVertical; $0.strength = 0.8; $0.invert = true
        }))
        assertClose(g.stops[0].alpha, 0.8, 6)
        assertClose(g.stops[g.stops.count - 1].alpha, 0.8, 6)
        XCTAssertEqual(try XCTUnwrap(g.stops.first { $0.at == 0.5 }).alpha, 0)
    }

    func testCentresARadialOnTheFrame() throws {
        let r = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = .radial })))
        XCTAssertEqual(r.cx, 0.5)
        XCTAssertEqual(r.cy, 0.5)
        XCTAssertEqual(r.r0, 0)
    }

    func testPutsACornerRadialOnItsCorner() throws {
        let corners: [(ShadeDirection, Double, Double)] = [
            (.topLeft, 0, 0), (.topRight, 1, 0), (.bottomLeft, 0, 1), (.bottomRight, 1, 1),
        ]
        for (direction, cx, cy) in corners {
            let r = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = direction })))
            XCTAssertEqual(r.r0, 0)
            XCTAssertEqual(r.cx, cx)
            XCTAssertEqual(r.cy, cy)
        }
    }

    func testGrowsACornerWithItsReachAndDrawsNothingAtNone() throws {
        let near = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = .bottomLeft; $0.reach = 0.3 })))
        let far = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = .bottomLeft; $0.reach = 0.8 })))
        XCTAssertGreaterThan(far.r1, near.r1)
        XCTAssertNil(shadeGradient(shadeOf { $0.direction = .bottomLeft; $0.reach = 0 }))
    }

    func testGivesEachDirectionItsOwnGeometry() {
        var seen: [ShadeGradient?] = []
        for d in shadeDirections {
            let g = shadeGradient(shadeOf { $0.direction = d.id; $0.reach = 0.5 })
            XCTAssertFalse(seen.contains(g), d.id.rawValue)
            seen.append(g)
        }
        XCTAssertEqual(seen.count, shadeDirections.count)
    }
}

final class ShadeGradientInversionTests: XCTestCase {
    func testPutsTheDarkEndAtTheFarEndOfTheReach() throws {
        let plain = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .top; $0.reach = 0.5 }))
        let inverted = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .top; $0.reach = 0.5; $0.invert = true }))
        XCTAssertGreaterThan(plain.stops[0].alpha, 0)
        XCTAssertEqual(plain.stops[plain.stops.count - 1].alpha, 0)
        XCTAssertEqual(inverted.stops[0].alpha, 0)
        XCTAssertGreaterThan(inverted.stops[inverted.stops.count - 1].alpha, 0)
    }

    func testKeepsTheStopsInOrderSoACanvasAcceptsThem() throws {
        for invert in [false, true] {
            for d in shadeDirections {
                let g = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = d.id; $0.invert = invert; $0.reach = 0.5 }))
                for i in 1..<g.stops.count { XCTAssertGreaterThan(g.stops[i].at, g.stops[i - 1].at) }
                XCTAssertEqual(g.stops[0].at, 0)
                XCTAssertEqual(g.stops[g.stops.count - 1].at, 1)
            }
        }
    }

    func testNeverExceedsTheAskedForStrength() throws {
        for invert in [false, true] {
            let g = try XCTUnwrap(shadeGradient(shadeOf { $0.strength = 0.4; $0.invert = invert }))
            for stop in g.stops { XCTAssertLessThanOrEqual(stop.alpha, 0.4 + 1e-9) }
        }
    }

    func testEasesTheMiddleSoTheFadeDoesNotReadAsAHardEdge() throws {
        let g = try XCTUnwrap(shadeGradient(shadeOf { $0.strength = 1 }))
        let middle = try XCTUnwrap(g.stops.first { $0.at > 0 && $0.at < 1 })
        XCTAssertGreaterThan(middle.alpha, 0)
        XCTAssertLessThan(middle.alpha, 1)
    }
}

final class ShadeGradientHookTests: XCTestCase {
    func testLandsABottomShadeOnTheBlockInsteadOfTheReach() throws {
        let free = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .bottom; $0.reach = 0.5 })))
        let hooked = try XCTUnwrap(linearOf(shadeGradient(
            shadeOf { $0.direction = .bottom; $0.reach = 0.5; $0.followHook = true }, aBlock)))
        XCTAssertGreaterThanOrEqual(abs(hooked.y1 - free.y1), pow(10, -6) / 2)
        // It clears the first line of the badge rather than cutting across it.
        XCTAssertLessThan(hooked.y1, aBlock.top)
    }

    func testMovesWithTheBadge() throws {
        let low = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .bottom; $0.followHook = true },
                                                       HookBlock(top: 0.7, bottom: 0.95))))
        let high = try XCTUnwrap(linearOf(shadeGradient(shadeOf { $0.direction = .bottom; $0.followHook = true },
                                                        HookBlock(top: 0.3, bottom: 0.55))))
        XCTAssertLessThan(high.y1, low.y1)
    }

    func testCentresARadialOnTheBadge() throws {
        let r = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = .radial; $0.followHook = true }, aBlock)))
        assertClose(r.cy, (aBlock.top + aBlock.bottom) / 2, 6)
    }

    func testFallsBackToItsOwnReachWhenThereIsNoBlock() throws {
        let g = try XCTUnwrap(linearOf(shadeGradient(
            shadeOf { $0.direction = .bottom; $0.reach = 0.5; $0.followHook = true }, nil)))
        assertClose(g.y1, 0.5, 6)
    }
}

final class ShadeGradientBoundsTests: XCTestCase {
    func testKeepsEveryPointInsideTheFrameWhateverItIsHanded() {
        for d in shadeDirections {
            for reach in [-1, 0.5, 4, Double.nan] {
                guard let g = shadeGradient(shadeOf { $0.direction = d.id; $0.reach = reach }) else { continue }
                let points: [Double]
                switch g {
                case .linear(let l): points = [l.x0, l.y0, l.x1, l.y1]
                case .radial(let r): points = [r.cx, r.cy]
                }
                for p in points {
                    XCTAssertGreaterThanOrEqual(p, 0)
                    XCTAssertLessThanOrEqual(p, 1)
                }
            }
        }
    }
}

final class ShadeGradientFadeTests: XCTestCase {
    func testDrawsTheVeryStopsItAlwaysDrewWhenNoneOfTheThreeIsSet() throws {
        for d in shadeDirections {
            for invert in [false, true] {
                let legacy = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = d.id; $0.invert = invert; $0.reach = 0.5 }))
                let soft = try XCTUnwrap(shadeGradient(shadeOf {
                    $0.direction = d.id; $0.invert = invert; $0.reach = 0.5; $0.falloff = .soft; $0.core = 0
                }))
                XCTAssertEqual(soft, legacy)
                XCTAssertLessThanOrEqual(legacy.stops.count, 5)
            }
        }
    }

    func testReadsGarbageAsAbsent() throws {
        let legacy = try XCTUnwrap(shadeGradient(shadeOf()))
        // A falloff this build does not know reads as absent — the document's reader.
        let stored: JSONValue = ["id": "fixed", "direction": "bottom", "reach": 0.55, "strength": 0.65,
                                 "color": "#000000", "invert": false, "followHook": false, "falloff": "bouncy"]
        var junk = try XCTUnwrap(readShade(stored))
        junk.core = .nan
        junk.center = Point(.nan, 4)
        let g = try XCTUnwrap(shadeGradient(junk))
        XCTAssertEqual(g.stops, legacy.stops)
        XCTAssertEqual(shadeFalloff(junk), .soft)
        XCTAssertEqual(shadeCore(shadeOf { $0.core = -1 }), 0)
        XCTAssertEqual(shadeCore(shadeOf { $0.core = 5 }), maxShadeCore)
        XCTAssertEqual(shadeCentre(shadeOf()), Point(0.5, 0.5))
    }

    func testHoldsFullStrengthAcrossTheCore() throws {
        let before = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .middleVertical; $0.reach = 1; $0.strength = 1 }))
        let after = try XCTUnwrap(shadeGradient(shadeOf {
            $0.direction = .middleVertical; $0.reach = 1; $0.strength = 1; $0.core = 0.5
        }))
        XCTAssertLessThan(alphaAt(before.stops, 0.75), 0.5)
        assertClose(alphaAt(after.stops, 0.75), 1, 6)
        assertClose(alphaAt(after.stops, 0.25), 1, 6)
        XCTAssertEqual(after.stops[0].alpha, 0)
        XCTAssertEqual(after.stops[after.stops.count - 1].alpha, 0)
    }

    func testHoldsTheCoreAtTheFarEndWhenInverted() throws {
        let g = try XCTUnwrap(shadeGradient(shadeOf {
            $0.direction = .top; $0.reach = 1; $0.strength = 0.8; $0.invert = true; $0.core = 0.4
        }))
        XCTAssertEqual(g.stops[0].alpha, 0)
        assertClose(alphaAt(g.stops, 0.7), 0.8, 6)
        assertClose(alphaAt(g.stops, 1), 0.8, 6)
    }

    func testGivesEveryFalloffItsOwnCurveAllStartingAtStrengthAndEndingClear() throws {
        var seen: Set<String> = []
        for f in shadeFalloffs {
            let g = try XCTUnwrap(shadeGradient(shadeOf {
                $0.direction = .bottom; $0.strength = 0.9; $0.falloff = f.id; $0.core = 0.1
            }))
            assertClose(g.stops[0].alpha, 0.9, 6)
            assertClose(g.stops[g.stops.count - 1].alpha, 0, 6)
            seen.insert(g.stops.map { String(format: "%.4f", $0.alpha) }.joined(separator: ","))
        }
        XCTAssertEqual(seen.count, shadeFalloffs.count)
    }

    func testHoldsLongerOnHeldThanOnQuick() throws {
        let held = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .left; $0.strength = 1; $0.falloff = .inCubic }))
        let quick = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .left; $0.strength = 1; $0.falloff = .outCubic }))
        XCTAssertGreaterThan(alphaAt(held.stops, 0.5), 0.8)
        XCTAssertLessThan(alphaAt(quick.stops, 0.5), 0.2)
    }

    func testKeepsSampledStopsInOrderFromZeroToOneWithinTheStrength() throws {
        for d in shadeDirections {
            for invert in [false, true] {
                for core in [0, 0.3, maxShadeCore] {
                    for f in shadeFalloffs {
                        let g = try XCTUnwrap(shadeGradient(shadeOf {
                            $0.direction = d.id; $0.invert = invert; $0.core = core; $0.falloff = f.id
                            $0.strength = 0.6; $0.reach = 0.7
                        }))
                        XCTAssertEqual(g.stops[0].at, 0)
                        XCTAssertEqual(g.stops[g.stops.count - 1].at, 1)
                        for i in 1..<g.stops.count { XCTAssertGreaterThan(g.stops[i].at, g.stops[i - 1].at) }
                        for s in g.stops {
                            XCTAssertGreaterThanOrEqual(s.alpha, 0)
                            XCTAssertLessThanOrEqual(s.alpha, 0.6 + 1e-9)
                        }
                    }
                }
            }
        }
    }

    func testKeepsASampledBandPeakingExactlyOnItsCentre() throws {
        let g = try XCTUnwrap(shadeGradient(shadeOf { $0.direction = .middleHorizontal; $0.strength = 0.7; $0.falloff = .inOut }))
        assertClose(try XCTUnwrap(g.stops.first { $0.at == 0.5 }).alpha, 0.7, 6)
    }

    func testMovesABandAlongItsOwnAxisOnlyThePeakOnTheCentreItWasGiven() throws {
        let v = try XCTUnwrap(linearOf(shadeGradient(shadeOf {
            $0.direction = .middleVertical; $0.reach = 0.6; $0.center = Point(0.9, 0.3)
        })))
        XCTAssertEqual(v.x0, 0)
        assertClose((v.y0 + v.y1) / 2, 0.3, 9)
        assertClose(v.y1 - v.y0, 0.6, 9)
        let h = try XCTUnwrap(linearOf(shadeGradient(shadeOf {
            $0.direction = .middleHorizontal; $0.reach = 0.6; $0.center = Point(0.2, 0.9)
        })))
        assertClose((h.x0 + h.x1) / 2, 0.2, 9)
        // Past the frame's edge rather than clamped, or the peak would slide.
        XCTAssertLessThan(h.x0, 0)
    }

    func testMovesAFreeRadialAnywhereAndHandsItToTheBadgeWhenFollowing() throws {
        let free = try XCTUnwrap(radialOf(shadeGradient(shadeOf { $0.direction = .radial; $0.center = Point(0.3, 0.7) })))
        XCTAssertEqual(free.cx, 0.3)
        XCTAssertEqual(free.cy, 0.7)
        let hooked = try XCTUnwrap(radialOf(shadeGradient(shadeOf {
            $0.direction = .radial; $0.followHook = true; $0.center = Point(0.3, 0.1)
        }, aBlock)))
        XCTAssertEqual(hooked.cx, 0.5)
        XCTAssertEqual(hooked.cy, (aBlock.top + aBlock.bottom) / 2)
    }

    func testLeavesAnEdgeAndACornerWhereTheyAreWhateverTheCentreSays() {
        for direction in [ShadeDirection.top, .left, .bottomRight] {
            XCTAssertEqual(shadeGradient(shadeOf { $0.direction = direction; $0.center = Point(0.1, 0.1) }),
                           shadeGradient(shadeOf { $0.direction = direction }))
        }
    }

    func testSaysWhichAxisOfTheCentreTheAuthorCanMove() {
        XCTAssertEqual(centreMovable(.middleVertical, .edge), .y)
        XCTAssertEqual(centreMovable(.middleHorizontal, .none), .x)
        XCTAssertEqual(centreMovable(.radial, .none), .both)
        XCTAssertNil(centreMovable(.radial, .edge))
        XCTAssertNil(centreMovable(.top, .none))
        XCTAssertNil(centreMovable(.bottomLeft, .none))
    }
}

final class ShadeGradientVignetteTests: XCTestCase {
    func testTheVignetteIsClearInTheMiddle() throws {
        let g = try XCTUnwrap(shadeGradient(vignetteShade(0.5)))
        XCTAssertEqual(g.stops[0].alpha, 0)
    }
}

final class ShadeGridTests: XCTestCase {
    func testHoldsEveryDirectionExactlyOnce() {
        let all = shadeGrid.flatMap(\.shapes)
        XCTAssertEqual(Set(all).count, all.count)
        XCTAssertEqual(all.map(\.rawValue).sorted(), shadeDirections.map(\.id.rawValue).sorted())
    }

    func testFilesADirectionUnderItsCellTheBandsUnderTheCentre() {
        XCTAssertEqual(shadeCell(.top), .topCenter)
        XCTAssertEqual(shadeCell(.left), .centerLeft)
        XCTAssertEqual(shadeCell(.bottomRight), .bottomRight)
        XCTAssertEqual(shadeCell(.middleVertical), .center)
        XCTAssertEqual(shadeCell(.radial), .center)
    }

    func testKeepsAShapeThatAlreadyLivesInTheCellElseTakesTheCellsFirst() {
        XCTAssertEqual(directionInCell(.center, .middleHorizontal), .middleHorizontal)
        XCTAssertEqual(directionInCell(.center, .bottom), .radial)
        XCTAssertEqual(directionInCell(.bottomLeft, .radial), .bottomLeft)
    }
}

final class ShadeGradientAnchorTests: XCTestCase {
    private func at(_ anchor: OverlayAnchor) -> HookBlock {
        HookBlock(top: aBlock.top, bottom: aBlock.bottom, anchor: anchor)
    }

    private func following(_ follow: ShadeFollow, _ change: (inout Shade) -> Void = { _ in }) -> Shade {
        shadeOf { s in
            let flags = followFlags(follow)
            s.followHook = flags.followHook
            s.followAnchor = flags.followAnchor
            change(&s)
        }
    }

    func testReadsTheFollowModeFromTheTwoFlagsAbsentFollowAnchorAsOff() {
        XCTAssertEqual(shadeFollow(shadeOf { $0.followHook = true; $0.followAnchor = nil }), .edge)
        for follow in ShadeFollow.allCases {
            XCTAssertEqual(shadeFollow(following(follow)), follow)
        }
    }

    func testTakesTheBadgesCellKeepingItsOwnDirectionUnderneath() throws {
        let s = following(.anchor) { $0.direction = .top }
        XCTAssertEqual(resolvedDirection(s, at(.bottomLeft)), .bottomLeft)
        XCTAssertEqual(resolvedDirection(s, at(.centerRight)), .right)
        XCTAssertEqual(s.direction, .top)
        let r = try XCTUnwrap(radialOf(shadeGradient(s, at(.bottomLeft))))
        XCTAssertEqual(r.cx, 0)
        XCTAssertEqual(r.cy, 1)
    }

    func testKeepsItsOwnDirectionWithNoAnchorToFollowOrWhenNotAsked() {
        XCTAssertEqual(resolvedDirection(following(.anchor) { $0.direction = .top }, aBlock), .top)
        XCTAssertEqual(resolvedDirection(following(.anchor) { $0.direction = .top }, nil), .top)
        XCTAssertEqual(resolvedDirection(shadeOf { $0.direction = .top; $0.followHook = true }, at(.bottomLeft)), .top)
    }

    func testLandsOnTheBlocksEdgeAsWellLikeFollowingTheEdge() {
        let anchored = shadeGradient(following(.anchor), at(.bottomCenter))
        let edged = shadeGradient(following(.edge) { $0.direction = .bottom }, aBlock)
        XCTAssertEqual(anchored, edged)
    }

    func testSaysWhenTheBadgeNotTheSliderSetsTheReach() {
        XCTAssertTrue(reachFollowsBadge(.bottom, .anchor))
        XCTAssertTrue(reachFollowsBadge(.top, .edge))
        XCTAssertFalse(reachFollowsBadge(.bottom, .none))
        XCTAssertFalse(reachFollowsBadge(.bottomLeft, .anchor))
        XCTAssertFalse(reachFollowsBadge(.left, .edge))
    }
}
