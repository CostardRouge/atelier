// The Repair section — heal, clone, dust — its state and every verb it
// writes: the web's repair half of `PictureWorkbench.tsx` (the patch list,
// the placing seam, the rings as handles, the dust scan) and the callbacks of
// `RepairPanel.tsx`, over `RollEditor`'s ONE updater. What it keeps
// (`render-repair.md`):
//
// - the list is the picture's (`carried["repair"]`, read through
//   `readPatches`), and every write goes through `update` — undo-able, and
//   ONE step per gesture: a patch being placed and aimed, or a ring being
//   dragged, is held LIVE here (`RepairEditState.live`) and written once, at
//   the gesture's end, the way the crop holds its zone;
// - what the NEXT patch is placed with (`RepairTool`: heal or clone, size,
//   feather) is the editor's and survives the next picture — the web keeps
//   `repairTool` on the roll editor (`lightroom-gaps.md`, pass 1); whether
//   Repair is armed, the selected patch and the dust scan belong to one
//   visit of one picture and start over on the next (the web's workbench is
//   keyed per picture);
// - the stage's pointer is the repair tool's (`DevelopTool.repair`) exactly
//   while Repair is armed ON THE DETAIL TAB — the web's `repairActive`: the
//   compare is suspended and a press on the picture places a patch. Off it
//   the rings stay HANDLES on the Detail tab, where the panel that explains
//   them is, and are facts about the picture everywhere else
//   (`RepairMarksOverlay`);
// - a tap places a patch sourced from beside it (`defaultSource`); a drag
//   from it AIMS the source at any distance (`placeSource`, the angle read
//   inside the disc too, the discs never overlapping); a drag on a solid
//   ring moves the patch with its source (`movePatch`), on the dashed one the
//   source alone; a press that travels under 3 pt is a TAP — on the solid
//   ring it takes the patch off (his call: a click, never only a key), on
//   the dashed one it selects; Size, Feather and Heal / Clone edit the
//   SELECTED patch, else the next one's tool; ⌫ takes the selected patch
//   off, Esc lets go of it and then puts Repair down;
// - dust is FOUND, never dumped: the stage's decode read ONCE at
//   `dustScanEdge` into a field off the main thread (`PicturePool.dustField`),
//   the sensitivity reading the field and never the picture (`dustSpots`),
//   the spots PROPOSED as dotted rings healed one by one or all at once, and
//   the map a way of LOOKING (`dustVeil`) that never reaches a file;
// - while the stage's plan does not draw the repair, the Detail tab draws the
//   repaired picture itself (`RepairLooking`) — the Layers tab's bridge, which
//   stands down on its own the moment the plan draws it (`planDrawsRepair`).

import CoreGraphics
import CoreImage
import Foundation
import Observation
import SwiftUI
import AtelierKit

/// What the NEXT patch is placed with — the web's `RepairTool`.
struct RepairTool: Equatable {
    var kind: PatchKind = .heal
    var radius: Double = defaultPatchRadius
    var feather: Double = defaultPatchFeather

    static let `default` = RepairTool()
}

/// The dust scan's controls — session state, never on the roll (the web's `DustState`).
struct DustState: Equatable {
    /// The scan is on: the map may be shown and the spots are proposed.
    var on = false
    /// 0…1, gentle to keen (`dustThreshold`).
    var sensitivity = defaultDustSensitivity
    /// Draw the map over the picture, or only the proposed rings.
    var map = true

    static let `default` = DustState()
}

/// The two halves of a ring a hand can take hold of (the web's `RingPart`).
enum RingPart: String, Equatable {
    case patch, source
}

/// The half of a ring under the pointer.
struct RingHover: Equatable {
    let id: String
    let part: RingPart
}

/// A gesture in flight on the picture.
enum RepairGesture {
    /// A patch just placed, its source following the hand.
    case placing(Patch)
    /// A ring taken hold of: the patch as it was, where the hand pressed, which half.
    case ring(id: String, part: RingPart, start: AtelierKit.Point, patch: Patch)
}

/// The Repair section's state and caches, held by the editor (`RollEditor.repairEdit`).
@Observable
final class RepairEditState {
    // MARK: one visit of one picture

    /// The picture this state is about; another picture opening starts it over.
    var pictureId: String?
    /// Repair is armed: a press on the picture places a patch.
    var repairing = false
    /// The patch whose ring was last taken hold of — the sliders edit it.
    var selectedId: String?
    /// The dust scan's controls.
    var dust: DustState = .default
    /// The list while a gesture is in flight — written once, at its end.
    var live: [Patch]?
    /// The ring whose press has travelled past the slop: it is being MOVED.
    var moving: String?
    /// The half of a ring under the pointer — its `−`, its cursor.
    var hovered: RingHover?

    // MARK: the tool — the editor's

    var tool: RepairTool = .default

    // MARK: the scan

    /// The spots the field holds at the sensitivity, before the patches take
    /// theirs away; nil while no field has been measured.
    var spots: [DustSpot]?
    /// The map, at the scan's size, white where the picture falls below its surroundings.
    var veil: CGImage?
    /// The field is being measured.
    var measuring = false

    // MARK: the stage

    /// The repaired picture, while the stage's plan does not draw the repair.
    var lookingImage: CGImage?
    /// Bumped on every patch placed, taken off or healed — the haptic's trigger.
    var touches = 0

    // MARK: bookkeeping — never observed

    @ObservationIgnored var attached = false
    @ObservationIgnored var gesture: RepairGesture?
    @ObservationIgnored var field: DustField?
    @ObservationIgnored var fieldKey: String?
    @ObservationIgnored var fieldSerial = 0
    @ObservationIgnored var dustKey: String?
    @ObservationIgnored var dustBusy = false
    @ObservationIgnored var dustDirty = false
    @ObservationIgnored var lookingBusy = false
    @ObservationIgnored var lookingDirty = false
    @ObservationIgnored var lookingGeneration = 0
    /// What the image on screen was drawn from.
    @ObservationIgnored var lookingKey: String?

    init() {}
}

extension RollPicture {
    /// The picture's heal and clone patches (`RollPicture.repair`), in the
    /// order they are drawn, read through `readPatches`. An empty list takes
    /// the field off, which the roll then writes as the web's `[]`.
    var repairPatches: [Patch] {
        get { readPatches(carried["repair"]) }
        set { carried["repair"] = newValue.isEmpty ? nil : .array(newValue.map(\.json)) }
    }
}

extension RollEditor {
    // MARK: - reading

    /// The Repair section's state — its watch on the editor started the
    /// first time anything asks.
    var repairState: RepairEditState {
        let state = repairEdit
        if !state.attached {
            state.attached = true
            Task { @MainActor [weak self] in
                self?.repairEditorMoved()
                self?.repairWatch()
            }
        }
        return state
    }

    /// The open picture's patches as they are drawn NOW — the gesture's live
    /// list while one is in flight.
    var repairPatches: [Patch] {
        let state = repairEdit
        if let live = state.live, state.pictureId == openId { return live }
        return picture?.repairPatches ?? []
    }

    /// The selected patch, derived against the list — a patch that went cannot stay selected.
    var repairSelected: Patch? {
        guard let id = repairEdit.selectedId else { return nil }
        return repairPatches.first { $0.id == id }
    }

    /// The most a picture holds.
    var repairFull: Bool { repairPatches.count >= maxPatches }

    /// The source's shape — what a patch's radius is measured against. Nil before a decode.
    var repairAspect: Double? {
        guard let size = decodedSize, size.width > 0, size.height > 0 else { return nil }
        return Double(size.width / size.height)
    }

    /// What the sliders show and edit: the selected patch's numbers, else the next patch's.
    var repairEdited: RepairTool {
        guard let p = repairSelected else { return repairEdit.tool }
        return RepairTool(kind: p.kind, radius: p.radius, feather: p.feather)
    }

    /// The spots the scan proposes at this sensitivity, less those already
    /// under a patch — nil while the picture has no field.
    var repairVisibleSpots: [DustSpot]? {
        let state = repairEdit
        guard state.dust.on, let spots = state.spots else { return nil }
        let patches = repairPatches
        guard !patches.isEmpty, let ar = repairAspect else { return spots }
        return spots.filter { spot in
            !patches.contains { patchCoverageAt($0, spot.x, spot.y, ar) > 0 }
        }
    }

    // MARK: - writing the list

    /// The list written to the roll — the same list back is no write and no step.
    func repairWrite(_ list: [Patch]) {
        guard let id = openId else { return }
        let capped = Array(list.prefix(maxPatches))
        update { r in
            guard let p = r.pictures.first(where: { $0.id == id }), !samePatches(p.repairPatches, capped) else { return r }
            return patchPicture(r, id) { $0.repairPatches = capped }
        }
        repairRequestLooking()
    }

    /// Repair on or off — a tap places a patch while it is on (on the Detail tab).
    func repairSetRepairing(_ on: Bool) {
        let state = repairState
        guard on != state.repairing else { return }
        if on && repairFull {
            tell("\(maxPatches) patches, the most a picture holds")
            return
        }
        state.repairing = on
        repairSyncTool()
    }

    /// Heal / Clone, Size or Feather: the SELECTED patch's, else what the
    /// next patch is placed with.
    func repairSetTool(kind: PatchKind? = nil, radius: Double? = nil, feather: Double? = nil) {
        if let selected = repairSelected {
            let next = adjustPatch(selected, kind: kind, radius: radius, feather: feather)
            repairWrite(repairPatches.map { $0.id == selected.id ? next : $0 })
            return
        }
        let state = repairState
        var tool = state.tool
        if let kind { tool.kind = kind }
        if let radius { tool.radius = clamp(radius, patchRadiusRange.min, patchRadiusRange.max) }
        if let feather { tool.feather = clamp(feather, 0, 1) }
        state.tool = tool
    }

    /// Let go of the selected patch — the sliders go back to the next patch's tool.
    func repairDeselect() {
        repairEdit.selectedId = nil
    }

    /// Select a patch — its numbers are the sliders'.
    func repairSelect(_ id: String) {
        repairState.selectedId = id
    }

    /// One patch taken off.
    func repairRemove(_ id: String) {
        let list = repairPatches
        guard list.contains(where: { $0.id == id }) else { return }
        repairWrite(list.filter { $0.id != id })
        if repairEdit.selectedId == id { repairEdit.selectedId = nil }
        repairEdit.touches += 1
    }

    /// The selected patch taken off (⌫, Remove).
    func repairRemoveSelected() {
        guard let selected = repairSelected else { return }
        repairRemove(selected.id)
    }

    /// Undo last — the last patch placed taken off.
    func repairRemoveLast() {
        let list = repairPatches
        guard !list.isEmpty else { return }
        repairWrite(Array(list.dropLast()))
    }

    /// Every patch taken off.
    func repairClear() {
        repairWrite([])
        repairEdit.selectedId = nil
    }

    // MARK: - the stage's hand: placing

    /// A press on the picture with Repair on: a patch placed there, sourced
    /// from beside it (`defaultSource`), selected — tap, then size it, is the
    /// gesture every darkroom teaches. False when nothing was placed.
    @discardableResult
    func repairPlaceBegin(at p: AtelierKit.Point) -> Bool {
        let state = repairState
        repairFinishGesture()
        guard let ar = repairAspect, openId != nil else { return false }
        let list = repairPatches
        guard list.count < maxPatches else {
            tell("\(maxPatches) patches, the most a picture holds")
            return false
        }
        let tool = state.tool
        var made = Patch(id: newPatchId(), kind: tool.kind, x: clamp01(p.x), y: clamp01(p.y),
                         radius: tool.radius, feather: tool.feather, dx: 0, dy: 0)
        let source = defaultSource(made, ar)
        made.dx = source.dx
        made.dy = source.dy
        state.pictureId = openId
        state.gesture = .placing(made)
        state.live = list + [made]
        state.selectedId = made.id
        state.touches += 1
        repairRequestLooking()
        return true
    }

    /// The hand moved: the source turns round the spot as the hand does, at
    /// any distance — inside the disc too — and never nearer than the two
    /// discs touching (`placeSource`).
    func repairPlaceMove(to p: AtelierKit.Point) {
        let state = repairEdit
        guard case .placing(let placed)? = state.gesture, let ar = repairAspect,
              let aimed = placeSource(placed, p, ar) else { return }
        var moved = placed
        moved.dx = aimed.dx
        moved.dy = aimed.dy
        state.gesture = .placing(moved)
        state.live = (state.live ?? repairPatches).map { $0.id == moved.id ? moved : $0 }
        repairRequestLooking()
    }

    /// The hand lifted, or a second finger took the gesture: what it made is written, once.
    func repairPlaceEnd() {
        guard case .placing? = repairEdit.gesture else { return }
        repairFinishGesture()
    }

    /// Whatever gesture is in flight, written as it stands and let go of —
    /// its end, or a gesture left hanging: SwiftUI calls no end on a drag a
    /// system gesture took over, and the next press must not find it held.
    func repairFinishGesture() {
        let state = repairEdit
        guard state.gesture != nil else { return }
        state.gesture = nil
        state.moving = nil
        if let live = state.live, state.pictureId == openId { repairWrite(live) }
        state.live = nil
    }

    // MARK: - the stage's hand: the rings

    /// A press on a ring — the dashed one or the solid one. It selects the patch.
    func repairRingBegin(_ id: String, _ part: RingPart, at p: AtelierKit.Point) {
        let state = repairState
        repairFinishGesture()
        guard let held = repairPatches.first(where: { $0.id == id }) else { return }
        state.pictureId = openId
        state.gesture = .ring(id: id, part: part, start: p, patch: held)
        state.selectedId = id
    }

    /// The press travelled: the solid ring moves the patch with its source,
    /// the dashed one moves the source alone — held to the same rule as a
    /// placed one, never on the patch, never off the picture. `p` is
    /// UNBOUNDED, so a hand past the edge still moves the patch to the edge.
    func repairRingMove(to p: AtelierKit.Point) {
        let state = repairEdit
        guard case .ring(let id, let part, let start, let held)? = state.gesture, let ar = repairAspect else { return }
        state.moving = id
        let dx = p.x - start.x
        let dy = p.y - start.y
        let moved: Patch
        if part == .patch {
            moved = movePatch(held, held.x + dx, held.y + dy)
        } else {
            let target = AtelierKit.Point(held.x + held.dx + dx, held.y + held.dy + dy)
            guard let placed = placeSource(held, target, ar, deadRadii: 0) else { return }
            var next = held
            next.dx = placed.dx
            next.dy = placed.dy
            moved = next
        }
        let base = state.live ?? (picture?.repairPatches ?? [])
        state.live = base.map { $0.id == moved.id ? moved : $0 }
        repairRequestLooking()
    }

    /// The press let go. One that never travelled is a TAP: on the solid ring
    /// it takes the patch off, on the dashed one it has selected it.
    func repairRingEnd(travelled: Bool) {
        let state = repairEdit
        guard case .ring(let id, let part, _, _)? = state.gesture else { return }
        state.gesture = nil
        state.moving = nil
        if !travelled {
            state.live = nil
            if part == .patch { repairRemove(id) }
            return
        }
        if let live = state.live { repairWrite(live) }
        state.live = nil
    }

    // MARK: - finding dust

    /// A change to the scan's controls — on, the sensitivity, the map.
    func repairSetDust(_ change: (inout DustState) -> Void) {
        let state = repairState
        var next = state.dust
        change(&next)
        guard next != state.dust else { return }
        state.pictureId = openId
        state.dust = next
        if !next.on {
            // Nothing of the scan is kept once it is off.
            state.field = nil
            state.fieldKey = nil
            state.dustKey = nil
            state.spots = nil
            state.veil = nil
            state.measuring = false
            return
        }
        repairMeasureField()
        repairRefreshDust()
    }

    /// A tap on a dotted ring: that spot healed from its cleanest neighbour
    /// (`dustPatch`), with the next patch's feather.
    func repairHealSpot(_ spot: DustSpot) {
        guard let field = repairEdit.field else { return }
        let list = repairPatches
        guard list.count < maxPatches else {
            tell("\(maxPatches) patches, the most a picture holds")
            return
        }
        guard let made = dustPatch(field, spot, { newPatchId() }, feather: repairEdit.tool.feather) else {
            tell("that spot sits where no neighbour can be borrowed from — place a patch by hand")
            return
        }
        repairWrite(list + [made])
        repairEdit.touches += 1
    }

    /// Heal all: every spot proposed now, as far as there is room — said.
    func repairHealAll() {
        guard let field = repairEdit.field, let spots = repairVisibleSpots, !spots.isEmpty else { return }
        let feather = repairEdit.tool.feather
        let made = spots.compactMap { dustPatch(field, $0, { newPatchId() }, feather: feather) }
        let list = repairPatches
        let room = max(0, maxPatches - list.count)
        let added = Array(made.prefix(room))
        if added.isEmpty {
            tell(room == 0 ? "\(made.count) found, no room left" : "no spot could be healed from a neighbour")
            return
        }
        let left = made.count - added.count
        tell("\(added.count) spot\(added.count == 1 ? "" : "s") healed" + (left > 0 ? " · \(left) left, no room" : ""))
        repairWrite(list + added)
        repairEdit.touches += 1
    }

    /// The stage's decode read ONCE into a dust field, off the main thread —
    /// the moment the scan is on and the picture is decoded.
    func repairMeasureField() {
        let state = repairEdit
        guard state.dust.on, let id = openId, let read = pool.held(id) else { return }
        let decoded = read.decoded
        let key = "\(id)|\(ObjectIdentifier(decoded))"
        guard state.fieldKey != key else { return }
        state.fieldKey = key
        state.field = nil
        state.dustKey = nil
        state.spots = nil
        state.veil = nil
        state.measuring = true
        Task { [weak self] in
            let field = await Task.detached(priority: .userInitiated) { () -> DustField? in
                PicturePool.dustField(of: decoded)
            }.value
            guard let self else { return }
            let state = self.repairEdit
            guard state.fieldKey == key else { return }
            state.measuring = false
            state.field = field
            state.fieldSerial += 1
            if field == nil { state.spots = [] }
            self.repairRefreshDust()
        }
    }

    /// The spots at the sensitivity, and the map — read from the field, never
    /// the picture; one reading in flight and one owed.
    func repairRefreshDust() {
        let state = repairEdit
        guard state.dust.on, let field = state.field else { return }
        let threshold = dustThreshold(state.dust.sensitivity)
        let wantsMap = state.dust.map
        let serial = state.fieldSerial
        let key = "\(serial)|\(threshold)|\(wantsMap)"
        if key == state.dustKey { return }
        if state.dustBusy {
            state.dustDirty = true
            return
        }
        state.dustBusy = true
        Task { [weak self] in
            let read = await Task.detached(priority: .userInitiated) { () -> (spots: [DustSpot], veil: CGImage?) in
                let spots = dustSpots(field, threshold: threshold)
                let veil = wantsMap ? RepairLooking.veil(field, threshold: threshold) : nil
                return (spots, veil)
            }.value
            guard let self else { return }
            let state = self.repairEdit
            state.dustBusy = false
            if state.dust.on && state.fieldSerial == serial {
                state.spots = read.spots
                state.veil = read.veil
                state.dustKey = key
            }
            if state.dustDirty {
                state.dustDirty = false
                self.repairRefreshDust()
            }
        }
    }

    // MARK: - keys

    /// ⌫: the selected patch taken off — on the Detail tab, where the rings
    /// answer the hand. Nothing selected, the key is somebody else's.
    func repairRemoveKey() -> Bool {
        guard tab == .detail, repairSelected != nil else { return false }
        repairRemoveSelected()
        return true
    }

    /// Esc: the selected patch let go of first, then Repair put down. An
    /// Escape with nothing to release is left to the next taker.
    func repairEscapeKey() -> Bool {
        guard tab == .detail else { return false }
        if repairSelected != nil {
            repairDeselect()
            return true
        }
        if repairEdit.repairing {
            repairSetRepairing(false)
            return true
        }
        return false
    }

    // MARK: - keeping level with the editor

    /// Watch what moves under the section — the tab, the picture, the tool,
    /// the roll, the draft, the decode — and follow it.
    func repairWatch() {
        withObservationTracking {
            _ = self.tab
            _ = self.openId
            _ = self.activeTool
            _ = self.picture
            _ = self.developDraft
            _ = self.decodedSize
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.repairEditorMoved()
                self?.repairWatch()
            }
        }
    }

    /// The editor moved: another picture starts the visit over, a patch an
    /// undo took away is let go of, the tool follows the tab, the scan and the
    /// repaired picture are brought level.
    func repairEditorMoved() {
        let state = repairEdit
        if state.pictureId != openId {
            state.pictureId = openId
            state.repairing = false
            state.selectedId = nil
            state.dust = .default
            state.live = nil
            state.gesture = nil
            state.moving = nil
            state.hovered = nil
            state.field = nil
            state.fieldKey = nil
            state.dustKey = nil
            state.spots = nil
            state.veil = nil
            state.measuring = false
            state.lookingGeneration += 1
            state.lookingImage = nil
            state.lookingKey = nil
        }
        // Off the Detail tab a ring is a fact about the picture, not a handle.
        if tab != .detail {
            repairFinishGesture()
            state.selectedId = nil
            state.hovered = nil
        }
        if state.selectedId != nil && repairSelected == nil { state.selectedId = nil }
        repairSyncTool()
        repairMeasureField()
        repairRequestLooking()
    }

    /// The stage's pointer is the repair tool's exactly while Repair is armed on the Detail tab.
    func repairSyncTool() {
        let wants = repairEdit.repairing && tab == .detail
        if wants && activeTool == .none {
            setTool(.repair)
        } else if !wants && activeTool == .repair {
            setTool(.none)
        }
    }

    // MARK: - the repaired picture, while the plan does not draw it

    /// The stage's plan draws the repair itself — then this section's own
    /// render stands down.
    var planDrawsRepair: Bool {
        guard var probe = draftedPicture else { return false }
        probe.repairPatches = [Patch(id: "probe", kind: .heal, x: 0.5, y: 0.5, radius: defaultPatchRadius,
                                     feather: defaultPatchFeather, dx: 0.1, dy: 0)]
        return !renderPlan.unrendered(picture: probe).contains("repair")
    }

    /// Draw the repaired picture again — one render in flight and one owed.
    func repairRequestLooking() {
        let state = repairEdit
        let wanted = tab == .detail && !repairPatches.isEmpty && !planDrawsRepair
        guard wanted else {
            state.lookingGeneration += 1
            state.lookingKey = nil
            if state.lookingImage != nil { state.lookingImage = nil }
            return
        }
        state.lookingDirty = true
        if !state.lookingBusy { repairStartLooking() }
    }

    private func repairStartLooking() {
        let state = repairEdit
        state.lookingDirty = false
        let patches = repairPatches
        guard tab == .detail, !patches.isEmpty, let pic = draftedPicture, let read = pool.held(pic.id) else {
            state.lookingBusy = false
            return
        }
        let decoded = read.decoded
        let plan = renderPlan
        // The whole picture as drawn, the decode and the plan: a watch that
        // fired for something the render does not read draws nothing again.
        var drawn = pic
        drawn.repairPatches = patches
        let key = [drawn.json.serialized(), "\(ObjectIdentifier(decoded))", "\(type(of: plan))"].joined(separator: "\u{1}")
        if key == state.lookingKey && state.lookingImage != nil {
            state.lookingBusy = false
            return
        }
        state.lookingBusy = true
        let generation = state.lookingGeneration
        Task { [weak self] in
            let image = await Task.detached(priority: .userInitiated) { () -> CGImage? in
                RepairLooking.frame(picture: pic, patches: patches, decoded: decoded, plan: plan)
            }.value
            guard let self else { return }
            let state = self.repairEdit
            if generation == state.lookingGeneration && pic.id == self.openId && self.tab == .detail {
                state.lookingImage = image
                state.lookingKey = image == nil ? nil : key
            }
            state.lookingBusy = false
            if state.lookingDirty { self.repairStartLooking() }
        }
    }
}
