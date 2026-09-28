// Composition guides — port of `src/shared/overlay/GuidesControl.tsx`: a
// social safe-zone picker (TikTok, Instagram Reels, YouTube Shorts, YouTube)
// and a configurable grid (show, divisions, snap). Presentational: the state
// is a `GuidesState` the host owns, kept in the project's portable half; the
// stage draws the guides on the PREVIEW only (`Paint/GuidesPainter.swift`),
// never through the overlay renderer, so they never burn into an export.
//
// A preset is authored for one orientation; over a frame of the other its
// `auto` orientation turns it a quarter-turn clockwise to span the frame. The
// Rotate switch shows what `auto` resolves to for this frame and pins it
// upright or turned; picking another template goes back to `auto`, since a
// rotation pinned for a portrait preset means nothing for a landscape one.
//
// Two layouts, the web's two: `rows` for an inspector (the Studio's), and
// `toolbar`, a strip of capsules for a stage's own bar.

import SwiftUI
import AtelierKit

enum GuidesControlLayout {
    case rows, toolbar
}

struct GuidesControlView: View {
    @Binding private var guides: GuidesState
    private let frameAspect: Double?
    private let layout: GuidesControlLayout
    @Environment(\.palette) private var palette

    private typealias Option = OverlayPanelOption

    /// - Parameters:
    ///   - frameAspect: the edited frame's width / height, so the Rotate switch
    ///     says what `auto` resolves to; nil (nothing loaded) reads upright,
    ///     which is what `auto` draws when the orientation is unknown.
    ///   - layout: `rows` (the default here, the Studio's) or `toolbar`.
    init(guides: Binding<GuidesState>, frameAspect: Double? = nil, layout: GuidesControlLayout = .rows) {
        _guides = guides
        self.frameAspect = frameAspect
        self.layout = layout
    }

    private var preset: SafeZonePreset? { findSafeZone(guides.safeZone) }

    private var rotated: Bool {
        guard let preset else { return false }
        return shouldRotateSafeZone(guides.safeZoneOrientation, preset.aspect, frameAspect ?? 0)
    }

    var body: some View {
        switch layout {
        case .rows: rows
        case .toolbar: toolbar
        }
    }

    // MARK: - writing

    private func pickSafeZone(_ id: String) {
        var next = guides
        next.safeZone = id
        next.safeZoneOrientation = .auto
        guides = next
    }

    private func setRotated(_ on: Bool) {
        var next = guides
        next.safeZoneOrientation = on ? .rotated : .upright
        guides = next
    }

    private func setGrid(_ edit: (inout GridConfig) -> Void) {
        var next = guides
        edit(&next.grid)
        guides = next
    }

    private static let safeZoneOptions: [Option<String>] =
        [Option("none", "Off")] + safeZonePresets.map { Option($0.id, $0.label) }

    private static let divisions: [Option<Int>] = (1...12).map { Option($0, "\($0)") }

    /// A phone has no Alt key to hold.
    private static var snapHint: String {
        #if os(macOS)
        return "Snap elements to the grid while dragging; hold Option to bypass."
        #else
        return "Snap elements to the grid while dragging."
        #endif
    }

    // MARK: - rows

    @ViewBuilder
    private var rows: some View {
        VStack(alignment: .leading, spacing: 12) {
            OverlayPanelPicker("Safe area", selection: guides.safeZone, options: GuidesControlView.safeZoneOptions) { id in
                pickSafeZone(id)
            }
            if preset != nil {
                OverlayPanelRow("Rotate", hint: "Turns the template a quarter-turn so it spans this frame.") {
                    OverlayPanelToggle("Rotate the safe area", isOn: rotated) { on in setRotated(on) }
                }
            }
            OverlayPanelRow("Grid") {
                OverlayPanelToggle("Show a composition grid", isOn: guides.grid.show) { on in setGrid { $0.show = on } }
            }
            OverlayPanelRow("Divisions") {
                divisionMenus
            }
            OverlayPanelRow("Snap", hint: GuidesControlView.snapHint) {
                OverlayPanelToggle("Snap to the grid", isOn: guides.grid.snap) { on in setGrid { $0.snap = on } }
            }
        }
    }

    private var divisionMenus: some View {
        HStack(spacing: 6) {
            OverlayPanelMenu("Grid columns", selection: guides.grid.cols, options: GuidesControlView.divisions) { n in
                setGrid { $0.cols = clampDivisions(Double(n)) }
            }
            .fixedSize()
            Text(verbatim: "×")
                .foregroundStyle(palette.muted)
                .accessibilityHidden(true)
            OverlayPanelMenu("Grid rows", selection: guides.grid.rows, options: GuidesControlView.divisions) { n in
                setGrid { $0.rows = clampDivisions(Double(n)) }
            }
            .fixedSize()
        }
        .help("Grid columns × rows (also used for snapping)")
    }

    // MARK: - toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Eyebrow("Safe area")
                OverlayPanelMenu("Safe area", selection: guides.safeZone, options: GuidesControlView.safeZoneOptions) { id in
                    pickSafeZone(id)
                }
                .fixedSize()
            }
            if let preset {
                GuidesToolbarCapsule(title: "Rotate", systemImage: "arrow.clockwise", on: rotated,
                              help: rotated
                                ? "\(preset.label)'s safe area is turned a quarter-turn to span this frame — click for the upright template"
                                : "Turn \(preset.label)'s safe area a quarter-turn so it spans this frame") {
                    setRotated(!rotated)
                }
            }
            Rectangle().fill(palette.line).frame(width: 1, height: 22)
            GuidesToolbarCapsule(title: "Grid", systemImage: "grid", on: guides.grid.show,
                          help: "Show a composition grid over the preview") {
                setGrid { $0.show.toggle() }
            }
            divisionMenus
            GuidesToolbarCapsule(title: "Snap", systemImage: "magnet", on: guides.grid.snap, help: GuidesControlView.snapHint) {
                setGrid { $0.snap.toggle() }
            }
        }
    }
}

/// A toolbar toggle: a capsule, the accent while it is on.
private struct GuidesToolbarCapsule: View {
    let title: String
    let systemImage: String
    let on: Bool
    let help: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(on ? palette.accentInk : palette.inkSoft)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(Capsule().fill(on ? palette.accentWash : palette.paper))
                .overlay(Capsule().stroke(on ? palette.accent : palette.lineStrong, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(help)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - previews

private struct GuidesPreview: View {
    @State private var guides: GuidesState
    let frameAspect: Double?
    let layout: GuidesControlLayout

    init(_ guides: GuidesState, frameAspect: Double?, layout: GuidesControlLayout) {
        _guides = State(initialValue: guides)
        self.frameAspect = frameAspect
        self.layout = layout
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            GuidesControlView(guides: $guides, frameAspect: frameAspect, layout: layout)
        }
    }
}

#Preview("Guides — rows, Reels over a landscape clip") {
    GuidesPreview(GuidesState(safeZone: "reels", grid: GridConfig(show: true, cols: 3, rows: 3, snap: true)),
                  frameAspect: 16.0 / 9, layout: .rows)
}

#Preview("Guides — toolbar") {
    ScrollView(.horizontal) {
        GuidesPreview(.default, frameAspect: 9.0 / 16, layout: .toolbar)
    }
}
