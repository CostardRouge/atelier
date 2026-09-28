// The gate for the repair pass — the web's `check-render.mjs` row «repair:
// heal and clone against repair.ts», on macOS: the same 96×64 soft field
// with a dark spot near the top-left and a darker band on the right, the
// same heal and clone, held to AtelierKit's `repairAt` at the web's two
// codes over every pixel, and the spot checked to have really risen.
//
// A patch is a function of WHERE, so the rows that matter most here are the
// ones about place: the frame's y runs DOWN in the twin and UP in Core Image
// (a patch on the wrong side of the frame fails every pixel near it), a
// picture whose extent does not start at the origin, a list longer than one
// batch of the kernel's four slots, and the ROI — a heal's means are read
// around the source disc wherever it lies, so a tile over the destination
// must ask for the source's tile too.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class RepairPassTests: XCTestCase {
    static let width = 96
    static let height = 64
    static var aspect: Double { Double(width) / Double(height) }

    /// The web's fixture on a 1/256 grid a half float holds exactly
    /// (`DetailPassTests.onHalfGrid` says why).
    static let picture = DetailImage(width: RepairPassTests.width, height: RepairPassTests.height) { x, y in
        var v = 0.6 + 0.1 * sin(Double(x) / 9) + 0.05 * cos(Double(y) / 7)
        if hypot(Double(x - 24), Double(y - 20)) < 4 { v = 0.15 }
        if x > 70 { v -= 0.25 }
        return (DetailPassTests.onHalfGrid(v), DetailPassTests.onHalfGrid(v * 0.95), DetailPassTests.onHalfGrid(v * 0.9))
    }

    /// The web's two patches: a heal over the spot, sourced right and down;
    /// a clone over the band's corner, sourced up and left.
    static let patches = [
        Patch(id: "h", kind: .heal, x: 24.0 / 96, y: 20.0 / 64, radius: 0.12, feather: 0.5, dx: 0.25, dy: 0.1),
        Patch(id: "c", kind: .clone, x: 0.8, y: 0.7, radius: 0.15, feather: 0.3, dx: -0.4, dy: -0.2),
    ]

    var context: PassContext {
        PassContext(renderSize: CGSize(width: Self.width, height: Self.height))
    }

    /// `patches` over the fixture, read back whole and held to the twin.
    @discardableResult
    func check(_ patches: [Patch], label: String, file: StaticString = #filePath, line: UInt = #line) throws -> [Float] {
        let src = NeighbourhoodGate.image(Self.picture)
        let ctx = context
        let recipe: CIImage
        do {
            recipe = try RepairPass(patches: patches, aspectRatio: Self.aspect).drawn(src, ctx)
        } catch KernelError.applyFailed(let name) where !NeighbourhoodGate.hasMetal {
            throw XCTSkip("no Metal device here, and the software renderer would not run the '\(name)' kernel")
        }
        let got = NeighbourhoodGate.read(recipe, width: Self.width, height: Self.height)
        if !NeighbourhoodGate.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing through the repair kernel")
        }
        let w = Double(Self.width)
        let h = Double(Self.height)
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height) { x, y in
            repairAt(Self.picture, (Double(x) + 0.5) / w, (Double(y) + 0.5) / h, patches, Self.aspect)
        }
        XCTAssertLessThanOrEqual(
            worst.codes, NeighbourhoodGate.codes,
            "\(NeighbourhoodGate.renderer), \(label): worst \(worst.codes) codes at (\(worst.x), \(worst.y)) channel \(worst.channel)",
            file: file, line: line)
        return got
    }

    // MARK: - the library

    func testTheLibraryVendsTheRepairKernel() {
        XCTAssertNoThrow(try Kernels.kernel("repairPatches"), "Repair.metal did not build, or the function moved")
    }

    // MARK: - against the twin

    func testAHealAndACloneMatchTheTwinAndTheSpotRises() throws {
        let got = try check(Self.patches, label: "heal + clone")
        // The spot at (24, 20) — near the TOP of the frame — was 0.15 and
        // must now read as the field around it: the web asks for 40 codes.
        let before = pixelAt(Self.picture, 24, 20).0
        let after = Double(got[(20 * Self.width + 24) * 4])
        XCTAssertGreaterThan(after, before + 40.0 / 255, "the spot went \(before * 255) → \(after * 255): NOT healed")
    }

    func testAHealMatchesTheSurroundingsNotTheSpot() throws {
        // The rule the ring exists for: a heal of a dark spot sourced from a
        // DARKER field still comes out as bright as the destination's ground,
        // where a clone of the same source goes dark. The source ring sits
        // wholly inside the band (see `testAListLongerThanOneBatch…` on why
        // a ring's edge is kept off a step).
        let dark = Patch(id: "d", kind: .heal, x: 24.0 / 96, y: 20.0 / 64, radius: 0.1, feather: 0.4, dx: 0.6, dy: 0)
        let healed = try check([dark], label: "heal from the dark band")
        var clone = dark
        clone.kind = .clone
        let cloned = try check([clone], label: "clone from the dark band")
        let at = (20 * Self.width + 24) * 4
        XCTAssertGreaterThan(Double(healed[at]), Double(cloned[at]) + 0.1, "the heal took the source's tone, not its texture")
    }

    func testAListLongerThanOneBatchDrawsInOrderFromTheOriginal() throws {
        // Nine patches — three batches of the kernel's four slots — heals and
        // clones mixed: every patch reads the ORIGINAL and mixes over what
        // the ones before it made, the twin's order.
        //
        // Placed in the smooth field, clear of the spot and of the band's
        // edge, rings included, and for a reason of the twin's own: the grid
        // a heal's means are read on puts its four axis end points EXACTLY on
        // the ring's outer edge, where the weight steps from 1 to 0, so a
        // float GPU and the double twin may round that tie differently. On a
        // smooth ground that costs a tenth of a code; with a ring's edge on
        // the spot it cost 1.8 (measured on a CPU transcription of the kernel
        // against `repairAt`, the tie forced each way).
        let us = [0.42, 0.50, 0.58]
        let vs = [0.3, 0.5, 0.72]
        var list: [Patch] = []
        for i in 0..<9 {
            list.append(Patch(id: "p\(i)", kind: i % 3 == 1 ? .clone : .heal, x: us[i % 3], y: vs[i / 3],
                              radius: 0.04 + Double(i % 3) * 0.012, feather: 0.2 + Double(i % 3) * 0.3,
                              dx: i % 2 == 0 ? 0.05 : -0.05, dy: i % 3 == 0 ? 0.06 : -0.05))
        }
        // Two more cover the first's centre, the last of them CLONING the
        // dark band: drawn in order the band wins there, reversed the first
        // heal does — so the order is what the row checks.
        list[3] = Patch(id: "p3", kind: .heal, x: 0.44, y: 0.32, radius: 0.06, feather: 0.2, dx: 0.08, dy: 0.1)
        list[6] = Patch(id: "p6", kind: .clone, x: 0.41, y: 0.31, radius: 0.05, feather: 0.2, dx: 0.4, dy: 0.05)
        try check(list, label: "nine patches in three batches")
        let w = Double(Self.width)
        let h = Double(Self.height)
        let probe = (u: (list[0].x * w).rounded(.down), v: (list[0].y * h).rounded(.down))
        let forward = repairAt(Self.picture, (probe.u + 0.5) / w, (probe.v + 0.5) / h, list, Self.aspect)
        let backward = repairAt(Self.picture, (probe.u + 0.5) / w, (probe.v + 0.5) / h, list.reversed(), Self.aspect)
        XCTAssertGreaterThan(abs(forward.0 - backward.0), 10.0 / 255,
                             "the overlap does not depend on the order, so the row cannot see it")
        try check(Array(list.reversed()), label: "the same nine, reversed")
    }

    func testAPictureAwayFromTheOriginIsRepairedInItsOwnFrame() throws {
        // The frame is the picture's EXTENT, wherever it sits.
        let moved = NeighbourhoodGate.image(Self.picture).transformed(by: CGAffineTransform(translationX: 13, y: 7))
        let ctx = context
        let recipe = try RepairPass(patches: Self.patches, aspectRatio: Self.aspect).drawn(moved, ctx)
        XCTAssertEqual(recipe.extent, CGRect(x: 13, y: 7, width: Self.width, height: Self.height))
        let got = NeighbourhoodGate.read(recipe, bounds: recipe.extent)
        if !NeighbourhoodGate.hasMetal, got.allSatisfy({ $0.isNaN }) {
            throw XCTSkip("no Metal device here, and the software renderer drew nothing")
        }
        let w = Double(Self.width)
        let h = Double(Self.height)
        let worst = NeighbourhoodGate.worst(got, width: Self.width, height: Self.height) { x, y in
            repairAt(Self.picture, (Double(x) + 0.5) / w, (Double(y) + 0.5) / h, Self.patches, Self.aspect)
        }
        XCTAssertLessThanOrEqual(worst.codes, NeighbourhoodGate.codes,
                                 "\(NeighbourhoodGate.renderer): worst \(worst.codes) codes at (\(worst.x), \(worst.y))")
    }

    func testTheAspectDefaultsToThePicturesOwn() throws {
        let src = NeighbourhoodGate.image(Self.picture)
        let named = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            try RepairPass(patches: Self.patches, aspectRatio: Self.aspect).drawn(src, self.context)
        }
        let own = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) {
            try RepairPass(patches: Self.patches).drawn(src, self.context)
        }
        XCTAssertLessThanOrEqual(NeighbourhoodGate.largest(named, own).difference, 1e-6)
    }

    // MARK: - the record

    func testAnEmptyListDrawsNothingAndALongOneIsCapped() throws {
        let src = NeighbourhoodGate.image(Self.picture)
        XCTAssertTrue(try RepairPass(patches: []).drawn(src, context) === src)
        let many = (0..<(maxPatches + 5)).map {
            Patch(id: "p\($0)", kind: .heal, x: 0.5, y: 0.5, radius: 0.05, feather: 0.5, dx: 0.1, dy: 0)
        }
        XCTAssertEqual(RepairPass(patches: many).patches.count, maxPatches)
        XCTAssertEqual(RepairPass(patches: []).id, "repair")
    }

    // MARK: - the ROI, tile by tile

    func testTheROIReachesTheSourceAndBothRings() throws {
        // 13×11 tiles: a tile over the heal's destination must also be handed
        // the source disc 24 pixels right and 6 down, and the rings around
        // both — none of which is anywhere near the tile itself.
        let src = NeighbourhoodGate.image(Self.picture)
        let pass = RepairPass(patches: Self.patches, aspectRatio: Self.aspect)
        let ctx = context
        let whole = try NeighbourhoodGate.drawn(width: Self.width, height: Self.height) { try pass.drawn(src, ctx) }
        let tiled = NeighbourhoodGate.tiled(try pass.drawn(src, ctx), width: Self.width, height: Self.height, tile: (13, 11))
        let (difference, at) = NeighbourhoodGate.largest(whole, tiled)
        XCTAssertLessThanOrEqual(
            difference, 1e-3,
            "\(NeighbourhoodGate.renderer): a tile read differs from the whole by \(difference) at pixel (\(at % Self.width), \(at / Self.width)) — the ROI falls short")
    }

    func testTheROIOfATileAwayFromEveryPatchIsTheTileAlone() {
        let frame = CGRect(x: 0, y: 0, width: Self.width, height: Self.height)
        let reads = Self.patches.map { RepairPass.reads(of: $0, frame: frame, aspectRatio: Self.aspect) }
        // Bottom-left in Core Image is the twin's bottom-left too: far from
        // the heal (top-left) and the clone (bottom-right).
        let quiet = CGRect(x: 0, y: 0, width: 8, height: 8)
        XCTAssertEqual(RepairPass.originalROI(quiet, reads), quiet)
        // Over the heal's centre, the source and both rings come in.
        let heal = reads[0]
        let over = CGRect(x: 22, y: Double(Self.height) - 22, width: 4, height: 4)
        let roi = RepairPass.originalROI(over, reads)
        XCTAssertTrue(roi.contains(heal.rings[0]))
        XCTAssertTrue(roi.contains(heal.rings[1]))
        XCTAssertTrue(roi.contains(over.offsetBy(dx: heal.offset.dx, dy: heal.offset.dy)))
        // The source sits to the RIGHT and — the frame's v running down — BELOW.
        XCTAssertGreaterThan(heal.offset.dx, 0)
        XCTAssertLessThan(heal.offset.dy, 0)
    }
}
