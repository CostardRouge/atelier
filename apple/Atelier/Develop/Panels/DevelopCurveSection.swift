// The curve editor — port of `src/shared/develop/DevelopCurve.tsx`: one
// square, the picture's own histogram behind it, the spline over it and its
// control points on top; five curves (Luma · RGB · R · G · B), one at a time.
//
// The path is SAMPLED from the kernel's `makeCurve` rather than drawn as
// béziers: the spline is monotone cubic, and any other drawing would show a
// different curve from the one that bakes. The gesture's rules — what a drag
// may do to a point, what a tap near one means — are the kernel's
// (`Develop/CurveEdit.swift`: `pointAt`, `addCurvePoint`, `moveCurvePoint`,
// `removeCurvePoint`), so this file is only the hand and the paint:
//
// - a press on a point grabs it, a press anywhere else adds one and grabs it;
// - a drag moves the grabbed point, penned in by its neighbours; dragging an
//   end inwards sets a black or white point;
// - a double-tap on a point drops it (the last two always stay).
//
// The curve UNDER THE HAND is held here while a drag lasts (`live`): a drag
// writes faster than the document comes back, and a handler reading the
// stored curve would apply each move to the curve as it was when the finger
// went down — which silently threw away a point the drag had just added on
// the web (measured there; `develop-roll.md`).

import SwiftUI
import AtelierKit

struct DevelopCurveSection: View {
    @Binding var settings: DevelopSettings
    let histogram: Histogram?
    let foldPrefix: String

    @State private var channel: CurveChannel = .luma
    /// The point under the hand, or −1.
    @State private var dragging = -1
    /// The curve as the hand last wrote it, while a drag lasts.
    @State private var live: Curve?
    /// The last tap that moved nothing: which point, and when — a second one
    /// on the same point soon after is a double-tap, and drops it.
    @State private var lastTap: (index: Int, at: Date)?
    @Environment(\.palette) private var palette

    /// - Parameters:
    ///   - histogram: the picture's own histogram, drawn behind the curve; nil before it is read.
    ///   - foldPrefix: keeps a LAYER's fold apart from the picture's (`layer.`).
    init(settings: Binding<DevelopSettings>, histogram: Histogram?, foldPrefix: String = "") {
        self._settings = settings
        self.histogram = histogram
        self.foldPrefix = foldPrefix
    }

    private var stored: Curve? {
        guard let c = settings.curves?[channel], !isIdentityCurve(c) else { return nil }
        return c
    }

    /// What is drawn and edited: the hand's curve while it drags, else the stored one, else the line.
    private var curve: Curve {
        if dragging >= 0, let live { return live }
        return curveToEdit(stored)
    }

    private var touched: [CurveChannel] {
        CurveChannel.allCases.filter { !isIdentityCurve(settings.curves?[$0]) }
    }

    var body: some View {
        DevelopSection(
            id: "\(foldPrefix)curve",
            title: "Curve",
            info: [Self.hint],
            marked: !touched.isEmpty,
            defaultOpen: false
        ) {
            Picker("Curve channel", selection: $channel) {
                ForEach(CurveChannel.allCases, id: \.self) { c in
                    // A dot marks a channel that is shaped, so a tab you are
                    // not on still says it is doing something.
                    Text(touched.contains(c) ? "\(Self.label(c)) ·" : Self.label(c)).tag(c)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: channel) { _, _ in
                dragging = -1
                live = nil
                lastTap = nil
            }

            box
            footer
        }
    }

    // MARK: - the square

    private var box: some View {
        let curve = self.curve
        let heights = histogram.map(histogramShape) ?? []
        let stroke = Self.stroke(channel, palette)
        let dragging = self.dragging
        let ink = palette.onMedia
        let rim = palette.frame
        return Canvas { context, size in
            Self.paint(&context, size: size, curve: curve, heights: heights, stroke: stroke,
                       dragging: dragging, ink: ink, rim: rim)
        }
        .aspectRatio(1, contentMode: .fit)
        // A fixed box that answers a drag on both axes, not a scroller: it
        // takes the gesture outright.
        .overlay(
            GeometryReader { geo in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(drag(in: geo.size))
            }
        )
        .padding(6)
        .background(palette.frame, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .accessibilityElement()
        .accessibilityLabel("\(Self.label(channel)) curve, \(curve.count) points")
        .accessibilityValue(stored == nil ? "straight" : curve.map(describeCurvePoint).joined(separator: "; "))
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Text(readout)
                .font(Brand.mono(10))
                .monospacedDigit()
                .foregroundStyle(palette.faint)
                .lineLimit(1)
            Spacer(minLength: 0)
            if stored != nil {
                Button("Reset \(Self.label(channel))") { write(identityCurve()) }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
            if touched.count > 1 {
                Button("Reset all") { settings.curves = nil }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    private var readout: String {
        if dragging >= 0 && dragging < curve.count { return describeCurvePoint(curve[dragging]) }
        return stored != nil ? "\(curve.count) points" : "straight"
    }

    // MARK: - the hand

    /// A point in CURVE coordinates — y up, clamped to the box.
    private func at(_ location: CGPoint, _ size: CGSize) -> (x: Double, y: Double) {
        guard size.width > 0, size.height > 0 else { return (0, 0) }
        let x = Double(location.x / size.width)
        let y = 1 - Double(location.y / size.height)
        return (clamp01(x), clamp01(y))
    }

    private func drag(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { g in
                let p = at(g.location, size)
                if dragging < 0 {
                    // The press: grab the point under it, else add one there.
                    let start = curveToEdit(stored)
                    live = start
                    let found = pointAt(start, p.x, p.y)
                    if found >= 0 {
                        dragging = found
                    } else {
                        let added = addCurvePoint(start, p.x, p.y)
                        write(added.curve)
                        dragging = added.index
                    }
                } else {
                    write(moveCurvePoint(live ?? curve, dragging, p.x, p.y))
                }
            }
            .onEnded { g in
                let moved = hypot(g.translation.width, g.translation.height) > 3
                let index = dragging
                if !moved, index >= 0, let last = lastTap, last.index == index, Date().timeIntervalSince(last.at) < 0.35 {
                    write(removeCurvePoint(live ?? curve, index))
                    lastTap = nil
                } else {
                    lastTap = moved ? nil : (index: index, at: Date())
                }
                dragging = -1
                live = nil
            }
    }

    /// Write this channel back — nil for a curve that does nothing, and no
    /// curves at all once every channel is the line.
    private func write(_ next: Curve) {
        live = next
        var base = settings.curves ?? ToneCurves()
        base[channel] = isIdentityCurve(next) ? nil : next
        let empty = CurveChannel.allCases.allSatisfy { base[$0] == nil }
        settings.curves = empty ? nil : base
    }

    // MARK: - the paint

    private static func paint(_ context: inout GraphicsContext, size: CGSize, curve: Curve, heights: [Double],
                              stroke: Color, dragging: Int, ink: Color, rim: Color) {
        let w = size.width
        let h = size.height

        // The picture's light, behind — the same shape the strip draws.
        if !heights.isEmpty {
            let n = CGFloat(heights.count)
            var area = Path()
            area.move(to: CGPoint(x: 0, y: h))
            for (i, v) in heights.enumerated() {
                let y = h * CGFloat(1 - v)
                area.addLine(to: CGPoint(x: w * CGFloat(i) / n, y: y))
                area.addLine(to: CGPoint(x: w * CGFloat(i + 1) / n, y: y))
            }
            area.addLine(to: CGPoint(x: w, y: h))
            area.closeSubpath()
            context.fill(area, with: .color(ink.opacity(0.14)))
        }

        // The straight line: where a point would be if it did nothing.
        var diagonal = Path()
        diagonal.move(to: CGPoint(x: 0, y: h))
        diagonal.addLine(to: CGPoint(x: w, y: 0))
        context.stroke(diagonal, with: .color(ink.opacity(0.22)), lineWidth: 1)

        var grid = Path()
        for q in [0.25, 0.5, 0.75] {
            let fx = w * CGFloat(q)
            let fy = h * CGFloat(q)
            grid.move(to: CGPoint(x: fx, y: 0))
            grid.addLine(to: CGPoint(x: fx, y: h))
            grid.move(to: CGPoint(x: 0, y: fy))
            grid.addLine(to: CGPoint(x: w, y: fy))
        }
        context.stroke(grid, with: .color(ink.opacity(0.09)), lineWidth: 1)

        // The spline, sampled from the very function that bakes.
        let f = makeCurve(curve)
        var line = Path()
        let samples = 96
        for i in 0...samples {
            let x = Double(i) / Double(samples)
            let point = CGPoint(x: w * CGFloat(x), y: h * CGFloat(1 - f(x)))
            if i == 0 { line.move(to: point) } else { line.addLine(to: point) }
        }
        context.stroke(line, with: .color(stroke), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

        for (i, p) in curve.enumerated() {
            let r = w * (i == dragging ? 0.028 : 0.021)
            let centre = CGPoint(x: w * CGFloat(p.x), y: h * CGFloat(1 - p.y))
            let dot = Path(ellipseIn: CGRect(x: centre.x - r, y: centre.y - r, width: r * 2, height: r * 2))
            context.fill(dot, with: .color(i == dragging ? stroke : ink.opacity(0.92)))
            context.stroke(dot, with: .color(rim.opacity(0.55)), lineWidth: 1.5)
        }
    }

    // MARK: - words and inks

    private static func label(_ c: CurveChannel) -> String {
        switch c {
        case .luma: return "Luma"
        case .rgb: return "RGB"
        case .red: return "R"
        case .green: return "G"
        case .blue: return "B"
        }
    }

    /// The ink a channel's curve is drawn in — the channel's own, so the tab
    /// needs no legend. Fixed on purpose: a red channel is red in every theme,
    /// on the frame's dark ground.
    private static func stroke(_ c: CurveChannel, _ palette: Palette) -> Color {
        switch c {
        case .luma, .rgb: return palette.onMedia.opacity(0.92)
        case .red: return Color(.sRGB, red: 233 / 255, green: 105 / 255, blue: 88 / 255, opacity: 0.95)
        case .green: return Color(.sRGB, red: 120 / 255, green: 196 / 255, blue: 132 / 255, opacity: 0.95)
        case .blue: return Color(.sRGB, red: 116 / 255, green: 161 / 255, blue: 232 / 255, opacity: 0.95)
        }
    }

    private static let hint = "Luma moves the tone and leaves the colour alone — a grey stays grey. RGB runs all three channels through one curve, which is the classic contrast curve and does deepen colour. R, G and B tint on purpose. Drag a point to move it, click the line to add one, double-click a point to drop it; dragging an end inwards sets a black or white point."
}

#Preview("Curve") {
    DevelopPreviewState(DevelopPanelFixtures.develop) { settings in
        DevelopCurveSection(settings: settings, histogram: DevelopPanelFixtures.histogram)
    }
}
