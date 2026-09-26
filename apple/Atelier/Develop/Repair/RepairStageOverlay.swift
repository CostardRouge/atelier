// The REPAIR tool on the stage — what the web's `DevelopViewport` draws and
// answers while Repair is armed on the Detail tab (`PictureWorkbench.tsx`'s
// repair seam, `render-repair.md`):
//
// - a press on the picture PLACES a patch, sourced from beside it; a drag
//   from it AIMS the source — the source turns round the spot as the hand
//   does, at any distance, inside the disc too, never nearer than the two
//   discs touching; the patch is written once, when the hand lifts;
// - the rings are handles (`RepairHandles`), their press claimed before the
//   surface sees it; the dust scan's spots are dotted rings healed by a tap,
//   and its map lies in the picture's place (`DustMapLayer`);
// - the repaired picture is drawn over the stage while the plan does not
//   draw the repair (`RepairLookingLayer`), the compare being suspended;
// - a pinch zooms, a press off the picture pans the zoomed picture, the
//   Mac's wheel zooms, and the Mac's cursor is a crosshair over the picture.
//
// With Repair NOT armed, the stage's idle slot draws `RepairMarksOverlay`:
// the same rings as HANDLES on the Detail tab (and the spots, the map, the
// repaired picture), as FACTS about the picture on every other tab — the
// stage's own drag (the wipe at the fit, the pan once zoomed) answering
// everywhere else.

import SwiftUI
#if os(macOS)
import AppKit
#endif
import AtelierKit

struct RepairStageOverlay: View {
    let context: StageOverlayContext
    @Environment(\.palette) private var palette
    /// The scale a pinch began at — let go by SwiftUI at the pinch's end and
    /// when it is cancelled alike.
    @GestureState private var pinchStart: Double?
    /// The surface press: where it began, what it does, the pan's last step.
    @State private var press: SurfacePress?

    /// A press on the surface. A new press is told by its START — a drag a
    /// system gesture took over gets no end from SwiftUI, and what it left
    /// set must never hold the next press back.
    private struct SurfacePress {
        let start: CGPoint
        var placing: Bool
        var aiming: Bool
        var last: CGSize
    }

    private var editor: RollEditor { context.editor }
    private var geometry: StageGeometry { context.geometry }
    private var zoom: LookingZoom { context.zoom }

    var body: some View {
        let state = editor.repairState
        ZStack {
            RepairLookingLayer(context: context, followsWipe: false)
            DustMapLayer(context: context)
            surface
            RepairHandles(context: context, live: true)
            chip
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sensoryFeedback(DevelopHaptics.snap, trigger: state.touches)
        #if os(macOS)
        .onDisappear { NSCursor.arrow.set() }
        .overlay(WheelCatcher(target: zoom, enabled: editor.stage != nil))
        #endif
    }

    // MARK: - the surface: place, aim, pan, pinch

    private var surface: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(placeDrag)
            .simultaneousGesture(pinch)
            .onContinuousHover { phase in hovered(phase) }
            .accessibilityElement()
            .accessibilityLabel("The picture: tap a spot to heal it")
    }

    private var placeDrag: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(DevelopStageView.space))
            .onChanged { value in
                guard pinchStart == nil else { return }
                if press?.start != value.startLocation {
                    // A new press — whatever a cancelled one left hanging is written first.
                    editor.repairFinishGesture()
                    var fresh = SurfacePress(start: value.startLocation, placing: false, aiming: false, last: .zero)
                    // A press ON the picture places a patch; off it, it pans.
                    if let at = geometry.pointAt(view: value.startLocation) {
                        fresh.placing = editor.repairPlaceBegin(at: AtelierKit.Point(at.u, at.v))
                    }
                    press = fresh
                }
                guard var held = press else { return }
                if held.placing {
                    aim(value, &held)
                } else {
                    pan(value, &held)
                }
                press = held
            }
            .onEnded { _ in
                if press?.placing == true { editor.repairPlaceEnd() }
                press = nil
            }
    }

    /// The source follows the hand once the press has moved past a tap's
    /// slop — so a finger's tremor does not swing a tap's source round.
    private func aim(_ value: DragGesture.Value, _ held: inout SurfacePress) {
        if !held.aiming {
            let moved = hypot(value.translation.width, value.translation.height)
            guard moved > RepairHandles.slop else { return }
            held.aiming = true
        }
        guard let at = geometry.pointAt(view: value.location, unbounded: true) else { return }
        editor.repairPlaceMove(to: AtelierKit.Point(at.u, at.v))
    }

    private func pan(_ value: DragGesture.Value, _ held: inout SurfacePress) {
        guard zoom.zoomed else { return }
        let dx = Double(value.translation.width - held.last.width)
        let dy = Double(value.translation.height - held.last.height)
        zoom.pan(dx: dx, dy: dy)
        held.last = value.translation
    }

    /// A second finger turns what the first began into a pinch: a patch it
    /// placed is kept as it stands, written when the hand lifts.
    private var pinch: some Gesture {
        MagnifyGesture()
            .updating($pinchStart) { value, start, _ in
                guard editor.stage != nil else { return }
                let from = start ?? zoom.view.scale
                if start == nil { start = from }
                zoom.pinch(from: from, ratio: Double(value.magnification), anchor: value.startLocation)
            }
    }

    // MARK: - what the tool says

    private var chip: some View {
        VStack {
            Text(chipText)
                .font(Brand.mono(11))
                .foregroundStyle(editor.repairFull ? palette.warn : palette.accentInk)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(palette.surface.opacity(0.92), in: Capsule())
                .overlay(Capsule().stroke(editor.repairFull ? palette.warn : palette.accent, lineWidth: 1))
                .padding(.top, 44)
                .padding(.horizontal, 12)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private var chipText: String {
        if editor.repairFull { return "\(maxPatches) patches, the most a picture holds" }
        #if os(macOS)
        return "click a spot to heal it · drag from it to choose where it borrows · Esc to stop"
        #else
        return "tap a spot to heal it · drag from it to choose where it borrows"
        #endif
    }

    // MARK: - the pointer

    private func hovered(_ phase: HoverPhase) {
        #if os(macOS)
        switch phase {
        case .active:
            // A ring under the pointer keeps the cursor it set.
            if editor.repairEdit.hovered == nil && press?.placing != true { NSCursor.crosshair.set() }
        case .ended:
            if editor.repairEdit.hovered == nil { NSCursor.arrow.set() }
        }
        #endif
    }
}

/// The repair on the stage while Repair is NOT armed — the stage's idle slot
/// and, over the mask tool, the Layers tab: on the Detail tab the rings are
/// handles and the scan and the repaired picture are shown; elsewhere the
/// rings are drawn as facts about the picture and answer nothing.
struct RepairMarksOverlay: View {
    let context: StageOverlayContext

    var body: some View {
        let editor = context.editor
        let live = editor.tab == .detail
        // Read through `repairState`, which starts the section's watch the
        // first time the stage is drawn.
        let state = editor.repairState
        ZStack {
            if live {
                RepairLookingLayer(context: context, followsWipe: true)
                DustMapLayer(context: context)
            }
            if !editor.repairPatches.isEmpty || (live && state.dust.on) {
                RepairHandles(context: context, live: live)
                    .allowsHitTesting(live)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sensoryFeedback(DevelopHaptics.snap, trigger: state.touches)
    }
}

// MARK: - previews

/// A roll of one picture carrying three patches, for the previews — nothing
/// here reaches a document on disk that anything else reads.
@MainActor
enum RepairPreviewFixture {
    static var patches: [Patch] {
        [
            Patch(id: "a", kind: .heal, x: 0.3, y: 0.28, radius: 0.03, feather: 0.5, dx: 0.06, dy: 0),
            Patch(id: "b", kind: .heal, x: 0.62, y: 0.4, radius: 0.02, feather: 0.5, dx: -0.03, dy: 0.05),
            Patch(id: "c", kind: .clone, x: 0.5, y: 0.75, radius: 0.05, feather: 0.3, dx: 0.12, dy: -0.08),
        ]
    }

    static func editor(selected: String? = "b", repairing: Bool = true) -> RollEditor {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-repair-preview")
        let store = RollStore(root: root)
        var doc = createRollDoc(name: "Repair preview")
        var picture = createRollPicture(SavedMediaRef(name: "DJI_0101.JPG", size: 9_400_000, lastModified: 0))
        picture.repairPatches = patches
        doc.pictures = [picture]
        store.insert(doc)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: doc.id)
        editor.tab = .detail
        let state = editor.repairState
        state.pictureId = editor.openId
        state.repairing = repairing
        state.selectedId = selected
        return editor
    }
}

#Preview("Repair tool") {
    let editor = RepairPreviewFixture.editor()
    let zoom = LookingZoom()
    let geometry = StageGeometry(source: CGSize(width: 4000, height: 3000), viewport: CGSize(width: 640, height: 440))
    return ZStack {
        Palette.darkroom.frame
        RepairStageOverlay(context: StageOverlayContext(editor: editor, geometry: geometry, zoom: zoom))
    }
    .frame(width: 640, height: 440)
    .darkroom()
}

#Preview("Repair rings as facts") {
    let editor = RepairPreviewFixture.editor(selected: nil, repairing: false)
    editor.tab = .adjust
    let zoom = LookingZoom()
    let geometry = StageGeometry(source: CGSize(width: 4000, height: 3000), viewport: CGSize(width: 640, height: 440))
    return ZStack {
        Palette.darkroom.frame
        RepairMarksOverlay(context: StageOverlayContext(editor: editor, geometry: geometry, zoom: zoom))
    }
    .frame(width: 640, height: 440)
    .darkroom()
}
