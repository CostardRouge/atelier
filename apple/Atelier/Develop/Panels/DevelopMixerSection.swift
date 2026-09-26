// The colour mixer — Lightroom's HSL panel — and black and white with its
// channel mixer. Port of `src/shared/develop/DevelopMixer.tsx`.
//
// One channel at a time — Hue, Saturation or Luminance — over the eight
// bands, the way Lightroom and Capture One both lay it out, because the eight
// sliders of ONE channel are what is compared. A channel with anything in it
// is marked in the switch, so a move made under another tab is never hidden.
//
// Lightroom's Treatment sits at the head of the one section it changes: in
// black and white the same eight bands become eight LIGHTS in grey
// (`MonoMix`), the colour mixer kept, not applied, and found again with
// Colour. The records and their rules are the kernel's (`Develop/Mixer.swift`:
// `withMixerValue`, `withoutMixerChannel`, `withMonoValue`, `straightMono`).

import SwiftUI
import AtelierKit

struct DevelopMixerSection: View {
    @Binding var settings: DevelopSettings
    @State private var channel: MixerChannel = .hue

    init(settings: Binding<DevelopSettings>) {
        self._settings = settings
    }

    var body: some View {
        if let mono = settings.mono {
            monoBody(mono)
        } else {
            colourBody
        }
    }

    // MARK: - black and white

    private func monoBody(_ mono: MonoMix) -> some View {
        let mixed = mono.mix.contains { $0 != 0 }
        return DevelopSection(id: "mixer", title: "B&W mix", info: [Self.monoHint], marked: true, defaultOpen: false) {
            treatment
            ForEach(MixerBand.allCases, id: \.self) { band in
                DevelopRangeSlider(band.label, value: Self.value(mono.mix, band), in: -100...100, step: 1,
                                   swatch: Self.swatch(band)) { v in
                    settings.mono = withMonoValue(settings.mono ?? mono, band, v)
                }
            }
            if mixed {
                Button("Reset mix") { settings.mono = straightMono() }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }
    }

    // MARK: - colour

    private var colourBody: some View {
        let mixer = settings.mixer
        return DevelopSection(id: "mixer", title: "Colour mixer", info: [Self.hint], marked: !isDefaultMixer(mixer),
                              defaultOpen: false) {
            treatment
            Picker("Mixer channel", selection: $channel) {
                ForEach(MixerChannel.allCases, id: \.self) { c in
                    Text(used(c) ? "\(Self.channelLabel(c)) •" : Self.channelLabel(c)).tag(c)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            ForEach(MixerBand.allCases, id: \.self) { band in
                DevelopRangeSlider(band.label, value: Self.value(mixer?[channel] ?? [], band), in: -100...100, step: 1,
                                   swatch: Self.swatch(band)) { v in
                    settings.mixer = withMixerValue(settings.mixer, channel, band, v)
                }
            }
            if !isDefaultMixer(mixer) {
                HStack(spacing: 12) {
                    if used(channel) {
                        Button("Reset \(Self.channelLabel(channel).lowercased())") {
                            settings.mixer = withoutMixerChannel(settings.mixer, channel)
                        }
                        .buttonStyle(DevelopLinkButtonStyle())
                    }
                    Button("Reset mixer") { settings.mixer = nil }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
    }

    // MARK: - the treatment

    /// Colour · B&W — V on the workbench switches it (the shell's key).
    private var treatment: some View {
        Picker("Treatment", selection: Binding(
            get: { settings.mono != nil },
            set: { on in settings.mono = on ? straightMono() : nil }
        )) {
            Text("Colour").tag(false)
            Text("B&W").tag(true)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .help("Colour or black and white (V)")
    }

    // MARK: - helpers

    private func used(_ c: MixerChannel) -> Bool {
        settings.mixer?[c].contains { $0 != 0 } ?? false
    }

    /// A band's value read safely: a hand-built record may hold fewer than eight.
    private static func value(_ list: [Double], _ band: MixerBand) -> Double {
        band.index < list.count ? list[band.index] : 0
    }

    /// The band's own colour, where it peaks — `hsl(centre 75% 52%)`, the web's swatch.
    private static func swatch(_ band: MixerBand) -> Color {
        .developHSL(band.centre, 0.75, 0.52)
    }

    private static func channelLabel(_ c: MixerChannel) -> String {
        switch c {
        case .hue: return "Hue"
        case .saturation: return "Saturation"
        case .luminance: return "Luminance"
        }
    }

    private static let hint = "Eight bands of colour, each moved on its own — darken a blue sky, calm a green lawn, warm a skin — while everything else stays. A grey is never touched, a hue shift keeps its light, and a band fades into its neighbours so no colour falls between two."

    private static let monoHint = "Black and white, and how light each colour becomes in grey — the red, orange or yellow filter a film photographer screwed on, band by band: a blue sky pulled down goes dark behind white clouds, an orange raised lifts a face. A grey stays its own grey. The colour mixer is kept, not applied, and comes back with Colour; the grading wheels still tint the grey, which is how a split tone is made. V switches the treatment."
}

#Preview("Colour mixer") {
    DevelopPreviewState(DevelopPanelFixtures.develop) { settings in
        DevelopMixerSection(settings: settings)
    }
}

#Preview("B&W mix") {
    DevelopPreviewState({ () -> DevelopSettings in
        var d = DevelopPanelFixtures.develop
        d.mono = withMonoValue(nil, .blue, -40)
        return d
    }()) { settings in
        DevelopMixerSection(settings: settings)
    }
}
