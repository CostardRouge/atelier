// The stack of SHADES laid over the hook's picture, as inspector rows — port
// of `src/tools/roadtrip/ShadesPanel.tsx`. The arithmetic is the kernel's
// (`Roadtrip/Shades.swift`, `ShadeGradient.swift`, `PieceLook.swift`); the
// paint is `Trips/Paint/ShadePainter.swift`, so what a row sets is what the
// stage, the PNG deck and a burned-in clip draw.
//
// Rules kept (`roadtrip.md`, «One stack of SHADES»):
// - ONE list rather than a vignette control and a scrim control: they were
//   the same thing seen twice, and apart they made the combinations that come
//   up impossible (a wash from the left AND a vignette).
// - Up to four (`maxShades`) — past that it stops being a treatment.
// - A direction is picked on a 3×3 GRID, cell for cell the badge's anchor
//   grid, each cell showing the gradient it draws; the centre holds three
//   shapes (the radial and the two bands, which cross the frame and fit no
//   cell), offered in a column beside the grid only while the centre is the
//   cell. Never a multi-select.
// - `enabled` absent means ON; off keeps the shade in the stack, dims its row
//   and greys its sliders — the LUT layer's bypass.
// - Under "Anchor" a row shows the cell the badge is anchored in; picking a
//   cell by hand drops the shade to "Edge". The reach slider is dead only
//   where the badge really sets it (a top or bottom shade following it).
// - The FADE has a shape: a falloff drawn from its own stops, a core held at
//   full strength, and a centre for a band or a radial — placed ON THE
//   PICTURE ("Place on the picture": while on, a press on the stage moves
//   that centre and nothing else; on a phone the inspector steps aside), the
//   sliders its keyboard twin.
// - Two shortcuts beside the plain add, because the two shapes reached for
//   constantly (a scrim under the hook, a corner vignette) would otherwise
//   each be four adjustments.

import SwiftUI
import AtelierKit

struct ShadesPanelView: View {
    let shades: [Shade]
    /// The badge's grid anchor — what a shade following it is placed by.
    let anchor: OverlayAnchor?
    /// The shade whose centre the stage is placing, if any.
    let placing: String?
    let onChange: ([Shade]) -> Void
    /// Hand a shade's centre to the stage, or take it back with nil.
    let onPlace: (String?) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if shades.isEmpty {
                OverlayPanelNote("The picture is untouched. Add a shade where the type needs help — a bright sky exactly under the hook is the normal case.")
            }
            ForEach(Array(shades.enumerated()), id: \.element.id) { i, shade in
                ShadeRowView(shade: shade, number: i + 1, anchor: anchor, placing: placing == shade.id,
                             onPatch: { next in patch(next) },
                             onRemove: { remove(shade.id) },
                             onPlace: onPlace)
            }
            verbs
        }
    }

    @ViewBuilder
    private var verbs: some View {
        if shades.count < maxShades {
            HStack(spacing: 6) {
                Button {
                    add(createShade())
                } label: {
                    Label("Shade", systemImage: "plus")
                }
                Button("Under the hook") { add(createShade(followHook: true)) }
                Button("Vignette") { add(vignetteShade(0.45)) }
            }
            .buttonStyle(DevelopPillButtonStyle())
        } else {
            Text("Four is the limit — past that it stops being a treatment.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.muted)
        }
    }

    private func patch(_ next: Shade) {
        onChange(shades.map { $0.id == next.id ? next : $0 })
    }

    private func remove(_ id: String) {
        if placing == id { onPlace(nil) }
        onChange(shades.filter { $0.id != id })
    }

    private func add(_ shade: Shade) {
        guard shades.count < maxShades else { return }
        onChange(shades + [shade])
    }
}

/// One shade of the stack, as its rows.
struct ShadeRowView: View {
    let shade: Shade
    /// 1-based, as the rows name it.
    let number: Int
    let anchor: OverlayAnchor?
    /// This shade's centre is the one the stage is placing.
    let placing: Bool
    let onPatch: (Shade) -> Void
    let onRemove: () -> Void
    let onPlace: (String?) -> Void

    @Environment(\.palette) private var palette
    private typealias P = OverlayPanels

    // MARK: - what the shade draws

    private var follow: ShadeFollow { shadeFollow(shade) }
    /// What it really draws: under "Anchor", the badge's cell.
    private var direction: ShadeDirection { shadeShownDirection(shade, anchor) }
    private var cell: OverlayAnchor { shadeCell(direction) }
    private var isRound: Bool { shadeIsRound(direction) }
    /// A top or bottom shade following the badge takes its reach from the block.
    private var reachLive: Bool { !reachFollowsBadge(direction, follow) }
    /// Absent on every shade stored before the switch existed: that is ON.
    private var on: Bool { shade.enabled != false }
    private var movable: ShadeCentreAxis? { centreMovable(direction, follow) }

    private func edit(_ change: (inout Shade) -> Void) {
        var next = shade
        change(&next)
        onPatch(next)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            fromRow
            sliders
            falloffRow
            if let movable {
                ShadeCentreRow(shade: shade, number: number, movable: movable, on: on, placing: placing,
                               onPatch: onPatch, onPlace: onPlace)
            }
            OverlayPanelRow("Invert") {
                OverlayPanelToggle("Invert shade \(number)", isOn: shade.invert) { invert in
                    edit { $0.invert = invert }
                }
            }
            followRow
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            Rectangle().fill(palette.line).frame(width: 2)
        }
        .opacity(on ? 1 : 0.6)
    }

    // MARK: - the rows

    private var header: some View {
        HStack(spacing: 8) {
            OverlayPanelToggle(on ? "Bypass shade \(number)" : "Enable shade \(number)", isOn: on) { enabled in
                edit { $0.enabled = enabled }
            }
            Text("Shade \(number)")
                .font(Brand.sans(13, weight: .medium))
                .foregroundStyle(palette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            OverlayPanelColourWell("Shade \(number) colour", css: shade.color) { hex in
                edit { $0.color = hex }
            }
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.muted)
            .help("Remove shade \(number)")
            .accessibilityLabel("Remove shade \(number)")
        }
    }

    private var fromRow: some View {
        OverlayPanelRow("From", hint: fromHint, alignTop: true) {
            ShadeDirectionGrid(direction: direction, cell: cell, number: number) { picked in
                onPatch(shadeDirectionPicked(shade, picked))
            }
        }
    }

    private var fromHint: String {
        let label = ShadeRowView.label(direction)
        return follow == .anchor && anchor != nil ? "\(label) — where the badge is anchored." : label
    }

    @ViewBuilder
    private var sliders: some View {
        let core = shadeCore(shade)
        let run = isRound ? "radius" : "reach"
        DevelopRangeSlider("Strength", value: shade.strength, in: 0...1, step: 0.02, reset: 0.65,
                           printed: P.percent(shade.strength)) { v in edit { $0.strength = v } }
            .disabled(!on)
            .accessibilityHint("Shade \(number) strength")
        DevelopRangeSlider(isRound ? "Radius" : "Reach", value: shade.reach, in: 0...1, step: 0.02, reset: 0.55,
                           printed: P.percent(shade.reach)) { v in edit { $0.reach = v } }
            .disabled(!on || !reachLive)
            .accessibilityHint("Shade \(number) \(run)")
        VStack(alignment: .leading, spacing: 4) {
            DevelopRangeSlider("Core", value: core, in: 0...maxShadeCore, step: 0.02, reset: 0,
                               printed: P.percent(core)) { v in edit { $0.core = v } }
                .disabled(!on)
                .accessibilityHint("Shade \(number) core")
            if core > 0 {
                OverlayPanelHint("Full strength over \(P.percent(core)) of the \(run), then the fade.")
            }
        }
    }

    private var falloffRow: some View {
        let falloff = shadeFalloff(shade)
        let hint = shadeFalloffs.first { $0.id == falloff }?.hint
        return OverlayPanelRow("Falloff", hint: hint) {
            HStack(spacing: 4) {
                ForEach(shadeFalloffs, id: \.id) { entry in
                    ShadeFalloffButton(falloff: entry, pressed: entry.id == falloff) {
                        edit { $0.falloff = entry.id }
                    }
                }
            }
            .disabled(!on)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Shade \(number) falloff")
        }
    }

    private var followRow: some View {
        OverlayPanelRow("Follow badge", hint: ShadeRowView.followTitle(follow)) {
            Picker("Shade \(number) follows the badge",
                   selection: Binding(get: { follow }, set: { next in onPatch(shadeFollowing(shade, next)) })) {
                ForEach(ShadeRowView.follows) { option in
                    Text(verbatim: option.label).tag(option.value)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
        }
    }

    // MARK: - the words

    static func label(_ direction: ShadeDirection) -> String {
        shadeDirections.first { $0.id == direction }?.label ?? direction.rawValue
    }

    private static let follows: [OverlayPanelOption<ShadeFollow>] = [
        OverlayPanelOption(ShadeFollow.none, "No"),
        OverlayPanelOption(.edge, "Edge"),
        OverlayPanelOption(.anchor, "Anchor"),
    ]

    static func followTitle(_ follow: ShadeFollow) -> String {
        switch follow {
        case .none: return "Placed where the grid says"
        case .edge: return "The reach lands on the badge, the side stays yours"
        case .anchor: return "Sits where the badge is anchored, and moves with it"
        }
    }
}

/// The 3×3 grid of directions, and — while the centre is the cell — the
/// column of the three shapes it holds.
struct ShadeDirectionGrid: View {
    let direction: ShadeDirection
    let cell: OverlayAnchor
    let number: Int
    let onPick: (ShadeDirection) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                ForEach(0..<3, id: \.self) { r in
                    GridRow {
                        ForEach(0..<3, id: \.self) { c in
                            glyph(shadeGrid[r * 3 + c])
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Shade \(number) direction")
            if cell == .center {
                centreColumn
            }
        }
    }

    private func glyph(_ entry: ShadeGridCell) -> some View {
        let centre = entry.cell == .center
        let shape = centre ? directionInCell(.center, direction) : entry.shapes[0]
        return ShadeGlyphButton(direction: shape, pressed: entry.cell == cell,
                                label: centre ? "Centre" : ShadeRowView.label(shape)) {
            onPick(shape)
        }
    }

    private var centreColumn: some View {
        VStack(spacing: 4) {
            ForEach(shadeGrid[4].shapes, id: \.self) { shape in
                ShadeGlyphButton(direction: shape, pressed: shape == direction, label: ShadeRowView.label(shape)) {
                    onPick(shape)
                }
            }
        }
        .padding(.leading, 8)
        .overlay(alignment: .leading) {
            Rectangle().fill(palette.line).frame(width: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Shade \(number) centre shape")
    }
}

/// Where a band or a radial is centred: placed on the picture, or by its
/// sliders; "Back to the middle" once it has moved.
struct ShadeCentreRow: View {
    let shade: Shade
    let number: Int
    let movable: ShadeCentreAxis
    let on: Bool
    let placing: Bool
    let onPatch: (Shade) -> Void
    let onPlace: (String?) -> Void
    @Environment(\.palette) private var palette
    private typealias P = OverlayPanels

    var body: some View {
        let centre = shadeCentre(shade)
        OverlayPanelRow("Centre", alignTop: true) {
            VStack(alignment: .leading, spacing: 8) {
                Button(placing ? "Done placing" : "Place on the picture") {
                    onPlace(placing ? nil : shade.id)
                }
                .buttonStyle(DevelopPillButtonStyle(on: placing))
                .disabled(!on)
                .accessibilityAddTraits(placing ? .isSelected : [])
                if movable != .y {
                    DevelopRangeSlider("Across", value: centre.x, in: 0...1, step: 0.01, reset: 0.5,
                                       printed: "\(P.percent(centre.x)) →") { x in
                        write(AtelierKit.Point(x, centre.y))
                    }
                    .disabled(!on)
                    .accessibilityHint("Shade \(number) centre across")
                }
                if movable != .x {
                    DevelopRangeSlider("Down", value: centre.y, in: 0...1, step: 0.01, reset: 0.5,
                                       printed: "\(P.percent(centre.y)) ↓") { y in
                        write(AtelierKit.Point(centre.x, y))
                    }
                    .disabled(!on)
                    .accessibilityHint("Shade \(number) centre down")
                }
                footnote
            }
        }
    }

    @ViewBuilder
    private var footnote: some View {
        if placing {
            OverlayPanelHint("Press or drag on the picture to move the \(movable == .both ? "centre" : "band").")
        } else if !shadeCentred(shade, movable) {
            Button("Back to the middle") {
                var next = shade
                next.center = nil
                onPatch(next)
            }
            .buttonStyle(DevelopLinkButtonStyle())
        }
    }

    private func write(_ centre: AtelierKit.Point) {
        var next = shade
        next.center = centre
        onPatch(next)
    }
}

// MARK: - previews

private struct ShadesPanelPreview: View {
    @State private var shades: [Shade]
    @State private var placing: String?

    init(_ shades: [Shade]) {
        _shades = State(initialValue: shades)
    }

    var body: some View {
        DevelopPreviewState(true) { _ in
            ShadesPanelView(shades: shades, anchor: .bottomLeft, placing: placing,
                            onChange: { shades = $0 }, onPlace: { placing = $0 })
        }
    }
}

#Preview("Shades — a scrim and a band") {
    ShadesPanelPreview([
        createShade(id: "a", followHook: true),
        createShade(id: "b", direction: .middleVertical, reach: 0.8, strength: 0.5, core: 0.3,
                    center: AtelierKit.Point(0.5, 0.35)),
        createShade(id: "c", direction: .radial, followAnchor: true, enabled: false),
    ])
}

#Preview("Shades — none yet") {
    ShadesPanelPreview([])
}
