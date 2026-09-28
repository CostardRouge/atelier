// The painters that put PICTURES on a frame — `drawFramed`, a collage's cells,
// a delivered picture on its border — and the editor's guides, held to the
// web's rules: bars only where `contain` asked for them, and black; an empty
// cell draws nothing; a cell's picture stays inside its cell; a border's
// colour is the ground and the crop sits in its rectangle; the blur fill is
// made from the kernel's small copy; the grid's lines fall where the kernel
// puts them, and the safe zone dims what the platform hides.

import AtelierKit
import CoreGraphics
import XCTest
@testable import Atelier

final class PicturePainterTests: XCTestCase {
    private let red = PaintRaster.Pixel(r: 255, g: 0, b: 0, a: 255)
    private let black = PaintRaster.Pixel(r: 0, g: 0, b: 0, a: 255)

    // MARK: framing

    func testCoverFillsTheFrameAndContainPaintsBlackBars() {
        let wide = PaintPicture(PaintRaster.solid(200, 100, 255, 0, 0))
        let cover = PaintRaster.render(100, 100) { cg, size in
            CellPainter.drawFramed(in: cg, size: size, wide)
        }
        XCTAssertEqual(cover.pixel(50, 2), red)
        XCTAssertEqual(cover.pixel(50, 97), red)
        var whole = Framing.default
        whole.fit = .contain
        let contain = PaintRaster.render(100, 100) { cg, size in
            CellPainter.drawFramed(in: cg, size: size, wide, whole)
        }
        XCTAssertEqual(contain.pixel(50, 10), black, "a bar above")
        XCTAssertEqual(contain.pixel(50, 50), red)
        XCTAssertEqual(contain.pixel(50, 90), black, "and below")
    }

    func testAFlipMirrorsWhatTheFrameShows() {
        // Left half red, right half blue.
        var rgba = [UInt8](repeating: 255, count: 4 * 2 * 4)
        for y in 0..<2 {
            for x in 0..<4 {
                let i = (y * 4 + x) * 4
                if x < 2 { rgba[i + 1] = 0; rgba[i + 2] = 0 } else { rgba[i] = 0; rgba[i + 1] = 0 }
            }
        }
        let picture = PaintPicture(OverlayRaster.image(rgba: rgba, width: 4, height: 2)!)
        let flipped = PaintRaster.render(80, 40) { cg, size in
            CellPainter.drawFramed(in: cg, size: size, picture, flipFraming(.default, axis: "x"))
        }
        XCTAssertEqual(flipped.pixel(10, 20).b, 255, "blue now on the left")
        XCTAssertEqual(flipped.pixel(70, 20).r, 255, "red on the right")
    }

    // MARK: cells

    func testACellsPictureStaysInItsCellAndAnEmptyCellDrawsNothing() {
        let picture = PaintPicture(PaintRaster.solid(300, 200, 255, 0, 0))
        let cells = [
            CellRect(x: 10, y: 10, width: 80, height: 80, rotation: 0, mount: .none),
            CellRect(x: 110, y: 10, width: 80, height: 80, rotation: 0, mount: .none),
        ]
        let spacing = LayoutSpacing(gap: 0, padding: 0, radius: 0)
        let raster = PaintRaster.render(200, 100) { cg, size in
            CellPainter.drawLayout(in: cg, size: size, cells: cells, CellPainter.LayoutOptions(
                picture: { $0 == 0 ? picture : nil },
                framing: { _ in .default },
                spacing: spacing
            ))
        }
        XCTAssertEqual(raster.pixel(50, 50), red)
        XCTAssertEqual(raster.pixel(5, 50).a, 0, "outside the cell")
        XCTAssertEqual(raster.pixel(150, 50).a, 0, "the empty cell shows the ground")
    }

    func testAPrintSitsOnPaperAndACellHalfFadedIsHalfSeen() {
        let picture = PaintPicture(PaintRaster.solid(100, 100, 255, 0, 0))
        let cell = CellRect(x: 50, y: 50, width: 100, height: 100, rotation: 0, mount: .print)
        let spacing = LayoutSpacing(gap: 0, padding: 0, radius: 0)
        let raster = PaintRaster.render(200, 200) { cg, size in
            let c = PaintCanvas(cg, width: 200, height: 200)
            CellPainter.drawCell(c, short: 200, cell, picture, .default, spacing)
            c.finish()
        }
        let paper = raster.pixel(100, 50 + 100 + 4) // under the picture, in the print's deeper foot
        XCTAssertEqual(paper.r, 0xf4)
        XCTAssertEqual(paper.g, 0xef)
        let bare = CellRect(x: 50, y: 50, width: 100, height: 100, rotation: 0, mount: .none)
        let faded = PaintRaster.render(200, 200) { cg, size in
            let c = PaintCanvas(cg, width: 200, height: 200)
            let motion = CellMotion(transform: OverlayTransform(alpha: 0.5), direction: nil)
            CellPainter.drawCell(c, short: 200, bare, picture, .default, spacing, motion: motion)
            c.finish()
        }
        XCTAssertEqual(Double(faded.pixel(100, 100).a), 127.5, accuracy: 2)
    }

    // MARK: the delivered picture

    func testAColourBorderIsTheGroundAndTheCropSitsInItsRectangle() {
        let picture = PaintPicture(PaintRaster.solid(300, 200, 255, 0, 0))
        let border = RollBorder(fill: "#ffffff", margin: RollBorder.Margin(x: 0.1, y: 0.1))
        let layout = borderLayout(300, 200, border)
        let raster = PaintRaster.render(Int(layout.w.rounded()), Int(layout.h.rounded())) { cg, _ in
            BorderPainter.drawDelivered(in: cg, picture, .default, layout, border: border)
        }
        XCTAssertEqual(raster.pixel(1, 1), .init(r: 255, g: 255, b: 255, a: 255), "the margin is the border's colour")
        XCTAssertEqual(raster.pixel(Int(layout.x + layout.pw / 2), Int(layout.y + layout.ph / 2)), red)
    }

    func testTheBlurFillIsMadeFromTheKernelsSmallCopy() throws {
        let picture = PaintPicture(PaintRaster.solid(300, 200, 0, 128, 255))
        var border = RollBorder.default
        border.fill = borderBlurFill
        let layout = borderLayout(300, 200, border)
        let fill = blurFillLayout(layout)
        let small = try XCTUnwrap(BorderPainter.blurredCopy(picture, .default, fill.sw, fill.sh))
        XCTAssertEqual(small.width, fill.sw)
        XCTAssertEqual(small.height, fill.sh)
        let raster = PaintRaster.render(Int(layout.w.rounded()), Int(layout.h.rounded())) { cg, _ in
            BorderPainter.drawDelivered(in: cg, picture, .default, layout, border: border)
        }
        // A flat picture blurs to itself; the fill is it darkened by 0.18.
        // Read in the left margin, half way down, away from the copy's edges.
        let margin = raster.pixel(Int(layout.x / 2), Int(layout.h / 2))
        XCTAssertEqual(margin.a, 255)
        XCTAssertEqual(Double(margin.b), 255 * 0.82, accuracy: 2)
        XCTAssertEqual(Double(margin.g), 128 * 0.82, accuracy: 2)
    }

    // MARK: guides

    func testTheGridsLinesFallWhereTheKernelPutsThem() {
        var guides = GuidesState.default
        guides.grid = GridConfig(show: true, cols: 3, rows: 3, snap: false)
        guides.safeZone = "none"
        let raster = PaintRaster.render(300, 300) { cg, size in
            GuidesPainter.drawGuides(in: cg, size: size, guides: guides)
        }
        XCTAssertGreaterThan(raster.pixel(100, 50).a, 0, "a line at 100.5")
        XCTAssertGreaterThan(raster.pixel(50, 200).a, 0, "and one across at 200.5")
        XCTAssertEqual(raster.pixel(50, 50).a, 0)
    }

    func testASafeZoneDimsWhatThePlatformHides() throws {
        let preset = try XCTUnwrap(safeZonePresets.first { $0.aspect < 1 })
        var guides = GuidesState.default
        guides.safeZone = preset.id
        guides.safeZoneOrientation = .upright // as authored, not turned to span the frame
        let raster = PaintRaster.render(1920, 1080) { cg, size in
            GuidesPainter.drawGuides(in: cg, size: size, guides: guides)
        }
        // A portrait zone on a landscape frame: pillarboxed, the sides dimmed.
        XCTAssertGreaterThan(raster.pixel(10, 540).a, 0)
    }
}
