// What the badge stage draws and on which clock — the render half of the
// web's `BadgeStage.tsx` (decode, clip playback, held grades, the paint
// through `renderBadge`) and `PostEditor`'s clock (the badge's time, the
// composition view, the hook thumbnail).
//
// Rules kept (`roadtrip.md`, `media-pipeline.md`):
// - The stage draws the open slide through the EXPORT's own renderer
//   (`SlideRenderer`), at the piece's aspect — only the frame is smaller.
// - A picture is decoded ONCE per file: moving a clip's frame SEEKS the
//   decoder already open (`BadgeSource.seek`), and the paint waits for the
//   seek to land (the web's `frameSeq`). A still is bounded to the stage's
//   pixel budget (`maxStagePixels`) and never enlarged.
// - A picture is graded ONCE per change (`BadgeSource.picture` holds it
//   under the grade's key), never per redraw; a clip graded per frame.
// - The canvas's size is read when the job is BUILT, on the main actor, and
//   the job paints at that size: never a size read before an await and a
//   paint after it (the web's miniature-over-a-resized-stage trap).
// - The badge's clock: on a CLIP the clip is the clock (the time into the
//   DELIVERED stretch at the slide's speed); on a photograph the deck's. AT
//   REST on the slide's first moment the badge draws SETTLED — the
//   composition every other surface shows.
// - The hook thumbnail is taken from the stage's own frame (no chrome: the
//   outline is drawn over it by the view), only at rest on the END card, with
//   its picture present and decoded, debounced 700 ms — never while the
//   picture is missing, or a black frame would replace a good thumbnail.

import CoreGraphics
import CoreImage
import Foundation
import Observation
import AtelierKit

/// The lead the stage decoded, and what it measured.
struct PieceLeadInfo: Equatable {
    var url: URL
    var name: String
    var width: Double
    var height: Double
    /// The clip's length, or 0 for a photograph.
    var duration: Double
}

/// One frame the stage drew, with what the paint measured at that size.
struct PieceStageFrame: @unchecked Sendable {
    let image: CGImage
    /// The badge's hit boxes, in the frame's pixels.
    let boxes: [OverlayGeometry.ElementBox]
    /// A collage's cells, in the frame's pixels; empty without one.
    let cells: [CellRect]
    /// The frame's pixels.
    let size: AtelierKit.Size
    /// The slide it was drawn for.
    let slideKey: String
}

/// Everything one stage frame is painted from, captured on the main actor.
struct PieceStageJob: @unchecked Sendable {
    let renderer: SlideRenderer
    let slide: DeckSlide
    let sources: SlideSources
    let time: Double
    /// Every drawn picture's framing AS SHOWN (the card in hand, the move at
    /// the needle), the lead first: the stage draws what it is given and
    /// moves nothing itself.
    let framings: [Framing]
    let collage: SlideCollage?
    /// The slide's screen time — what a collage's cells leave against.
    let collageSeconds: Double
    /// EDITOR ONLY: the selected element, drawn ghosted outside its window.
    let ghost: String?
    let width: Int
    let height: Int
    let slideKey: String

    func run() -> PieceStageFrame? {
        var o = renderer.options(slide, sources, at: time, clock: nil, ghostId: ghost)
        if let first = framings.first { o.framing = first }
        o.motion = nil
        if var render = o.collage, let collage {
            render.collage = collage
            for i in render.items.indices where i < framings.count {
                render.items[i].framing = framings[i]
                render.items[i].motion = nil
            }
            render.clock = nil
            render.seconds = collageSeconds
            o.collage = render
        }
        guard let image = renderer.badge.image(width: width, height: height, o) else { return nil }
        let size = CGSize(width: width, height: height)
        let boxes = renderer.badge.measure(size: size, o)
        let cells = collage.map { resolveCollage($0, Double(width), Double(height)) } ?? []
        return PieceStageFrame(image: image, boxes: boxes, cells: cells, size: AtelierKit.Size(Double(width), Double(height)),
                               slideKey: slideKey)
    }
}

/// Renders off the main actor, one at a time; a request made while one runs
/// replaces any other waiting, so the stage always catches up to the latest.
@MainActor
@Observable
final class PieceStageRenderer {
    private(set) var frame: PieceStageFrame?
    @ObservationIgnored var onFrame: (@MainActor (PieceStageFrame) -> Void)?
    @ObservationIgnored private var running = false
    @ObservationIgnored private var pending: PieceStageJob?

    func submit(_ job: PieceStageJob) {
        if running {
            pending = job
            return
        }
        run(job)
    }

    func clear() {
        pending = nil
        frame = nil
    }

    private func run(_ job: PieceStageJob) {
        running = true
        Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) { job.run() }.value
            guard let self else { return }
            if let result {
                self.frame = result
                self.onFrame?(result)
            }
            self.running = false
            if let next = self.pending {
                self.pending = nil
                self.run(next)
            }
        }
    }
}

extension PieceEditorModel {
    // MARK: - which files

    /// The stage's lead file: without a collage what the Library has TICKED
    /// (the two are kept in step), with one the lead's own ref by name — the
    /// Library then follows the selected cell.
    var leadRef: SavedMediaRef? {
        guard !isCta, let library else { return nil }
        if collage != nil { return library.poolFile(named: slide?.media) }
        return library.active
    }

    var leadURL: URL? { leadRef.flatMap { url(for: $0) } }

    /// Every drawn cell's file, the lead first.
    var cellRefs: [SavedMediaRef?] {
        guard let collage else { return [leadRef] }
        let lead = self.lead
        return (0..<collageCellCount(collage)).map { i in
            i == 0 ? leadRef : library?.poolFile(named: collageCellAt(lead, collage, i).media)
        }
    }

    /// What each cell holds, by name — what a drop target says it will replace.
    var cellLabels: [String?] { cellRefs.map { $0.map { fileBaseName($0.name) } } }

    /// The SELECTED cell's file, as the Library holds it.
    var cellRef: SavedMediaRef? {
        let refs = cellRefs
        return refs.indices.contains(cellIndex) ? refs[cellIndex] : nil
    }

    /// The slide names a picture the Library cannot resolve right now.
    var missing: Bool { !isCta && cellMedia != nil && library?.active == nil }

    /// The hook's picture, whichever slide is open — the camera credit, the
    /// hook clip export and the bridge are about the piece.
    var hookRef: SavedMediaRef? { isHook ? leadRef : library?.poolFile(named: post?.media) }

    // MARK: - the clip under the open slide

    var isVideo: Bool { leadRef.map { BadgeSources.isClip($0.name) } ?? false }

    /// The open clip's length — only once it describes THIS file: while the
    /// piece plays from one clip into another, the last one's would cut the
    /// next with a stretch it does not have.
    var duration: Double {
        guard let info = leadInfo, let url = leadURL, info.url == url else { return 0 }
        return info.duration
    }

    var isClipSlide: Bool { isVideo && duration > 0 }

    /// The stretch the clip plays: `[in, in + screen × speed]`, derived.
    var clipRange: TrimRange {
        guard let slide else { return TrimRange(start: 0, end: 0) }
        return clipSlice(slide.videoTimeSeconds, slide.seconds, slide.speed, duration)
    }

    /// The cut is open, over a clip.
    var trimOpen: Bool { trimming && isClipSlide }

    /// What the stage plays: the cut's own loop while it is open, the piece otherwise.
    var stagePlaying: Bool { trimOpen ? clipPlaying : deck.playing }

    /// The open slide's picture is still decoding: a still's clock waits for it.
    var stagePending: Bool { leadURL != nil && leadInfo?.url != leadURL }

    /// How long each slide holds the screen — a clip its cut, a still its seconds.
    var lengths: [Double] {
        slides.map { s in screenLength(s, s.media.flatMap { clipDurations[$0.name.lowercased()] } ?? 0) }
    }

    /// A stable key per slide.
    var slideKeys: [String] { slides.map { $0.slideId ?? $0.kind.rawValue } }

    /// How long the badge's entrances take to settle.
    var settleSeconds: Double {
        guard let post else { return 0 }
        return badgeSettleSeconds(post.badge.pieceStyles, post.badge.cascade)
    }

    /// How long the burned-in hook clip runs — clamped on read to the clip in hand.
    var hookLength: Double {
        guard let post else { return 0 }
        let b = post.badge
        return hookSecondsWithin(b.hookSeconds, b.durationSeconds, hookClipSeconds, b.videoTimeSeconds, b.videoSpeed)
    }

    private var clipAtRest: Bool { !stagePlaying && playhead <= clipRange.start + trimEpsilon }
    private var stillAtRest: Bool { !deck.playing && deck.local <= trimEpsilon }

    /// The composition is on the stage — the only frame the hook thumbnail
    /// may be taken from: at rest, on the END card.
    var composedView: Bool { (isClipSlide ? clipAtRest : stillAtRest) && cardPick == .end }

    /// Where the badge's own animations are up to, in seconds.
    var badgeTime: Double {
        let collageSettle = collageSettleSeconds(collage, aspect)
        if !isHook { return stillAtRest ? collageSettle : deck.local }
        if isClipSlide {
            if clipAtRest { return max(settleSeconds, collageSettle) }
            let speed = max(1e-9, slide?.speed ?? 1)
            return max(0, (playhead - clipRange.start) / speed)
        }
        return stillAtRest ? max(settleSeconds, openerSeconds, collageSettle) : deck.local
    }

    // MARK: - the transport's verbs

    /// ▶ / ❚❚ — the piece, or the cut while it is open (Space).
    func togglePlay() {
        if trimOpen {
            setClipPlaying(!clipPlaying)
        } else {
            deck.toggle()
        }
    }

    /// Move the open clip's playhead (source seconds) — a scrub, a cut, a key.
    func setPlayhead(_ t: Double) {
        guard t != playhead else { return }
        playhead = t
        playheadMoved()
        requestRender()
    }

    func setClipPlaying(_ on: Bool) {
        guard on != clipPlaying else { return }
        clipPlaying = on
        playbackChanged()
    }

    /// Open or close the cut on the band — playback stops either way.
    func setTrimming(_ on: Bool) {
        deck.setPlaying(false)
        setClipPlaying(false)
        guard on != trimming else { return }
        trimming = on
        playbackChanged()
    }

    /// `L` — what playback loops over.
    func toggleLoopScope() {
        loopScope = loopScope == .piece ? .slide : .piece
        playbackChanged()
    }

    /// The still clock moved.
    func clockTicked() {
        requestRender()
    }

    /// Something about playback changed: the clip plays or stops, and a stop
    /// leaves the needle where it stopped — on a card, or between two.
    func playbackChanged() {
        let playing = stagePlaying
        if playing, isClipSlide, let url = leadURL, let slide {
            let range = clipRange
            let loop = trimOpen || loopsOpenSlide(loopScope, slides.count)
            clip.run(PieceClipPlayer.Want(url: url, start: range.start, end: range.end, rate: slide.speed,
                                          loop: loop, slide: slideKey), from: playhead)
        } else {
            clip.run(nil, from: playhead)
            if liveFrame != nil {
                liveFrame = nil
                playheadMoved()
            }
        }
        if wasPlaying && !playing { followNeedle(deck.local) }
        wasPlaying = playing
        requestRender()
    }

    /// The player reported where it is, and the frame it shows.
    func clipReported(_ t: Double, frame: CIImage?) {
        playhead = t
        if let frame { liveFrame = BadgeSource(image: frame, duration: duration, seconds: t) }
        requestRender()
    }

    /// The player stopped on the out point.
    func clipEnded() {
        if trimOpen {
            setClipPlaying(false)
        } else {
            deck.onClipEnded()
        }
    }

    /// A new slide: the frame a clip was playing is not this slide's.
    func slideChangedForClock() {
        liveFrame = nil
    }

    /// A new slide or a newly decoded file puts the playhead where the band
    /// sent it; an in point moved by the cut puts it on the new in point.
    func resyncClock() {
        guard let slide else { return }
        let opened = "\(slideKey)|\(leadURL?.absoluteString ?? "")"
        let moved = opened != clockOpened
        guard moved || slide.videoTimeSeconds != clockIn else { return }
        clockOpened = opened
        clockIn = slide.videoTimeSeconds
        let jump = moved ? deck.pendingLocal(slideKey) * slide.speed : 0
        setPlayhead(slide.videoTimeSeconds + jump)
        setClipPlaying(false)
    }

    /// Paused, a clip's frame is SEEKED to the playhead — never re-decoded —
    /// and the stage repaints once it lands. Scrubs are coalesced: a seek in
    /// flight takes the latest target when it lands.
    func playheadMoved() {
        guard !stagePlaying, liveFrame == nil, !loading, let source = leadSource, source.isClip else { return }
        if seeking {
            seekAgain = true
            return
        }
        seeking = true
        Task { [weak self] in
            guard let self else { return }
            repeat {
                self.seekAgain = false
                let target = self.playhead
                try? await source.seek(target)
                self.requestRender()
            } while self.seekAgain && self.leadSource === source
            self.seeking = false
        }
    }

    // MARK: - decoding

    /// The stage's inputs may have moved (a slide, a cell, the Library, the
    /// document): decode what changed, put the clock back, repaint.
    func stageInputsChanged() {
        loadSources()
        resyncClock()
        loadHookExif()
        playbackChanged()
    }

    /// Decode the lead and the collage's cells — ONLY when their files change.
    func loadSources() {
        loadLead()
        loadCells()
    }

    private func loadLead() {
        let ref = leadRef
        let url = leadURL
        let key = url.map { "\($0.absoluteString)|\(ref?.name ?? "")" }
        guard key != loadedLeadKey else { return }
        loadedLeadKey = key
        leadSource = nil
        liveFrame = nil
        stageError = nil
        tasks["lead"]?.cancel()
        guard let url, let ref else {
            loading = false
            updatePictureSizes()
            requestRender()
            return
        }
        loading = true
        let at = BadgeSources.isClip(ref.name) ? playhead : 0
        tasks["lead"] = Task { [weak self] in
            do {
                let source = try await BadgeSources.load(url, name: ref.name, videoSeconds: at, budget: maxStagePixels)
                guard let self, !Task.isCancelled, self.loadedLeadKey == key else { return }
                self.leadSource = source
                self.leadInfo = PieceLeadInfo(url: url, name: ref.name, width: source.width, height: source.height,
                                              duration: source.duration)
                if source.duration > 0 { self.clipDurations[ref.name.lowercased()] = source.duration }
                if self.isHook { self.hookClipSeconds = source.duration }
                self.loading = false
                self.updatePictureSizes()
                self.keepInPointInside()
                self.resyncClock()
                self.playbackChanged()
                self.playheadMoved()
                self.requestRender()
            } catch {
                guard let self, !Task.isCancelled, self.loadedLeadKey == key else { return }
                self.stageError = error.localizedDescription
                self.loading = false
                self.requestRender()
            }
        }
    }

    /// The collage's OTHER cells: a cell whose file did not change is not
    /// decoded again when another cell's does; one that cannot be decoded is
    /// an empty cell, never a failed stage.
    private func loadCells() {
        let refs = collage == nil ? [] : cellRefs
        let urls: [URL?] = refs.enumerated().map { i, ref in i == 0 ? nil : ref.flatMap { self.url(for: $0) } }
        let keys = urls.map { $0?.absoluteString }
        guard keys != loadedCellKeys else { return }
        let previous = cellSources
        let previousKeys = loadedCellKeys
        var next: [BadgeSource?] = Array(repeating: nil, count: keys.count)
        for i in keys.indices where i > 0 {
            if let k = keys[i], i < previousKeys.count, previousKeys[i] == k, i < previous.count { next[i] = previous[i] }
        }
        cellSources = next
        loadedCellKeys = keys
        tasks["cells"]?.cancel()
        let pending = keys.indices.filter { $0 > 0 && urls[$0] != nil && next[$0] == nil }
        updatePictureSizes()
        requestRender()
        guard !pending.isEmpty else { return }
        tasks["cells"] = Task { [weak self] in
            for i in pending {
                guard let url = urls[i], let ref = refs[i] else { continue }
                let source = try? await BadgeSources.load(url, name: ref.name, videoSeconds: 0, budget: maxStagePixels)
                guard let self, !Task.isCancelled, self.loadedCellKeys == keys else { return }
                if i < self.cellSources.count { self.cellSources[i] = source }
                self.updatePictureSizes()
                self.requestRender()
            }
        }
    }

    /// Each picture's decoded shape — the lead, then every cell. Only the
    /// SHAPES are meant: what a motion preset measures a pan's room against.
    func updatePictureSizes() {
        let leadSize = leadSource.map { AtelierKit.Size($0.width, $0.height) }
        let next: [AtelierKit.Size?]
        if collage == nil {
            next = [leadSize]
        } else {
            next = (0..<cellCount).map { i in
                if i == 0 { return leadSize }
                guard i < cellSources.count, let s = cellSources[i] else { return nil }
                return AtelierKit.Size(s.width, s.height)
            }
        }
        if next != pictureSizes { pictureSizes = next }
    }

    // MARK: - the paint

    /// The stage's box on screen, in points, and the screen's scale — the
    /// view sets it; the frame's pixels follow at the piece's aspect.
    func setStageBox(_ points: AtelierKit.Size, scale: Double) {
        guard points != stageBox.points || scale != stageBox.scale else { return }
        stageBox = (points, scale)
        requestRender()
    }

    /// The frame's pixels: the displayed size at the device's scale, floored
    /// at `previewLongEdge` and capped at `maxPreviewLongEdge`, so a bigger
    /// preview is sharp and a 5K screen does not repaint a 4K canvas per frame.
    var framePixels: AtelierKit.Size {
        let long = max(stageBox.points.width, stageBox.points.height) * stageBox.scale
        let edge = min(maxPreviewLongEdge, max(previewLongEdge, long.rounded()))
        return frameSize(aspect, edge)
    }

    /// Compose the stage again: an edit, the clock, a decode, the selection.
    func requestRender() {
        guard !closed else { return }
        guard let trip, let post, let slide else {
            stage.clear()
            return
        }
        let size = framePixels
        let w = Int(size.width)
        let h = Int(size.height)
        guard w > 0, h > 0 else { return }
        let renderer = currentRenderer(trip, post)
        let lead = liveFrame ?? leadSource
        var cells: [BadgeSource?] = []
        if collage != nil {
            cells = (0..<cellCount).map { i in i == 0 ? lead : (i < cellSources.count ? cellSources[i] : nil) }
        }
        let job = PieceStageJob(renderer: renderer, slide: slide, sources: SlideSources(lead: lead, cells: cells),
                                time: badgeTime, framings: stageFramings, collage: collage,
                                collageSeconds: slide.seconds, ghost: selectedId, width: w, height: h,
                                slideKey: slideKey)
        stage.submit(job)
    }

    /// The renderer the stage paints through — made again when the document,
    /// the opener's pictures or the hook's EXIF change; its graders are kept
    /// across every frame in between.
    private func currentRenderer(_ trip: TripDoc, _ post: TripPost) -> SlideRenderer {
        if let renderer, rendererRev == revision, rendererInputs == hookInputs { return renderer }
        let made = SlideRenderer(trip: trip, post: post, aspect: pieceAspect(post), pictures: hookPictures,
                                 exif: hookExif?.exif, looks: looks)
        renderer = made
        rendererRev = revision
        rendererInputs = hookInputs
        return made
    }

    /// A frame landed: keep the hook's thumbnail from it (see the header).
    func frameLanded(_ frame: PieceStageFrame) {
        guard isHook, !missing, !loading, composedView, frame.slideKey == slideKey else { return }
        thumbTimer?.cancel()
        let image = frame.image
        thumbTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard let self, !Task.isCancelled, self.isHook, !self.missing, !self.loading, self.composedView else { return }
            self.store.keepThumb(self.postId, frame: image)
        }
    }

    // MARK: - the looks, the opener's pictures, the hook's EXIF

    /// Resolve every pack look the piece wears, ahead of a render: a paint is
    /// synchronous and a pack lattice is read from the vault asynchronously.
    func prepareLooks() {
        guard let trip, let post else { return }
        let key = TripSlideLooks.gradesWorn(trip, post).map { gradeKey($0) }.joined(separator: "|")
            + "#\(LookLibrary.shared.interpolation.rawValue)"
        guard key != looksKey else { return }
        looksKey = key
        tasks["looks"]?.cancel()
        tasks["looks"] = Task { [weak self] in
            guard let self else { return }
            let fresh = TripSlideLooks(looks: .shared, interpolation: LookLibrary.shared.interpolation)
            await fresh.prepare(trip, post)
            guard !Task.isCancelled, self.looksKey == key else { return }
            self.lookPreparationLanded(fresh)
        }
    }

    /// The looks are resolved: bake from a fresh cache (one made before the
    /// vault answered would keep a cube missing its pack layer), and grade
    /// every held picture again.
    private func lookPreparationLanded(_ fresh: TripSlideLooks) {
        looks = fresh
        renderer = nil
        leadSource?.release()
        for source in cellSources { source?.release() }
        hookInputs &+= 1
        requestRender()
    }

    /// The device's look preferences moved (the interpolation, a pack
    /// imported or removed): resolve and bake again.
    func lookPreferencesChanged() {
        looksKey = nil
        prepareLooks()
        openerKey = nil
        refreshOpener()
    }

    /// The pictures the opener asked for, decoded, cropped and graded with
    /// the hook's look — only a CHANGED want is decoded again.
    func refreshOpener() {
        guard let trip, let post, let state = hookState, var flash = slides.first else { return }
        let wants = HookPictureLoader.wants(post.badge.hook, state.ctx)
        flash.develop = nil
        let flashKey = looks.key(flash, trip, post, develop: .some(nil)) ?? "as-shot"
        let pool = library.map { String($0.pool.count) } ?? "-"
        let key = wants.map(\.key).joined(separator: "|") + "#" + flashKey + "#" + pool
        guard key != openerKey else { return }
        openerKey = key
        tasks["opener"]?.cancel()
        if wants.isEmpty {
            if !hookPictures.isEmpty || !hookPictureProblems.isEmpty {
                hookPictures = [:]
                hookPictureProblems = [:]
                hookInputs &+= 1
                requestRender()
            }
            return
        }
        let cube = looks.cube(flash, trip, post, develop: .some(nil))
        let interpolation = looks.interpolation
        let aspect = pieceAspect(post)
        tasks["opener"] = Task { [weak self] in
            let set = await HookPictureLoader.load(wants, aspect: aspect, cube: cube, interpolation: interpolation,
                                                   resolve: { ref in await self?.openerURL(ref) },
                                                   isCancelled: { Task.isCancelled })
            guard let self, !Task.isCancelled, self.openerKey == key else { return }
            self.hookPictures = set.pictures
            self.hookPictureProblems = set.problems
            self.hookInputs &+= 1
            self.requestRender()
        }
    }

    /// Where an opener's picture is: the Library's file. An instance's still
    /// fetched for these frames alone is the opener-pictures task's
    /// (`use-hook-pictures`'s `fetchPreviewStill`) — until then a picture
    /// the pool does not hold is reported, one line, never replaced.
    func openerURL(_ ref: SavedMediaRef) async -> URL? {
        guard let library, let file = library.poolFile(named: ref) else { return nil }
        return url(for: file)
    }

    /// The hook picture's EXIF — the file's own head, then what its source
    /// vouched for under it — read once per file.
    func loadHookExif() {
        let ref = hookRef
        let url = ref.flatMap { self.url(for: $0) }
        let key = url?.absoluteString
        guard key != exifKey else { return }
        exifKey = key
        tasks["exif"]?.cancel()
        guard let url, let ref else {
            if hookExif != nil {
                hookExif = nil
                hookInputs &+= 1
                requestRender()
            }
            return
        }
        let vouched = library?.vouchedExif(for: ref)
        tasks["exif"] = Task { [weak self] in
            let head = await Task.detached(priority: .utility) { () -> [UInt8]? in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
                defer { try? handle.close() }
                let data: Data? = try? handle.read(upToCount: exifSliceBytes)
                return data.map { [UInt8]($0) }
            }.value
            guard let self, !Task.isCancelled, self.exifKey == key else { return }
            self.hookExif = readEffectiveExif(head, vouched)
            self.hookInputs &+= 1
            self.refreshOpener()
            self.requestRender()
        }
    }
}
