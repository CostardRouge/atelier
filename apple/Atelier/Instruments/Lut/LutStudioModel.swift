// LUT Studio's state — the web's `LutStudio.tsx` + `use-lut-preview.ts` +
// `batch-export.ts`: the look, the picture on the stage (a clip's frame
// under the playhead, or a photo), the before/after wipe, and the batch
// export of every clip on the shelf.
//
// Grading is the render graph's (`Render/Graph/FrameGrader.swift`, the cube
// pass sampling tetrahedrally unless the person asked otherwise), once per
// change: a new frame, a new look, a strength step, a divider moved. The
// stage renders at the screen's pixels under the stage budget, the export at
// the clip's own; both go through the same grader recipe, so what is judged
// on the stage is what the file carries.
//
// The export is the web's: sequential, one encoder at a time, one clip
// failing reported and skipped, never aborting the rest. The web downloads
// each file as it lands; here the person picks a FOLDER first (at the
// click, as the web's rule for any picker asks) and each file is written
// there as it lands, named `<clip>-graded.mp4`, numbered if the name is taken.

import AVFoundation
import CoreImage
import Foundation
import Observation
import SwiftUI
import AtelierKit

@MainActor
@Observable
final class LutStudioModel {
    let look = InstrumentLook()
    let playback = InstrumentPlayback()
    let stage = StageRenderer()
    @ObservationIgnored let tap = ClipFrameTap()
    @ObservationIgnored let grader = FrameGrader()
    @ObservationIgnored let cubes = LookCubes()

    /// The Original / Graded switch: true shows the original.
    private(set) var bypass = false
    /// The before/after wipe.
    private(set) var compareOn = false
    /// Where the divider sits, 0…1 across the picture.
    var split = 0.5
    /// The stage's pixels, set by the view.
    var renderSize = CGSize(width: 1280, height: 720)

    /// What is on the stage now.
    enum Media: Equatable {
        case nothing
        case clip(URL)
        case photo(URL)
    }
    private(set) var media: Media = .nothing
    /// The clip's facts — size · codec · cadence (the web's `activeDetail`).
    private(set) var detail = ""
    /// Why the stage has nothing to show, when it cannot.
    private(set) var problem: String?
    private(set) var loading = false
    /// What a stopped export left behind, said once it stops.
    private(set) var note: String?

    /// The picture being graded: a photo decoded to the stage budget, or the
    /// clip's last frame.
    @ObservationIgnored private var source: CIImage?
    /// A paused player hands its first frame over once asked for one — asked once.
    @ObservationIgnored private var primed = false

    // MARK: - the switches (the web's `toggleCompare` and the two segments)

    /// The wipe needs the grade applied, so turning it on shows the grade.
    func toggleCompare() {
        compareOn.toggle()
        if compareOn { bypass = false }
    }

    func showOriginal() {
        bypass = true
        compareOn = false
    }

    func showGraded() {
        bypass = false
        compareOn = false
    }

    // MARK: - opening

    func open(_ asset: Asset?, shelf: InstrumentShelf) async {
        let video = asset?.parts.video.flatMap { shelf.url(for: $0) }
        let image = asset?.parts.image.flatMap { shelf.url(for: $0) }
        let next: Media = video.map { Media.clip($0) } ?? image.map { Media.photo($0) } ?? Media.nothing
        guard next != media else { return }
        media = next
        source = nil
        stage.clear()
        problem = nil
        detail = ""
        primed = false
        tap.detach()
        playback.load(nil)

        switch next {
        case .nothing:
            break
        case .clip(let url):
            loading = true
            let opened = try? await VideoSource.open(url)
            guard media == next else { return }
            loading = false
            if let meta = opened?.metadata {
                detail = LutStudioModel.detail(meta)
            }
            playback.load(url)
            tap.attach(playback.player.currentItem, metadata: opened?.metadata)
        case .photo(let url):
            loading = true
            let name = url.lastPathComponent
            let decoded = await Task.detached(priority: .userInitiated) { () -> (CIImage, Int, Int)? in
                guard let data = try? Data(contentsOf: url),
                      let picture = PictureDecoder.decode(data, name: name) else { return nil }
                let fitted = FrameGrader.fit(picture.image, longEdge: PictureRenderer.stageLongEdge).image
                return (fitted, picture.width, picture.height)
            }.value
            guard media == next else { return }
            loading = false
            if let decoded {
                source = decoded.0
                detail = "\(decoded.1)×\(decoded.2) · \(imageTypeLabel(name))"
                rerender()
            } else {
                problem = "This file can't be previewed on this device."
            }
        }
    }

    /// `1920×1080 · hvc1 · 30 fps` — what the web reads from the library's
    /// meta and the container probe.
    static func detail(_ meta: VideoMetadata) -> String {
        var parts = ["\(meta.displayWidth)×\(meta.displayHeight)"]
        if !meta.codec.isEmpty { parts.append(meta.codec) }
        if meta.nominalFrameRate > 0 {
            let fps = (meta.nominalFrameRate * 100).rounded() / 100
            parts.append("\(cadenceText(fps)) fps")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - the stage

    /// Pick up the clip's frame under the playhead when it is a new one —
    /// called about sixty times a second while the stage is on screen.
    func pullFrame() {
        guard case .clip = media, let item = playback.player.currentItem else { return }
        if let failure = playback.failure {
            problem = failure
            return
        }
        if source == nil, !primed, item.status == .readyToPlay {
            primed = true
            playback.seek(to: 0)
        }
        guard let frame = tap.newFrame(at: item.currentTime()) else { return }
        source = frame
        rerender()
    }

    /// Grade the picture on the stage again: the look, the switch or the
    /// divider changed, or a new frame arrived.
    func rerender() {
        guard let source else {
            stage.clear()
            return
        }
        let grade = bypass ? nil : look.grade
        let wipe: Double? = compareOn && grade != nil ? split : nil
        let size = renderSize
        let grader = self.grader
        let cubes = self.cubes
        stage.submit {
            LutStudioModel.render(source, grade: grade, wipe: wipe, size: size, grader: grader, cubes: cubes)
        }
    }

    /// The picture fitted to `size` (never up), graded, and — with a wipe —
    /// the original LEFT of the divider and the grade RIGHT of it.
    nonisolated static func render(_ source: CIImage, grade: LookGrade?, wipe: Double?, size: CGSize,
                                   grader: FrameGrader, cubes: LookCubes) -> CGImage? {
        let fitted = FrameGrader.fit(source, within: size).image
        guard let grade else { return FrameGrader.cgImage(fitted) }
        let resolved = cubes.resolve(grade)
        grader.setCube(resolved.lut, intensity: resolved.intensity, interpolation: grade.interpolation)
        let graded = grader.render(source: fitted)
        guard let wipe else { return FrameGrader.cgImage(graded) }
        let e = fitted.extent
        let right = CGRect(x: e.minX + e.width * CGFloat(wipe), y: e.minY,
                           width: e.width * CGFloat(1 - wipe), height: e.height)
        let composed = graded.cropped(to: right).composited(over: fitted)
        return FrameGrader.cgImage(composed)
    }

    // MARK: - the batch export

    enum ExportStatus: Equatable {
        case queued, exporting, done, error
    }

    struct ClipReport: Identifiable, Equatable {
        let id: String
        let name: String
        var status: ExportStatus
        /// 0…1 while encoding.
        var ratio: Double?
        var error: String?
    }

    /// Clips that entered the export — the web's `reported`.
    private(set) var reports: [ClipReport] = []
    private(set) var exporting = false
    private(set) var batchTotal = 0
    @ObservationIgnored private var exportTask: Task<Void, Never>?

    var doneCount: Int { reports.filter { $0.status == .done }.count }
    var errorCount: Int { reports.filter { $0.status == .error }.count }

    /// `(done + the running clip's share) / total`.
    var overallRatio: Double {
        guard batchTotal > 0 else { return 0 }
        let running = reports.first { $0.status == .exporting }?.ratio ?? 0
        return (Double(doneCount) + running) / Double(batchTotal)
    }

    /// Grade every clip in turn into `folder` — the web's `runBatchExport`.
    func exportAll(_ clips: [(id: String, name: String, url: URL)], to folder: URL) {
        guard !exporting, !clips.isEmpty else { return }
        playback.pause()
        exporting = true
        note = nil
        batchTotal = clips.count
        reports = clips.map { ClipReport(id: $0.id, name: $0.name, status: .queued) }
        let grade = look.grade
        let cubes = LookCubes()
        let handle = TaskRegistry.shared.startTask(
            label: "Exporting graded clips", progress: 0, detail: "1 of \(clips.count)",
            cancel: { [weak self] in
                let owner = self
                Task { @MainActor in owner?.cancelExport() }
            }
        )
        // The model is held for the run: it is what the rows report to.
        let model = self
        exportTask = Task.detached(priority: .userInitiated) {
            let scoped = folder.startAccessingSecurityScopedResource()
            defer {
                if scoped { folder.stopAccessingSecurityScopedResource() }
                handle.done()
            }
            for (index, clip) in clips.enumerated() {
                if Task.isCancelled { break }
                handle.update(TaskPatch(detail: "\(index + 1) of \(clips.count)"))
                await model.mark(clip.id, .exporting)
                do {
                    let written = try await LutStudioModel.exportOne(clip.url, name: clip.name, grade: grade,
                                                                     cubes: cubes, into: folder) { ratio in
                        handle.update(TaskPatch(progress: (Double(index) + ratio) / Double(clips.count)))
                        Task { @MainActor in model.progress(clip.id, ratio) }
                    }
                    _ = written
                    await model.mark(clip.id, .done)
                } catch is CancellationError {
                    break
                } catch {
                    await model.mark(clip.id, .error, error.localizedDescription)
                }
            }
            await model.finishExport(cancelled: Task.isCancelled)
        }
    }

    func cancelExport() {
        exportTask?.cancel()
    }

    private func mark(_ id: String, _ status: ExportStatus, _ error: String? = nil) {
        guard let i = reports.firstIndex(where: { $0.id == id }) else { return }
        reports[i].status = status
        reports[i].error = error
        if status == .done { reports[i].ratio = 1 }
        if status == .exporting { reports[i].ratio = nil }
    }

    /// Half a percent at a time — the web's rule for a per-frame report.
    private func progress(_ id: String, _ ratio: Double) {
        guard let i = reports.firstIndex(where: { $0.id == id }), reports[i].status == .exporting else { return }
        let last = reports[i].ratio ?? -1
        if ratio >= 1 || abs(ratio - last) >= 0.005 { reports[i].ratio = ratio }
    }

    private func finishExport(cancelled: Bool) {
        // A clip waiting, or the one cut off, never reached the folder: it
        // leaves the list, and the note says what did.
        let stopped = reports.contains { $0.status == .queued || $0.status == .exporting }
        reports.removeAll { $0.status == .queued || $0.status == .exporting }
        if cancelled || stopped {
            let done = doneCount
            note = "Cancelled — \(done) exported before it stopped."
        }
        exporting = false
        exportTask = nil
    }

    /// One clip through the shared pipeline (`exportProcessedVideo`), graded
    /// frame by frame in its coded orientation — the grade is per pixel, so
    /// the container's rotation flag stands, as on the web — then moved into
    /// `folder` under a free name.
    nonisolated static func exportOne(_ url: URL, name: String, grade: LookGrade?, cubes: LookCubes,
                                      into folder: URL, onRatio: @escaping (Double) -> Void) async throws -> URL {
        let source = try await VideoSource.open(url)
        let resolved = grade.map { cubes.resolve($0) }
        let interpolation = grade?.interpolation ?? .tetrahedral
        let temp = try await exportProcessedVideo(
            source,
            makeProcessor: { _ in
                let grader = FrameGrader(lut: resolved?.lut, intensity: resolved?.intensity ?? 1,
                                         interpolation: interpolation)
                return FrameProcessor(draw: { image, _ in grader.render(source: image) })
            },
            onProgress: { progress in
                if progress.phase == .encoding, let ratio = progress.ratio { onRatio(ratio) }
            },
            isCancelled: { Task.isCancelled }
        )
        let wanted = instrumentOutputName(name, "graded")
        let target = try uniqueName(wanted) { candidate in
            FileManager.default.fileExists(atPath: folder.appendingPathComponent(candidate).path)
        }
        let destination = folder.appendingPathComponent(target)
        do {
            try FileManager.default.moveItem(at: temp, to: destination)
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
        return destination
    }
}

/// A cadence as the web writes a number: `30`, `29.97`.
private func cadenceText(_ n: Double) -> String {
    n == n.rounded() ? String(Int(n)) : String(n)
}
