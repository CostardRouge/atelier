// The Layers tab — its state and every verb it writes — the web's layer half
// of `PictureWorkbench.tsx` (the open layer and part, Pick / Paint, the brush,
// how the mask is shown, the subject maps and their blink, the colour a layer
// sees) over `RollEditor`'s ONE updater. What it keeps (`render-layers.md`,
// `mask-parts.md`, `subject-picking.md`):
//
// - the stack is the picture's (`RollPicture.layers`), bottom to top, and
//   every write goes through `update` — so a layer's slider is one undo step
//   per rest like any other, and an undo that takes a layer away closes it;
// - what is a TOOL, not the picture's — the brush's size, softness and
//   eraser, the mask view, the next part's op — lives here on the editor, so
//   stepping to the next picture keeps it; the OPEN layer is the picture's
//   and is let go when another picture opens (a subject of one picture must
//   never be shown on another);
// - the stage's pointer is the mask tool's (`DevelopTool.mask`) exactly while
//   a layer is open on the Layers tab: the compare is suspended, the stage's
//   own drag stands down, and `MaskStageOverlay` draws the handles, the
//   markers, the brush and the layered picture;
// - the mask shows BY ITSELF while Pick or Paint is on — the moment it is
//   being made — and otherwise only when pinned; `M` steps Hidden · Outline ·
//   Fill and `P` toggles Pick / Paint, both only on the Layers tab;
// - a SUBJECT is segmented on the tap, not when its layer first draws
//   (`subjectLayersToSegment`), by Apple's model on the device
//   (`SubjectMasks`), shown the picture in the frame its mask is sampled in —
//   the source through the geometry's warps; the last good map stays up while
//   a new one is found, and the region a tap ADDED blinks twice (on, off, on,
//   off, 90 ms), never under reduced motion;
// - a colour sample, and the readout under the pointer, are the colour the
//   LAYER sees — the develop, the warps and the layers under it — stored at
//   the tap so the range does not move when a slider does.

import CoreGraphics
import CoreImage
import Foundation
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif
import AtelierKit

/// The Layers tab's state and caches, held by the editor (`RollEditor.layerEdit`).
@Observable
final class LayerEditState {
    // MARK: the open layer — the picture's

    /// The picture the open layer belongs to; another picture opening lets it go.
    var pictureId: String?
    var selectedId: String?
    /// Which of the open layer's masks the stage acts on: nil its own, 0… a part.
    var part: Int?

    // MARK: tools — the editor's

    /// Pick (a subject, a colour, a tone) or Paint (a brush) is on.
    var painting: Bool = false
    /// What the NEXT stroke is painted with.
    var brush: BrushTool = .default
    /// How the open layer's mask is shown: its line by default.
    var maskView: MaskView = .outline
    /// The mask pinned on outside Pick / Paint.
    var showMask: Bool = false
    /// How the next part combines.
    var nextOp: MaskOp = .add

    // MARK: the subject

    /// Each subject layer's map, by layer id.
    var subjectMaps: [String: CIImage] = [:]
    /// A layer whose subject is being found right now.
    var subjectWorking: String?
    /// Why no subject can be found here, in words — nil when the model ran.
    var subjectUnavailable: String?
    /// The layers whose points landed on no subject.
    var subjectMissed: Set<String> = []

    // MARK: what the stage shows

    /// The layered picture, and the same with the blink on.
    var lookingImage: CGImage?
    var lookingFlash: CGImage?
    /// The blink's beat.
    var flashOn: Bool = false
    /// What the pointer is over, while a tone or a colour is picked.
    var readout: String?

    // MARK: bookkeeping — never observed

    @ObservationIgnored var attached = false
    @ObservationIgnored var lookingBusy = false
    @ObservationIgnored var lookingDirty = false
    @ObservationIgnored var lookingGeneration = 0
    @ObservationIgnored var subjectBusy = false
    @ObservationIgnored var subjectDirty = false
    @ObservationIgnored var subjectKey: String?
    @ObservationIgnored var pendingFresh: (layer: String, point: AtelierKit.Point)?
    @ObservationIgnored var flashMap: CIImage?
    @ObservationIgnored var blinkPending = false
    @ObservationIgnored var blinkTask: Task<Void, Never>?
    @ObservationIgnored var below: BelowBuffer?
    @ObservationIgnored var belowKey: String?
    @ObservationIgnored var belowTask: Task<BelowBuffer?, Never>?
    @ObservationIgnored var belowTaskKey: String?
    @ObservationIgnored var strokeLive = false

    /// Apple's subject model, its answers cached per picture.
    let subjects = SubjectMasks()
    /// The Layers tab's own render of the layered picture.
    let renderer = LayerLookingRenderer()
    /// What a render plan reads to draw the same thing (`LayerLooking`).
    let looking = LayerLooking()

    init() {}
}

/// The kinds whose mask is made with the pointer: painted, or picked.
private let pointerKinds: Set<MaskKind> = [.brush, .subject, .colour, .luma]

extension RollEditor {
    // MARK: - reading

    /// The Layers tab's state — its watch on the editor started the first
    /// time anything asks.
    var layerState: LayerEditState {
        let state = layerEdit
        if !state.attached {
            state.attached = true
            Task { @MainActor [weak self] in
                self?.layersEditorMoved()
                self?.layersWatch()
            }
        }
        return state
    }

    /// The open picture's layers, bottom to top.
    var layerList: [AdjustLayer] { picture?.layers ?? [] }

    /// The layer open in the panel — on THIS picture only.
    var openLayer: AdjustLayer? {
        let state = layerEdit
        guard let id = state.selectedId, state.pictureId == openId else { return nil }
        return layerList.first { $0.id == id }
    }

    /// The component the stage's gestures act on: nil the layer's own mask, 0… a part.
    var openPart: Int? {
        guard let layer = openLayer, let part = layerEdit.part, layer.parts.indices.contains(part) else { return nil }
        return part
    }

    /// The mask open in the panel — the layer's own, or the open part's.
    var openMask: Mask? {
        guard let layer = openLayer else { return nil }
        return componentMask(layer, openPart)
    }

    /// Pick or Paint holds the pointer: the kind being made with it, or nil.
    var maskPointerKind: MaskKind? {
        guard layerEdit.painting, let kind = openMask?.kind, pointerKinds.contains(kind) else { return nil }
        return kind
    }

    /// The open layer's mask is on the picture: by itself while Pick or Paint
    /// is on, else only when pinned — and never while Hidden.
    var maskShown: Bool {
        let state = layerEdit
        guard openLayer != nil, state.maskView != .off else { return false }
        return maskPointerKind != nil || state.showMask
    }

    /// The source's shape, which every mask is measured against.
    var layersAspect: Double? {
        guard let size = decodedSize, size.width > 0, size.height > 0 else { return nil }
        return Double(size.width / size.height)
    }

    /// The stage's plan draws the layers itself — then this tab's own render
    /// stands down and the plan reads `LayerEditState.looking`.
    var planDrawsLayers: Bool {
        guard var probe = draftedPicture else { return false }
        var layer = createLayer(nil, id: "probe")
        layer.develop.exposure = 1
        probe.layers = [layer]
        return !renderPlan.unrendered(picture: probe).contains("layers")
    }

    /// The open layer's develop — edited by the Adjust tab's own sections.
    var openLayerDevelopBinding: Binding<DevelopSettings> {
        Binding(
            get: { self.openLayer?.develop ?? .default },
            set: { value in self.writeOpenLayer { $0.develop = value } }
        )
    }

    // MARK: - writing

    /// Every write of the stack — the same list back is no write and no step.
    func writeLayers(_ change: ([AdjustLayer]) -> [AdjustLayer]) {
        guard let id = openId, let current = picture else { return }
        let before = current.layers
        let after = change(before)
        if sameLayers(before, after) { return }
        update { r in patchPicture(r, id) { $0.layers = after } }
    }

    /// The open layer's own fields.
    func writeOpenLayer(_ patch: (inout AdjustLayer) -> Void) {
        guard let id = openLayer?.id else { return }
        writeLayers { patchLayer($0, id, patch) }
    }

    /// The open component's mask replaced — nil (the whole picture) only for the layer's own.
    func writeOpenMask(_ mask: Mask?) {
        guard let layer = openLayer else { return }
        let part = openPart
        writeLayers { list in
            list.map { $0.id == layer.id ? withComponentMask($0, part, mask) : $0 }
        }
    }

    // MARK: - the list

    /// A new layer on TOP, open at once; a fresh subject or colour comes with
    /// Pick on — its only use is to be tapped.
    func layerAdd(_ kind: MaskKind?) {
        guard layerList.count < maxLayers, openId != nil else { return }
        let made = createLayer(kind)
        writeLayers { addLayer($0, made) }
        let state = layerState
        state.pictureId = openId
        state.selectedId = made.id
        state.part = nil
        state.painting = kind == .subject || kind == .colour
        layersSyncTool()
        layersRequestLooking()
    }

    /// Open a layer — nil closes the one open.
    func layerSelect(_ id: String?) {
        let state = layerState
        state.pictureId = openId
        state.selectedId = id
        state.part = nil
        state.strokeLive = false
        layersSyncTool()
        layersRequestLooking()
    }

    func layerRemove(_ id: String) {
        writeLayers { removeLayer($0, id) }
        if layerEdit.selectedId == id { layerSelect(nil) }
    }

    /// `delta` in stack terms: +1 is nearer the top.
    func layerMove(_ id: String, _ delta: Int) {
        writeLayers { moveLayer($0, id, delta) }
    }

    func layerRename(_ id: String, _ name: String) {
        writeLayers { renameLayer($0, id, name) }
    }

    /// A copy just above, open at once.
    func layerDuplicate(_ id: String) {
        guard let out = duplicateLayer(layerList, id) else {
            tell("\(maxLayers) layers is the limit")
            return
        }
        writeLayers { _ in out.layers }
        layerSelect(out.id)
    }

    /// The eye: a VERB, not a field — hidden is a layer kept and not drawn.
    func layerToggleEnabled(_ id: String) {
        writeLayers { list in patchLayer(list, id) { $0.enabled.toggle() } }
    }

    // MARK: - the mask panel

    /// Switching kinds starts the new shape FRESH (a radius is not an angle);
    /// nil is the whole picture, for the layer's own mask only.
    func maskSetKind(_ kind: MaskKind?) {
        writeOpenMask(kind.map(defaultMask))
        layersRequestLooking()
    }

    func maskSetInvert(_ on: Bool) {
        guard let layer = openLayer else { return }
        if let part = openPart {
            writeLayers { list in
                list.map { l in l.id == layer.id ? patchPart(l, part, { p in p.invert = on }) : l }
            }
        } else {
            writeOpenLayer { $0.invert = on }
        }
    }

    /// Open one component — nil the layer's own mask.
    func maskOpenPart(_ index: Int?) {
        layerEdit.part = index
        layerEdit.strokeLive = false
        layersRequestLooking()
    }

    /// A further mask combined with this one, opened at once; a colour or a
    /// painted part is made with the pointer, so Pick / Paint comes on with it.
    func maskPartAdd(_ kind: MaskKind) {
        guard let layer = openLayer, layer.parts.count < maxMaskParts else { return }
        let state = layerState
        let next = addPart(layer, state.nextOp, kind)
        guard next.parts.count > layer.parts.count else { return }
        writeLayers { list in list.map { $0.id == layer.id ? next : $0 } }
        state.part = next.parts.count - 1
        state.painting = kind == .colour || kind == .brush
        layersRequestLooking()
    }

    func maskPartRemove(_ index: Int) {
        guard let layer = openLayer else { return }
        writeLayers { list in list.map { $0.id == layer.id ? removePart($0, index) : $0 } }
        layerEdit.part = nil
        layersRequestLooking()
    }

    func maskPartOp(_ index: Int, _ op: MaskOp) {
        guard let layer = openLayer else { return }
        writeLayers { list in
            list.map { l in l.id == layer.id ? patchPart(l, index, { p in p.op = op }) : l }
        }
    }

    /// «Sauf le sujet»: a subject layer taken out of this one — nil for nothing.
    func maskSetExcept(_ id: String?) {
        writeOpenLayer { $0.except = id }
    }

    // MARK: - tools

    func layersSetPainting(_ on: Bool) {
        let state = layerState
        state.painting = on
        state.strokeLive = false
        if !on { state.readout = nil }
        layersRefreshBelowKey()
        layersRequestLooking()
    }

    func layersSetMaskView(_ view: MaskView) {
        layerState.maskView = view
        layersRequestLooking()
    }

    func layersSetShowMask(_ on: Bool) {
        layerState.showMask = on
        layersRequestLooking()
    }

    func layersSetBrush(_ change: (inout BrushTool) -> Void) {
        var brush = layerState.brush
        change(&brush)
        layerEdit.brush = brush
    }

    /// `M` and `P`, on the Layers tab — true when the tab took the key.
    func layerKey(_ action: EditorKeyAction) -> Bool {
        let state = layerState
        switch action {
        case .mask:
            guard openLayer != nil else { return false }
            layersSetMaskView(nextMaskView(state.maskView))
            return true
        case .pick:
            guard let kind = openMask?.kind, pointerKinds.contains(kind) else { return false }
            layersSetPainting(!state.painting)
            return true
        default:
            return false
        }
    }

    /// Escape: Pick / Paint off first, then the layer closed.
    func layersEscape() {
        if layerEdit.painting {
            layersSetPainting(false)
        } else if openLayer != nil {
            layerSelect(nil)
        }
    }

    // MARK: - the stage's hand

    /// A press on the picture with Paint on starts a stroke (`beginStroke`).
    func maskStrokeBegin(at p: AtelierKit.Point) {
        guard case .brush(let mask)? = openMask else { return }
        guard let next = beginStroke(mask, at: p, tool: layerEdit.brush) else {
            tell("\(maxStrokes) strokes is the most one mask holds")
            return
        }
        layerEdit.strokeLive = true
        writeOpenMask(.brush(next))
    }

    /// The hand moved: the live stroke grows, when it moved far enough.
    func maskStrokeMove(to p: AtelierKit.Point) {
        guard layerEdit.strokeLive, case .brush(let mask)? = openMask,
              let next = continueStroke(mask, to: p) else { return }
        writeOpenMask(.brush(next))
    }

    func maskStrokeEnd() {
        layerEdit.strokeLive = false
    }

    /// A tap with Pick on: a subject point added or taken off, a colour
    /// sampled or taken off, a brightness band moved onto the tone tapped.
    func maskTap(at p: AtelierKit.Point) {
        guard let layer = openLayer else { return }
        let part = openPart
        switch openMask {
        case .subject(let subject)?:
            let next = tapSubject(subject, at: p)
            if next.points.count > subject.points.count { layerEdit.pendingFresh = (layer: layer.id, point: p) }
            writeOpenMask(.subject(next))
        case .colour(let colour)?:
            let marks = colour.samples.map { AtelierKit.Point($0.x, $0.y) }
            if markHit(marks, p) != nil {
                if let next = tapColour(colour, at: p, rgb: nil) { writeOpenMask(.colour(next)) }
                return
            }
            if colour.samples.count >= maxColourSamples {
                tell("\(maxColourSamples) colours is the most one range holds")
                return
            }
            Task { [weak self] in
                guard let self else { return }
                let rgb = await self.layersBelow()?.average(u: p.x, v: p.y)
                // The panel may have moved on while the colour was read.
                guard self.openLayer?.id == layer.id, self.openPart == part,
                      case .colour(let now)? = self.openMask else { return }
                guard let rgb else {
                    self.tell("the colour there could not be read")
                    return
                }
                if let next = tapColour(now, at: p, rgb: rgb) { self.writeOpenMask(.colour(next)) }
            }
        case .luma?:
            Task { [weak self] in
                guard let self else { return }
                guard let rgb = await self.layersBelow()?.average(u: p.x, v: p.y),
                      self.openLayer?.id == layer.id, self.openPart == part,
                      case .luma(let now)? = self.openMask else { return }
                let tone = lumaOf(rgb.0, rgb.1, rgb.2)
                self.writeOpenMask(.luma(centreLumaBand(now, on: tone)))
            }
        default:
            break
        }
    }

    /// A marker answering its own press: that point, or that colour, off.
    func maskUnmark(_ index: Int) {
        guard let mask = openMask else { return }
        writeOpenMask(unmark(mask, index))
    }

    /// A gradient's centre dragged — from where it was when the hand came down.
    func maskMove(from start: Mask, du: Double, dv: Double) {
        writeOpenMask(moveMask(start, du: du, dv: dv))
    }

    /// A gradient's handle dragged to `p`, the source's shares.
    func maskDragHandle(_ handle: MaskHandle, to p: AtelierKit.Point) {
        guard let mask = openMask, let ar = layersAspect else { return }
        writeOpenMask(dragMaskHandle(mask, handle, to: p, ar))
    }

    /// The pointer over the picture while a tone or a colour is picked: what
    /// the layer sees there, and how much of it the mask takes in.
    func layersHover(at p: AtelierKit.Point?) {
        let state = layerEdit
        guard let p, let kind = maskPointerKind, kind == .luma || kind == .colour else {
            if state.readout != nil { state.readout = nil }
            return
        }
        let mask = openMask
        let ar = layersAspect ?? 1
        Task { [weak self] in
            guard let self, let rgb = await self.layersBelow()?.rgb(u: p.x, v: p.y) else { return }
            let tone = lumaOf(rgb.0, rgb.1, rgb.2)
            let inside = maskAt(mask, p.x, p.y, tone, ar, rgb: rgb)
            let percent = Int((inside * 100).rounded())
            let text: String
            if kind == .luma {
                text = "brightness \(String(format: "%.2f", tone)) · \(percent) % in the band"
            } else {
                text = "\(percent) % in the range"
            }
            if self.maskPointerKind == kind { self.layerEdit.readout = text }
        }
    }

    // MARK: - the colour a layer sees

    /// What the open layer sees, small — rendered once per change under it.
    func layersBelow() async -> BelowBuffer? {
        let state = layerEdit
        if let held = state.below, state.belowKey != nil, state.belowKey == layersWantedBelowKey() { return held }
        guard let pic = draftedPicture, let layer = openLayer, let read = pool.held(pic.id) else { return nil }
        let key = layersWantedBelowKey()
        if let task = state.belowTask, state.belowTaskKey == key { return await task.value }
        let decoded = read.decoded
        let maps = state.subjectMaps
        let renderer = state.renderer
        let layerId = layer.id
        let task = Task.detached(priority: .userInitiated) { () -> BelowBuffer? in
            renderer.below(picture: pic, decoded: decoded, layerId: layerId, subjects: maps)
        }
        state.belowTask = task
        state.belowTaskKey = key
        let buffer = await task.value
        if state.belowTaskKey == key {
            state.belowTask = nil
            state.belowTaskKey = nil
            if buffer != nil && openId == pic.id {
                state.below = buffer
                state.belowKey = key
            }
        }
        return buffer
    }

    /// What the buffer must have been made from: the picture, the open layer,
    /// the develop, the layers under it and the geometry — nil while nothing
    /// is picked from it.
    private func layersWantedBelowKey() -> String? {
        guard let pic = draftedPicture, let layer = openLayer else { return nil }
        let all = pic.layers
        let at = all.firstIndex(where: { $0.id == layer.id }) ?? all.count
        let under = JSONValue.array(all.prefix(at).map(\.json)).serialized()
        let develop = pic.develop?.json.serialized() ?? ""
        return [layersPictureKey(pic), layer.id, develop, under].joined(separator: "\u{1}")
    }

    /// A buffer made from anything else is let go.
    func layersRefreshBelowKey() {
        let state = layerEdit
        guard let kind = maskPointerKind, kind == .luma || kind == .colour else {
            state.below = nil
            state.belowKey = nil
            return
        }
        if state.belowKey != layersWantedBelowKey() {
            state.below = nil
            state.belowKey = nil
        }
    }

    /// The picture AND the frame its masks live in: another geometry is
    /// another picture to the subject model (`subject-picking.md`).
    func layersPictureKey(_ pic: RollPicture) -> String {
        let geometry = ["keystone", "lens", "lensProfile"].map { pic.carried[$0]?.serialized() ?? "" }
        return ([pic.id] + geometry).joined(separator: "|")
    }

    // MARK: - keeping level with the editor

    /// Watch what moves under the tab — the tab, the picture, the tool, the
    /// roll, the draft, the decode — and follow it.
    func layersWatch() {
        withObservationTracking {
            _ = self.tab
            _ = self.openId
            _ = self.activeTool
            _ = self.picture
            _ = self.developDraft
            _ = self.decodedSize
            _ = self.holding
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.layersEditorMoved()
                self?.layersWatch()
            }
        }
    }

    /// The editor moved: another picture lets the open layer go, a layer an
    /// undo took away closes, the tool follows, and what is shown is redrawn.
    func layersEditorMoved() {
        let state = layerEdit
        if state.pictureId != openId {
            state.pictureId = openId
            state.selectedId = nil
            state.part = nil
            state.painting = false
            state.strokeLive = false
            state.subjectMaps = [:]
            state.subjectKey = nil
            state.subjectWorking = nil
            state.subjectUnavailable = nil
            state.subjectMissed = []
            state.pendingFresh = nil
            state.lookingGeneration += 1
            state.lookingImage = nil
            state.lookingFlash = nil
            state.flashMap = nil
            state.flashOn = false
            state.blinkTask?.cancel()
            state.below = nil
            state.belowKey = nil
            state.readout = nil
            state.looking.clear()
        }
        if let id = state.selectedId, !layerList.contains(where: { $0.id == id }) {
            state.selectedId = nil
            state.part = nil
        }
        if let part = state.part, !(openLayer?.parts.indices.contains(part) ?? false) {
            state.part = nil
        }
        layersSyncTool()
        layersRefreshBelowKey()
        layersRefreshSubjects()
        layersRequestLooking()
    }

    /// The stage's pointer is the mask tool's exactly while a layer is open on the Layers tab.
    func layersSyncTool() {
        let wants = tab == .layers && openLayer != nil
        if wants && activeTool == .none {
            setTool(.mask)
        } else if !wants && activeTool == .mask {
            setTool(.none)
            layerEdit.lookingImage = nil
            layerEdit.lookingFlash = nil
            layerEdit.readout = nil
        }
    }

    // MARK: - what the stage shows

    /// The open layer's mask as it is shown now, or nil.
    private var layersWash: (layer: AdjustLayer, style: MaskOverlayStyle)? {
        guard maskShown, let layer = openLayer else { return nil }
        let style: MaskOverlayStyle = layerEdit.maskView == .fill ? .fill : .outline
        return (layer: layer, style: style)
    }

    /// Draw the layered picture again — one render in flight and one owed.
    func layersRequestLooking() {
        let state = layerEdit
        let wash = layersWash
        state.looking.setLook(wash: wash, flash: state.flashOn ? state.flashMap : nil)
        guard activeTool == .mask else { return }
        if planDrawsLayers {
            // The plan draws the stage, the seam included.
            state.lookingImage = nil
            state.lookingFlash = nil
            requestRender()
            return
        }
        state.lookingDirty = true
        if !state.lookingBusy { layersStartLooking() }
    }

    private func layersStartLooking() {
        let state = layerEdit
        state.lookingDirty = false
        guard activeTool == .mask, let pic = draftedPicture, let read = pool.held(pic.id) else {
            state.lookingBusy = false
            return
        }
        state.lookingBusy = true
        let decoded = read.decoded
        let maps = state.subjectMaps
        let wash = layersWash
        let flash = state.flashMap
        let renderer = state.renderer
        let generation = state.lookingGeneration
        Task { [weak self] in
            let frame = await Task.detached(priority: .userInitiated) { () -> LookingFrame in
                renderer.frame(picture: pic, decoded: decoded, subjects: maps, wash: wash, flash: flash)
            }.value
            guard let self else { return }
            let state = self.layerEdit
            if generation == state.lookingGeneration && pic.id == self.openId && self.activeTool == .mask {
                state.lookingImage = frame.image
                state.lookingFlash = frame.flash
                if frame.flash != nil && state.blinkPending { self.layersBlink() }
            }
            state.lookingBusy = false
            if state.lookingDirty { self.layersStartLooking() }
        }
    }

    /// The region a tap just added, on and off twice — nothing under reduced
    /// motion, where the outline alone says it.
    private func layersBlink() {
        let state = layerEdit
        state.blinkPending = false
        state.blinkTask?.cancel()
        guard !layersReduceMotion else {
            state.flashMap = nil
            state.lookingFlash = nil
            return
        }
        let throughPlan = planDrawsLayers
        state.blinkTask = Task { @MainActor [weak self] in
            for step in 0..<4 {
                guard let self, !Task.isCancelled else { return }
                state.flashOn = step % 2 == 0
                if throughPlan { self.layersRequestLooking() }
                try? await Task.sleep(nanoseconds: 90_000_000)
            }
            state.flashOn = false
            state.flashMap = nil
            state.lookingFlash = nil
            if throughPlan { self?.layersRequestLooking() }
        }
    }

    private var layersReduceMotion: Bool {
        #if os(iOS)
        return UIAccessibility.isReduceMotionEnabled
        #else
        return NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #endif
    }

    // MARK: - the subject

    /// Find the subjects the picture's layers ask for — once per change of
    /// their points or of the frame, off the main thread, one run at a time.
    func layersRefreshSubjects() {
        let state = layerEdit
        guard let pic = draftedPicture else { return }
        let layers = pic.layers
        let wanted = subjectLayersToSegment(layers)
        let key = layersPictureKey(pic)
        let spelled: [String] = wanted.map { layer in
            let points = (maskMarks(layer.mask) ?? []).map { "\($0.x),\($0.y)" }.joined(separator: ";")
            return "\(layer.id)=\(points)"
        }
        let signature = key + "#" + spelled.joined(separator: "|")
        if wanted.isEmpty {
            if !state.subjectMaps.isEmpty { state.subjectMaps = [:] }
            state.looking.setSubjects([:])
            state.subjectKey = signature
            state.subjectWorking = nil
            state.subjectMissed = []
            return
        }
        if signature == state.subjectKey { return }
        if state.subjectBusy {
            state.subjectDirty = true
            return
        }
        // Not decoded yet: the watch asks again once it is.
        guard let read = pool.held(pic.id) else { return }
        state.subjectBusy = true
        state.subjectKey = signature
        let open = openLayer?.id
        state.subjectWorking = wanted.first(where: { $0.id == open })?.id ?? wanted.first?.id
        let decoded = read.decoded
        let geometry = GeometryFamilyPasses(picture: pic, sourceWidth: Double(decoded.width),
                                            sourceHeight: Double(decoded.height)).shape
        let subjects = state.subjects
        let fresh = state.pendingFresh
        state.pendingFresh = nil
        Task { [weak self] in
            let found = await Task.detached(priority: .userInitiated) { () -> (SubjectMasks.Resolution, CIImage?) in
                let view: () -> CGImage? = { SubjectMasks.view(of: decoded.image, geometry: geometry) }
                let resolution = subjects.resolve(layers, picture: key, view: view)
                var flash: CIImage?
                if let fresh, resolution.unavailable == nil {
                    let probe = AdjustLayer(id: "fresh", mask: .subject(SubjectMask(points: [fresh.point])))
                    flash = subjects.resolve([probe], picture: key, view: view).images["fresh"]
                }
                return (resolution, flash)
            }.value
            self?.layersSubjectsArrived(found.0, flash: found.1, pictureId: pic.id)
        }
    }

    private func layersSubjectsArrived(_ found: SubjectMasks.Resolution, flash: CIImage?, pictureId: String) {
        let state = layerEdit
        state.subjectBusy = false
        if pictureId == openId {
            state.subjectMaps = found.images
            state.subjectUnavailable = found.unavailable
            state.subjectMissed = Set(found.missed)
            state.subjectWorking = nil
            state.looking.setSubjects(found.images)
            if let flash {
                state.flashMap = flash
                state.blinkPending = true
            }
            layersRequestLooking()
        }
        if state.subjectDirty {
            state.subjectDirty = false
            layersRefreshSubjects()
        }
    }

    /// How the open subject is getting on, in the web's words where they hold.
    func subjectStatus(_ layer: AdjustLayer, _ subject: SubjectMask) -> String {
        let state = layerEdit
        let n = subject.points.count
        let points = "\(n) point\(n == 1 ? "" : "s")"
        if let why = state.subjectUnavailable {
            return "\(why) — every other mask still works"
        }
        if n == 0 { return "tap the subject on the picture" }
        if state.subjectWorking == layer.id { return "finding it… (\(points))" }
        if state.subjectMissed.contains(layer.id) {
            return "\(points) · no subject under them — tap on the subject itself, or paint instead"
        }
        if state.subjectMaps[layer.id] != nil {
            let idle = isDefaultDevelop(layer.develop) ? " · found — move a slider below to act on it" : ""
            return "\(points) · tap a marker to remove it\(idle)"
        }
        return "asking the subject model…"
    }
}
