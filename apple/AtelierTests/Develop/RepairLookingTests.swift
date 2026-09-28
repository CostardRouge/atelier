// The Repair section's two reads of the picture, held to where things ARE:
//
// - the dust field is measured off the stage's decode TOP ROW FIRST, as the
//   twin (`dustField`) reads a picture — Core Image counts y up, and a field
//   read bottom row first would propose every spot mirrored, a ring on the
//   sky above a mark on the ground;
// - the repaired picture the Detail tab draws while the stage's plan does not
//   draw the repair heals the spot where the stage shows it — the patch runs
//   on the source, then through the plan (`RepairLooking.frame`) — and a list
//   with no patch draws the picture untouched.
//
// Same fixtures as the render gate (`RepairPassTests`) and the kernel's own
// dust spec (`RepairTests`), so a failure here is about the app's plumbing,
// never about the maths.

import AtelierKit
import CoreImage
import XCTest
@testable import Atelier

final class RepairLookingTests: XCTestCase {
    private func decoded(_ img: DetailImage) -> DecodedPicture {
        DecodedPicture(image: NeighbourhoodGate.image(img), properties: [:], isRaw: false)
    }

    /// The red code of `image` at pixel (x, y), the top row first.
    private func code(_ image: CGImage, _ x: Int, _ y: Int) -> Double {
        guard let data = image.dataProvider?.data, let base = CFDataGetBytePtr(data) else { return .nan }
        let step = max(1, image.bitsPerPixel / 8)
        let at = y * image.bytesPerRow + x * step
        guard at < CFDataGetLength(data) else { return .nan }
        return Double(base[at])
    }

    func testTheDustFieldIsReadOffTheDecodeTopRowFirst() throws {
        let width = 400
        let height = 300
        // The kernel spec's deep spot, twice: one near the TOP, one near the bottom.
        let img = DetailImage(width: width, height: height) { x, y in
            var v = 0.7
            if hypot(Double(x - 100), Double(y - 60)) < 4 { v = 0.4 }
            if hypot(Double(x - 300), Double(y - 220)) < 4 { v = 0.4 }
            return (v, v, v)
        }
        let field = try XCTUnwrap(PicturePool.dustField(of: decoded(img), context: NeighbourhoodGate.context))
        XCTAssertEqual(field.width, width, "a picture under the scan's edge is walked at its own size")
        XCTAssertEqual(field.height, height)
        let spots = dustSpots(field, threshold: dustThreshold(1))
        XCTAssertEqual(spots.count, 2, "\(spots)")
        let w = Double(width)
        let h = Double(height)
        let top = spots.contains { abs($0.x * w - 100) < 3 && abs($0.y * h - 60) < 3 }
        let bottom = spots.contains { abs($0.x * w - 300) < 3 && abs($0.y * h - 220) < 3 }
        XCTAssertTrue(top, "the spot near the top was not found where it is: \(spots)")
        XCTAssertTrue(bottom, "the spot near the bottom was not found where it is: \(spots)")

        // The map is the field's size, white at the spot and black on the sky.
        let veil = try XCTUnwrap(RepairLooking.veil(field, threshold: dustThreshold(0.5)))
        XCTAssertEqual(veil.width, width)
        XCTAssertEqual(veil.height, height)
        XCTAssertEqual(code(veil, 100, 60), 255)
        XCTAssertEqual(code(veil, 10, 10), 0)
    }

    func testTheRepairedPictureHealsTheSpotWhereTheStageDrawsIt() throws {
        guard NeighbourhoodGate.hasMetal else {
            throw XCTSkip("no Metal device here: the stage's context would not run the repair kernel")
        }
        let img = RepairPassTests.picture
        let source = decoded(img)
        let picture = createRollPicture(SavedMediaRef(name: "fixture.png", size: 0, lastModified: 0))
        let plan = DefaultDevelopRenderPlan()

        let untouched = try XCTUnwrap(RepairLooking.frame(picture: picture, patches: [], decoded: source, plan: plan))
        XCTAssertEqual(untouched.width, RepairPassTests.width)
        XCTAssertEqual(untouched.height, RepairPassTests.height)

        // The gate's heal over the spot at (24, 20) — near the TOP of the frame.
        let heal = Array(RepairPassTests.patches.prefix(1))
        let repaired = try XCTUnwrap(RepairLooking.frame(picture: picture, patches: heal, decoded: source, plan: plan))
        let before = code(untouched, 24, 20)
        let after = code(repaired, 24, 20)
        XCTAssertGreaterThan(after, before + 40, "the spot went \(before) → \(after): NOT healed where the stage draws it")
        // Far from the patch, nothing moved.
        XCTAssertEqual(code(repaired, 60, 50), code(untouched, 60, 50), accuracy: 1)
    }
}
