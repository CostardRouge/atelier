// The neighbourhood family's builder, pinned apart from any kernel: which
// nodes a picture's stored `detail` and `repair` contribute, in which list,
// in which order — repair first, then colour noise, luminance noise and
// defringe before the cube; dehaze, clarity, texture and the sharpen last
// after it — read the way the web reads them (`detailOrNull`, `readPatches`)
// and mapped from the twin's own plan (`detailPassPlan`) one to one, the
// plan's blur + apply pair being ONE presence node here.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class DetailPassesTests: XCTestCase {
    private func ids(_ passes: [RenderPass]) -> [String] {
        passes.map { $0.id }
    }

    private func picture(_ carried: [String: JSONValue]) -> RollPicture {
        RollPicture(id: "p1", ref: SavedMediaRef(name: "DJI_0101.JPG", size: 1, lastModified: 0), carried: carried)
    }

    private static let everything: JSONValue = [
        "luminance": 40, "colour": 30, "defringe": 50, "sharpen": 60, "sharpenRadius": 1.5,
        "sharpenDetail": 25, "sharpenMasking": 20, "texture": 15, "clarity": -20, "dehaze": 35,
    ]

    private static let twoPatches: JSONValue = [
        ["id": "a", "kind": "heal", "x": 0.3, "y": 0.4, "radius": 0.05, "feather": 0.5, "dx": 0.1, "dy": 0],
        ["id": "b", "kind": "clone", "x": 0.7, "y": 0.2, "radius": 0.08, "feather": 0.3, "dx": -0.1, "dy": 0.05],
    ]

    func testAnUntouchedPictureContributesNothing() {
        let built = DetailPasses.make(for: picture([:]))
        XCTAssertTrue(built.isEmpty)
        // The web's own "nothing" spellings read as nothing too.
        XCTAssertTrue(DetailPasses.make(for: picture(["detail": .null, "repair": .array([])])).isEmpty)
        // A record whose amounts are all 0 is no operation, whatever its radius says.
        XCTAssertTrue(DetailPasses.make(for: picture(["detail": ["sharpenRadius": 2, "sharpenMasking": 50]])).isEmpty)
    }

    func testEverythingLandsInTheWebsOrder() {
        let built = DetailPasses.make(for: picture(["detail": Self.everything, "repair": Self.twoPatches]))
        XCTAssertEqual(ids(built.before), ["repair", "chroma-x", "chroma-y", "denoise", "defringe"])
        XCTAssertEqual(ids(built.after), ["presence-dehaze", "presence-clarity", "presence-texture", "sharpen"])
        let repair = built.before.first as? RepairPass
        XCTAssertEqual(repair?.patches.map { $0.id }, ["a", "b"])
        XCTAssertEqual(repair?.patches.first?.kind, .heal)
        let presence = built.after.compactMap { $0 as? PresencePass }
        XCTAssertEqual(presence.map { $0.amount }, [0.35, -0.2, 0.15])
    }

    func testTheNodesFollowTheTwinsPlanOneToOne() {
        // Every id of `detailPassPlan` has its node, in its list and its
        // place; the plan's presence PAIR is one node.
        let detail = detailOrNull(Self.everything)
        let plan = detailPassPlan(detail)
        let built = DetailPasses.make(detail: detail, repair: [])
        XCTAssertEqual(ids(built.before), plan.pre.map { $0.rawValue })
        var collapsed: [String] = []
        var ops = PresenceOp.allCases.filter { op in
            switch op {
            case .dehaze: return detail!.dehaze != 0
            case .clarity: return detail!.clarity != 0
            case .texture: return detail!.texture != 0
            }
        }.makeIterator()
        for id in plan.post {
            switch id {
            case .presenceBlur: collapsed.append("presence-\(ops.next()!.rawValue)")
            case .presenceApply: continue
            default: collapsed.append(id.rawValue)
            }
        }
        XCTAssertEqual(ids(built.after), collapsed)
        XCTAssertEqual(plan.post.count, 2 * 3 + 1, "the plan holds three pairs and the sharpen")
    }

    func testOnlyTheSlidersThatMoveGetANode() {
        let built = DetailPasses.make(detail: DetailSettings(colour: 20, clarity: 30), repair: [])
        XCTAssertEqual(ids(built.before), ["chroma-x", "chroma-y"])
        XCTAssertEqual(ids(built.after), ["presence-clarity"])
    }

    func testTheMaskViewDrawsWithNothingElseAndOnlyWhenAsked() {
        let bare = DetailPasses.make(detail: nil, repair: [], showSharpenMask: true)
        XCTAssertEqual(ids(bare.before), [])
        XCTAssertEqual(ids(bare.after), ["sharpen"])
        XCTAssertEqual((bare.after.first as? SharpenPass)?.showMask, true)
        let sharpened = DetailPasses.make(detail: DetailSettings(sharpen: 50), repair: [])
        XCTAssertEqual((sharpened.after.first as? SharpenPass)?.showMask, false)
    }

    func testARecordWrittenBeforeDetailExistedIsTheLegacyUnsharpMask() {
        // `sharpenDetail` absent reads 100 — the plain mask every such record
        // was sharpened with — never the 25 a new picture starts from.
        let built = DetailPasses.make(for: picture(["detail": ["sharpen": 50]]))
        let sharpen = built.after.first as? SharpenPass
        XCTAssertEqual(sharpen?.detail.sharpenDetail, DetailSettings.legacySharpenDetail)
        XCTAssertEqual(sharpen?.detail.sharpen, 50)
    }

    func testJunkIsReadTheWayTheWebReadsIt() {
        // A detail that is not a record reads as the default: nothing. A
        // patch list keeps what it can read, drops a repeated id, and clamps.
        let built = DetailPasses.make(for: picture([
            "detail": "loud",
            "repair": [
                ["id": "a", "kind": "clone", "x": 7, "y": -1, "radius": 9, "dx": 3],
                ["id": "a", "kind": "heal", "x": 0.5, "y": 0.5],
                "not a patch",
                ["kind": "heal"],
            ],
        ]))
        XCTAssertEqual(ids(built.before), ["repair"])
        XCTAssertTrue(built.after.isEmpty)
        let patches = (built.before.first as? RepairPass)?.patches ?? []
        XCTAssertEqual(patches.count, 1)
        XCTAssertEqual(patches.first?.kind, .clone)
        XCTAssertEqual(patches.first?.x, 1)
        XCTAssertEqual(patches.first?.y, 0)
        XCTAssertEqual(patches.first?.radius, patchRadiusRange.max)
        XCTAssertEqual(patches.first?.dx, 1)
    }

    func testTheScaleAndTheAspectReachTheNodes() {
        let built = DetailPasses.make(detail: DetailSettings(luminance: 10, colour: 10, defringe: 10, sharpen: 10),
                                      repair: [Patch(id: "a", kind: .heal, x: 0.5, y: 0.5, radius: 0.05, feather: 0.5, dx: 0.1, dy: 0)],
                                      aspectRatio: 1.5, decodeScale: 0.5)
        XCTAssertEqual((built.before[0] as? RepairPass)?.aspectRatio, 1.5)
        XCTAssertEqual((built.before[1] as? ChromaBlurPass)?.decodeScale, 0.5)
        XCTAssertEqual((built.before[3] as? DenoisePass)?.decodeScale, 0.5)
        XCTAssertEqual((built.before[4] as? DefringePass)?.decodeScale, 0.5)
        XCTAssertEqual((built.after[0] as? SharpenPass)?.decodeScale, 0.5)
    }

    func testTheGraderPlacesThemAroundTheCube() {
        // The integration's seam: `before` on the source ahead of the cube,
        // `after` behind it, the film node's slot still last.
        let built = DetailPasses.make(for: picture(["detail": Self.everything, "repair": Self.twoPatches]))
        let grader = FrameGrader(lut: CubeLut.identity(), before: built.before, after: built.after)
        XCTAssertEqual(ids(grader.passes), [
            "repair", "chroma-x", "chroma-y", "denoise", "defringe",
            "cube",
            "presence-dehaze", "presence-clarity", "presence-texture", "sharpen",
        ])
    }
}
