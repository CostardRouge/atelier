// The component palette — port of `src/shared/overlay/ElementPalette.tsx`: a
// grid of what can be dropped on the frame, grouped (Intro · Flight · Camera ·
// Time · Instruments · Shapes, the kernel's `paletteGroups`), each cell
// previewing what it will actually add — the current value in the current
// style, on a dark stage that stands in for the footage.
//
// The rules it keeps (`docs/memory/studio.md`):
// - a FOLDABLE PREVIEW palette, never a dropdown: it folds away because a
//   narrow column of eighteen readouts would push the element list and its
//   style panel off-screen; the fold is the caller's (`isOpen`), so a trip to
//   another tab never re-collapses it, and the host opens it on an empty deck;
// - a cell shows the REAL value at the playhead or the field's NAME — never a
//   fabricated "87 m" (`OverlayPanels.palettePreviewText`);
// - the preview wears the project theme, painted by the real renderer
//   (`OverlayElementPreview`) rather than the web's CSS approximation; the
//   shapes draw the web's own glyphs, as its palette does;
// - an intro cell counts nothing and says where in the intro it lands
//   (`+0.5s`); another cell shows how many are already placed (`•`, `2`).

import SwiftUI
import AtelierKit

struct ElementPaletteView: View {
    private let elements: [OverlayElement]
    private let cue: Cue?
    private let theme: StyleTheme?
    private let timeShift: TimeShift?
    @Binding private var isOpen: Bool
    private let bare: Bool
    private let onAdd: (OverlayElement) -> Void

    /// One renderer for every cell — it keeps each cell's grain mask across redraws.
    @State private var painter = OverlayPainter()
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - elements: what is already on the frame — each cell counts it, never blocks on it.
    ///   - cue: the cue at the playhead, so a cell previews the value it will really show.
    ///   - theme: the project theme, so a cell previews the look it will really wear.
    ///   - timeShift: the project's capture-time correction, so a Clock cell previews it too.
    ///   - isOpen: the fold, owned by the caller.
    ///   - bare: drawn inside a host that owns the header and the fold (a
    ///     `DevelopSection` titled "Add an element" passing the same state).
    ///   - onAdd: a FRESH element for the cell pressed; the host inserts and selects it.
    init(elements: [OverlayElement], cue: Cue?, theme: StyleTheme?, timeShift: TimeShift? = nil,
         isOpen: Binding<Bool>, bare: Bool = false, onAdd: @escaping (OverlayElement) -> Void) {
        self.elements = elements
        self.cue = cue
        self.theme = theme
        self.timeShift = timeShift
        _isOpen = isOpen
        self.bare = bare
        self.onAdd = onAdd
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !bare {
                header
            }
            if isOpen {
                ForEach(paletteGroups.indices, id: \.self) { g in
                    group(paletteGroups[g])
                }
            }
        }
    }

    private var header: some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { isOpen.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                    .font(Brand.sans(11, weight: .semibold))
                Text("Add an element")
                    .font(Brand.sans(13, weight: .semibold))
            }
            .foregroundStyle(palette.accentInk)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(isOpen ? "expanded" : "collapsed")
    }

    private func group(_ group: PaletteGroup) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: group.label.uppercased())
                .font(Brand.mono(9, weight: .medium))
                .kerning(1.3)
                .foregroundStyle(palette.muted)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(group.items.indices, id: \.self) { i in
                    OverlayPaletteCell(item: group.items[i], elements: elements, cue: cue, theme: theme,
                                timeShift: timeShift, painter: painter, onAdd: onAdd)
                }
            }
        }
    }
}

// MARK: - a cell

private struct OverlayPaletteCell: View {
    let item: PaletteItem
    let elements: [OverlayElement]
    let cue: Cue?
    let theme: StyleTheme?
    let timeShift: TimeShift?
    let painter: OverlayPainter
    let onAdd: (OverlayElement) -> Void
    @Environment(\.palette) private var palette

    private typealias P = OverlayPanels

    var body: some View {
        let el = P.paletteElement(item)
        let name = P.paletteItemName(item)
        let placed = P.palettePlacedCount(elements, item)
        let hint = P.paletteTimingHint(el)
        return Button {
            onAdd(P.paletteElement(item))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                caption(name: name, placed: placed, hint: hint)
                stage(el)
            }
            .padding(6)
            .background(palette.paper, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(OverlayPaletteCellStyle())
        .help(P.paletteCellTitle(name, placed: placed))
        .accessibilityLabel(P.paletteCellTitle(name, placed: placed))
    }

    private func caption(name: String, placed: Int, hint: String?) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: name.uppercased())
                .font(Brand.mono(9))
                .kerning(0.7)
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let hint {
                Text(verbatim: hint)
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.muted)
            } else if placed > 0 {
                Text(verbatim: placed > 1 ? "\(placed)" : "•")
                    .font(Brand.mono(9))
                    .foregroundStyle(palette.accent)
                    .accessibilityLabel("\(placed) already placed")
            }
        }
    }

    /// The little dark stage: the glyph of a shape, else the element's own
    /// words painted by the renderer, edges faded so a long readout says
    /// "there is more" instead of chopping a glyph in half.
    private func stage(_ el: OverlayElement) -> some View {
        let resolved = resolveElementStyle(el, theme)
        return ZStack {
            RoundedRectangle(cornerRadius: 3).fill(palette.frame)
            stageContent(el, resolved)
                .padding(.horizontal, 4)
        }
        .frame(height: 32)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .mask {
            LinearGradient(stops: [
                Gradient.Stop(color: .clear, location: 0),
                Gradient.Stop(color: .black, location: 0.07),
                Gradient.Stop(color: .black, location: 0.93),
                Gradient.Stop(color: .clear, location: 1),
            ], startPoint: .leading, endPoint: .trailing)
        }
    }

    @ViewBuilder
    private func stageContent(_ el: OverlayElement, _ resolved: ResolvedStyle) -> some View {
        let ink = Color(cgColor: OverlayPanelColour.cgColor(resolved.color))
        let glow = OverlayPaletteGlow(resolved)
        switch item {
        case .headingArrow:
            OverlayPaletteGlyph(kind: .arrow, ink: ink, sight: ink).frame(width: 18, height: 18).overlayPaletteGlow(glow)
        case .headingTape:
            let sight = Color(cgColor: OverlayPanelColour.cgColor(el.tapeReticleColor ?? resolved.color))
            OverlayPaletteGlyph(kind: .tape, ink: ink, sight: sight).frame(width: 30, height: 13).overlayPaletteGlow(glow)
        case .battery:
            OverlayPaletteGlyph(kind: .battery, ink: ink, sight: ink).frame(width: 28, height: 14).overlayPaletteGlow(glow)
        case .frameCorners:
            OverlayPaletteGlyph(kind: .corners, ink: ink, sight: ink).frame(width: 27, height: 17).overlayPaletteGlow(glow)
        default:
            if el.kind == .rotateDevice {
                OverlayPaletteGlyph(kind: .phone, ink: ink, sight: ink).frame(width: 30, height: 21).overlayPaletteGlow(glow)
            } else {
                OverlayElementPreview(previewElement(el), theme: theme, painter: painter)
            }
        }
    }

    /// The cell's words as a text element: the live value, or the field's
    /// name when this cue has none — so the renderer is handed exactly what
    /// the web's cell writes, never `ALT —`.
    private func previewElement(_ el: OverlayElement) -> OverlayElement {
        var text = el
        text.kind = .text
        text.text = P.palettePreviewText(item, el, cue, timeShift: timeShift)
        text.field = nil
        text.label = nil
        // 0.62rem over a 2rem stage, the web's size.
        return OverlayElementPreview.centred(text, id: "palette.\(P.paletteItemKey(item))", fontShare: 0.31, theme: theme)
    }
}

/// A cell's press: its border takes the accent, nothing moves.
private struct OverlayPaletteCellStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PressBody(configuration: configuration)
    }

    private struct PressBody: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.palette) private var palette
        @State var hovering = false

        var body: some View {
            configuration.label
                .overlay(RoundedRectangle(cornerRadius: 10)
                    .stroke(palette.accent, lineWidth: 1)
                    .opacity(configuration.isPressed || hovering ? 1 : 0))
                .onHover { hovering = $0 }
        }
    }
}

// MARK: - the shapes' glyphs (the web's inline SVGs)

/// The halation a shape's glyph wears — the web's `previewGlowFilter`:
/// a drop shadow of the warm-drifted ink, as wide as the halo.
private struct OverlayPaletteGlow {
    let color: Color?
    let radius: CGFloat

    init(_ style: ResolvedStyle) {
        guard let glow = style.glow, glow.bleedAlpha != 0 else {
            color = nil
            radius = 0
            return
        }
        let rgb = warmDrift(style.color, style.glowWarmth)
        let alpha = min(1, glow.bleedAlpha * 2)
        color = Color(.sRGB, red: Double(rgb[0]) / 255, green: Double(rgb[1]) / 255, blue: Double(rgb[2]) / 255,
                      opacity: alpha)
        radius = CGFloat(glow.haloRadiusFrac * 8) / 2
    }
}

private extension View {
    @ViewBuilder
    func overlayPaletteGlow(_ glow: OverlayPaletteGlow) -> some View {
        if let color = glow.color {
            self.shadow(color: color, radius: glow.radius)
        } else {
            self
        }
    }
}

private struct OverlayPaletteGlyph: View {
    enum Kind { case arrow, tape, battery, corners, phone }

    let kind: Kind
    let ink: Color
    /// The tape's sight, which is its own colour.
    let sight: Color

    var body: some View {
        Canvas { context, size in
            switch kind {
            case .arrow: OverlayPaletteGlyph.arrow(&context, size, ink)
            case .tape: OverlayPaletteGlyph.tape(&context, size, ink, sight)
            case .battery: OverlayPaletteGlyph.battery(&context, size, ink)
            case .corners: OverlayPaletteGlyph.corners(&context, size, ink)
            case .phone: OverlayPaletteGlyph.phone(&context, size, ink)
            }
        }
        .accessibilityHidden(true)
    }

    /// Scale the SVG's viewBox onto the canvas.
    private static func fit(_ context: inout GraphicsContext, _ size: CGSize, _ w: CGFloat, _ h: CGFloat) {
        context.scaleBy(x: size.width / w, y: size.height / h)
    }

    /// `M12 3 L19 20 L12 15.5 L5 20 Z` in a 24 × 24 box.
    private static func arrow(_ context: inout GraphicsContext, _ size: CGSize, _ ink: Color) {
        fit(&context, size, 24, 24)
        var p = Path()
        p.move(to: CGPoint(x: 12, y: 3))
        p.addLine(to: CGPoint(x: 19, y: 20))
        p.addLine(to: CGPoint(x: 12, y: 15.5))
        p.addLine(to: CGPoint(x: 5, y: 20))
        p.closeSubpath()
        context.fill(p, with: .color(ink))
    }

    /// Ticks thinning toward both ends, the way the real ribbon dissolves,
    /// over a faint rule, under the sight's triangle (32 × 14).
    private static func tape(_ context: inout GraphicsContext, _ size: CGSize, _ ink: Color, _ sight: Color) {
        fit(&context, size, 32, 14)
        let stroke = StrokeStyle(lineWidth: 1.1)
        for t in [-13.0, -9, -5, 0, 5, 9, 13] {
            var tick = Path()
            tick.move(to: CGPoint(x: 16 + t, y: 4))
            tick.addLine(to: CGPoint(x: 16 + t, y: t == 0 ? 10 : 7.5))
            context.stroke(tick, with: .color(ink.opacity(1 - abs(t) / 16)), style: stroke)
        }
        var rule = Path()
        rule.move(to: CGPoint(x: 2, y: 4))
        rule.addLine(to: CGPoint(x: 30, y: 4))
        context.stroke(rule, with: .color(ink.opacity(0.35)), style: stroke)
        var mark = Path()
        mark.move(to: CGPoint(x: 16, y: 3.4))
        mark.addLine(to: CGPoint(x: 13.4, y: 0.6))
        mark.addLine(to: CGPoint(x: 18.6, y: 0.6))
        mark.closeSubpath()
        context.fill(mark, with: .color(sight))
    }

    /// A cell outline, a charge two thirds full and the terminal (32 × 16).
    private static func battery(_ context: inout GraphicsContext, _ size: CGSize, _ ink: Color) {
        fit(&context, size, 32, 16)
        let shell = Path(roundedRect: CGRect(x: 1, y: 2, width: 26, height: 12), cornerRadius: 2.5)
        context.stroke(shell, with: .color(ink), style: StrokeStyle(lineWidth: 1.4))
        context.fill(Path(roundedRect: CGRect(x: 3.4, y: 4.4, width: 16, height: 7.2), cornerRadius: 1.4), with: .color(ink))
        context.fill(Path(roundedRect: CGRect(x: 28.4, y: 5.6, width: 2.6, height: 4.8), cornerRadius: 1), with: .color(ink))
    }

    /// `M2 6 V2 H7 M25 2 H30 V6 M30 14 V18 H25 M7 18 H2 V14` (32 × 20).
    private static func corners(_ context: inout GraphicsContext, _ size: CGSize, _ ink: Color) {
        fit(&context, size, 32, 20)
        var p = Path()
        let arms: [[(CGFloat, CGFloat)]] = [
            [(2, 6), (2, 2), (7, 2)],
            [(25, 2), (30, 2), (30, 6)],
            [(30, 14), (30, 18), (25, 18)],
            [(7, 18), (2, 18), (2, 14)],
        ]
        for arm in arms {
            p.move(to: CGPoint(x: arm[0].0, y: arm[0].1))
            for point in arm.dropFirst() { p.addLine(to: CGPoint(x: point.0, y: point.1)) }
        }
        context.stroke(p, with: .color(ink), style: StrokeStyle(lineWidth: 1.8, lineCap: .square))
    }

    /// A phone mid-turn, with the arc that says "turn" (32 × 22).
    private static func phone(_ context: inout GraphicsContext, _ size: CGSize, _ ink: Color) {
        fit(&context, size, 32, 22)
        // `rotate(22 16 12)`: clockwise, about the phone's middle.
        let turn = CGAffineTransform(translationX: 16, y: 12)
            .rotated(by: 22 * .pi / 180)
            .translatedBy(x: -16, y: -12)
        let body = Path(roundedRect: CGRect(x: 10.5, y: 4, width: 11, height: 16), cornerRadius: 2).applying(turn)
        context.stroke(body, with: .color(ink), style: StrokeStyle(lineWidth: 1.4))
        // `M7 8 A 9.5 9.5 0 0 1 25 8`: the short arc over the top, sampled —
        // its centre under the chord, from 198.7° round through 270° (up, on
        // a y-down canvas) to 341.3°.
        let centre = CGPoint(x: 16, y: 8 + (9.5 * 9.5 - 81).squareRoot())
        let from: CGFloat = atan2(8 - centre.y, 7 - centre.x) + 2 * .pi
        let to: CGFloat = atan2(8 - centre.y, 25 - centre.x) + 2 * .pi
        var arc = Path()
        let steps = 24
        for i in 0...steps {
            let a = from + (to - from) * CGFloat(i) / CGFloat(steps)
            let point = CGPoint(x: centre.x + 9.5 * cos(a), y: centre.y + 9.5 * sin(a))
            if i == 0 { arc.move(to: point) } else { arc.addLine(to: point) }
        }
        context.stroke(arc, with: .color(ink.opacity(0.85)), style: StrokeStyle(lineWidth: 1.2))
        var head = Path()
        head.move(to: CGPoint(x: 25, y: 8))
        head.addLine(to: CGPoint(x: 22.4, y: 4.6))
        head.addLine(to: CGPoint(x: 27.8, y: 5.2))
        head.closeSubpath()
        context.fill(head, with: .color(ink.opacity(0.85)))
    }
}

// MARK: - previews

#Preview("Palette — a clip with a log") {
    DevelopPreviewState(true) { open in
        ElementPaletteView(elements: OverlayPanelFixtures.deck, cue: OverlayPanelFixtures.cue,
                           theme: OverlayPanelFixtures.theme, isOpen: open) { _ in }
    }
}

#Preview("Palette — no telemetry, no theme") {
    DevelopPreviewState(true) { open in
        ElementPaletteView(elements: [], cue: nil, theme: nil, isOpen: open) { _ in }
    }
}
