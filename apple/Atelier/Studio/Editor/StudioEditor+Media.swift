// The media half of the open project — the web's `StudioEditor.tsx` around
// `useActiveAsset`, `useVideoTransport`, `useOverlayStage` and the trim:
//
// - which clip or still is OPEN (‹ › step through the project's working set;
//   navigation, never an edit), and what it says about itself — a clip's
//   container facts and its `.srt` parsed at scale 1 with the cadence
//   measured, a still decoded to the stage budget with its EXIF read into the
//   ONE cue it is worth (`cueFromExif`);
// - the STAGE: the frame under the playhead (the player's own, through
//   `ClipFrameTap`) or the still, fitted to the stage's pixels, graded ONCE
//   per change through the render graph (`FrameGrader`: the project's look
//   and the media's develop baked into one cube, the film node after it), the
//   overlays burnt in by `OverlayPainter` at the frame's time and cue — the
//   export's own drawing at the stage's size, so preview = export — and the
//   A/B wipe putting the ORIGINAL left of the divider;
// - the trim: each clip opens on the range that belongs to it (`restoreTrim`
//   refuses a range set against a different duration), `I` / `O` cut at the
//   playhead, a handle dragged past the playhead carries it, the out point
//   pauses playback.
//
// A still has no clock: its deck is SETTLED before it reaches the renderer
// (`settleForStill`), its time is 0 and no scene is passed — so an entrance
// never draws mid-slide and a later window never draws nothing.

import AVFoundation
import CoreImage
import Foundation
import SwiftUI
import AtelierKit

extension StudioEditor {
    // MARK: - what is open

    /// The stage image's pixel size — the frame the overlays are laid out in.
    var renderedSize: CGSize? {
        stage.image.map { CGSize(width: $0.width, height: $0.height) }
    }

    /// One frame, or 100 ms when the container gave no cadence: the handles
    /// stop that far apart, and it is the arrow step.
    var frameStep: Double { minTrimLength(clipFps) }

    /// The range the transport enforces — nil until the clip has a length.
    var activeRange: TrimRange? { range.end > range.start ? range : nil }

    var trimmed: Bool { isTrimmed(range, playback.duration) }

    /// What the stage and the still export draw: a still's deck settled.
    var stageElements: [OverlayElement] {
        isPhoto ? settleForStill(edit.elements) : edit.elements
    }

    /// The cue under the playhead.
    var activeCue: Cue? { findCue(cues, isPhoto ? 0 : playback.time) }

    /// Seconds from the first exported frame — every timing control's clock.
    var windowTime: Double { windowPlayhead(playback.time, range) }

    var hasTelemetry: Bool { !cues.isEmpty }

    /// Something is on the stage: a clip loaded, or a still decoded.
    var hasFrame: Bool { stage.image != nil || activeVideo != nil || photoSize != nil }

    /// The media's facts beside its name — what is ON THE STAGE.
    var activeDetail: String {
        if isPhoto {
            let w = photoSize.map { Int($0.width) }
            let h = photoSize.map { Int($0.height) }
            let type = activeImage.map { captureFileType($0.name) }
            return studioMediaDetail(isPhoto: true, width: w, height: h, imageType: type)
        }
        return studioMediaDetail(isPhoto: false, width: clipWidth, height: clipHeight, codec: clipCodec, fps: clipFps)
    }

    /// The frame's aspect, for the guides' notion of "this frame".
    var frameAspect: Double? {
        if let photoSize, photoSize.height > 0 { return Double(photoSize.width / photoSize.height) }
        if let w = clipWidth, let h = clipHeight, h > 0 { return Double(w) / Double(h) }
        return nil
    }

    /// The outro's preview composes for the project's destination format.
    var outroAspect: Double { studioOutroAspect(edit.aspectId, frameAspect: frameAspect) }

    /// The "no telemetry" / "no exif" chip — said only once the file has been read.
    var missingDataChip: String? {
        guard !hasTelemetry else { return nil }
        if isPhoto { return photoExif != nil ? "no exif" : nil }
        return activeSrt == nil && activeVideo != nil ? "no telemetry" : nil
    }

    /// The clip has an `.srt` and it says nothing.
    var unreadableTelemetry: Bool {
        !isPhoto && activeSrt != nil && srtRead && rawCues.isEmpty
    }

    // MARK: - stepping through the working set

    func setActive(_ id: String?) {
        if id == activeId { return }
        activeId = id
        loadActive()
        scheduleSave()
    }

    /// ‹ › between the project's clips and stills.
    func step(_ delta: Int) {
        let list = clips
        let i = activeIndex
        guard i >= 0, i + delta >= 0, i + delta < list.count else { return }
        setActive(list[i + delta].id)
    }

    /// The library changed under the editor (a file added, a folder
    /// re-pointed): the open media stays open if it is still here.
    func mediaChanged() {
        let list = clips
        if activeId == nil || !list.contains(where: { $0.id == activeId }) {
            activeId = list.first?.id
            loadActive()
        } else if source == nil && stage.image == nil {
            loadActive()
        }
        scheduleSave()
    }

    /// Open whatever is active: its facts, its frames, its telemetry, its hash.
    func loadActive() {
        mediaTask?.cancel()
        hashTask?.cancel()
        tap.detach()
        source = nil
        sourceTime = 0
        primed = false
        stage.clear()
        rawCues = []
        timing = .realtime
        cues = []
        photoExif = nil
        photoSize = nil
        photoProblem = nil
        clipWidth = nil
        clipHeight = nil
        clipCodec = nil
        clipFps = nil
        srtRead = false
        activeHash = nil
        range = fullRange(0)
        guard let asset = active else {
            playback.load(nil)
            refreshLook()
            return
        }
        let id = asset.id
        if asset.kind == .photo, let ref = asset.parts.image, let url = library.url(for: ref) {
            playback.load(nil)
            loadStill(id: id, ref: ref, url: url)
        } else if let ref = asset.parts.video, let url = library.url(for: ref) {
            loadClip(id: id, url: url, srt: asset.parts.srt.flatMap { library.url(for: $0) })
        } else {
            playback.load(nil)
            photoProblem = asset.kind == .photo ? "This file can't be read on this device." : nil
        }
        if let file = activeFile, let url = library.url(for: file) {
            hashTask = Task { [weak self] in
                let hash = await Task.detached(priority: .utility) { StudioMediaFiles.hash(file, at: url) }.value
                guard let self, !Task.isCancelled, self.active?.id == id else { return }
                self.activeHash = hash
                self.refreshLook()
            }
        }
        applyRate()
        refreshLook()
    }

    private func loadStill(id: String, ref: SavedMediaRef, url: URL) {
        let name = ref.name
        mediaTask = Task { [weak self] in
            let decoded = await Task.detached(priority: .userInitiated) { () -> (image: CIImage, size: CGSize)? in
                guard let data = try? Data(contentsOf: url), let picture = PictureDecoder.decode(data, name: name) else {
                    return nil
                }
                let fitted = FrameGrader.fit(picture.image, longEdge: PictureRenderer.stageLongEdge).image
                return (fitted, CGSize(width: picture.width, height: picture.height))
            }.value
            // EXIF is read from the head of the file, independently of the
            // decode: a RAW that cannot be drawn still says what it was shot at.
            let exif = await Task.detached(priority: .utility) { () -> ExifData in
                readEffectiveExif(InstrumentImages.head(url, count: exifSliceBytes), nil).exif
            }.value
            guard let self, !Task.isCancelled, self.active?.id == id else { return }
            self.photoExif = exif
            if let decoded {
                self.source = decoded.image
                self.photoSize = decoded.size
            } else {
                self.photoProblem = "This photo could not be decoded on this device — develop it to a JPEG or a TIFF first."
            }
            self.recomputeCues()
        }
    }

    private func loadClip(id: String, url: URL, srt: URL?) {
        mediaTask = Task { [weak self] in
            let opened = try? await VideoSource.open(url)
            guard let self, !Task.isCancelled, self.active?.id == id else { return }
            if let meta = opened?.metadata {
                self.clipWidth = meta.displayWidth
                self.clipHeight = meta.displayHeight
                self.clipCodec = meta.codec
                self.clipFps = meta.nominalFrameRate > 0 ? (meta.nominalFrameRate * 100).rounded() / 100 : nil
            }
            self.playback.load(url)
            self.tap.attach(self.playback.player.currentItem, metadata: opened?.metadata)
            self.applyRate()
            // Clips without an .srt just get no cues. Parsed at scale 1: the
            // cadence correction is applied here, so changing it re-derives
            // rather than re-reads.
            if let srt {
                let parsed = await Task.detached(priority: .userInitiated) { () -> [Cue] in
                    guard let text = TelemetryTracks.text(srt) else { return [] }
                    return parseSrt(text, timeScale: .fixed(1))
                }.value
                guard !Task.isCancelled, self.active?.id == id else { return }
                self.rawCues = parsed
                self.timing = measureTimeScale(parsed)
                self.srtRead = true
            }
            self.recomputeCues()
        }
    }

    /// The cues every readout draws from, re-derived — a pure pass, no re-read.
    func recomputeCues() {
        if isPhoto {
            cues = photoExif.flatMap { cueFromExif($0) }.map { [$0] } ?? []
        } else {
            cues = retimeCues(rawCues, timeScale: scale)
        }
        applyRate()
        requestRender()
    }

    // MARK: - the trim

    /// The clip's length is known: open on the range that belongs to it, and
    /// ON its in point when it reopens trimmed.
    func clipDurationChanged() {
        let duration = playback.duration
        guard let id = active?.id, duration > 0 else {
            range = fullRange(duration)
            return
        }
        let next = restoreTrim(edit.trims[id], duration, frameStep)
        range = next
        let inside = clampPlayhead(playback.time, next)
        if inside != playback.time { playback.seek(to: inside) }
    }

    /// Move the handles and remember them for this clip.
    func applyRange(_ next: TrimRange) {
        let duration = playback.duration
        if isTrimmed(next, duration) { learnTrim() }
        range = next
        guard let id = active?.id else { return }
        update { e in e.trims = writeClipTrim(e.trims, id, next, duration) }
    }

    /// ↺ — the whole clip again.
    func clearTrim() {
        applyRange(fullRange(playback.duration))
    }

    /// `I` / `O` at the playhead, Shift releasing a handle.
    @discardableResult
    func trimKey(_ key: String, shift: Bool) -> Bool {
        guard activeVideo != nil,
              let next = trimKeyRange(key, shift: shift, current: activeRange, at: playback.time,
                                      duration: playback.duration, frameStep: frameStep) else { return false }
        applyRange(next)
        return true
    }

    // MARK: - the transport

    func togglePlay() {
        playback.togglePlay(range: activeRange)
    }

    /// A seek from the bar or a key — the stage follows the frame it lands on.
    func seek(_ time: Double) {
        playback.seek(to: time)
    }

    /// ← → a frame, Shift a second, inside the range.
    func stepPlayhead(forward: Bool, shift: Bool) {
        guard activeVideo != nil else { return }
        playback.pause()
        seek(steppedPlayhead(playback.time, forward: forward, shift: shift, step: frameStep, range: range))
    }

    /// Called about sixty times a second while a clip is on the stage: the
    /// out point enforced, and the frame under the playhead picked up when it
    /// is a NEW one — a paused player repaints on an edit alone.
    func frameTick() {
        guard activeVideo != nil, let item = playback.player.currentItem else { return }
        if source == nil, !primed, item.status == .readyToPlay {
            primed = true
            // A tiny seek forces a decode, so the stage shows the clip rather
            // than black before the first play.
            let first = clampPlayhead(min(0.001, max(0, playback.duration / 2)), activeRange)
            playback.seek(to: first)
        }
        playback.enforce(activeRange, loop: loop)
        let now = item.currentTime()
        guard let frame = tap.newFrame(at: now) else { return }
        source = frame
        sourceTime = now.isNumeric ? now.seconds : playback.time
        requestRender()
    }

    // MARK: - the look

    /// Bake the project's look and the open media's develop into ONE cube,
    /// off the main actor, when either changed.
    func refreshLook() {
        let grade = edit.grade
        let develop = activeDevelop
        let library = LookLibrary.shared
        let interpolation = library.interpolation
        let developKey = develop.map { $0.json.serialized() } ?? "-"
        let packs = library.packs.map(\.id).joined(separator: ",")
        let key = [gradeKey(grade.map { SavedGrade($0) }), developKey, interpolation.rawValue, packs].joined(separator: "|")
        guard key != lookKey else { return }
        lookKey = key
        lookTask?.cancel()
        lookTask = Task { [weak self] in
            let resolved = await library.resolve(grade ?? RollGrade())
            guard !Task.isCancelled else { return }
            let cube = await Task.detached(priority: .userInitiated) {
                resolved.cube(develop: develop, interpolation: interpolation)
            }.value
            guard let self, !Task.isCancelled, self.lookKey == key else { return }
            self.stageCube = cube
            self.lookMissing = resolved.missing
            self.requestRender()
        }
    }

    // MARK: - the stage

    /// The draw options every render and every measure of the stage takes —
    /// the selected element ghosted outside its window, so it stays reachable.
    func drawOptions(ghost: String?) -> OverlayDrawOptions {
        OverlayDrawOptions(timeShift: edit.timeShift, cues: cues, scenes: isPhoto ? nil : edit.scenes,
                           originSeconds: isPhoto ? 0 : range.start, ghostId: ghost)
    }

    /// Compose the stage again: an edit, the look, the wipe or a new frame.
    func requestRender() {
        guard let source else {
            stage.clear()
            return
        }
        let time = isPhoto ? 0 : sourceTime
        let job = StudioFrameJob(
            source: source, time: time, size: renderSize, cube: stageCube,
            interpolation: LookLibrary.shared.interpolation, film: edit.film,
            elements: stageElements, cue: findCue(cues, time), theme: edit.theme,
            options: drawOptions(ghost: selectedId), wipe: compareOn ? split : nil,
            grader: grader, painter: painter
        )
        stage.submit { job.render() }
    }

    /// Pixel boxes of the elements on screen, in the stage image's pixels —
    /// the same layout the paint uses.
    func overlayBoxes() -> [OverlayGeometry.ElementBox] {
        guard let size = renderedSize else { return [] }
        let time = isPhoto ? 0 : sourceTime
        return measurer.measureOverlays(size: size, elements: stageElements, cue: findCue(cues, time), time: time,
                                        theme: edit.theme, options: drawOptions(ghost: selectedId))
    }

    // MARK: - keys

    /// A press, read and acted on — true when the editor took it. Space plays
    /// (a field keeps it), `I` / `O` cut, ← → step, ⌫ removes the selected
    /// element. A sheet over the editor keeps every key.
    func handleKey(_ press: EditorKeyPress) -> Bool {
        if textEditing || settingsOpen || developOpen { return false }
        if press.metaKey || press.ctrlKey { return false }
        switch press.key {
        case " ":
            // Held space repeats: one press, one toggle. Modified space is somebody else's.
            guard !press.repeat, !press.altKey, !press.shiftKey, activeVideo != nil else { return false }
            togglePlay()
            return true
        case "ArrowLeft", "ArrowRight":
            guard activeVideo != nil else { return false }
            stepPlayhead(forward: press.key == "ArrowRight", shift: press.shiftKey)
            return true
        case "Backspace", "Delete":
            guard let id = selectedId else { return false }
            removeElement(id)
            return true
        default:
            let key = press.key.lowercased()
            guard (key == "i" || key == "o"), !press.altKey, !press.repeat else { return false }
            return trimKey(key, shift: press.shiftKey)
        }
    }
}

/// One stage render, off the main actor: everything it reads captured as it
/// was when asked, so a render in flight and the next edit never interfere.
struct StudioFrameJob {
    let source: CIImage
    let time: Double
    let size: CGSize
    let cube: CubeLut?
    let interpolation: Interpolation
    let film: FilmTexture?
    let elements: [OverlayElement]
    let cue: Cue?
    let theme: StyleTheme?
    let options: OverlayDrawOptions
    /// The A/B divider, 0…1 across, or nil with the wipe off.
    let wipe: Double?
    let grader: FrameGrader
    let painter: OverlayPainter

    /// The picture fitted to the stage (never up), graded, the overlays burnt
    /// in at its size and time — and, with the wipe on, the ORIGINAL left of
    /// the divider: before → after, left to right.
    func render() -> CGImage? {
        let fitted = FrameGrader.fit(source, within: size)
        grader.setCube(cube, intensity: 1, interpolation: interpolation)
        grader.setFilm(FilmPass(film))
        let graded = grader.render(source: fitted.image, sourceSeconds: time, sourceScale: fitted.scale)
        let composed = painter.burnIn(graded, elements: elements, cue: cue, time: time, theme: theme, options: options)
        guard let wipe, wipe > 0 else { return FrameGrader.cgImage(composed) }
        let e = fitted.image.extent
        let left = CGRect(x: e.minX, y: e.minY, width: e.width * CGFloat(wipe), height: e.height)
        return FrameGrader.cgImage(fitted.image.cropped(to: left).composited(over: composed))
    }
}
