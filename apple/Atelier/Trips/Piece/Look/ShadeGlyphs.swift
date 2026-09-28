// The two small pictures the shades panel is read by — port of `GLYPHS` /
// `GlyphButton` and `FALLOFF_PATHS` / `FalloffButton` in
// `src/tools/roadtrip/ShadesPanel.tsx`.
//
// - A direction's cell shows the GRADIENT it draws, so the grid is read by eye
//   rather than by label. A sketch, not the renderer: it only has to tell
//   eleven shapes apart at 32 points, and it is drawn with the web's own CSS
//   gradients (a circle at a corner fading out at 80 % of its farthest
//   corner, a band clear at 10 % and 90 %…).
// - A falloff's button draws the strength along a shade's run from the VERY
//   stops the renderer gets for it (`shadeFalloffStops`) — a sketch of the
//   curve could drift from what is painted. The web's 36 × 22 view box, fitted.

import SwiftUI
import AtelierKit

// MARK: - a direction

/// One cell of the direction grid: its gradient on paper, ringed when chosen.
struct ShadeGlyphButton: View {
    let direction: ShadeDirection
    let pressed: Bool
    let label: String
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            ShadeGlyph(direction: direction, ink: palette.ink.opacity(0.8))
                .frame(width: ShadeGlyph.side, height: ShadeGlyph.side)
                .background(palette.paper)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(pressed ? palette.accent : palette.lineStrong,
                                                                   lineWidth: pressed ? 2 : 1))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// The gradient a direction draws, as the web's CSS sketches it.
struct ShadeGlyph: View {
    let direction: ShadeDirection
    let ink: Color

    static let side: CGFloat = 32

    var body: some View {
        Rectangle().fill(fill)
    }

    private var clear: Color { ink.opacity(0) }

    private var fill: AnyShapeStyle {
        switch direction {
        case .top: return AnyShapeStyle(edge(from: .top, to: .bottom))
        case .bottom: return AnyShapeStyle(edge(from: .bottom, to: .top))
        case .left: return AnyShapeStyle(edge(from: .leading, to: .trailing))
        case .right: return AnyShapeStyle(edge(from: .trailing, to: .leading))
        case .middleVertical: return AnyShapeStyle(band(from: .top, to: .bottom))
        case .middleHorizontal: return AnyShapeStyle(band(from: .leading, to: .trailing))
        case .radial: return AnyShapeStyle(pool(at: .center, span: ShadeGlyph.side / 2, clearAt: 0.6))
        case .topLeft: return AnyShapeStyle(pool(at: .topLeading, span: ShadeGlyph.side, clearAt: 0.8))
        case .topRight: return AnyShapeStyle(pool(at: .topTrailing, span: ShadeGlyph.side, clearAt: 0.8))
        case .bottomLeft: return AnyShapeStyle(pool(at: .bottomLeading, span: ShadeGlyph.side, clearAt: 0.8))
        case .bottomRight: return AnyShapeStyle(pool(at: .bottomTrailing, span: ShadeGlyph.side, clearAt: 0.8))
        }
    }

    /// `linear-gradient(to …, ink, transparent 75%)`.
    private func edge(from: UnitPoint, to: UnitPoint) -> LinearGradient {
        LinearGradient(stops: [
            Gradient.Stop(color: ink, location: 0),
            Gradient.Stop(color: clear, location: 0.75),
        ], startPoint: from, endPoint: to)
    }

    /// `linear-gradient(to …, transparent 10%, ink, transparent 90%)`.
    private func band(from: UnitPoint, to: UnitPoint) -> LinearGradient {
        LinearGradient(stops: [
            Gradient.Stop(color: clear, location: 0.1),
            Gradient.Stop(color: ink, location: 0.5),
            Gradient.Stop(color: clear, location: 0.9),
        ], startPoint: from, endPoint: to)
    }

    /// `radial-gradient(circle at …, ink, transparent N%)`: a circle sized to
    /// the farthest corner (CSS's default), which lies `span` away on each
    /// axis — half the side from the middle, the whole side from a corner.
    private func pool(at centre: UnitPoint, span: CGFloat, clearAt: CGFloat) -> RadialGradient {
        let radius = span * CGFloat(2.0.squareRoot())
        return RadialGradient(stops: [
            Gradient.Stop(color: ink, location: 0),
            Gradient.Stop(color: clear, location: clearAt),
        ], center: centre, startRadius: 0, endRadius: radius)
    }
}

// MARK: - a falloff

/// One falloff's button: the fade drawn from its own stops, filled faintly
/// under the line; ringed when chosen.
struct ShadeFalloffButton: View {
    let falloff: ShadeFalloffEntry
    let pressed: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let stops = shadeFalloffStops(falloff.id)
        let ink = pressed ? palette.accent : palette.inkSoft
        return Button(action: action) {
            ZStack {
                ShadeFalloffCurve(stops: stops, closed: true).fill(ink.opacity(0.18))
                ShadeFalloffCurve(stops: stops, closed: false)
                    .stroke(ink, style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))
            }
            .frame(width: 36, height: 28)
            .background(palette.paper)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(pressed ? palette.accent : palette.lineStrong,
                                                               lineWidth: pressed ? 2 : 1))
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help("\(falloff.label) — \(falloff.hint)")
        .accessibilityLabel(falloff.label)
        .accessibilityHint(falloff.hint)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// The strength along a run, in the web's 36 × 22 view box fitted to the
/// rect (`xMidYMid meet`): x from 2 to 34, full strength at 3, clear at 19.
/// Closed, it runs down to the floor and back — the faint fill under the line.
struct ShadeFalloffCurve: Shape {
    let stops: [ShadeStop]
    let closed: Bool

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width / 36, rect.height / 22)
        let ox = rect.minX + (rect.width - 36 * scale) / 2
        let oy = rect.minY + (rect.height - 22 * scale) / 2
        func point(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: ox + CGFloat(x) * scale, y: oy + CGFloat(y) * scale)
        }
        var path = Path()
        for (i, stop) in stops.enumerated() {
            let at = point(2 + stop.at * 32, 3 + (1 - stop.alpha) * 16)
            if i == 0 {
                path.move(to: at)
            } else {
                path.addLine(to: at)
            }
        }
        if closed && !stops.isEmpty {
            path.addLine(to: point(34, 19))
            path.addLine(to: point(2, 19))
            path.closeSubpath()
        }
        return path
    }
}

#Preview("Shade glyphs") {
    VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 4) {
            ForEach(ShadeDirection.allCases, id: \.self) { d in
                ShadeGlyphButton(direction: d, pressed: d == .bottom, label: d.rawValue) {}
            }
        }
        HStack(spacing: 4) {
            ForEach(shadeFalloffs, id: \.id) { f in
                ShadeFalloffButton(falloff: f, pressed: f.id == .soft) {}
            }
        }
    }
    .padding(16)
    .darkroom()
}
