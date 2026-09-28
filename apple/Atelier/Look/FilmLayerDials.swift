// The dials of ONE film layer — its stock, the emulsion's own numbers, and the
// three characteristic curves behind an R/G/B picker. The web's
// `FilmDials.tsx`: a column has no room for eighteen curve sliders at once,
// and per-channel editing IS the crossover, so the picker is the control, not
// a hiding place. `All` writes one value onto the three curves and shows the
// red one's.
//
// Every change goes out as WHOLE settings: the host writes them into the
// layer (`RollGrade.settingFilm`), whose name then says whether it is still on
// its stock, and the cube is regenerated from them — cached by settings, so a
// strength drag never re-runs the emulsion (`FilmLayer.swift`). Nothing here
// knows about the stack.

import SwiftUI
import AtelierKit

struct FilmLayerDials: View {
    let settings: FilmSettings
    let onChange: (FilmSettings) -> Void
    @State private var channel: Channel = .all
    @Environment(\.palette) private var palette

    enum Channel: String, CaseIterable, Identifiable {
        case all = "All", r = "R", g = "G", b = "B"
        var id: String { rawValue }
    }

    private var stock: FilmStock? { filmStock(settings.stock) }
    private var r: FilmResponse { settings.response }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            stockRow
            if !onStock(settings), let stock {
                HStack(spacing: 8) {
                    Text("Adjusted from \(stock.name).")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                    Spacer(minLength: 6)
                    Button("Back to stock") { onChange(filmSettingsFor(stock.id)) }
                        .buttonStyle(DevelopPillButtonStyle())
                        .help("Put the stock’s own numbers back")
                }
            }
            responseSlider("Coupling", responseRanges.coupling, r.coupling, printed: "\(Int(r.coupling.rounded()))%",
                           hint: "How much each dye layer also sees its neighbours’ light: hue shifts, a little less purity.") {
                $0.coupling = $1
            }
            responseSlider("Rolloff", responseRanges.inhibition, r.inhibition, printed: "\(Int(r.inhibition.rounded()))%",
                           hint: "Coupler inhibition: a saturated colour melts toward neutral instead of clipping to a flat patch.") {
                $0.inhibition = $1
            }
            responseSlider("Dye", responseRanges.dye, r.dye, printed: signed(r.dye)) { $0.dye = $1 }
            printRow
            if r.print {
                responseSlider("Paper grade", responseRanges.paperGrade, r.paperGrade,
                               printed: String(format: "%.1f", r.paperGrade), reset: 2) { $0.paperGrade = $1 }
            }
            curvesRow
            ForEach(FilmLayerDials.curveDials, id: \.key) { dial in
                let range = curveRanges[dial.key] ?? FilmRange(min: 0, max: 1, step: 0.01)
                DevelopRangeSlider("\(dial.label) (\(channel == .all ? "all channels" : channel.rawValue))",
                                   value: shown[dial.key], in: range.min...range.max, step: range.step,
                                   reset: neutralCurve[dial.key], printed: dial.format(shown[dial.key])) { value in
                    patchCurve(dial.key, value)
                }
            }
        }
    }

    // MARK: - the stock

    private var stockRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Stock")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Picker("Film stock", selection: Binding(get: { settings.stock }, set: { id in
                    if let known = FilmStockId(rawValue: id) { onChange(filmSettingsFor(known)) }
                })) {
                    ForEach(filmStocks, id: \.id) { s in
                        Text(s.name).tag(s.id.rawValue)
                    }
                    if stock == nil {
                        Text("A stock this build no longer knows").tag(settings.stock)
                    }
                }
                .labelsHidden()
                .fixedSize()
            }
            if let note = stock?.note {
                Text(note)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var printRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            Toggle(isOn: Binding(get: { r.print }, set: { on in patch { $0.print = on } })) {
                HStack {
                    Text("Print")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.ink)
                    Spacer(minLength: 8)
                    Text(r.print ? "Negative, printed" : "Reversal")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.inkSoft)
                }
            }
            .tint(palette.accent)
            Text(r.print
                 ? "A negative printed on paper: the paper sets the final contrast and clips the whites clean."
                 : "A reversal: the film is the positive, its own shoulder decides the whites.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var curvesRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Curves")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Picker("Curve channel", selection: $channel) {
                    ForEach(Channel.allCases) { c in Text(c.rawValue).tag(c) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 200)
            }
            Text(r.mono != nil
                 ? "One layer: the three curves are the same curve."
                 : "Per channel is the crossover: a lower blue contrast cools the shadows and warms the highlights.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - writing

    private func responseSlider(_ label: String, _ range: FilmRange, _ value: Double, printed: String,
                                reset: Double = 0, hint: String? = nil,
                                write: @escaping (inout FilmResponse, Double) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            DevelopRangeSlider(label, value: value, in: range.min...range.max, step: range.step, reset: reset,
                               printed: printed) { next in
                patch { write(&$0, next) }
            }
            if let hint {
                Text(hint)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func patch(_ change: (inout FilmResponse) -> Void) {
        var next = settings
        change(&next.response)
        onChange(next)
    }

    /// The curve the dials show: the red one under `All`.
    private var shown: FilmCurve {
        switch channel {
        case .all, .r: return r.curve.r
        case .g: return r.curve.g
        case .b: return r.curve.b
        }
    }

    private func patchCurve(_ key: FilmCurveKey, _ value: Double) {
        patch { response in
            switch channel {
            case .all:
                response.curve.r[key] = value
                response.curve.g[key] = value
                response.curve.b[key] = value
            case .r: response.curve.r[key] = value
            case .g: response.curve.g[key] = value
            case .b: response.curve.b[key] = value
            }
        }
    }

    // MARK: - the six curve dials, in the web's words

    struct CurveDial {
        let key: FilmCurveKey
        let label: String
        let format: (Double) -> String
    }

    static let curveDials: [CurveDial] = [
        CurveDial(key: .speed, label: "Speed", format: { v in
            FilmLayerDials.trimZeros(signed(v, digits: 2)) + " EV"
        }),
        CurveDial(key: .gamma, label: "Contrast", format: { "γ \(String(format: "%.2f", $0))" }),
        CurveDial(key: .toe, label: "Toe", format: { "\(String(format: "%.2f", $0)) EV" }),
        CurveDial(key: .shoulder, label: "Shoulder", format: { "\(String(format: "%.2f", $0)) EV" }),
        CurveDial(key: .black, label: "Black", format: { "−\(String(format: "%.1f", $0)) EV" }),
        CurveDial(key: .white, label: "White", format: { "+\(String(format: "%.1f", $0)) EV" }),
    ]

    /// `+0.50` → `+0.5`, `+1.00` → `+1` — the web's `.replace(/\.?0+$/, '')`.
    static func trimZeros(_ text: String) -> String {
        guard text.contains(".") else { return text }
        var out = text
        while out.hasSuffix("0") { out.removeLast() }
        if out.hasSuffix(".") { out.removeLast() }
        return out
    }
}

#Preview("Film layer") {
    DevelopPreviewState(filmSettingsFor(.negativePortrait)) { settings in
        FilmLayerDials(settings: settings.wrappedValue) { settings.wrappedValue = $0 }
    }
}
