// The piece BRIEFS the Studio — the logic half of the web's `StudioLink.tsx`.
//
// The workflow it closes: a clip is graded and given its telemetry in the
// Studio, the day badge is composed here, and the two used to leave as two
// files joined on a phone. Linking a project lets the badge be SENT into it as
// an intro scene (`roadtrip-hook`), so ONE Studio export carries the grade,
// the telemetry and the hook. The translation is the kernel's
// (`Roadtrip/HookScene.swift`); this reads and writes the Studio's documents.
//
// Rules kept (`roadtrip.md`, «Road Trip briefs the STUDIO», «The closing card
// crosses the same bridge», «The hook's DEVELOP crosses the bridge»):
// - A send REPLACES the last one and touches nothing else in the project.
// - The closing card goes into the OUTRO slot when the piece closes on it; an
//   outro the author composed in the Studio is never overwritten — it stays,
//   and the send says so. Unticked, a sent card is taken back out.
// - The hook picture's develop goes under the media's key, marked `via:
//   roadtrip`; the author's own develop for that media stays, and is said.
// - Unlinking takes the hook, the sent card and the sent develop back out.
// - A project created here records NO media: the clip is already in the
//   shared Library, and a ref without a folder greets a new project with
//   "1 media file not in this folder" (`roadtrip.md`'s trap).
// - Giving the project a grade never writes over one it has.
// - Neither tool reaches into the other's state: the project is written
//   through the Studio's own store (`StudioStore` → `DocumentStore<ProjectDoc>`,
//   and its sync's dirty record for a project kept on an instance) and opened
//   through its hand-off seam (`openHandedOver`), the web's `#/studio/open/<id>`.
//
// One native rule the web never needed: the Studio keeps its editor alive
// while a project is open (coming back resumes it), seeded from the document
// it opened — its next autosave would write that copy back OVER a send. So a
// write to the project open in the Studio first flushes the editor's owed
// save, closes it, writes, and opens the project again from the new copy.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class PieceStudioBridge {
    /// Every Studio project on this device, newest first; nil until read.
    private(set) var projects: [ProjectDoc]?
    /// What a verb is doing right now ("Sending…"); nil when idle.
    private(set) var busy: String?
    /// The last verb's sentence.
    var note: String?

    @ObservationIgnored let studio: StudioStore

    init(studio: StudioStore = .shared) {
        self.studio = studio
    }

    // MARK: - reading

    /// Read the Studio's projects again — the list to link from, and the linked one.
    func refresh() {
        projects = studio.documents.list()
    }

    /// The project `id` names, as last read.
    func project(_ id: String?) -> ProjectDoc? {
        guard let id else { return nil }
        return projects?.first { $0.id == id }
    }

    /// The badge exactly as the stage draws it — what a send carries.
    static func elements(_ model: PieceEditorModel) -> [OverlayElement] {
        guard let post = model.post, let content = model.content else { return [] }
        let badge = post.badge
        return badgeElements(content, badge.layout, model.aspect, badge.pieceStyles, badge.durationSeconds,
                             badge.cascade)
    }

    /// The grade the HOOK wears here, and whose it is — what a reel from the
    /// project is weighed against.
    static func hookGrade(_ model: PieceEditorModel) -> (grade: TripGrade, scope: GradeScope) {
        guard let trip = model.trip, let post = model.post else { return (emptyGrade(), .trip) }
        return (gradeShownBy(trip, post, hookPicture), gradeScopeOf(post, hookPicture))
    }

    // MARK: - the verbs

    /// Link an existing project.
    func link(_ model: PieceEditorModel, _ id: String) {
        note = nil
        model.updatePost { $0.projectId = id }
    }

    /// Write the badge into the project as its intro scene — with the closing
    /// card and the picture's correction — and open the Studio on it, or stay.
    func send(_ model: PieceEditorModel, openAfter: Bool, navigate: @escaping () -> Void) async {
        guard let post = model.post, let trip = model.trip, let id = post.projectId else { return }
        note = nil
        busy = "Sending…"
        defer { busy = nil }
        guard let doc = await current(id) else {
            note = "That project is gone from this device. Link another one."
            model.updatePost { $0.projectId = nil }
            return
        }
        let name = post.title.isEmpty ? "Trip hook" : post.title
        let injection = hookInjection(PieceStudioBridge.elements(model), post.badge.durationSeconds,
                                      post.badge.shades, name)
        var next = withHook(doc, injection)
        // The closing card goes with the hook when the piece closes on it;
        // unticked, a card sent before is taken back out. An outro the author
        // composed in the Studio is theirs, and stays.
        let card = post.includeCta ? ctaOutro(trip.cta, model.aspect) : nil
        var ctaHeld: String?
        if let applied = withCtaOutro(next, card) {
            next = applied
        } else {
            ctaHeld = "The closing card stayed here: the project already has an outro of its own."
        }
        // The hook picture's correction goes too; a develop the author set in
        // the Studio for that media is theirs, and stays.
        let hookDevelop = post.media.map { HookDevelop(name: $0.name, hash: $0.hash, settings: post.badge.develop) }
        let developed = withHookDevelop(next, hookDevelop)
        next = developed.doc
        let developHeld = developed.held
            ? "The picture’s correction stayed here: the project has its own for that media." : nil
        guard await write(next, reopen: !openAfter) else {
            note = "The project could not be saved on this device."
            return
        }
        if openAfter {
            await open(next.id, navigate: navigate)
            return
        }
        let held = [ctaHeld, developHeld].compactMap { $0 }.joined(separator: " ")
        note = held.isEmpty ? "Sent. Open the Studio to export." : "Sent. \(held)"
    }

    /// A project around this piece's clip, ready to grade — no folder, no media.
    func create(_ model: PieceEditorModel) async {
        guard let post = model.post else { return }
        note = nil
        busy = "Creating…"
        defer { busy = nil }
        let fileName = model.hookRef?.name
        let title = post.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let stem = fileName.map { ($0 as NSString).deletingPathExtension } ?? ""
        let name = !title.isEmpty ? title : (!stem.isEmpty ? stem : "Day \(post.date)")
        var doc = createProjectDoc(name, post.badge.aspectId, [], .default)
        doc.media = .empty
        guard studio.documents.put(doc) else {
            note = "This device refused to save a new project."
            return
        }
        model.updatePost { $0.projectId = doc.id }
        refresh()
        note = fileName.map {
            "Project created. Add \($0) to it from the Library, grade it, and send the hook when the badge is right."
        } ?? "Project created. Send the hook when the badge is right."
    }

    /// Take the hook, the sent card and the sent develop back out of the
    /// project, and drop the link — the author's own outro survives.
    func unlink(_ model: PieceEditorModel) async {
        if let id = model.post?.projectId {
            busy = "Unlinking…"
            if let doc = await current(id) {
                let next = withoutCtaOutro(withoutHook(doc))
                if next != doc { _ = await write(next, reopen: true) }
            }
            busy = nil
        }
        model.updatePost { $0.projectId = nil }
        note = nil
    }

    /// Give a project that has no grade this piece's, so both exports agree.
    /// Never over a grade the project has — it is the author's.
    func pushGrade(_ model: PieceEditorModel) async {
        guard let id = model.post?.projectId else { return }
        note = nil
        busy = "Sending the grade…"
        defer { busy = nil }
        guard let doc = await current(id) else {
            note = "That project is gone from this device. Link another one."
            return
        }
        if !doc.lutStack.isEmpty {
            note = "The project already has a grade of its own; it was left as it is."
            remember(doc)
            return
        }
        let grade = PieceStudioBridge.hookGrade(model).grade
        var next = doc
        next.lutStack = grade.layers
        next.outputTransform = grade.output
        next.updatedAt = nowMillis()
        let ok = await write(next, reopen: true)
        note = ok ? "The grade is in the project now." : "The project could not be saved on this device."
    }

    /// Open the project in the Studio — as its card would — and go there.
    func open(_ id: String, navigate: @escaping () -> Void) async {
        guard await studio.openHandedOver(id) else {
            note = "That project is gone from this device. Link another one."
            return
        }
        navigate()
    }

    // MARK: - the Studio's documents

    /// The project as it stands now — the Studio's owed save written first
    /// when it is the one open there.
    private func current(_ id: String) async -> ProjectDoc? {
        if studio.open?.doc.id == id, let flush = studio.pendingSave { await flush() }
        return studio.stored(id)
    }

    /// Write a project through the Studio's store — dirty for its instance
    /// when it is kept on one. The project open in the Studio is closed first
    /// (its editor seeded itself from the copy this replaces) and, with
    /// `reopen`, opened again from the new one.
    private func write(_ doc: ProjectDoc, reopen: Bool) async -> Bool {
        let wasOpen = studio.open?.doc.id == doc.id
        if wasOpen {
            studio.discardPendingSave?()
            studio.close()
        }
        studio.saved(doc)
        let ok = !studio.storageFailed
        remember(doc)
        if wasOpen && reopen { _ = await studio.openProject(doc) }
        return ok
    }

    /// The list, with this copy of a project in it.
    private func remember(_ doc: ProjectDoc) {
        guard var all = projects else {
            projects = [doc]
            return
        }
        if let at = all.firstIndex(where: { $0.id == doc.id }) {
            all[at] = doc
        } else {
            all.insert(doc, at: 0)
        }
        projects = all
    }
}
