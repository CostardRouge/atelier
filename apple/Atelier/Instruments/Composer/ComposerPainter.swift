// The Composer's frame — `src/tools/composer/ComposerTool.tsx`'s `draw`,
// `export-composition.ts`'s per-frame `draw` and `draw-readout.ts`, as ONE
// function the preview, the PNG and every frame of the MP4 go through: the
// same code at two sizes, which is the web's own rule for this page.
//
// The frame is black; the video pane holds the (graded, upright) clip fitted
// by the kernel's `fitRect`; the map pane holds the flight path drawn by
// `TrackPainter` on its paper; the readout card sits over both. Under a
// `pip-video` layout the map is the full frame and is drawn FIRST.
//
// Built in Core Image so a clip's frame never leaves the GPU: the video is
// cropped and placed by transforms, the map and the card are painted by Core
// Graphics into frame-sized rasters (`Paint/OverlayRaster.swift`) laid over
// it. The context keeps colour management off, so a raster's sRGB codes
// land on the frame as the web's canvas lays them.
//
// The map is framed on the PREVIEW's pane and scaled to the size drawn — the
// web's `cameraForTrack(previewScale)` — so the export shows the map at the
// scale the person set up; the line and the dot scale with it.

import CoreGraphics
import CoreImage
import Foundation
import AtelierKit

/// The web preview's cap on its canvas's long edge.
let composerPreviewMax = 1440.0

/// Everything the page lets the person set, as a value: what an export
/// takes with it when it starts, while the page goes on changing.
struct ComposerSettings: Sendable, Equatable {
    var aspectW: Double = 9
    var aspectH: Double = 16
    var quality: Double = 1920
    var layout: LayoutKind = .stacked
    var split: Double = 0.6
    var inset: Double = 0.3
    var corner: Corner = .br
    var videoFit: Fit = .cover
    var zoomOffset: Double = 0
    var follow = true
    var overlay = ComposerOverlayConfig.default
    var readoutPos = AtelierKit.Point(0.04, 0.8)

    /// The output frame (even pixels).
    var out: AtelierKit.Size { outputSize(aspectW, aspectH, quality) }

    /// How much smaller the preview is than the output (≤ 1).
    var previewScale: Double {
        let size = out
        return min(1, composerPreviewMax / max(size.width, size.height))
    }

    /// The preview canvas, in pixels.
    var previewSize: AtelierKit.Size {
        let size = out
        let k = previewScale
        return AtelierKit.Size((size.width * k).rounded(), (size.height * k).rounded())
    }

    /// The frame at `size` for `cue`: `scale` is how many of these pixels
    /// make one of the preview's (1 for the preview itself).
    func scene(cue: Cue?, track: [TrackPoint], size: AtelierKit.Size, scale: Double) -> ComposerScene {
        let panes = paneRects(size.width, size.height, layout, split, inset, corner)
        let fix = cue.flatMap(parsePosition)
        let position = fix ?? track.first.map { LonLat(lon: $0.lon, lat: $0.lat) }
        let preview = previewSize
        let previewPane = paneRects(preview.width, preview.height, layout, split, inset, corner).map
        let paneSize = AtelierKit.Size(previewPane.width, previewPane.height)
        var camera = fitTrackCamera(track, viewport: paneSize, padding: 40, maxZoom: 16, singleZoom: 15)
        let levels = zoomOffset + log2(max(1e-6, scale))
        camera = camera?.zoomed(by: levels)
        if follow, let position {
            camera = camera?.centred(lat: position.lat, lon: position.lon)
        }
        return ComposerScene(size: size, panes: panes, videoFit: videoFit, mapFirst: layout == .pipVideo,
                             track: track, camera: camera, position: position, strokeScale: scale,
                             overlay: overlay, readoutPos: readoutPos, cue: cue)
    }
}

/// One frame's worth of what is drawn around the video.
struct ComposerScene: Sendable {
    let size: AtelierKit.Size
    let panes: PaneRects
    let videoFit: Fit
    /// `pip-video`: the map is the full frame, under the video.
    let mapFirst: Bool
    let track: [TrackPoint]
    let camera: TrackCamera?
    let position: LonLat?
    /// The map's line and dot, in multiples of their preview size.
    let strokeScale: Double
    let overlay: ComposerOverlayConfig
    let readoutPos: AtelierKit.Point
    let cue: Cue?
}

enum ComposerPainter {
    /// The web's `FONT_STACK`.
    static func fontStack(_ font: ComposerOverlayFont) -> [String] {
        switch font {
        case .mono: return ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
        case .sans: return ["system-ui", "-apple-system", "Segoe UI", "sans-serif"]
        case .serif: return ["Georgia", "Times New Roman", "serif"]
        }
    }

    // MARK: - the frame

    /// The composite at the scene's size, `video` being the clip's frame
    /// (upright, graded or not) or nil before one has decoded.
    static func composite(video: CIImage?, scene: ComposerScene) -> CIImage {
        let w = scene.size.width
        let h = scene.size.height
        let frame = CGRect(x: 0, y: 0, width: w, height: h)
        var out = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: frame)
        let placed = video.map { place($0, in: scene.panes.video, fit: scene.videoFit, frameHeight: h) }

        if scene.mapFirst {
            if let map = raster(scene, map: true, readout: false) { out = map.composited(over: out) }
            if let placed { out = placed.composited(over: out) }
            if let card = raster(scene, map: false, readout: true) { out = card.composited(over: out) }
        } else {
            if let placed { out = placed.composited(over: out) }
            if let top = raster(scene, map: true, readout: true) { out = top.composited(over: out) }
        }
        return out.cropped(to: frame)
    }

    /// The video cropped and scaled into its pane by `fitRect` — computed in
    /// the web's top-left pixels, turned into Core Image's bottom-left ones.
    static func place(_ video: CIImage, in pane: AtelierKit.Rect, fit: Fit, frameHeight: Double) -> CIImage {
        let e = video.extent
        let srcW = Double(e.width)
        let srcH = Double(e.height)
        let f = fitRect(srcW, srcH, pane, fit)
        guard f.sw > 0, f.sh > 0, f.dw > 0, f.dh > 0 else { return video.cropped(to: .zero) }
        let crop = CGRect(x: e.minX + f.sx, y: e.minY + (srcH - f.sy - f.sh), width: f.sw, height: f.sh)
        let dest = CGRect(x: f.dx, y: frameHeight - f.dy - f.dh, width: f.dw, height: f.dh)
        let toOrigin = CGAffineTransform(translationX: -crop.minX, y: -crop.minY)
        let scale = CGAffineTransform(scaleX: dest.width / crop.width, y: dest.height / crop.height)
        let toPane = CGAffineTransform(translationX: dest.minX, y: dest.minY)
        let moved = video.cropped(to: crop)
            .transformed(by: toOrigin)
            .samplingLinear()
            .transformed(by: scale)
            .transformed(by: toPane)
        return moved.cropped(to: dest)
    }

    /// The map pane and/or the readout card, painted into a frame-sized
    /// raster; nil when there is nothing to paint.
    static func raster(_ scene: ComposerScene, map: Bool, readout: Bool) -> CIImage? {
        let showsCard = readout && scene.overlay.show
        guard map || showsCard else { return nil }
        let w = Int(scene.size.width.rounded())
        let h = Int(scene.size.height.rounded())
        return OverlayRaster.ciImage(width: w, height: h) { cg, _ in
            if map { paintMap(cg, scene: scene) }
            if showsCard {
                let canvas = PaintCanvas(cg, width: scene.size.width, height: scene.size.height)
                _ = drawReadout(canvas, scene: scene)
                canvas.finish()
            }
        }
    }

    static func paintMap(_ cg: CGContext, scene: ComposerScene) {
        let pane = scene.panes.map
        guard pane.width >= 1, pane.height >= 1 else { return }
        let rect = CGRect(x: pane.x, y: pane.y, width: pane.width, height: pane.height)
        TrackPainter.draw(cg, in: rect, track: scene.track, position: scene.position, camera: scene.camera,
                          scale: CGFloat(scene.strokeScale))
    }

    // MARK: - the readout card (`draw-readout.ts`)

    /// Paint the card for the scene's cue; the box it took, or nil when
    /// hidden or empty. Its arithmetic is the kernel's (`ComposerReadout`).
    @discardableResult
    static func drawReadout(_ canvas: PaintCanvas, scene: ComposerScene) -> ReadoutBox? {
        let cfg = scene.overlay
        guard cfg.show else { return nil }
        let lines = buildReadoutLines(scene.cue, cfg)
        guard !lines.isEmpty else { return nil }
        let metrics = readoutMetrics(frameHeight: scene.size.height, fontScale: cfg.fontScale)
        canvas.font = PaintFont(fontStack(cfg.font), size: metrics.fontSize, weight: 600)
        canvas.textBaseline = .alphabetic
        canvas.textAlign = .left
        var widest = 0.0
        for line in lines { widest = max(widest, canvas.measureText(line).width) }
        guard let box = readoutBox(pos: scene.readoutPos, frame: scene.size, maxLineWidth: widest,
                                   lineCount: lines.count, metrics: metrics, radius: cfg.radius) else { return nil }
        canvas.setFill(readoutRgba(cfg.bgColor, cfg.bgOpacity))
        canvas.roundRectPath(box.rect.x, box.rect.y, box.rect.width, box.rect.height, box.radius)
        canvas.fill()
        canvas.setFill(cfg.textColor)
        for (i, line) in lines.enumerated() where i < box.baselines.count {
            canvas.fillText(line, box.textX, box.baselines[i])
        }
        return box
    }

    /// Where the card is, without painting it — the preview's hit area for
    /// a drag, measured with the very faces the painter sets.
    static func readoutArea(_ scene: ComposerScene) -> AtelierKit.Rect? {
        let cfg = scene.overlay
        guard cfg.show else { return nil }
        let lines = buildReadoutLines(scene.cue, cfg)
        guard !lines.isEmpty else { return nil }
        let metrics = readoutMetrics(frameHeight: scene.size.height, fontScale: cfg.fontScale)
        let font = PaintFont(fontStack(cfg.font), size: metrics.fontSize, weight: 600)
        let widest = lines.map { PaintFonts.line($0, font).width }.max() ?? 0
        return readoutBox(pos: scene.readoutPos, frame: scene.size, maxLineWidth: widest,
                          lineCount: lines.count, metrics: metrics, radius: cfg.radius)?.rect
    }
}
