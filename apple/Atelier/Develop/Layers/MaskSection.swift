// The open layer's MASK — the web's `MaskPanel.tsx`: its own mask and the
// further masks COMBINED with it (Lightroom's Add · Subtract · Intersect,
// `mask-parts.md`), one of them open at a time; the open one's own controls;
// invert; the layer's opacity; «sauf le sujet» (`except`, a subject taken out
// of this layer); and the Combine row that adds the next part.
//
// The gradients are set with numbers here AND with handles on the stage
// (`MaskStageOverlay`) — the web has the numbers only. A painted mask, a
// subject, a colour and (native) a brightness band take the POINTER: there is
// no number that means "here" or "this blue", so Paint / Pick arms the stage,
// and the stage acts on the component OPEN here.
//
// The words are the web's; the ranges, steps and resets are the web's sliders'.

import SwiftUI
import AtelierKit

/// One choice of kind — `Whole` is the layer's own mask only; a part is never a subject.
private struct MaskKindOption: Identifiable {
    let kind: MaskKind?
    let label: String
    var id: String { kind?.rawValue ?? "none" }

    static let own: [MaskKindOption] = [
        MaskKindOption(kind: nil, label: "Whole"),
        MaskKindOption(kind: .linear, label: "Linear"),
        MaskKindOption(kind: .radial, label: "Radial"),
        MaskKindOption(kind: .luma, label: "Brightness"),
        MaskKindOption(kind: .colour, label: "Colour"),
        MaskKindOption(kind: .brush, label: "Painted"),
        MaskKindOption(kind: .subject, label: "Subject"),
    ]

    static let parts: [MaskKindOption] = own.filter { option in
        guard let kind = option.kind else { return false }
        return partKinds.contains(kind)
    }
}

private func opLabel(_ op: MaskOp) -> String {
    switch op {
    case .add: return "Add"
    case .subtract: return "Subtract"
    case .intersect: return "Intersect"
    }
}

private func opGlyph(_ op: MaskOp) -> String {
    switch op {
    case .add: return "+"
    case .subtract: return "\u{2212}"
    case .intersect: return "\u{2229}"
    }
}

struct MaskSection: View {
    @Bindable var editor: RollEditor
    let state: LayerEditState
    let layer: AdjustLayer
    @Environment(\.palette) private var palette

    static let hint = "Feather is the width of the transition, measured against half the picture’s diagonal — so it means the same on a wide frame and on a square crop of it. A linear mask reads 0.5 exactly on its line, and its angle is a compass bearing: 0 covers the top, 90 the right. A radial mask is FULL inside its ellipse and fades outward, so the shape is what is affected rather than the middle of a ramp. Invert applies the layer everywhere the mask is not. On the picture, a linear mask is placed by its handles — the centre moves it, the knob on its middle line turns it, the bars on its two edge lines set the feather — and a radial one by its centre, its two half-axes, its feather ring and the knob above it."

    static let combineHint = "Combine a further mask with this one, the way Lightroom does. Add takes in the new shape as well (the larger of the two wherever they overlap, so a shape added to itself changes nothing); Subtract takes it out — a sky minus the mountain you paint over; Intersect keeps only where both are — the shadows, but only inside an ellipse. Parts apply in order, each one reading what the ones above it made, and each has its own invert. A subject is not offered as a part: a Subject layer can carry parts of its own, and “everything but the subject” is Except, below."

    var body: some View {
        let parts = layer.parts
        let open = editor.openPart
        let mask = componentMask(layer, open)
        let title = parts.isEmpty ? "Mask · \(describeMask(layer.mask))" : "Mask · \(parts.count + 1) combined"
        DevelopSection(id: "layer.mask", title: title, info: [Self.hint],
                       marked: layer.mask != nil || !parts.isEmpty || layer.except != nil) {
            if !parts.isEmpty {
                components(parts, open: open)
            }
            if let open, parts.indices.contains(open) {
                thisPart(parts[open], index: open)
            }
            kindGrid(open: open, current: mask?.kind)
            if let mask {
                MaskShapeControls(editor: editor, state: state, layer: layer, mask: mask)
                Toggle(isOn: Binding(get: { invert(open) }, set: { editor.maskSetInvert($0) })) {
                    Text(open == nil ? "invert — apply everywhere the mask is not" : "invert this part before it combines")
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.faint)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
            }
            DevelopRangeSlider("Opacity", value: layer.opacity, in: 0...1, step: 0.01, reset: 1,
                               printed: "\(Int((layer.opacity * 100).rounded())) %") { value in
                editor.writeOpenLayer { $0.opacity = Swift.min(1, Swift.max(0, value)) }
            }
            except
            if parts.count < maxMaskParts {
                combine
            }
        }
    }

    private func invert(_ open: Int?) -> Bool {
        guard let open, layer.parts.indices.contains(open) else { return layer.invert }
        return layer.parts[open].invert
    }

    // MARK: - the components

    /// The layer's own mask, then each part in the order it applies — a row
    /// opens it below, and is what the stage's Pick / Paint act on.
    private func components(_ parts: [MaskPart], open: Int?) -> some View {
        VStack(spacing: 4) {
            componentRow(nil, label: "\(layer.invert ? "not " : "")\(describeMask(layer.mask))", selected: open == nil)
            ForEach(parts.indices, id: \.self) { i in
                componentRow(i, label: describePart(parts[i]), selected: open == i)
            }
        }
    }

    private func componentRow(_ index: Int?, label: String, selected: Bool) -> some View {
        HStack(spacing: 6) {
            Button {
                editor.maskOpenPart(index)
            } label: {
                HStack(spacing: 0) {
                    if index == nil {
                        Text("mask · ").foregroundStyle(palette.faint)
                    }
                    Text(label).foregroundStyle(palette.ink)
                }
                .font(Brand.mono(11))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            if let index {
                Button {
                    editor.maskPartRemove(index)
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(palette.muted)
                .accessibilityLabel("Remove \(label)")
                .help("Remove this part")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(RoundedRectangle(cornerRadius: 8).fill(selected ? palette.paper2 : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? palette.accent : palette.line, lineWidth: 1))
    }

    /// The open part's own op — labelled *This part*, so it never reads as the Combine row's.
    private func thisPart(_ part: MaskPart, index: Int) -> some View {
        HStack(spacing: 8) {
            Text("This part")
                .font(Brand.mono(10))
                .foregroundStyle(palette.faint)
            Picker("How this part combines", selection: Binding(get: { part.op }, set: { editor.maskPartOp(index, $0) })) {
                ForEach(MaskOp.allCases, id: \.self) { op in
                    Text(opLabel(op)).tag(op)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    // MARK: - the kind

    /// Seven kinds do not fit one row at an inspector's width: a grid of pills,
    /// the web's `columns={4}` (3 for a part).
    private func kindGrid(open: Int?, current: MaskKind?) -> some View {
        let options = open == nil ? MaskKindOption.own : MaskKindOption.parts
        let count = open == nil ? 4 : 3
        let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: count)
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
            ForEach(options) { option in
                Button(option.label) {
                    // Switching kinds STARTS the new shape fresh: a radius is
                    // not an angle, and a half-translated shape is worse than
                    // an obvious default.
                    if option.kind != current { editor.maskSetKind(option.kind) }
                }
                .buttonStyle(DevelopPillButtonStyle(on: option.kind == current))
                .accessibilityAddTraits(option.kind == current ? .isSelected : [])
            }
        }
    }

    // MARK: - except

    /// The subjects this layer may SUBTRACT — offered only where one exists: a
    /// control with nothing to choose is a question nobody can answer.
    @ViewBuilder
    private var except: some View {
        let cuts = exceptCandidates(editor.layerList, layer.id)
        if !cuts.isEmpty {
            let chosen = layer.except.flatMap { id in cuts.contains { $0.id == id } ? id : nil } ?? "none"
            VStack(alignment: .leading, spacing: 4) {
                Picker("Except", selection: Binding(get: { chosen },
                                                     set: { editor.maskSetExcept($0 == "none" ? nil : $0) })) {
                    Text("Nothing").tag("none")
                    ForEach(cuts, id: \.id) { cut in
                        Text(cuts.count == 1 ? "The subject" : layerLabel(cut, editor.layerList)).tag(cut.id)
                    }
                }
                .pickerStyle(.menu)
                Text(layer.except != nil
                     ? "except — the subject is taken out of this layer, so its own layer alone decides it"
                     : "except — take a subject out of this layer: darken everything but the person")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - combine

    private var combine: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Combine")
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(palette.ink)
                CombineInfo()
            }
            Picker("How the next mask combines", selection: Binding(get: { state.nextOp }, set: { state.nextOp = $0 })) {
                ForEach(MaskOp.allCases, id: \.self) { op in
                    Text(opLabel(op)).tag(op)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(MaskKindOption.parts) { option in
                    Button("\(opGlyph(state.nextOp)) \(option.label)") {
                        if let kind = option.kind { editor.maskPartAdd(kind) }
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                }
            }
        }
        .padding(.top, 4)
    }
}

/// The Combine row's ⓘ and its note.
private struct CombineInfo: View {
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DevelopInfoDot(about: "combining masks", isOpen: $open)
            if open {
                DevelopNote(paragraphs: [MaskSection.combineHint])
            }
        }
    }
}

// MARK: - one mask's own controls

/// One mask's own controls — the same whether it is a layer's mask or a part.
struct MaskShapeControls: View {
    @Bindable var editor: RollEditor
    let state: LayerEditState
    let layer: AdjustLayer
    let mask: Mask
    @Environment(\.palette) private var palette

    static let paintHint = "With Paint on, a drag across the picture lays a stroke — a finger, the Pencil or the pointer; the before/after wipe waits until it is off. Erase takes coverage away, and only from what is already there — a stroke painted after an eraser comes back, because strokes apply in the order they were made. Size and Softness are set before a stroke, not after: each stroke keeps the ones it was painted with, which is what lets a soft edge and a hard one live in the same mask."

    static let subjectHint = "A model finds the subject you tap. Turn Pick on and tap the thing you mean — a person, a car, a dog — and tap again anywhere else to add to it, which is how you take in someone AND their bag. Tapping a marker you already placed removes it. It is the whole subject the model returns, not a region you drew, so it follows an edge better than a brush and understands nothing about why you chose it: if it takes in too much, remove the point and tap somewhere more specific, or fall back to painting. “Background” is this mask inverted — the switch below. Here the model is Apple’s own, on the device: it finds the salient subjects of a picture, so a point on the sky or the ground picks nothing."

    static let colourHint = "Turn Pick on and tap a colour on the picture: every pixel near that colour is in the mask, wherever it is — a sky’s blue, a jacket, the green of a hillside. Tap again elsewhere to add up to five colours; tap a marker to remove it. The colour is taken from the picture as THIS layer sees it — the develop, the look and the layers below, not this layer’s own change nor anything above it — and stored, so the mask does not move when a slider does. Refine widens or narrows how far a colour may stray and still be in; lightness counts half as much as hue, so a sampled blue takes in the sky’s lighter and darker blues but not a grey of the same brightness."

    static let lumaHint = "A band of brightness, wherever it falls in the frame — the shadows alone, the highlights alone. From and To are the band that is fully in; Feather is how far past each end it fades out. Pick puts the band on the tone you tap, keeping its width; the tone under the pointer and how much of it is in are said on the picture."

    var body: some View {
        switch mask {
        case .linear(let m): linear(m)
        case .radial(let m): radial(m)
        case .luma(let m): luma(m)
        case .brush(let m): brush(m)
        case .subject(let m): subject(m)
        case .colour(let m): colour(m)
        }
    }

    // MARK: gradients

    private func percent(_ v: Double) -> String { "\(Int((v * 100).rounded())) %" }
    private func degrees(_ v: Double) -> String { "\(Int(v.rounded()))°" }
    private func fixed(_ v: Double) -> String { String(format: "%.2f", v) }

    @ViewBuilder
    private func linear(_ m: LinearMask) -> some View {
        DevelopRangeSlider("Across", value: m.x, in: 0...1, step: 0.01, reset: 0.5, printed: percent(m.x)) { v in
            var n = m; n.x = v; editor.writeOpenMask(.linear(n))
        }
        DevelopRangeSlider("Down", value: m.y, in: 0...1, step: 0.01, reset: 0.4, printed: percent(m.y)) { v in
            var n = m; n.y = v; editor.writeOpenMask(.linear(n))
        }
        DevelopRangeSlider("Angle", value: m.angle, in: -180...180, step: 1, reset: 0, printed: degrees(m.angle)) { v in
            var n = m; n.angle = v; editor.writeOpenMask(.linear(n))
        }
        DevelopRangeSlider("Feather", value: m.feather, in: 0...1.5, step: 0.01, reset: 0.35, printed: fixed(m.feather)) { v in
            var n = m; n.feather = v; editor.writeOpenMask(.linear(n))
        }
        stageLine("on the picture: drag the centre to move it, the knob to turn it, an edge bar to set the feather")
    }

    @ViewBuilder
    private func radial(_ m: RadialMask) -> some View {
        DevelopRangeSlider("Across", value: m.x, in: 0...1, step: 0.01, reset: 0.5, printed: percent(m.x)) { v in
            var n = m; n.x = v; editor.writeOpenMask(.radial(n))
        }
        DevelopRangeSlider("Down", value: m.y, in: 0...1, step: 0.01, reset: 0.5, printed: percent(m.y)) { v in
            var n = m; n.y = v; editor.writeOpenMask(.radial(n))
        }
        DevelopRangeSlider("Width", value: m.radiusX, in: 0.02...1.5, step: 0.01, reset: 0.4, printed: fixed(m.radiusX)) { v in
            var n = m; n.radiusX = v; editor.writeOpenMask(.radial(n))
        }
        DevelopRangeSlider("Height", value: m.radiusY, in: 0.02...1.5, step: 0.01, reset: 0.4, printed: fixed(m.radiusY)) { v in
            var n = m; n.radiusY = v; editor.writeOpenMask(.radial(n))
        }
        DevelopRangeSlider("Turn", value: m.angle, in: -180...180, step: 1, reset: 0, printed: degrees(m.angle)) { v in
            var n = m; n.angle = v; editor.writeOpenMask(.radial(n))
        }
        DevelopRangeSlider("Feather", value: m.feather, in: 0...1.5, step: 0.01, reset: 0.3, printed: fixed(m.feather)) { v in
            var n = m; n.feather = v; editor.writeOpenMask(.radial(n))
        }
        stageLine("on the picture: the centre moves it, the side handles size it, the dashed ring is the feather, the knob turns it")
    }

    @ViewBuilder
    private func luma(_ m: LumaMask) -> some View {
        pickRow(hint: Self.lumaHint, clear: nil)
        DevelopRangeSlider("From", value: m.from, in: 0...1, step: 0.01, reset: 0, printed: fixed(m.from)) { v in
            var n = m; n.from = Swift.min(v, m.to); editor.writeOpenMask(.luma(n))
        }
        DevelopRangeSlider("To", value: m.to, in: 0...1, step: 0.01, reset: 0.35, printed: fixed(m.to)) { v in
            var n = m; n.to = Swift.max(v, m.from); editor.writeOpenMask(.luma(n))
        }
        DevelopRangeSlider("Feather", value: m.feather, in: 0...1, step: 0.01, reset: 0.15, printed: fixed(m.feather)) { v in
            var n = m; n.feather = v; editor.writeOpenMask(.luma(n))
        }
        if state.painting {
            stageLine("tap a tone on the picture to put the band on it")
        }
    }

    // MARK: painted

    @ViewBuilder
    private func brush(_ m: BrushMask) -> some View {
        legend("Painting", Self.paintHint)
        HStack(spacing: 6) {
            Button(state.painting ? "Painting" : "Paint") { editor.layersSetPainting(!state.painting) }
                .buttonStyle(DevelopPillButtonStyle(on: state.painting))
                .help("Paint on the picture — P")
            Button("Erase") { editor.layersSetBrush { $0.erase.toggle() } }
                .buttonStyle(DevelopPillButtonStyle(on: state.brush.erase))
                .help("The next strokes take coverage away")
            Spacer(minLength: 4)
            Button("Undo stroke") { editor.writeOpenMask(.brush(withoutLastStroke(m))) }
                .buttonStyle(DevelopLinkButtonStyle())
                .disabled(m.strokes.isEmpty)
            Button("Clear") { editor.writeOpenMask(.brush(BrushMask())) }
                .buttonStyle(DevelopLinkButtonStyle())
                .disabled(m.strokes.isEmpty)
        }
        DevelopRangeSlider("Size", value: state.brush.radius, in: brushRadiusLimits.min...brushRadiusLimits.max,
                           step: 0.005, reset: defaultBrushRadius, printed: percent(state.brush.radius)) { v in
            editor.layersSetBrush { $0.radius = v }
        }
        DevelopRangeSlider("Softness", value: 1 - state.brush.hardness, in: 0...1, step: 0.01,
                           reset: 1 - defaultBrushHardness, printed: percent(1 - state.brush.hardness)) { v in
            editor.layersSetBrush { $0.hardness = 1 - v }
        }
        if m.strokes.isEmpty {
            stageLine("nothing painted yet — an empty painted mask covers nothing, so the layer does nothing")
        }
    }

    // MARK: picked

    @ViewBuilder
    private func subject(_ m: SubjectMask) -> some View {
        let clear: (() -> Void)? = m.points.isEmpty ? nil : {
            editor.writeOpenMask(.subject(SubjectMask(points: [], model: m.model)))
        }
        legend("Subject", Self.subjectHint)
        pickRow(hint: nil, clear: clear)
        Text(editor.subjectStatus(layer, m))
            .font(Brand.mono(10))
            .foregroundStyle(editor.layerState.subjectUnavailable != nil ? palette.warn : palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func colour(_ m: ColourMask) -> some View {
        legend("Colour range", Self.colourHint)
        HStack(spacing: 6) {
            pickButton
            ForEach(m.samples.indices, id: \.self) { i in
                let s = m.samples[i]
                Button {
                    editor.maskUnmark(i)
                } label: {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color(.sRGB, red: s.r, green: s.g, blue: s.b, opacity: 1))
                        .frame(width: 20, height: 20)
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(palette.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove colour \(i + 1)")
                .help("Remove this colour")
            }
            Spacer(minLength: 4)
            Button("Clear") { editor.writeOpenMask(.colour(ColourMask(samples: [], range: m.range))) }
                .buttonStyle(DevelopLinkButtonStyle())
                .disabled(m.samples.isEmpty)
        }
        DevelopRangeSlider("Refine", value: m.range, in: 0...1, step: 0.01, reset: defaultColourRange,
                           printed: "\(Int((m.range * 100).rounded()))") { v in
            var n = m; n.range = v; editor.writeOpenMask(.colour(n))
        }
        stageLine(colourLine(m))
    }

    private func colourLine(_ m: ColourMask) -> String {
        let n = m.samples.count
        if n == 0 { return "tap a colour on the picture — an empty range covers nothing, so the layer does nothing" }
        if n >= maxColourSamples { return "\(maxColourSamples) colours is the most one range holds · tap a marker to remove one" }
        return "\(n) colour\(n == 1 ? "" : "s") · tap another to add it, a marker to remove it"
    }

    // MARK: pieces

    private var pickButton: some View {
        Button(state.painting ? "Picking" : "Pick") { editor.layersSetPainting(!state.painting) }
            .buttonStyle(DevelopPillButtonStyle(on: state.painting))
            .help("Pick on the picture — P")
    }

    private func pickRow(hint: String?, clear: (() -> Void)?) -> some View {
        HStack(spacing: 6) {
            pickButton
            if let hint {
                LegendInfo(about: "the brightness band", text: hint)
            }
            Spacer(minLength: 4)
            if let clear {
                Button("Clear", action: clear)
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    private func legend(_ title: String, _ hint: String) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(palette.ink)
            LegendInfo(about: title.lowercased(), text: hint)
        }
    }

    private func stageLine(_ text: String) -> some View {
        Text(text)
            .font(Brand.mono(10))
            .foregroundStyle(palette.faint)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// An ⓘ with its note under it — a legend's standing prose.
private struct LegendInfo: View {
    let about: String
    let text: String
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            DevelopInfoDot(about: about, isOpen: $open)
            if open {
                DevelopNote(paragraphs: [text])
            }
        }
    }
}

// MARK: - previews

#Preview("Mask · combined, except the subject") {
    let editor = LayersPreviewFixture.editor(open: "rest")
    return ScrollView {
        if let layer = editor.openLayer {
            MaskSection(editor: editor, state: editor.layerState, layer: layer)
                .padding(14)
        }
    }
    .frame(minWidth: 340, minHeight: 640)
    .background(Palette.darkroom.surface)
    .darkroom()
}

#Preview("Mask · subject") {
    let editor = LayersPreviewFixture.editor(open: "person")
    return ScrollView {
        if let layer = editor.openLayer {
            MaskSection(editor: editor, state: editor.layerState, layer: layer)
                .padding(14)
        }
    }
    .frame(minWidth: 340, minHeight: 520)
    .background(Palette.darkroom.surface)
    .darkroom()
}
