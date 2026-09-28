// The row above the develop sheet's picture — the web's `DevelopSheet` header
// minus its title and close (the navigation bar carries those): what the
// picture IS (the fidelity chip, `pictureFidelity` with its pixels), the
// session's clipboard (`DevelopClipboardActions`: Copy · Paste · As shot —
// one clipboard shared by every host, so a develop copied in the Studio
// pastes in Trips and in the Develop tool), the compare switch `A/B` (the
// Develop tool's word), and the ± pill (`StageZoomPill`, the tool's own; its
// `%` carries Fit, 100 % and smooth ↔ pixels — a label of fixed width, so
// nothing is ever inserted in the row).
//
// On a phone the row WRAPS into two, as the web's does at 390px: the chip on
// its own line, then the verbs at a finger's height — one row of five things
// left the chip as "J…".

import SwiftUI
import AtelierKit

struct DevelopSheetBar: View {
    @Bindable var picture: DevelopSheetPicture
    @Binding var draft: DevelopSettings
    /// `pictureFidelity(...).chip`; nil before anything is known.
    let chip: String?
    let compact: Bool
    let onTold: (String) -> Void
    @Environment(\.palette) private var palette

    private var asShot: Bool { isDefaultDevelop(draft) }
    private var height: CGFloat { compact ? 34 : 28 }

    var body: some View {
        if compact {
            VStack(alignment: .leading, spacing: 6) {
                chipView
                HStack(spacing: 8) {
                    clipboard
                    Spacer(minLength: 0)
                    abPill
                    zoomPill
                }
            }
        } else {
            HStack(spacing: 10) {
                chipView
                Spacer(minLength: 8)
                clipboard
                abPill
                zoomPill
            }
        }
    }

    // MARK: - what the picture is

    @ViewBuilder
    private var chipView: some View {
        if let chip {
            Text(chip)
                .font(Brand.mono(10))
                .foregroundStyle(palette.inkSoft)
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(palette.paper2, in: Capsule())
                .overlay(Capsule().stroke(palette.line, lineWidth: 1))
                .help(chip)
                .accessibilityLabel("What this picture is: \(chip)")
        }
    }

    // MARK: - the session's clipboard

    private var clipboard: some View {
        HStack(spacing: 12) {
            Button("Copy") {
                copyDevelop(draft)
                onTold("copied")
            }
            .disabled(asShot)
            .help(asShot ? "Nothing to copy — this picture is as shot" : "Keep these numbers for the next picture, in this session (⌘C)")
            Button("Paste") {
                if let pasted = pasteDevelop() { draft = pasted }
            }
            .disabled(!picture.canPaste)
            .help(picture.canPaste ? "Replace these numbers with the copied ones (⌘V)" : "Nothing copied yet")
            Button("As shot") { draft = .default }
                .disabled(asShot)
                .help("Throw these numbers away")
        }
        .buttonStyle(DevelopLinkButtonStyle())
        .fixedSize()
    }

    // MARK: - the compare switch

    /// `A/B` — the Develop tool's word and colours. Suspended while the grey
    /// dropper holds the pointer: dashed and faint, never claiming to be on.
    private var abPill: some View {
        let held = picture.compareOn && picture.picking
        let on = picture.compareOn && !held
        let ink = held ? palette.faint : (on ? palette.accentInk : palette.muted)
        let ground = on ? palette.accentWash : (held ? palette.paper2 : palette.surface)
        let shape = RoundedRectangle(cornerRadius: Brand.controlRadius - 2)
        return Button {
            picture.setCompareOn(!picture.compareOn)
        } label: {
            Text("A/B")
                .font(Brand.mono(10))
                .kerning(0.6)
                .padding(.horizontal, 8)
                .frame(height: height)
                .foregroundStyle(ink)
                .background(ground, in: shape)
                .overlay(shape.strokeBorder(on ? palette.accent : palette.lineStrong,
                                            style: StrokeStyle(lineWidth: 1, dash: held ? [3, 2] : [])))
        }
        .buttonStyle(.plain)
        .disabled(picture.shown == nil)
        .help(abHelp(held: held, on: on))
        .accessibilityLabel("Before and after")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func abHelp(held: Bool, on: Bool) -> String {
        if held { return "Before / after — suspended while the dropper has the pointer; the divider comes back where it was" }
        if on { return "Before / after — the divider is on, and a drag across the picture places it" }
        return "Before / after — off: the whole picture is shown corrected"
    }

    // MARK: - the zoom

    private var zoomPill: some View {
        StageZoomPill(zoom: picture.zoom, large: compact, offersCrop: false)
            .disabled(picture.shown == nil)
    }
}

#Preview("Sheet bar") {
    DevelopSheetBarPreview()
        .padding()
        .background(Palette.darkroom.surface)
        .darkroom()
}

private struct DevelopSheetBarPreview: View {
    @State private var picture = DevelopSheetPicture()
    @State private var draft = DevelopSettings.default

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            DevelopSheetBar(picture: picture, draft: $draft, chip: "RAW · camera render · 960 × 540",
                            compact: false, onTold: { _ in })
            DevelopSheetBar(picture: picture, draft: $draft, chip: "JPEG · 8-bit · 4032 × 3024",
                            compact: true, onTold: { _ in })
                .frame(width: 360)
        }
    }
}
