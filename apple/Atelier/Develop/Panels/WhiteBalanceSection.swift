// White balance in KELVIN, on a RAW — port of
// `src/tools/develop/WhiteBalancePanel.tsx` over the kernel's
// `Raw/WhiteBalance.swift`.
//
// Drawn only on a develop that stands on the SENSOR (`isRawDevelop`): a
// finished JPEG has no as-shot white to move from, so on a render the
// Colour group's Temperature and Tint — relative gains — are the whole of it,
// and this section draws nothing (the web's own condition). On the sensor it
// is Lightroom's: presets, a temperature walked on a LOG scale (2000 → 50000 K
// over 1000 steps), a tint, and As shot for none; every value is turned into
// the multipliers the camera would have used under that light, through its
// own matrix (`wbMatrix`), and stored as `rawWb` with that matrix so the
// export applies exactly what the stage did.
//
// The camera's white (`RawWhite`) comes from the decoder. The app's decoder
// (`CIRAWFilter`) does not hand it out yet (`Raw/WhiteBalance.swift`'s note),
// so where the host has none the section SAYS so rather than drawing
// sliders that could not mean anything — and a `rawWb` written on another
// device is named and can be taken off.

import SwiftUI
import AtelierKit

struct WhiteBalanceSection: View {
    @Binding var settings: DevelopSettings
    let white: RawWhite?
    @Environment(\.palette) private var palette

    /// - Parameter white: what the decoder read of the camera's white, or nil when it has not.
    init(settings: Binding<DevelopSettings>, white: RawWhite?) {
        self._settings = settings
        self.white = white
    }

    /// The stored white balance — the carried `rawWb` record, read as the web reads it.
    private var value: RawWhiteBalance? {
        rawWhiteBalanceOrNull(settings.carried["rawWb"])
    }

    private func store(_ next: RawWhiteBalance?) {
        var d = settings
        d.carried["rawWb"] = next?.json
        settings = d
    }

    var body: some View {
        if isRawDevelop(settings) {
            if let white, let shot = asShotTempTint(white) {
                panel(white: white, shot: shot)
            } else {
                unread
            }
        }
    }

    // MARK: - on the sensor, with the camera's white

    private func panel(white: RawWhite, shot: TempTint) -> some View {
        let stored = value
        let kelvin = stored?.kelvin ?? shot.kelvin
        let tint = stored?.tint ?? shot.tint
        let shotStep = Self.toStep(shot.kelvin)
        let set: (Double, Double) -> Void = { k, t in
            if let matrix = wbMatrix(white, k, t) {
                store(RawWhiteBalance(kelvin: k, tint: t, matrix: matrix))
            }
        }
        return DevelopSection(id: "white-balance", title: "White balance", info: [Self.hint], marked: stored != nil) {
            HStack(spacing: 8) {
                Text("Preset")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Picker("Preset", selection: Binding(
                    get: { Self.presetId(stored) },
                    set: { id in
                        if id == "shot" {
                            store(nil)
                        } else if let p = wbPresets.first(where: { $0.id == id }) {
                            set(p.kelvin, p.tint)
                        }
                    }
                )) {
                    Text("As shot").tag("shot")
                    ForEach(wbPresets, id: \.id) { p in
                        Text("\(p.label) · \(DevelopNumbers.plain(p.kelvin)) K").tag(p.id)
                    }
                    if Self.presetId(stored) == "custom" {
                        Text("Custom").tag("custom")
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
            }
            DevelopRangeSlider("Temperature", value: Double(Self.toStep(kelvin)), in: 0...Double(Self.steps), step: 1,
                               reset: Double(shotStep),
                               printed: "\(Int(DevelopNumbers.jsRound(kelvin))) K") { step in
                if Int(step) == shotStep && (stored?.tint ?? 0) == 0 {
                    store(nil)
                } else {
                    set(Self.toKelvin(Int(step)), tint)
                }
            }
            DevelopRangeSlider("Tint", value: DevelopNumbers.jsRound(tint), in: tintRange.min...tintRange.max, step: 1,
                               reset: DevelopNumbers.jsRound(shot.tint)) { t in
                set(kelvin, t)
            }
            HStack(spacing: 8) {
                Text("as shot \(describeWhiteBalance(RawWhiteBalance(kelvin: shot.kelvin, tint: shot.tint, matrix: [])))")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if stored != nil {
                    Button("As shot") { store(nil) }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
    }

    // MARK: - on the sensor, with no white to read

    private var unread: some View {
        let stored = value
        return DevelopSection(id: "white-balance", title: "White balance", info: [Self.hint], marked: stored != nil) {
            UnreadWhite(stored: stored) { store(nil) }
        }
    }

    // MARK: - the scale

    /// The slider walks the range on a LOG scale, as Lightroom's does.
    static let steps = 1000
    private static let logSpan = log(kelvinRange.max / kelvinRange.min)

    static func toStep(_ kelvin: Double) -> Int {
        Int(DevelopNumbers.jsRound((log(kelvin / kelvinRange.min) / logSpan) * Double(steps)))
    }

    static func toKelvin(_ step: Int) -> Double {
        DevelopNumbers.jsRound(kelvinRange.min * exp((Double(step) / Double(steps)) * logSpan))
    }

    /// Which preset the stored value is: `shot` for none, a preset's id, else `custom`.
    private static func presetId(_ stored: RawWhiteBalance?) -> String {
        guard let stored else { return "shot" }
        let k = DevelopNumbers.jsRound(stored.kelvin)
        let t = DevelopNumbers.jsRound(stored.tint)
        return wbPresets.first { $0.kelvin == k && $0.tint == t }?.id ?? "custom"
    }

    static let hint = "On a RAW, white balance is a temperature in kelvin and a tint, as in Lightroom — the light the picture was lit by. Lower is bluer, higher warmer; tint above zero adds magenta, below adds green. The camera’s own reading is As shot, and every value is turned into the multipliers the camera would have used under that light, through its own matrix. The Temperature and Tint sliders further down still work on top, as a relative nudge."
}

/// What the section says when the decoder has not read the camera's white.
private struct UnreadWhite: View {
    let stored: RawWhiteBalance?
    let onAsShot: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Text("The camera’s own white is not read on this device yet, so a temperature in kelvin cannot be turned into its multipliers here. The Temperature and Tint sliders below still nudge the picture.")
            .font(Brand.sans(12))
            .foregroundStyle(palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        if let stored {
            HStack(spacing: 8) {
                Text("stored \(describeWhiteBalance(stored)) — not rendered here yet")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.faint)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button("As shot", action: onAsShot)
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }
}

#Preview("White balance · RAW") {
    DevelopPreviewState(DevelopPanelFixtures.rawDevelop) { settings in
        WhiteBalanceSection(settings: settings, white: DevelopPanelFixtures.white)
        WhiteBalanceSection(settings: settings, white: nil)
    }
}
