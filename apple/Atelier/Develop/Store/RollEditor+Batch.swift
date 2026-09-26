// The editor's time-savers — the web's `RollEditor.tsx` verbs: the filmstrip's
// batch selection (D7), the delivery state (E1–E3), variants (item 30), the
// develop clipboard (⌘C / ⌘V), the SECTIONS picker (⌘⇧C / ⌘⇧V, apply-to,
// reset — `picture-sections.ts`), the per-tab apply-to verbs, the preset
// book, and taking a picture off the roll. Each writes through the ONE
// updater, so each is one undo step, and each says what it did in the web's
// own words.

import SwiftUI
import AtelierKit

/// A batch verb, as a section draws it — the web's `DevelopApplyVerb` (and
/// its crop, look and border twins, which share the shape).
struct ApplyVerb: Identifiable {
    let id: String
    let label: String
    let hint: String
    let run: () -> Void
}

/// The delivery gestures — a key, a badge, a table row.
enum DeliverAction {
    /// Send ↔ hold (`P`, a click on a badge).
    case toggle
    /// Back on the roll's rule (`U`).
    case auto
    /// Ignore ↔ bring back (`M`, a right-click or a held finger).
    case ignore
}

extension RollEditor {
    // MARK: - the batch selection

    /// A filmstrip click: a plain one OPENS, Shift or ⌘/Ctrl marks for a batch
    /// instead — the anchor never moves on a Shift-click, a ⌘-click becomes it.
    func click(_ id: String, _ mods: SelectionModifiers) {
        if !mods.shiftKey && !mods.metaKey && !mods.ctrlKey {
            open(id)
            return
        }
        selected = selectionAfterClick(pictures, visibleSelected, anchor ?? openId ?? id, id, mods)
        if mods.metaKey || mods.ctrlKey { anchor = id }
    }

    /// The selection, filtered to what is still on the roll.
    var visibleSelected: Set<String> {
        let ids = Set(pictures.map(\.id))
        return selected.filter { ids.contains($0) }
    }

    /// The batch's TARGETS: the selection without the open picture.
    var selectionTargets: [String] {
        pictures.map(\.id).filter { visibleSelected.contains($0) && $0 != openId }
    }

    /// "The others": every other picture still in the roll's WORK — an
    /// ignored one is never written by an Apply-to-all.
    var otherIds: [String] {
        pictures.filter { $0.id != openId && !isIgnored($0) }.map(\.id)
    }

    func clearSelection() {
        selected = []
    }

    // MARK: - delivery

    /// A delivery gesture on one picture, answered from the roll as it stands
    /// and said in the status line.
    func deliver(_ id: String, _ action: DeliverAction) {
        guard let p = pictures.first(where: { $0.id == id }) else { return }
        let next: DeliverState
        switch action {
        case .toggle: next = toggledDelivery(p)
        case .auto: next = .auto
        case .ignore: next = isIgnored(p) ? .auto : .ignore
        }
        update { setDelivery($0, [id], next) }
        var after = p
        after.deliver = next
        if next == .ignore {
            notice = "\(pictureLabel(p)) ignored — the arrows step over it"
        } else {
            let leaves = delivers(after) ? "will be exported" : "stays out of the export"
            notice = "\(pictureLabel(p)) \(leaves)\(next == .auto ? " (the roll’s rule)" : "")"
        }
    }

    // MARK: - variants

    /// A variant of the open picture — Lightroom's virtual copy when cloned,
    /// Capture One's New Variant when it starts as shot. Opened at once, and
    /// wearing the source's thumbnail until its own is taken. It shares the
    /// source's FILE, so it shares its locator.
    func makeVariant(_ start: VariantStart) {
        guard let from = openId else { return }
        let id = newRollId()
        update { addVariant($0, from, start, newId: id) }
        guard pictures.contains(where: { $0.id == id }) else { return }
        store.shareLocator(rollId, from: from, to: id)
        if start == .clone { pool.shareThumbnail(from: from, to: id) }
        open(id)
    }

    // MARK: - taking a picture off

    /// Remove — through the confirmation when it carries edits (they go with it).
    func requestRemove(_ p: RollPicture) {
        if isEdited(p) { confirmRemove = p } else { remove(p) }
    }

    func remove(_ p: RollPicture) {
        let nextOpen = openAfterRemoval(pictures, p.id, openId)
        // A draft the removed picture still owed goes with it: the roll moving
        // under it (`adoptStoreChange`) drops what was owed.
        store.removePicture(rollId, p.id)
        adoptStoreChange()
        pool.forget([p.id])
        selected.remove(p.id)
        if nextOpen != openId { open(nextOpen) }
    }

    // MARK: - the develop clipboard (⌘C / ⌘V)

    /// Copy the open picture's numbers — never its material.
    func copyDevelopHere() {
        guard !asShot else { return }
        copyDevelop(developDraft)
        tell("copied")
    }

    /// Replace the open picture's numbers with the copied ones.
    func pasteDevelopHere() {
        guard let pasted = pasteDevelop() else { return }
        setDevelopDraft(withBaseOf(pasted))
        tell("pasted")
    }

    /// Back to as shot — the develop's numbers only (its RAW base stays).
    func resetDevelop() {
        setDevelopDraft(withBaseOf(.default))
        tell("reset")
    }

    /// `numbers` on the open picture, keeping ITS OWN base and gain: a base is
    /// a fact about one picture's bytes and never travels.
    private func withBaseOf(_ numbers: DevelopSettings) -> DevelopSettings {
        var out = withoutBase(numbers)
        if isRawDevelop(developDraft) {
            out.base = developDraft.base
            out.rawGain = developDraft.rawGain
        }
        return out
    }

    /// Black and white ↔ colour (`V`) — the mixer is kept either way.
    func toggleMono() {
        var d = developDraft
        let wasMono = d.mono != nil
        d.mono = wasMono ? nil : straightMono()
        setDevelopDraft(d)
        tell(wasMono ? "colour" : "black and white")
    }

    // MARK: - sections (⌘⇧C / ⌘⇧V, apply, reset)

    private func sectionNames(_ sections: [PictureSection]) -> String {
        sections.compactMap { id in pictureSections.first { $0.id == id }?.label.lowercased() }.joined(separator: ", ")
    }

    /// Hold the open picture's `sections` for another picture, this session.
    func copySectionsOf(_ sections: [PictureSection]) {
        flushDrafts()
        guard let p = picture else { return }
        copySettings(p, sections)
        notice = "copied \(sectionNames(sections))"
    }

    /// Paste what ⌘⇧C held onto the open picture. False when nothing is held.
    @discardableResult
    func pasteSectionsHere() -> Bool {
        guard let held = copiedSettings(), let id = openId else { return false }
        flushDrafts()
        update { applySections($0, held.from, [id], held.sections) }
        notice = "pasted \(sectionNames(held.sections)) from \(pictureLabel(held.from))"
        return true
    }

    /// The open picture's `sections` back to as shot — one undo step away.
    func resetSectionsOf(_ sections: [PictureSection]) {
        guard let id = openId else { return }
        flushDrafts()
        update { resetSections($0, id, sections) }
        notice = "reset \(sectionNames(sections)) — ⌘Z brings them back"
    }

    /// The open picture's `sections` written onto `ids`, each as its own copy.
    func applySectionsTo(_ ids: [String], _ sections: [PictureSection]) {
        flushDrafts()
        guard let source = picture else { return }
        update { applySections($0, source, ids, sections) }
        notice = "\(sectionNames(sections)) applied to \(ids.count) picture\(ids.count == 1 ? "" : "s")"
    }

    // MARK: - the per-tab apply-to verbs

    /// The develop's own verbs: to the selection (and the clipboard pasted to
    /// it, while something is copied), else to every other picture.
    var developApplyVerbs: [ApplyVerb] {
        guard openId != nil else { return [] }
        let targets = selectionTargets
        if !targets.isEmpty {
            let n = targets.count
            var verbs = [ApplyVerb(id: "selection", label: "Apply to \(n) selected",
                                   hint: "the pictures marked in the filmstrip, each as its own copy") { [weak self] in
                guard let self else { return }
                self.writeDevelop(to: targets, self.developDraft)
            }]
            if canPasteDevelop {
                verbs.append(ApplyVerb(id: "paste-selection", label: "Paste to \(n) selected",
                                       hint: "the copied numbers, written onto each marked picture") { [weak self] in
                    guard let self, let pasted = pasteDevelop() else { return }
                    self.writeDevelop(to: targets, pasted)
                })
            }
            return verbs
        }
        let others = otherIds
        guard !others.isEmpty else { return [] }
        return [ApplyVerb(id: "roll", label: "Apply to \(others.count) other picture\(others.count == 1 ? "" : "s")",
                          hint: "the rest of this roll, each as its own copy") { [weak self] in
            guard let self else { return }
            self.writeDevelop(to: others, self.developDraft)
        }]
    }

    /// The NUMBERS onto `targets`, never the material: each target keeps its
    /// own base and gain, so a batch onto a RAW keeps it on the RAW.
    func writeDevelop(to targets: [String], _ develop: DevelopSettings?) {
        flushDrafts()
        let numbers = develop.map(withoutBase)
        let value: DevelopSettings? = (numbers != nil && !isDefaultDevelop(numbers)) ? numbers : nil
        update { r in
            var out = r
            var changed = false
            for i in out.pictures.indices where targets.contains(out.pictures[i].id) {
                let p = out.pictures[i]
                var next: DevelopSettings? = value
                if let own = p.develop, isRawDevelop(own) {
                    var kept = value ?? .default
                    kept.base = own.base
                    kept.rawGain = own.rawGain
                    next = kept
                }
                if !sameDevelop(p.develop, next) {
                    out.pictures[i].develop = next
                    changed = true
                }
            }
            if changed { out.updatedAt = nowMillis() }
            return changed ? out : r
        }
    }

    /// One section's verbs (the crop's, the look's, the border's): the open
    /// picture's section onto the selection, else onto the others — the web's
    /// `copyCropTo` / `copyGradeTo` / `copyBorderTo`, which are
    /// `applySections` over one section.
    func sectionApplyVerbs(_ section: PictureSection, noun: String, selectionHint: String, rollHint: String) -> [ApplyVerb] {
        guard openId != nil else { return [] }
        let targets = selectionTargets
        if !targets.isEmpty {
            return [ApplyVerb(id: "selection", label: "Apply \(noun) to \(targets.count) selected", hint: selectionHint) { [weak self] in
                self?.applySectionsTo(targets, [section])
            }]
        }
        let others = otherIds
        guard !others.isEmpty else { return [] }
        return [ApplyVerb(id: "roll", label: "Apply \(noun) to \(others.count) other picture\(others.count == 1 ? "" : "s")",
                          hint: rollHint) { [weak self] in
            self?.applySectionsTo(others, [section])
        }]
    }

    var cropApplyVerbs: [ApplyVerb] {
        sectionApplyVerbs(.crop, noun: "crop",
                          selectionHint: "the pictures marked in the filmstrip, each as its own copy",
                          rollHint: "the rest of this roll, each as its own copy")
    }

    var lookApplyVerbs: [ApplyVerb] {
        sectionApplyVerbs(.look, noun: "look",
                          selectionHint: "this picture’s look — LUTs, output, grain — onto the pictures marked in the filmstrip, their develops untouched",
                          rollHint: "this picture’s look onto the rest of the roll, each as its own copy, their develops untouched")
    }

    var borderApplyVerbs: [ApplyVerb] {
        sectionApplyVerbs(.border, noun: "borders",
                          selectionHint: "the pictures marked in the filmstrip, their crops untouched",
                          rollHint: "the whole roll, each keeping its own crop")
    }

    // MARK: - presets

    /// Wear a preset: a COPY of its numbers into the draft (its look too, where
    /// it carries one — this picture owns its look).
    func wearPreset(_ preset: DevelopPreset) {
        setDevelopDraft(withBaseOf(preset.settings))
        if let look = preset.look, let grade = readRollGrade(look), let id = openId {
            flushDrafts()
            update { patchPicture($0, id) { $0.grade = grade } }
        }
        tell("applied \(preset.name)")
    }

    /// Keep the draft under a name — with this picture's look when asked.
    func savePreset(named name: String, withLook: Bool) {
        let look = withLook ? picture?.grade?.json : nil
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if presets.save(name: label, settings: developDraft, look: look) {
            tell(look != nil ? "saved \(label) with its look" : "saved \(label)")
        }
    }
}
