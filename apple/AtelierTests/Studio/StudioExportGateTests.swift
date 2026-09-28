// The Studio export gate: a two-second clip painted here, then exported
// through the ONE path the Export tab runs (`StudioVariantExport.video`, over
// `exportProcessedVideo`) at two variants — a master at the source frame and
// cadence with the overlays burnt in and the outro appended, and a clean 9:16
// reel at 180 on the short side and 24 fps — and each file read back: its
// size, its length, its cadence, and the burnt-in element's own pixels (a
// magenta box, where the clip is green) in the master and nowhere in the
// clean reel. Then a still through `StudioVariantExport.still`: its variant
// frame, its box, and the signature every delivered picture carries.
//
// Hosted by the Mac app like the render gate: it needs the device's H.264
// encoder and the brand faces the app registers.

import AVFoundation
import AtelierKit
import CoreGraphics
import CoreImage
import ImageIO
import XCTest
@testable import Atelier

final class StudioExportGateTests: XCTestCase {
    private var made: [URL] = []

    override func setUp() {
        super.setUp()
        Brand.registerFonts()
    }

    override func tearDown() {
        for url in made { try? FileManager.default.removeItem(at: url) }
        made = []
        super.tearDown()
    }

    // MARK: - fixtures

    /// The clip's flat green.
    private let clipColour = CIColor(red: 0.1, green: 0.45, blue: 0.2)

    /// Two seconds of a flat green 640×360 frame at 30 fps, as H.264.
    private func syntheticClip() async throws -> URL {
        let frame = CIImage(color: clipColour).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 360))
        let url = try await encodeFrames(width: 640, height: 360, seconds: 2, fps: 30, draw: { _ in frame })
        made.append(url)
        return url
    }

    /// A text element on a solid magenta box, in the middle of the frame —
    /// ink no green clip holds.
    private func magentaBox() -> OverlayElement {
        var el = createTextElement("MMMM", id: "burn")
        el.anchor = .center
        el.x = 0.5
        el.y = 0.5
        el.sizeFrac = 0.18
        el.color = "#ff00ff"
        el.legibility = LegibilityStyle(mode: .box, color: "#ff00ff", padFrac: 0.4)
        return el
    }

    private func input(outro: OutroCard?) -> StudioRenderInput {
        StudioRenderInput(elements: [magentaBox()], cues: [], cube: nil, film: nil, theme: nil, timeShift: nil,
                          scenes: [], trim: nil, outro: outro)
    }

    private func isMagenta(_ p: PaintRaster.Pixel) -> Bool {
        p.r > 170 && p.b > 170 && p.g < 110
    }

    private func isClipGreen(_ p: PaintRaster.Pixel) -> Bool {
        p.g > 80 && p.g < 150 && p.r < 70 && p.b < 90
    }

    // MARK: - reading a file back

    private struct Facts {
        let width: Int
        let height: Int
        let seconds: Double
        let fps: Double
        let bytes: Int
    }

    private func facts(_ url: URL) async throws -> Facts {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let track = try XCTUnwrap(tracks.first)
        let (size, fps) = try await track.load(.naturalSize, .nominalFrameRate)
        return Facts(width: Int(size.width.rounded()), height: Int(size.height.rounded()), seconds: duration.seconds,
                     fps: Double(fps), bytes: StudioVariantExport.bytes(url))
    }

    /// The frame at `seconds`, decoded exactly there, as readable pixels.
    private func frame(_ url: URL, at seconds: Double) async throws -> PaintRaster {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let (image, _) = try await generator.image(at: CMTime(seconds: seconds, preferredTimescale: 600))
        return PaintRaster.render(image.width, image.height) { cg, size in
            cg.draw(image, in: CGRect(origin: .zero, size: size))
        }
    }

    private func share(_ raster: PaintRaster, _ test: (PaintRaster.Pixel) -> Bool) -> Double {
        Double(raster.points(where: test).count) / Double(max(1, raster.width * raster.height))
    }

    // MARK: - the clip

    func testTwoVariantsLeaveAtTheirSizeLengthAndCadenceWithTheOverlayBurntInOnlyWhereAsked() async throws {
        let clip = try await syntheticClip()
        let source = try await VideoSource.open(clip)
        var outro = createOutroCard("Merci")
        outro.seconds = 1
        let drawn = input(outro: outro)

        // The master: the source frame and cadence, the overlays in, the card appended.
        let master = ExportVariant(id: "master")
        // A reel: 9:16 cover-cropped, 180 on the short side, 24 fps, clean — no box, no card.
        let reel = ExportVariant(id: "reel", aspectId: "9:16", resolution: .shortSide(180), frameRate: .fps(24),
                                 overlays: false)
        XCTAssertEqual(variantOutputSize(reel, 640, 360), AtelierKit.Size(180, 320))

        let a = try await StudioVariantExport.video(source, master, drawn)
        made.append(a)
        let b = try await StudioVariantExport.video(source, reel, drawn)
        made.append(b)

        let fa = try await facts(a)
        XCTAssertEqual(fa.width, 640)
        XCTAssertEqual(fa.height, 360)
        XCTAssertEqual(fa.seconds, 3, accuracy: 0.1, "two seconds of footage, then the one-second card")
        XCTAssertEqual(fa.fps, 30, accuracy: 0.5)
        XCTAssertGreaterThan(fa.bytes, 1_000)

        let fb = try await facts(b)
        XCTAssertEqual(fb.width, 180)
        XCTAssertEqual(fb.height, 320)
        XCTAssertEqual(fb.seconds, 2, accuracy: 0.1, "a clean variant carries no card: its length is the footage's")
        XCTAssertEqual(fb.fps, 24, accuracy: 0.5, "the cadence is resampled onto the variant's grid")
        XCTAssertGreaterThan(fb.bytes, 1_000)

        // The element's pixels are burnt into the master, over the clip…
        let footage = try await frame(a, at: 1)
        XCTAssertGreaterThan(share(footage, isMagenta), 0.01, "the magenta box is in the master's footage")
        XCTAssertTrue(isMagenta(footage.pixel(footage.width / 2, footage.height / 2)), "the box sits on the frame's centre")
        XCTAssertGreaterThan(share(footage, isClipGreen), 0.5, "the clip itself is still there around it")
        // …the card follows the footage, and the clip's green is gone…
        let card = try await frame(a, at: 2.5)
        XCTAssertLessThan(share(card, isClipGreen), 0.01, "past the footage the master shows the outro card")
        // …and the clean reel carries none of it.
        let clean = try await frame(b, at: 1)
        XCTAssertEqual(clean.points(where: isMagenta).count, 0, "a clean variant burns nothing in")
        XCTAssertGreaterThan(share(clean, isClipGreen), 0.9)
    }

    func testATrimmedVariantLastsTheCut() async throws {
        let clip = try await syntheticClip()
        let source = try await VideoSource.open(clip)
        var cut = input(outro: nil)
        cut.trim = TrimRange(start: 0.5, end: 1.5)
        let file = try await StudioVariantExport.video(source, ExportVariant(id: "cut"), cut)
        made.append(file)
        let read = try await facts(file)
        XCTAssertEqual(read.seconds, 1, accuracy: 0.1, "only the trimmed second leaves")
        XCTAssertEqual(read.fps, 30, accuracy: 0.5)
    }

    // MARK: - a still

    func testAStillLeavesAsASignedJpegAtItsVariantFrameWithItsBox() throws {
        let picture = CIImage(color: clipColour).cropped(to: CGRect(x: 0, y: 0, width: 1200, height: 800))
        let square = ExportVariant(id: "square", aspectId: "1:1", overlays: true)
        let data = try StudioVariantExport.still(picture, square, input(outro: nil), head: nil, vouched: nil, now: 0)

        let source = try XCTUnwrap(CGImageSourceCreateWithData(data as CFData, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(image.width, 800, "1:1 cover-cropped at the source's density")
        XCTAssertEqual(image.height, 800)
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let tiff = properties?[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        XCTAssertEqual(tiff?[kCGImagePropertyTIFFSoftware] as? String, atelierSoftware, "every delivered picture is signed")

        let raster = PaintRaster.render(image.width, image.height) { cg, size in
            cg.draw(image, in: CGRect(origin: .zero, size: size))
        }
        XCTAssertGreaterThan(share(raster, isMagenta), 0.01, "the box is burnt into the still")

        let bare = try StudioVariantExport.still(picture, ExportVariant(id: "bare", overlays: false), input(outro: nil),
                                                 head: nil, vouched: nil, now: 0)
        let bareSource = try XCTUnwrap(CGImageSourceCreateWithData(bare as CFData, nil))
        let bareImage = try XCTUnwrap(CGImageSourceCreateImageAtIndex(bareSource, 0, nil))
        XCTAssertEqual(bareImage.width, 1200)
        XCTAssertEqual(bareImage.height, 800)
        let bareRaster = PaintRaster.render(bareImage.width, bareImage.height) { cg, size in
            cg.draw(bareImage, in: CGRect(origin: .zero, size: size))
        }
        XCTAssertEqual(bareRaster.points(where: isMagenta).count, 0, "a clean still burns nothing in")
    }

    // MARK: - the frame

    func testCoveredFillsTheFrameCentredAndNeverLeavesAnEdge() {
        let wide = CIImage(color: clipColour).cropped(to: CGRect(x: 0, y: 0, width: 1920, height: 1080))
        let tall = StudioVariantExport.covered(wide, width: 1080, height: 1920)
        XCTAssertEqual(tall.extent, CGRect(x: 0, y: 0, width: 1080, height: 1920))
        let small = StudioVariantExport.covered(wide, width: 640, height: 360)
        XCTAssertEqual(small.extent, CGRect(x: 0, y: 0, width: 640, height: 360))
    }
}
