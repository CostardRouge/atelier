// The lens correction — distortion, fringing and vignetting — and the lens's
// MEASURED profile. Port of `src/tools/develop/LensPanel.tsx` over the
// kernel's `Render/Lens.swift` (the sliders) and `Lens/*` (Lensfun).
//
// It sits beside the perspective on the Crop tab: both are about the SHAPE of
// the picture rather than its light, and the order between them (the lens
// first, radial, then the perspective, which needs straight lines to make
// parallel) is easier to hold when they are together.
//
// The profile block is the suite's THIRD network exception, and says every
// state it can be in (`lens-profiles.md`): on the picture (what it corrects,
// or why a camera render is not corrected by it), found and offered (applied
// by itself on the SENSOR when the picture never decided — the editor does
// that — only offered on a camera render, which the body may have corrected
// already), not allowed yet (one button, naming the one host it asks), not
// reachable, or not in Lensfun. Nothing is fetched until the person allows it
// on this device; only the answer is kept, never the database.

import SwiftUI
import AtelierKit

struct LensSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    private struct Row: Identifiable {
        let id: String
        let label: String
        let path: WritableKeyPath<LensCorrection, Double>
        let range: ClosedRange<Double>
        let reset: Double
    }

    private static let rows: [Row] = [
        Row(id: "distortion", label: "Distortion", path: \.distortion, range: -100...100, reset: 0),
        Row(id: "distortion2", label: "Secondary", path: \.distortion2, range: -100...100, reset: 0),
        Row(id: "chromaRed", label: "Fringing, red", path: \.chromaRed, range: -100...100, reset: 0),
        Row(id: "chromaBlue", label: "Fringing, blue", path: \.chromaBlue, range: -100...100, reset: 0),
        Row(id: "vignette", label: "Vignetting", path: \.vignette, range: -100...100, reset: 0),
        Row(id: "vignetteMidpoint", label: "Falls off", path: \.vignetteMidpoint, range: 0...100, reset: 50),
    ]

    var body: some View {
        let lens = editor.lensBinding
        let value = lens.wrappedValue
        let current = value ?? .default
        let touched = !isDefaultLens(value)
        let applied = editor.storedLensProfile.flatMap { $0 }
        let inEffect = profileInEffect(applied, editor.developsOnSensor) != nil
        DevelopSection(id: "lens", title: "Lens", info: LensSection.info, marked: touched || inEffect, actions: {
            if touched {
                Button("Reset") { lens.wrappedValue = nil }
                    .buttonStyle(DevelopLinkButtonStyle())
            }
        }) {
            LensProfileBlock(editor: editor)
            ForEach(LensSection.rows) { row in
                DevelopRangeSlider(row.label, value: current[keyPath: row.path], in: row.range, step: 1,
                                   reset: row.reset) { n in
                    var next = lens.wrappedValue ?? .default
                    next[keyPath: row.path] = n
                    // A midpoint on its own only says WHERE a lift would bite:
                    // not a correction, so nil.
                    lens.wrappedValue = isDefaultLens(next) ? nil : next
                }
            }
        }
    }

    static let info = [
        "A wide lens bows straight lines outwards (barrel) and a long one pinches them in (pincushion); Distortion takes that back out, and Secondary is the one a “moustache” curve needs, where the middle of the frame bends the other way from the corners. Fringing scales red and blue against green, which is what removes the coloured edges on high-contrast subjects near the corners. Vignetting lifts the corners a lens darkened, and Falls off says how much of the middle stays untouched. All of it is radial — measured from the centre of the frame — so it runs BEFORE the perspective correction, which needs straight lines to make parallel.",
        "A PROFILE is measured calibration data for one lens, from Lensfun — an open database people build by photographing targets. When you allow it, the lens a picture names is looked up there the first time it is met: your camera maker’s file, and the independent lens makers’ only if the lens is not in the first. Only the answer is kept on this device, never the database, and nothing about your pictures is sent. A profile applies by itself to a picture developed from its SENSOR; a camera’s own JPEG — and the render inside a RAW — is often corrected in the body already, so there it is only offered. The sliders below correct what the profile leaves, by eye, and work on any lens.",
        "Corrected before the perspective, and before the crop.",
    ]
}

/// The measured profile: what is on the picture, or what can be.
struct LensProfileBlock: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        let lensfun = LensfunStore.shared
        let onSensor = editor.developsOnSensor
        let stored = editor.storedLensProfile
        let shot = editor.openShot
        let lookup = shot.flatMap { lensfun.answer(for: $0) }
        // Absent: never decided. A null: taken off. An object: on the picture.
        let applied: LensProfileApplied? = stored.flatMap { $0 }
        let takenOff = stored != nil && applied == nil
        VStack(alignment: .leading, spacing: 4) {
            if let applied {
                appliedRows(applied, inEffect: profileInEffect(applied, onSensor) != nil)
            } else if let candidate = editor.lensProfileCandidate {
                offerRows(candidate, onSensor: onSensor, takenOff: takenOff)
            } else if let lookup {
                answerRows(lookup)
            } else if shot != nil {
                line("looking the lens up…")
            } else {
                line("the picture says nothing about its camera")
            }
        }
    }

    // MARK: - the three faces

    @ViewBuilder
    private func appliedRows(_ applied: LensProfileApplied, inEffect: Bool) -> some View {
        let aperture = applied.aperture.map { " · f/" + number($0) } ?? ""
        let focal = number(applied.focal)
        HStack(spacing: 8) {
            Text("\(applied.lens) · \(focal) mm\(aperture)")
                .font(Brand.mono(11))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(applied.lens)
            Spacer(minLength: 4)
            Button("Remove") { editor.setLensProfile(nil) }
                .buttonStyle(DevelopLinkButtonStyle())
        }
        line(inEffect
             ? "corrects \(describeProfileParts(applied.has)) · \(lensfunLicence)"
             : "kept for the sensor — this camera render is not corrected by it, the body may have done so already")
    }

    @ViewBuilder
    private func offerRows(_ candidate: LensProfileApplied, onSensor: Bool, takenOff: Bool) -> some View {
        HStack(spacing: 8) {
            Text(candidate.lens)
                .font(Brand.mono(11))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 4)
            Button(onSensor ? "Apply" : "Apply to this render") { editor.setLensProfile(candidate) }
                .buttonStyle(DevelopPillButtonStyle())
        }
        if onSensor {
            line(takenOff
                 ? "taken off this picture — apply it again if you want it back"
                 : "found in Lensfun · \(describeProfileParts(candidate.has))")
        } else {
            line("this is the camera’s render, which the body may have corrected already — look at a straight edge before applying")
        }
    }

    @ViewBuilder
    private func answerRows(_ lookup: LensLookUp) -> some View {
        switch lookup {
        case .notAllowed:
            Button("Look lenses up in Lensfun") { LensfunStore.shared.setAllowed(true) }
                .buttonStyle(DevelopPillButtonStyle())
            line("asks raw.githubusercontent.com for Lensfun’s file of your camera maker — once per lens, kept on this device")
        case .offline:
            line("Lensfun could not be reached — the sliders below still correct by eye")
        case .missing(let why):
            switch why {
            case .noExif: line("the picture does not say its camera and focal length")
            case .camera: line("this camera is not in Lensfun yet — the sliders below correct by eye")
            case .lens: line("this lens is not in Lensfun yet — the sliders below correct by eye")
            }
        case .found:
            // Found, but nothing measured at this focal length: nothing to offer.
            EmptyView()
        }
    }

    private func line(_ text: String) -> some View {
        Text(text)
            .font(Brand.mono(10))
            .foregroundStyle(palette.faint)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// `+n.toFixed(1)` — `24`, `24.5`, never `24.0`.
    private func number(_ v: Double) -> String {
        DevelopNumbers.plain((v * 10).rounded() / 10)
    }
}

#Preview("Lens") {
    DevelopPreviewState(true) { _ in
        LensSectionPreview()
    }
}

private struct LensSectionPreview: View {
    var body: some View {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")
        let store = RollStore(root: root)
        let editor = RollEditor(store: store, pool: PicturePool(store: store), presets: PresetBookStore(root: root),
                                rollId: "preview")
        return LensSection(editor: editor)
    }
}
