// The TOOL that holds the stage's pointer — and the slot on the stage it
// fills. The web's workbench decides it from its tab and its toggles (the
// crop stage, Pick / Paint on a mask, Repair, the grey dropper); here it is
// ONE value on the editor (`RollEditor.activeTool`), so the stage knows at a
// glance whether its own gestures (the wipe, the pan) stand down, whether the
// compare is suspended (`develop-roll.md`, «The compare is a switch»: a mask
// tool or the dropper holding the pointer suspends the divider, which comes
// back where it was), and what to draw over the picture.
//
// A tool's overlay is ITS file's: `StageOverlaySlot` names one view per tool
// — `CropStageOverlay`, `MaskStageOverlay`, `RepairStageOverlay`,
// `EyedropperOverlay` — each taking the same `StageOverlayContext` (the
// editor, the stage's geometry, its zoom). The eyedropper is built here.
// With no tool up, and under the mask tool, the slot still draws the repair's
// rings (`RepairMarksOverlay`): a patch is a fact about the picture on every
// tab, and a handle on the Detail tab (`render-repair.md`).

import SwiftUI
import AtelierKit

enum DevelopTool: String, CaseIterable, Identifiable {
    case none, crop, mask, repair, eyedropper

    var id: String { rawValue }

    /// The stage's own drag (the wipe at the fit, the pan once zoomed) stands
    /// down: the tool's overlay answers the pointer.
    var takesPointer: Bool { self != .none }

    /// The before/after divider is suspended while this tool holds the pointer.
    var suspendsCompare: Bool { self == .mask || self == .repair || self == .eyedropper || self == .crop }

    /// The stage draws the WHOLE picture, uncropped — the classic crop draws
    /// its zone over the whole picture under a veil (`develop-roll.md`, «The
    /// crop is a ZONE drawn over the whole picture»).
    var showsWholePicture: Bool { self == .crop }
}

/// What a tool's overlay is handed. Every point it reads or writes goes
/// through `geometry` (`StageGeometry`); every write goes through `editor`.
struct StageOverlayContext {
    let editor: RollEditor
    let geometry: StageGeometry
    let zoom: LookingZoom
}

/// The slot on the stage the active tool fills — over the picture, under the
/// stage's own chips.
struct StageOverlaySlot: View {
    let tool: DevelopTool
    let context: StageOverlayContext

    var body: some View {
        switch tool {
        case .none: RepairMarksOverlay(context: context)
        case .eyedropper: EyedropperOverlay(context: context)
        case .crop: CropStageOverlay(context: context)
        case .mask: MaskStageOverlay(context: context).overlay { RepairMarksOverlay(context: context) }
        case .repair: RepairStageOverlay(context: context)
        }
    }
}

/// The grey dropper: one tap on something that should be neutral solves the
/// white balance on the picture AS SHOT (`whiteBalanceFor`), then the tool is
/// put down — the web's `onPick` over the viewport's own draw branch, so a
/// crop can never misplace the pixel read.
struct EyedropperOverlay: View {
    let context: StageOverlayContext
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        guard let at = context.geometry.pointAt(view: value.location) else { return }
                        context.editor.pickGrey(u: at.u, v: at.v)
                    }
                )
                #if os(macOS)
                .onHover { inside in
                    if inside { NSCursor.crosshair.push() } else { NSCursor.pop() }
                }
                #endif
            Text(pickWord)
                .font(Brand.mono(11))
                .foregroundStyle(palette.accentInk)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(palette.surface.opacity(0.92), in: Capsule())
                .overlay(Capsule().stroke(palette.accent, lineWidth: 1))
                .padding(10)
                .allowsHitTesting(false)
        }
    }

    private var pickWord: String {
        #if os(macOS)
        return "click something grey"
        #else
        return "tap something grey"
        #endif
    }
}
