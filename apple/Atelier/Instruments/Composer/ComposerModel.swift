// The Composer's state — `src/tools/composer/ComposerTool.tsx`: the active
// DJI clip and its flight log, the output (aspect, quality), the layout, the
// map's zoom and follow, the look, the readout card and where it sits; the
// live composite on the stage; the MP4 export and, natively, a PNG of the
// frame under the playhead.
//
// The composite is `ComposerPainter`'s, at the preview's size for the stage
// and at the output's for a file. The preview's clip frame is graded at no
// more than 1280 px on its long edge (the web's `GRADE_MAX`), the export's
// at the clip's own size, through the render graph's grader.

import AVFoundation
import CoreImage
import Foundation
import ImageIO
import Observation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// The web's `ASPECTS`.
struct ComposerAspect: Identifiable, Hashable {
    let id: String
    let w: Double
    let h: Double

    static let all = [
        ComposerAspect(id: "16:9", w: 16, h: 9),
        ComposerAspect(id: "9:16", w: 9, h: 16),
        ComposerAspect(id: "1:1", w: 1, h: 1),
        ComposerAspect(id: "4:5", w: 4, h: 5),
    ]
}

@MainActor
@Observable
final class ComposerModel {
    let look = InstrumentLook()
    let playback = InstrumentPlayback()
    let stage = StageRenderer()
    @ObservationIgnored let tap = ClipFrameTap()
    @ObservationIgnored let grader = FrameGrader()
    @ObservationIgnored let cubes = LookCubes()

    /// Every setting of the page — the web's `useState`s, as one value.
    var settings = ComposerSettings()

    private(set) var clipURL: URL?
    private(set) var clipName = ""
    private(set) var srtRef: SavedMediaRef?
    @ObservationIgnored private var frame: CIImage?
    @ObservationIgnored private var primed = false

    /// The cap on how big a preview frame is graded (the web's `GRADE_MAX`).
    nonisolated static let gradeMax = 1280

    // MARK: - the clip and its log

    var telemetry: TelemetryTrack? { TelemetryTracks.shared.track(for: srtRef) }

    func open(_ asset: Asset?, shelf: InstrumentShelf) async {
        let url = asset?.parts.video.flatMap { shelf.url(for: $0) }
        srtRef = asset?.parts.srt
        clipName = asset?.parts.video?.name ?? ""
        guard url != clipURL else { return }
        clipURL = url
        frame = nil
        primed = false
        stage.clear()
        tap.detach()
        playback.load(nil)
        guard let url else { return }
        let opened = try? await VideoSource.open(url)
        guard clipURL == url else { return }
        playback.load(url)
        tap.attach(playback.player.currentItem, metadata: opened?.metadata)
    }

    /// The cue under the playhead (the web's `useActiveCue`).
    var cue: Cue? { cueAt(telemetry?.cues ?? [], playback.time) }

    /// The preview's scene now.
    var previewScene: ComposerScene {
        settings.scene(cue: cue, track: telemetry?.track ?? [], size: settings.previewSize, scale: 1)
    }

    // MARK: - the stage

    /// Pick up a new frame of the clip — about sixty looks a second.
    func pullFrame() {
        guard let item = playback.player.currentItem else { return }
        if frame == nil, !primed, item.status == .readyToPlay {
            primed = true
            playback.seek(to: 0)
        }
        guard let next = tap.newFrame(at: item.currentTime()) else { return }
        frame = next
        rerender()
    }

    /// Compose the stage again: a setting, the look, the cue or the frame changed.
    func rerender() {
        guard clipURL != nil else {
            stage.clear()
            return
        }
        let scene = previewScene
        let video = frame
        let grade = look.grade
        let grader = self.grader
        let cubes = self.cubes
        stage.submit {
            ComposerModel.render(video: video, maxEdge: ComposerModel.gradeMax, grade: grade,
                                 grader: grader, cubes: cubes, scene: scene)
        }
    }

    /// `video` brought under `maxEdge` (never up), graded, composed.
    nonisolated static func render(video: CIImage?, maxEdge: Int?, grade: LookGrade?, grader: FrameGrader,
                                   cubes: LookCubes, scene: ComposerScene) -> CGImage? {
        var source = video
        if let current = source, let maxEdge {
            source = FrameGrader.fit(current, longEdge: maxEdge).image
        }
        if let current = source, let grade {
            let resolved = cubes.resolve(grade)
            grader.setCube(resolved.lut, intensity: resolved.intensity, interpolation: grade.interpolation)
            source = grader.render(source: current)
        }
        return FrameGrader.cgImage(ComposerPainter.composite(video: source, scene: scene))
    }

    /// The card dragged: its corner, in preview pixels, becomes its place.
    func moveReadout(corner: AtelierKit.Point) {
        settings.readoutPos = readoutDragPosition(corner: corner, frame: settings.previewSize)
    }

    // MARK: - the PNG of the frame under the playhead

    private(set) var savingFrame = false

    /// The composite at the OUTPUT's size for the frame on the stage, as PNG
    /// bytes — the same painter as the export's.
    func framePNG() async -> Data? {
        guard let frame else { return nil }
        savingFrame = true
        defer { savingFrame = false }
        let settings = self.settings
        let track = telemetry?.track ?? []
        let cue = self.cue
        let grade = look.grade
        return await Task.detached(priority: .userInitiated) { () -> Data? in
            let size = settings.out
            let scale = size.height / max(1, settings.previewSize.height)
            let scene = settings.scene(cue: cue, track: track, size: size, scale: scale)
            let grader = FrameGrader()
            guard let image = ComposerModel.render(video: frame, maxEdge: nil, grade: grade, grader: grader,
                                                   cubes: LookCubes(), scene: scene) else { return nil }
            return ComposerModel.png(image)
        }.value
    }

    nonisolated static func png(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data as CFMutableData, UTType.png.identifier as CFString,
                                                                 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    // MARK: - the MP4

    private(set) var exporting = false
    /// 0…1 while encoding, nil while the run prepares ("Rendering…").
    private(set) var exportRatio: Double?
    private(set) var exportError: String?
    /// The finished file, waiting for the person to put it somewhere.
    var exported: URL?
    /// The temporary folder it was written into, removed once it is moved.
    @ObservationIgnored private var exportFolder: URL?
    @ObservationIgnored private var exportTask: Task<Void, Never>?

    /// Render the composition to an MP4 — the shared pipeline at the
    /// output's size, every frame through `ComposerPainter`. The map follows
    /// the aircraft in the file too when Follow is on: preview = export.
    func exportMP4() {
        guard let url = clipURL, !exporting else { return }
        discardExported()
        playback.pause()
        exporting = true
        exportRatio = nil
        exportError = nil
        let settings = self.settings
        let cues = telemetry?.cues ?? []
        let track = telemetry?.track ?? []
        let grade = look.grade
        let name = clipName
        let handle = TaskCenter.start(
            "Exporting \(name.isEmpty ? "the composition" : name)", progress: nil,
            cancel: { [weak self] in
                let owner = self
                Task { @MainActor in owner?.cancelExport() }
            }
        )
        let model = self
        exportTask = Task.detached(priority: .userInitiated) {
            defer { handle.done() }
            do {
                let file = try await ComposerModel.exportComposition(
                    url, name: name, settings: settings, cues: cues, track: track, grade: grade
                ) { ratio in
                    handle.update(TaskPatch(progress: ratio))
                    Task { @MainActor in model.exportProgress(ratio) }
                }
                await model.exportEnded(file: file, error: nil)
            } catch is CancellationError {
                await model.exportEnded(file: nil, error: nil)
            } catch {
                await model.exportEnded(file: nil, error: error.localizedDescription)
            }
        }
    }

    func cancelExport() {
        exportTask?.cancel()
    }

    private func exportProgress(_ ratio: Double) {
        guard exporting else { return }
        let last = exportRatio ?? -1
        if ratio >= 1 || abs(ratio - last) >= 0.005 { exportRatio = ratio }
    }

    private func exportEnded(file: URL?, error: String?) {
        exporting = false
        exportRatio = nil
        exportTask = nil
        exportError = error
        exportFolder = file?.deletingLastPathComponent()
        exported = file
    }

    /// The file was put where the person asked, or they declined: what the
    /// export left in the temporary folder goes either way (and, should a
    /// panel close without saying, at the next export).
    func discardExported() {
        if let folder = exportFolder { try? FileManager.default.removeItem(at: folder) }
        exportFolder = nil
        exported = nil
    }

    nonisolated static func exportComposition(_ url: URL, name: String, settings: ComposerSettings, cues: [Cue],
                                              track: [TrackPoint], grade: LookGrade?,
                                              onRatio: @escaping (Double) -> Void) async throws -> URL {
        let source = try await VideoSource.open(url)
        let resolved = grade.map { LookCubes().resolve($0) }
        let interpolation = grade?.interpolation ?? .tetrahedral
        let size = settings.out
        let scale = size.height / max(1, settings.previewSize.height)
        var options = VideoExportOptions()
        options.outputSize = CGSize(width: size.width, height: size.height)
        let temp = try await exportProcessedVideo(
            source,
            makeProcessor: { _ in
                let grader = resolved.map {
                    FrameGrader(lut: $0.lut, intensity: $0.intensity, interpolation: interpolation)
                }
                return FrameProcessor(draw: { image, seconds in
                    let cue = findCue(cues, seconds)
                    let scene = settings.scene(cue: cue, track: track, size: size, scale: scale)
                    let video = grader.map { $0.render(source: image) } ?? image
                    return ComposerPainter.composite(video: video, scene: scene)
                })
            },
            onProgress: { progress in
                if progress.phase == .encoding, let ratio = progress.ratio { onRatio(ratio) }
            },
            isCancelled: { Task.isCancelled },
            options: options
        )
        // Named the web's way, in a folder of its own for the mover to take.
        let folder = try InstrumentShelf.copyFolder()
        let named = folder.appendingPathComponent(instrumentOutputName(name.isEmpty ? "clip.mp4" : name, "composition"))
        do {
            try FileManager.default.moveItem(at: temp, to: named)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
        return named
    }
}
