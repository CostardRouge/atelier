// A roll's EXPORT RUN — the web's `exportPictures` (`use-roll-export.ts`) over
// `renderRollPicture` (`roll-render.ts`) and `deliverFilesTo`
// (`deliver-files.ts`), for this device:
//
// 1. WHERE first: the folder was picked at the click (its security scope
//    opened here, for the whole run); Photos is asked for its permission
//    before a pixel is rendered — "ask first, render second".
// 2. Per picture, off the main actor: its file read and decoded; the numbers
//    it leaves with decided (a RAW base set aside under *Proxies only*, or
//    when the RAW is out of reach — and said); rendered ONCE through the
//    editor's own render plan at `.whole`, so the file is what the stage
//    showed (Core Image tiles the whole picture); then cut to EVERY target
//    (`DeliveredFile`): sized as a cap that never upscales, sharpened for a
//    screen, marked, encoded, stamped with the ORIGINAL's metadata, wrapped
//    as Ultra HDR where asked and possible.
// 3. Each file written as it lands — never the whole roll held until the end
//    (the web holds it; its audit said to write each as it lands) — under
//    the picture's EXACT name (`DJI_0101.JPG` → `DJI_0101.jpg`), the first
//    target into the chosen folder, every other into a sub-folder named after
//    it, a variant into `Variant N/`; numbered around a name the folder holds
//    unless the roll says to replace. Photos takes each picture's first target.
// 4. The pictures whose main file LANDED are marked on this device
//    (`export-marks.ts`), keyed on each picture as it was rendered.
// 5. One TASK for the run: a picture at a time on its bar, a Cancel that
//    stops BETWEEN two pictures and keeps what was written, said in the note.
//
// What the render plan does not draw yet (the look, the layers…) is never
// passed off as delivered: the run says which pictures left without it.

import CoreImage
import Foundation
import AtelierKit

/// One picture's work, handed to the render thread.
struct PictureJob {
    /// The picture as it leaves — its drafts already on the roll.
    let picture: RollPicture
    /// The file's name, numbered within the run where two pictures want one.
    let name: String
    /// `Variant 2` for a copy, `""` for a picture.
    let variantDir: String
    let locator: PictureLocator?
    let mediaDirectory: URL
    let plan: DevelopRenderPlan
    let targets: [ExportTarget]
    let format: ExportFormat
    let proxiesOnly: Bool
    /// The HDR reach asked, or nil when the roll asks for none.
    let hdrStops: Int?
    /// The roll's watermark style, when a target draws it.
    let watermark: Watermark?
    let identity: DeliveryIdentity?
    let keep: MetaChoice
    let placeOf: ((GpsCoord) -> DeliveryPlace?)?
    /// The chosen folder; nil hands the first target's file back for Photos.
    let folder: URL?
    let replace: Bool
    /// The run's clock (ms) and this year — a picture nobody dated is signed with it.
    let now: Double
    let year: Int
}

/// What one picture came to.
struct PictureOutcome {
    /// The run was cancelled before this picture was rendered.
    var cancelled = false
    /// Its first target was made.
    var rendered = false
    var failures: [String] = []
    /// Files written into the folder, numbered ones among them.
    var written = 0
    var renamed = 0
    /// Files the folder refused, with the folder's own words.
    var errors: [String] = []
    /// The main file landed — what the export mark records.
    var mainLanded = false
    /// The first target's file, for Photos.
    var photo: (data: Data, name: String)?
    /// It had a position and no town near enough to name.
    var unplaced = false
    /// Its watermark line came out empty.
    var unmarked = false
    /// What the render plan did not draw on it.
    var unrendered: [String] = []
    /// It could carry a gain map (a RAW), and what the map came to.
    var hdrAsked = false
    var hdr: HdrMade?
}

@MainActor
final class RollExportRun {
    struct Input {
        let rollId: String
        /// The pictures asked for, in the strip's order, as they are on the roll.
        let pictures: [RollPicture]
        let export: RollExport
        let identity: DeliveryIdentity?
        let format: ExportFormat
        let proxiesOnly: Bool
        let destination: RunDestination
        let plan: DevelopRenderPlan
        let locators: [String: PictureLocator]
        let mediaDirectory: URL
    }

    private let input: Input
    private let state: RollRunState
    private let store: RollStore
    private weak var editor: RollEditor?

    init(input: Input, state: RollRunState, store: RollStore, editor: RollEditor?) {
        self.input = input
        self.state = state
        self.store = store
        self.editor = editor
    }

    /// Begin: the task registered, the work held so a Cancel reaches it.
    func start() {
        let count = input.pictures.count
        let label = count == 1 ? "Exporting \(input.pictures[0].ref.name)" : "Exporting \(count) pictures"
        let flag = RunCancelFlag()
        state.begin(label: label, flag: flag)
        let work = Task { await self.run(flag) }
        state.hold(work)
    }

    private func run(_ flag: RunCancelFlag) async {
        let pictures = input.pictures
        let total = pictures.count
        let export = input.export
        let keep = readMetaChoice(export.metadata)
        let style = readWatermark(export.watermark)
        let drawsMark = export.targets.contains { $0.watermark }
        let photos: Bool
        var folder: URL?
        var scoped = false

        // WHERE, before a pixel is rendered.
        switch input.destination {
        case .folder(let url):
            photos = false
            folder = url
            scoped = url.startAccessingSecurityScopedResource()
        case .photos:
            photos = true
            state.say("Asking Photos…")
            guard await PhotosDelivery.authorised() else {
                state.finish(note: "Photos refused access — nothing was rendered.", hdr: nil, details: [])
                return
            }
        }
        defer {
            if scoped, let folder { folder.stopAccessingSecurityScopedResource() }
        }

        var failures: [String] = []
        // The place index (`delivery-place.ts`), only when the roll writes a
        // place: bundled with the app, never asked of anyone. One that will not
        // load names nothing, and the run says so after what the pictures said.
        var placeOf: ((GpsCoord) -> DeliveryPlace?)?
        var indexNote: [String] = []
        if keep.place {
            state.say("Loading the place index…")
            let cities = await Task.detached(priority: .userInitiated) { PlaceIndex.cities }.value
            if let cities {
                placeOf = { gps in placeFor(cities, gps) }
            } else {
                indexNote = ["the place index is not in this build — no town was written"]
            }
        }

        var unplaced: [String] = []
        var unmarked: [String] = []
        var undrawnCount = 0
        var undrawn = Set<String>()
        var landed: [RollPicture] = []
        var written = 0
        var renamed = 0
        var errors: [String] = []
        var rendered = 0
        var hdrRun: RollRunHdr? = export.hdr ? RollRunHdr() : nil
        // A run names each file after its picture, so two pictures wanting one
        // name are numbered here, case-folded like the volume it lands on.
        var named = Set<String>()
        let now = nowMillis()
        let year = Calendar.current.component(.year, from: Date())

        for (i, original) in pictures.enumerated() {
            if flag.isSet { break }
            let step = "\(i + 1)/\(total)"
            let share = Double(i) / Double(max(1, total))
            state.say("Rendering \(step)…", progress: share, detail: "\(step) · \(original.ref.name)")
            let variantDir = variantFolder(original)
            let wanted = RollExportRun.fileName(original.ref.name, input.format)
            let name = (try? uniqueName(wanted, taken: { named.contains(RollExportRun.key(variantDir, $0)) })) ?? wanted
            named.insert(RollExportRun.key(variantDir, name))

            let job = PictureJob(
                picture: original,
                name: name,
                variantDir: variantDir,
                locator: input.locators[original.id],
                mediaDirectory: input.mediaDirectory,
                plan: input.plan,
                targets: export.targets,
                format: input.format,
                proxiesOnly: input.proxiesOnly,
                hdrStops: export.hdr ? export.hdrStops : nil,
                watermark: drawsMark ? style : nil,
                identity: input.identity,
                keep: keep,
                placeOf: placeOf,
                folder: folder,
                replace: export.replace,
                now: now,
                year: year
            )
            let outcome = await Task.detached(priority: .userInitiated) { await RollExportRun.deliver(job, flag) }.value
            if outcome.cancelled { break }

            failures += outcome.failures
            if outcome.unplaced { unplaced.append(original.ref.name) }
            if outcome.unmarked { unmarked.append(original.ref.name) }
            if !outcome.unrendered.isEmpty {
                undrawnCount += 1
                undrawn.formUnion(outcome.unrendered)
            }
            if outcome.hdrAsked { hdrRun?.asked += 1 }
            if let made = outcome.hdr, made.ultra, var run = hdrRun {
                run.ultra += 1
                run.headroom = max(run.headroom, made.headroom)
                if let checked = made.checked { run.checked = max(run.checked ?? 0, checked) }
                hdrRun = run
            }
            guard outcome.rendered else { continue }
            rendered += 1

            if photos {
                guard let photo = outcome.photo else { continue }
                state.say("Saving \(step) to Photos…")
                do {
                    try await PhotosDelivery.save(photo.data, name: photo.name)
                    written += 1
                    landed.append(original)
                } catch {
                    errors.append("\(photo.name): \(error.localizedDescription)")
                }
            } else {
                written += outcome.written
                renamed += outcome.renamed
                errors += outcome.errors
                if outcome.mainLanded { landed.append(original) }
            }
        }

        let cancelled = flag.isSet
        if rendered == 0 {
            let note = cancelled ? "Export cancelled — nothing was written." : (failures.first ?? "Nothing could be rendered.")
            state.finish(note: note, hdr: hdrRun, details: failures)
            return
        }
        // What LANDED is what gets marked: a file the folder refused was not delivered.
        if !landed.isEmpty {
            if let editor {
                editor.markExported(landed)
            } else {
                store.recordExported(input.rollId, landed)
            }
        }
        var said = RollExportRun.drawnNote(undrawnCount, undrawn) + failures
        said += RollExportRun.placeNote(unplaced) + indexNote + RollExportRun.markNote(unmarked) + errors
        if photos && export.targets.count > 1 {
            said.append("Photos took each picture’s first target — the other \(export.targets.count - 1) need a folder")
        }
        let method: DeliveryMethod = photos ? .photos : .folder
        let shape: (pictures: Int, targets: Int)? = photos ? nil : (rendered, export.targets.count)
        let sentence = describeRun(written, method, said, renamed, run: shape)
        let head = cancelled ? "Cancelled after \(rendered) of \(total) — " : ""
        state.finish(note: head + sentence, hdr: hdrRun, details: said)
    }

    // MARK: - one picture, off the main actor

    /// Read, decode, render once, make every target's file and land it.
    nonisolated static func deliver(_ job: PictureJob, _ flag: RunCancelFlag) async -> PictureOutcome {
        var out = PictureOutcome()
        let label = job.picture.ref.name
        guard let locator = job.locator else {
            out.failures.append("\(label) could not be found — this device does not know where its file is; reopen its folder or drop it on the roll")
            return out
        }
        let data: Data
        do {
            data = try RollStore.bytes(of: locator, mediaDirectory: job.mediaDirectory)
        } catch {
            out.failures.append("\(label) could not be read: \(error.localizedDescription)")
            return out
        }
        guard let decoded = PictureDecoder.decode(data, name: label) else {
            out.failures.append("\(label) is in a format this device cannot decode")
            return out
        }
        // Cancelled while it was being read: nothing of it is rendered.
        if flag.isSet {
            out.cancelled = true
            return out
        }

        // The numbers the pixels take. A RAW base stands only where the
        // sensor's data is what is decoded — never set aside silently.
        var picture = job.picture
        let raw = decoded.isRaw && !job.proxiesOnly
        if isRawDevelop(picture.develop) {
            if job.proxiesOnly {
                out.failures.append("\(label) left from its file: proxies only for this run, its RAW base set aside")
            } else if !decoded.isRaw {
                out.failures.append("\(label) is developed on its RAW, which is not reachable here — its render left instead")
            }
            if !raw, let develop = picture.develop {
                let numbers = withoutBase(develop)
                picture.develop = isDefaultDevelop(numbers) ? nil : numbers
            }
        }
        // What a render cannot wait for is read first: a pack look from the
        // vault, a subject from the model — then what is still not drawn is said.
        await job.plan.prepare(picture: picture, decoded: decoded, budget: .whole)
        out.unrendered = job.plan.unrendered(picture: picture)

        // The metadata is the ORIGINAL's: the file's own head, else what the
        // system reads of a container the kernel does not walk (a HEIC).
        let head = [UInt8](data.prefix(exifSliceBytes))
        let own = parseExif(head)
        let vouched: ExifData? = isEmptyExif(own) ? ImageIOEncoding.exifData(decoded.properties) : nil
        let capture: ExifData? = isEmptyExif(own) ? vouched : own

        // The watermark's line for THIS picture: the identity, the year it was
        // taken, its own title. A line that says nothing is not drawn, and said.
        var mark: (text: String, style: Watermark)?
        if let style = job.watermark {
            let taken = captureYear(capture?.dateTimeOriginal, job.year)
            let text = resolveWatermarkText(style.text, creator: job.identity?.creator, year: taken, title: picture.title)
            if text.isEmpty {
                out.unmarked = true
            } else {
                mark = (text, style)
            }
        }

        // HDR needs the sensor's data: a render holds nothing above white.
        var stops: Double?
        if let asked = job.hdrStops {
            if job.format == .heic {
                out.failures.append("\(label) left as a HEIC: an Ultra HDR file is a JPEG")
            } else if raw {
                out.hdrAsked = true
                stops = Double(asked)
            } else {
                out.failures.append("\(label) left as a plain JPEG: HDR needs a RAW, a render holds nothing above white")
            }
        }

        // ONE render, every target cut from it.
        let composed = job.plan.render(picture: picture, decoded: decoded, budget: .whole)
        var darker: CIImage?
        if let stops {
            var dark = picture
            var numbers = picture.develop ?? .default
            numbers.exposure -= stops
            dark.develop = numbers
            darker = job.plan.render(picture: dark, decoded: decoded, budget: .whole)
        }

        // The file's own arithmetic: the crop at the source's density, inside
        // its border where the plan draws one, capped and never upscaled.
        // The pixels the plan renders from — a RAW's SENSOR where the develop
        // is on it (8064 × 4536 on a DJI), never the render it opened on.
        let drawn = job.plan.sourceSize(picture: picture, decoded: decoded, budget: .whole)
        let src = Size(Double(drawn.width), Double(drawn.height))
        let ratio = pictureAspectRatio(picture.aspect, src.width, src.height)
        let border = out.unrendered.contains("border") ? nil : readBorder(picture.carried["border"])
        let frame = deliveredLayout(src, ratio, picture.framing, border, nil).out
        let author = AuthorMeta(identity: job.identity, fallbackYear: job.year, title: picture.title,
                                caption: picture.caption, keep: job.keep, placeOf: job.placeOf)
        let headForStamp: [UInt8]? = head.isEmpty ? nil : head

        var firstExif: ExportExif?
        for (i, target) in job.targets.enumerated() {
            let cap = longEdgeFor(target.size, width: frame.width, height: frame.height).map(Double.init)
            let size = deliveredLayout(src, ratio, picture.framing, border, cap).out
            let targetDir = i == 0 ? "" : targetFolder(target.name, index: i)
            let dir = [targetDir, job.variantDir].filter { !$0.isEmpty }.joined(separator: "/")
            let made: MadeFile
            do {
                made = try DeliveredFile.make(
                    composed,
                    darker: darker,
                    out: size,
                    sharpen: target.sharpen.amount,
                    quality: target.quality,
                    format: job.format,
                    mark: target.watermark ? mark : nil,
                    stops: stops,
                    exif: { delivered in exportExifBlock(headForStamp, vouched, delivered, author, now: job.now) }
                )
            } catch {
                let at = dir.isEmpty ? "" : " (\(dir)/)"
                out.failures.append("\(label)\(at): \(error.localizedDescription)")
                // The main file failed: the picture did not leave.
                if i == 0 { return out }
                continue
            }
            if i == 0 {
                firstExif = made.exif
                out.hdr = made.hdr
                out.rendered = true
            }
            guard let root = job.folder else {
                // Photos: the first target, under the picture's own name.
                if i == 0 { out.photo = (made.data, job.name) }
                break
            }
            do {
                let wrote = try FolderDelivery.write(made.data, name: job.name, folder: dir, root: root, replace: job.replace)
                out.written += 1
                if wrote != job.name { out.renamed += 1 }
                if i == 0 { out.mainLanded = true }
            } catch {
                let at = dir.isEmpty ? job.name : "\(dir)/\(job.name)"
                out.errors.append("\(at): \(error.localizedDescription)")
            }
        }

        // Said, not hidden — only where the choice asked for what was missing.
        if let exif = firstExif {
            if job.placeOf != nil && exif.located && (exif.place?.city ?? "").isEmpty { out.unplaced = true }
            if exif.account == .none && keepsCapture(job.keep) {
                out.failures.append("\(label) carries no camera EXIF — nothing is known about the picture it came from, only the signature is written")
            }
        }
        if stops != nil, let made = out.hdr, !made.ultra {
            out.failures.append("\(label) left as a plain JPEG: \(made.reason ?? "no gain map")")
        }
        return out
    }

    // MARK: - names and sentences

    /// `DJI_0101.JPG` → `DJI_0101.jpg` (or `.heic`): EXACTLY the picture's own name.
    nonisolated static func fileName(_ refName: String, _ format: ExportFormat) -> String {
        let jpg = exportName(refName)
        guard format == .heic else { return jpg }
        return (jpg as NSString).deletingPathExtension + ".heic"
    }

    /// A name within its folder, case-folded — a variant's does not collide with the first's.
    nonisolated static func key(_ folder: String, _ name: String) -> String {
        "\(folder)/\(name)".lowercased()
    }

    /// The pictures that had a position and no town near enough — said once.
    nonisolated static func placeNote(_ names: [String]) -> [String] {
        guard let first = names.first else { return [] }
        let who = names.count == 1 ? first : "\(names.count) pictures"
        return ["\(who) had no named town within \(Int(placeMaxKm)) km of its position — no city was written"]
    }

    /// The pictures whose watermark said nothing — said once, with what would fill it.
    nonisolated static func markNote(_ names: [String]) -> [String] {
        guard let first = names.first else { return [] }
        let who = names.count == 1 ? first : "\(names.count) pictures"
        return ["\(who) left without a watermark: its line says nothing yet — set a creator in Metadata, or write the line out"]
    }

    /// What the render plan did not draw — never passed off as delivered.
    nonisolated static func drawnNote(_ count: Int, _ what: Set<String>) -> [String] {
        guard count > 0 else { return [] }
        let who = count == 1 ? "1 picture" : "\(count) pictures"
        return ["\(who) left without what this app does not draw yet — \(what.sorted().joined(separator: ", ")); the web app delivers them"]
    }
}

/// The committed GeoNames index (`public/geo/cities.json`), bundled with the
/// app by `project.yml` and read once per session — never fetched.
enum PlaceIndex {
    static let cities: [GazetteerCity]? = {
        guard let url = Bundle.main.url(forResource: "cities", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = JSONValue.parse(data) else { return nil }
        let list = parseGazetteer(json)
        return list.isEmpty ? nil : list
    }()
}
