// A picture of every slide AS IT WILL BE DELIVERED — the crop, the caption,
// the badge, the grade — for the band's cells: the web's `use-rail-thumbs.ts`.
// Each goes through `SlideRenderer`, the one object the stage, the PNG deck
// and every painted clip draw through, at cell size, so a cell never shows a
// picture the export does not deliver (the maintainer read the old raw-file
// cells, rightly, as the rail not updating).
//
// What keeps that affordable (the web's four rules):
// - Each slide carries a SIGNATURE of everything drawn into it (`RailInput`,
//   compared whole): a pass redraws only the cells whose signature moved, so
//   editing the hook costs the hook and switching slides costs nothing.
// - Pictures are decoded small (`sourceBudget` pixels), never at their own
//   density: a carousel of 48-megapixel stills would put one full-size decode
//   up per cell.
// - One decoded source is kept between passes, so a run of edits on one slide
//   decodes once — and a clip at another moment SEEKS the reader already open.
// - Slides are drawn one at a time after 350 ms of quiet, and a pass is
//   abandoned the moment its inputs change. A slide that cannot be decoded
//   costs its cell its picture, never the band, and is not retried until
//   something about it changes.
//
// Drawn SETTLED, whatever the transport does: past the badge's entrances and
// the opener's own seconds on the hook, past a collage's arrival anywhere — a
// thumbnail caught mid-entrance is a thumbnail that changes while you watch.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class PieceRailThumbs {
    /// Longest edge of a thumbnail, in pixels — the cells are 38 points tall,
    /// so this is about twice a dense screen's need.
    static let longEdge = 192.0
    /// How many pixels a picture is decoded to for a thumbnail — generous,
    /// because a picture zoomed in shows only a part of itself.
    static let sourceBudget = 512.0 * 512.0
    /// Quiet after an edit before drawing again — a keystroke is not a job.
    static let debounceNanos: UInt64 = 350_000_000

    /// Each slide's thumbnail, by the slide's key; absent while never drawn
    /// (or when its picture could not be).
    private(set) var images: [String: CGImage] = [:]

    /// What each cell was drawn from.
    @ObservationIgnored private var drawn: [String: RailInput] = [:]
    /// The last inputs asked for — the same twice schedules nothing.
    @ObservationIgnored private var asked: [RailJob] = []
    @ObservationIgnored private var pass: Task<Void, Never>?
    /// The one decoded source kept between passes, and the file it came from.
    @ObservationIgnored private var held: (key: String, source: BadgeSource)?

    /// The thumbnail of `slide`, or nil while it has none.
    func image(_ slide: DeckSlide) -> CGImage? {
        images[slide.slideId ?? slide.kind.rawValue]
    }

    /// The piece moved (an edit, a picture landing, the looks resolved): draw
    /// again what changed, once the edits have settled.
    func refresh(_ model: PieceEditorModel) {
        guard let trip = model.trip, let post = model.post else { return }
        let jobs = PieceRailThumbs.jobs(model, trip, post)
        let inputs = jobs.map(\.input)
        guard inputs != asked.map(\.input) else { return }
        asked = jobs
        // Forget the cells this deck no longer has.
        let alive = Set(jobs.map(\.key))
        for key in drawn.keys where !alive.contains(key) { drawn[key] = nil }
        let stale = images.keys.filter { !alive.contains($0) }
        for key in stale { images[key] = nil }

        pass?.cancel()
        guard jobs.contains(where: { drawn[$0.key] != $0.input }) else { return }
        let renderer = SlideRenderer(trip: trip, post: post, aspect: pieceAspect(post), pictures: model.hookPictures,
                                     exif: model.hookExif?.exif, looks: model.looks)
        pass = Task { [weak self] in
            try? await Task.sleep(nanoseconds: PieceRailThumbs.debounceNanos)
            guard !Task.isCancelled else { return }
            await self?.run(jobs, renderer)
        }
    }

    /// The editor is going away: let the decoded picture go.
    func close() {
        pass?.cancel()
        pass = nil
        held?.source.release()
        held = nil
    }

    // MARK: - a pass

    private func run(_ jobs: [RailJob], _ renderer: SlideRenderer) async {
        for job in jobs {
            if Task.isCancelled { return }
            if drawn[job.key] == job.input { continue }
            let decoded = await self.decode(job)
            if Task.isCancelled { return }
            let size = frameSize(renderer.aspect, PieceRailThumbs.longEdge)
            let draw = RailDraw(renderer: renderer, slide: job.slide, sources: decoded, time: job.time,
                                width: max(1, Int(size.width)), height: max(1, Int(size.height)))
            let image = await Task.detached(priority: .utility) { draw.run() }.value
            // A collage's cells were decoded for this one draw.
            if job.slide.collage != nil { for cell in decoded.cells { cell?.release() } }
            if Task.isCancelled { return }
            // Stored even when it failed, so an undecodable file is not retried
            // on every pass — only once something about its slide changes.
            drawn[job.key] = job.input
            images[job.key] = image
        }
    }

    /// The decoded pictures one cell is painted over: a collage decodes every
    /// cell for this draw; a single picture reuses the one kept, seeking a clip.
    private func decode(_ job: RailJob) async -> SlideSources {
        let files = job.files
        if let collage = job.slide.collage {
            let lead = CollageLead(media: job.slide.media, framing: job.slide.framing, develop: job.slide.develop,
                                   motion: job.slide.motion)
            let cells = await BadgeSources.loadCollage(lead, videoSeconds: job.slide.videoTimeSeconds, collage,
                                                       resolve: { ref in files[ref.name.lowercased()] },
                                                       budget: PieceRailThumbs.sourceBudget)
            return SlideSources(cells: cells)
        }
        guard let ref = job.slide.media, let url = files[ref.name.lowercased()] else { return .empty }
        let key = url.absoluteString
        if let have = held, have.key == key {
            if have.source.isClip { try? await have.source.seek(job.slide.videoTimeSeconds) }
            return SlideSources(lead: have.source)
        }
        held?.source.release()
        held = nil
        guard let source = try? await BadgeSources.load(url, name: ref.name, videoSeconds: job.slide.videoTimeSeconds,
                                                        budget: PieceRailThumbs.sourceBudget) else { return .empty }
        held = (key, source)
        return SlideSources(lead: source)
    }

    // MARK: - the signatures

    /// Every slide's job: what it is drawn from, and where its files are.
    private static func jobs(_ model: PieceEditorModel, _ trip: TripDoc, _ post: TripPost) -> [RailJob] {
        let aspect = pieceAspect(post)
        let hookSeconds = max(model.settleSeconds, model.hookState?.hook.seconds ?? 0)
        let looksId = ObjectIdentifier(model.looks)
        return model.slides.map { (slide: DeckSlide) -> RailJob in
            let files = PieceRailThumbs.files(model, slide)
            let fileKey = files.keys.sorted().map { "\($0)=\(files[$0]?.absoluteString ?? "")" }.joined(separator: "|")
            var input = RailInput(slide: slide, aspect: aspect, files: fileKey, looks: looksId,
                                  look: model.looks.key(slide, trip, post))
            switch slide.kind {
            case .hook:
                // The hook reads the whole badge, the trip's words and legs,
                // the opener's pictures and the camera credit: any of them.
                input.hook = "\(model.revision)#\(model.hookInputs)"
                input.theme = trip.theme
            case .content:
                input.theme = trip.theme
            case .cta:
                input.cta = trip.cta
            }
            return RailJob(key: slide.slideId ?? slide.kind.rawValue, slide: slide, input: input, files: files,
                           time: deckStillSeconds(slide, aspect, hookSeconds))
        }
    }

    /// Where a slide's pictures are on this device, by lower-cased name — the
    /// Library's files, opened through the editor (which holds them).
    private static func files(_ model: PieceEditorModel, _ slide: DeckSlide) -> [String: URL] {
        guard slide.kind != .cta, let library = model.library else { return [:] }
        var refs: [SavedMediaRef] = slide.media.map { [$0] } ?? []
        if let collage = slide.collage {
            let lead = CollageLead(media: slide.media, framing: slide.framing, develop: slide.develop, motion: slide.motion)
            refs = collageMediaRefs(lead, collage)
        }
        var out: [String: URL] = [:]
        for ref in refs {
            if let file = library.poolFile(named: ref), let url = model.url(for: file) {
                out[ref.name.lowercased()] = url
            }
        }
        return out
    }
}

/// Everything a cell is drawn from — compared whole, so a cell redraws when
/// and only when one of these moved.
private struct RailInput: Equatable {
    var slide: DeckSlide
    var aspect: Double
    /// The files its pictures are read from.
    var files: String
    /// The looks cache the grades were baked through (made again when a pack
    /// look resolves), and the key of the cube this picture wears.
    var looks: ObjectIdentifier
    var look: String?
    /// The trip's title style — a caption and the badge wear it.
    var theme: StyleTheme?
    /// The trip's closing card — the last slide is drawn from it.
    var cta: CtaSlide?
    /// The hook: the document's revision and the opener's inputs.
    var hook: String?
}

private struct RailJob {
    let key: String
    let slide: DeckSlide
    let input: RailInput
    let files: [String: URL]
    /// The settled moment the still is taken at.
    let time: Double
}

/// One cell's paint, handed off the main actor — the stage's `PieceStageJob`
/// pattern: the renderer is used by one pass at a time.
private struct RailDraw: @unchecked Sendable {
    let renderer: SlideRenderer
    let slide: DeckSlide
    let sources: SlideSources
    let time: Double
    let width: Int
    let height: Int

    func run() -> CGImage? {
        renderer.image(slide, sources, at: time, width: width, height: height)
    }
}
