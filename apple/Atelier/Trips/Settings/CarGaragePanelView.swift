// The garage: the trip's car on its turntable, and every choice about it —
// port of `src/tools/roadtrip/CarGaragePanel.tsx`.
//
// Rules kept (`roadtrip.md`, «The car is the TRIP's», (5)):
// - ONE controlled panel with TWO homes (the web's `CoverPanel` rule): ⚙ Trip's
//   Car pane, which writes the trip on every switch, and `CarGarageSheet`, the
//   sheet the Virée opener opens from a piece, which holds a DRAFT and writes
//   it on Done. One panel, so the two can never drift.
// - The model is a menu over the registry (`carModels`; one car today, a
//   second is a registry line). The colour is a row of named swatches — the
//   J120's factory range and the maintainer's own two — plus a custom well; a
//   preset that is a COATING (Raptor) sets the finish with it, and the finish
//   stays a choice of its own after that.
// - The gear is switches grouped by where it sits; a fitting that needs
//   another (the spot lights the bar, the roof load the basket) is listed only
//   while that one is on — its flag stays STORED, so turning the basket back on
//   brings the load back (`effectiveGear` is what the drawing reads).
// - It lays itself out by its OWN width (the web's container query at 44rem):
//   past 704 points the car sits in one column and the choices scroll in the
//   other, so a switch flipped far down the list is seen on the car at once;
//   narrower, it stacks and scrolls as one.

import SwiftUI
import AtelierKit

struct CarGaragePanelView<Header: View>: View {
    let value: CarSpec
    let onChange: (CarSpec) -> Void
    private let header: Header
    @Environment(\.palette) private var palette

    init(value: CarSpec, onChange: @escaping (CarSpec) -> Void, @ViewBuilder header: () -> Header) {
        self.value = value
        self.onChange = onChange
        self.header = header()
    }

    var body: some View {
        GeometryReader { geo in
            if geo.size.width >= GarageLayout.split {
                wide(geo.size)
            } else {
                narrow(geo.size)
            }
        }
    }

    // MARK: - the two layouts

    private func wide(_ size: CGSize) -> some View {
        let choicesWidth = max(GarageLayout.choicesMin, (size.width - GarageLayout.gap) / 2.2)
        return VStack(alignment: .leading, spacing: 16) {
            header
            HStack(alignment: .top, spacing: GarageLayout.gap) {
                VStack(alignment: .leading, spacing: 12) {
                    CarTurntableView(spec: value)
                        .frame(minHeight: 256)
                        .frame(maxHeight: .infinity)
                    describe
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                ScrollView {
                    choices
                        .padding(.trailing, 8)
                        .padding(.bottom, 4)
                }
                .frame(width: choicesWidth)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func narrow(_ size: CGSize) -> some View {
        let stage = min(320, max(220, size.height * 0.4))
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                CarTurntableView(spec: value)
                    .frame(height: stage)
                describe
                choices
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: size.width, height: size.height)
    }

    private var describe: some View {
        Text(verbatim: describeCar(value, carModel(value.model).name))
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - the choices

    private var choices: some View {
        let model = carModel(value.model)
        let isDefault = sameCarSpec(value, defaultCarSpec())
        return VStack(alignment: .leading, spacing: 16) {
            OverlayPanelRow("Model", hint: model.series) {
                OverlayPanelMenu("Car model", selection: value.model,
                                 options: carModels.map { OverlayPanelOption($0.id, $0.name) }) { id in
                    patch { $0.model = id }
                }
            }
            OverlayPanelRow("Colour", hint: colourHint, alignTop: true) {
                swatches
            }
            OverlayPanelRow("Finish", hint: GarageLayout.finishHint(value.finish)) {
                Picker("Finish", selection: Binding(get: { value.finish }, set: { finish in patch { $0.finish = finish } })) {
                    Text("Gloss").tag(CarFinish.gloss)
                    Text("Matte").tag(CarFinish.matte)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .fixedSize()
            }
            ForEach(garageGearGroups, id: \.title) { group in
                gearGroup(group)
            }
            VStack(alignment: .leading, spacing: 0) {
                Hairline()
                Button("Back to the default car") { onChange(defaultCarSpec()) }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .disabled(isDefault)
                    .help("The Prado as it was photographed: Raptor black, matte, everything fitted")
                    .padding(.top, 12)
            }
        }
    }

    /// The preset the colour is, its note lower-cased after a dash; or "your own".
    private var colourHint: String {
        guard let preset = carColours.first(where: { $0.hex == value.color.lowercased() }) else {
            return "A colour of your own."
        }
        guard let note = preset.note, let first = note.first else { return preset.name }
        return "\(preset.name) — \(first.lowercased())\(note.dropFirst())"
    }

    private var swatches: some View {
        let current = value.color.lowercased()
        return PresetChipFlow(spacing: 6) {
            ForEach(carColours, id: \.id) { colour in
                swatch(colour, on: colour.hex == current)
            }
            OverlayPanelColourWell("A custom colour", css: value.color) { hex in
                patch { $0.color = hex.lowercased() }
            }
            .help("A colour of your own")
        }
        .sensoryFeedback(.selection, trigger: current)
    }

    private func swatch(_ colour: CarColour, on: Bool) -> some View {
        Button {
            patch { spec in
                spec.color = colour.hex
                if let finish = colour.finish { spec.finish = finish }
            }
        } label: {
            Circle()
                .fill(Color(cgColor: CSSColor.parse(colour.hex, or: CSSColor.black)))
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(on ? palette.accent : palette.lineStrong, lineWidth: 2))
                .overlay {
                    if on { Circle().inset(by: 2).strokeBorder(palette.surface, lineWidth: 2) }
                }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(colour.note.map { "\(colour.name) — \($0)" } ?? colour.name)
        .accessibilityLabel(colour.name)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func gearGroup(_ group: GarageGearGroup) -> some View {
        let rows = group.rows.filter { row in row.needs.map { value.gear[$0] } ?? true }
        return VStack(alignment: .leading, spacing: 10) {
            Hairline()
            Eyebrow(group.title)
            ForEach(rows, id: \.key) { row in
                OverlayPanelSwitch(GarageLayout.capitalised(row.key.label), isOn: value.gear[row.key],
                                   hint: row.hint) { on in
                    patch { $0.gear[row.key] = on }
                }
            }
        }
    }

    private func patch(_ change: (inout CarSpec) -> Void) {
        var next = value
        change(&next)
        onChange(next)
    }
}

extension CarGaragePanelView where Header == EmptyView {
    init(value: CarSpec, onChange: @escaping (CarSpec) -> Void) {
        self.init(value: value, onChange: onChange) { EmptyView() }
    }
}

// MARK: - the garage's constants (at file scope: a generic view holds no statics)

private enum GarageLayout {
    /// The web's `@min-[44rem]`: past it the car and the choices sit side by side.
    static let split: CGFloat = 704
    /// The choices column's floor, the web's `minmax(19rem, 1fr)`.
    static let choicesMin: CGFloat = 304
    static let gap: CGFloat = 24

    static func finishHint(_ finish: CarFinish) -> String {
        switch finish {
        case .gloss: return "Factory paint: a highlight where the light strikes."
        case .matte: return "A textured coating: no highlight, a broad sheen instead."
        }
    }

    /// A sentence's first letter up: the labels are lower-case for the describing line.
    static func capitalised(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }
}

/// A row of the gear: its switch, the fitting it needs, a word about it.
private struct GarageGearRow {
    let key: CarGearKey
    var needs: CarGearKey? = nil
    var hint: String? = nil
}

private struct GarageGearGroup {
    let title: String
    let rows: [GarageGearRow]
}

/// The gear, grouped where it sits on the car — the web's `GEAR_GROUPS`.
private let garageGearGroups: [GarageGearGroup] = [
    GarageGearGroup(title: "Front", rows: [
        GarageGearRow(key: .bullBar, hint: "The tubular bar around the headlights."),
        GarageGearRow(key: .spotLights, needs: .bullBar, hint: "Two round lights on the bar."),
    ]),
    GarageGearGroup(title: "Roof", rows: [
        GarageGearRow(key: .rack, hint: "The basket the load rides in."),
        GarageGearRow(key: .solar, needs: .rack, hint: "On the left of the basket."),
        GarageGearRow(key: .box, needs: .rack, hint: "The aluminium box, front right."),
        GarageGearRow(key: .jerryCans, needs: .rack, hint: "Three across the rear: water, petrol, water."),
        GarageGearRow(key: .awning, needs: .rack, hint: "Along the basket’s left side."),
    ]),
    GarageGearGroup(title: "Body", rows: [
        GarageGearRow(key: .mudFlaps),
        GarageGearRow(key: .visors, hint: "The tinted visors over the door windows."),
        GarageGearRow(key: .spare, hint: "On the tailgate."),
        GarageGearRow(key: .mirrors),
    ]),
]

// MARK: - previews

private struct CarGaragePreview: View {
    @State private var car = defaultCarSpec()

    var body: some View {
        CarGaragePanelView(value: car, onChange: { car = $0 })
            .padding(24)
            .background(Palette.paper.surface)
    }
}

#Preview("Garage — side by side") {
    CarGaragePreview().frame(width: 960, height: 640)
}

#Preview("Garage — stacked") {
    CarGaragePreview().frame(width: 390, height: 760)
}
