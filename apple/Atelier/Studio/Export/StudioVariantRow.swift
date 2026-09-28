// The Export tab's VARIANTS — the web's `studio.export.variants` block of
// `StudioEditor.tsx`: one press of Export makes every row, each a deliverable
// of the same composition. A row is a Format (the source frame or a preset,
// cover-cropped at the source's density), a Resolution (the SHORT side,
// never upscaled — a row asking for more says what it really gets), a Frame
// rate and a Speed for a clip (a cadence and a speed are about a sequence of
// frames; a still has one, so both rows leave), and Overlays — burnt in, or
// clean, which also leaves the outro card out. Beside the switch, the frame
// it writes and the file it lands as; under the row, `rendering… 12 s` while
// it works, then what it cost — kept with the settings that produced it, and
// gone the moment one of them changes.
//
// Every write goes through the editor's funnel (`updateExportVariant`), so a
// row's edit is a step of undo like any other; the menus' words and the
// hints are the kernel's (`Projects/StudioExport.swift`).

import SwiftUI
import AtelierKit

struct StudioExportVariantsSection: View {
    @Bindable var editor: StudioEditor

    static let info = [
        "One press of Export renders every variant, one after the other: reframed to another destination format, capped to a delivery resolution, at another cadence or speed, with the overlays burnt in or clean.",
        "A preset format cover-crops into its frame at the source's own density, and the overlays are composed for THAT frame — a 9:16 cut keeps its titles composed for 9:16. A clean variant carries neither the overlays nor the outro card.",
    ]

    var body: some View {
        let variants = editor.edit.variants
        let model = editor.exporter
        DevelopSection(id: "studio.export.variants", title: "Variants", badge: "\(variants.count)", info: Self.info,
                       remember: .local, actions: {
            Button {
                editor.addExportVariant()
            } label: {
                Label("Variant", systemImage: "plus")
            }
            .buttonStyle(DevelopLinkButtonStyle())
            .help("Add a variant in the project's format")
        }) {
            ForEach(Array(variants.enumerated()), id: \.element.id) { index, variant in
                StudioVariantRow(editor: editor, model: model, variant: variant, index: index,
                                 removable: variants.count > 1)
            }
        }
    }
}

struct StudioVariantRow: View {
    @Bindable var editor: StudioEditor
    let model: StudioExportModel
    let variant: ExportVariant
    let index: Int
    let removable: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            formatRow
            resolutionRow
            if !editor.isPhoto {
                frameRateRow
                speedRow
            }
            overlaysRow
            status
        }
        .padding(.leading, 10)
        .overlay(alignment: .leading) { Rectangle().fill(palette.line).frame(width: 2) }
        .padding(.bottom, 4)
    }

    /// What the export will encode from — the capture when it fetches one.
    private var source: AtelierKit.Size? {
        editor.exportSourceSize(renderFromProxy: model.renderFromProxy)
    }

    // MARK: - the rows

    private var header: some View {
        HStack(spacing: 8) {
            Text("Variant \(index + 1)")
                .font(Brand.sans(13, weight: .medium))
                .foregroundStyle(palette.ink)
            Spacer(minLength: 0)
            Button {
                editor.removeExportVariant(variant.id)
            } label: {
                Image(systemName: "xmark")
                    .font(Brand.sans(11, weight: .semibold))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(palette.muted)
            .disabled(!removable)
            .opacity(removable ? 1 : 0.35)
            .help("Remove this variant")
            .accessibilityLabel("Remove this variant")
        }
    }

    private var formatRow: some View {
        let ids = variantFormatChoices(current: variant.aspectId)
        let options = ids.map { OverlayPanelOption($0, variantFormatLabel($0)) }
        let id = variant.id
        return OverlayPanelPicker("Format", selection: variant.aspectId, options: options) { picked in
            editor.updateExportVariant(id) { $0.aspectId = picked }
        }
    }

    private var resolutionRow: some View {
        let choices = variantResolutionChoices(current: variant.resolution)
        let options = choices.map { OverlayPanelOption(StudioVariantRow.resolutionKey($0), variantResolutionLabel($0)) }
        let selected = StudioVariantRow.resolutionKey(variant.resolution)
        let id = variant.id
        return OverlayPanelRow("Resolution", hint: shortfallText, tone: .problem) {
            OverlayPanelMenu("Resolution", selection: selected, options: options) { key in
                guard let picked = choices.first(where: { StudioVariantRow.resolutionKey($0) == key }) else { return }
                editor.updateExportVariant(id) { $0.resolution = picked }
            }
        }
    }

    /// A variant never upscales, so asking for more than the source holds
    /// silently delivers less. Say which.
    private var shortfallText: String? {
        guard let source, let short = resolutionShortfall(variant, source.width, source.height) else { return nil }
        let fromProxy = editor.exportClipProxy != nil && model.renderFromProxy
        return shortfallHint(short, renderingFromProxy: fromProxy)
    }

    private var frameRateRow: some View {
        let menu = frameRateMenu(current: variant.frameRate)
        let fps = editor.clipFps
        let options = menu.map { OverlayPanelOption(StudioVariantRow.rateKey($0), StudioVariantRow.rateLabel($0, sourceFps: fps)) }
        let selected = StudioVariantRow.rateKey(variant.frameRate)
        let id = variant.id
        return OverlayPanelRow("Frame rate", hint: frameRateHint(variant.frameRate, sourceFps: fps)) {
            OverlayPanelMenu("Frame rate", selection: selected, options: options) { key in
                guard let picked = menu.first(where: { StudioVariantRow.rateKey($0) == key }) else { return }
                editor.updateExportVariant(id) { $0.frameRate = picked }
            }
        }
    }

    private var speedRow: some View {
        let realtime = editor.realtimeRate
        let current = resolveSpeed(variant.speed)
        var choices = deliveredSpeedChoices(realtime)
        if !choices.contains(current) {
            choices.append(current)
            choices.sort()
        }
        let options = choices.map { OverlayPanelOption($0, speedOptionLabel($0, realtimeRate: realtime)) }
        let hint = speedHint(variant.speed, duration: editor.playback.duration)
        let id = variant.id
        return OverlayPanelRow("Speed", hint: hint) {
            OverlayPanelMenu("Speed", selection: current, options: options) { picked in
                editor.updateExportVariant(id) { $0.speed = picked }
            }
        }
    }

    private var overlaysRow: some View {
        let medium: VariantMedium = editor.isPhoto ? .photo : .video
        let name = variantFileName(baseName, variant, medium)
        let dims = source.map { variantOutputSize(variant, $0.width, $0.height) }
        let size = dims.map { "\(Int($0.width))×\(Int($0.height)) · " } ?? ""
        let id = variant.id
        return OverlayPanelRow("Overlays", hint: outroHint) {
            OverlayPanelToggle("Burn the overlays in", isOn: variant.overlays) { on in
                editor.updateExportVariant(id) { $0.overlays = on }
            }
            Spacer(minLength: 4)
            Text(verbatim: size + name)
                .font(Brand.mono(10))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(name)
        }
    }

    /// The file names' base: the Output's custom name, else the media's.
    private var baseName: String {
        let custom = editor.edit.exportFileName.trimmingCharacters(in: .whitespacesAndNewlines)
        return custom.isEmpty ? (editor.active?.baseName ?? "export") : custom
    }

    /// Said only where the project has a card: it rides a burnt-in variant alone.
    private var outroHint: String? {
        guard !editor.isPhoto, let outro = editor.edit.outro, outro.seconds > 0 else { return nil }
        return variant.overlays
            ? "The outro card is appended after the footage."
            : "Clean: no overlays, and no outro card."
    }

    /// What this row cost last time it rendered, or its clock while it renders.
    @ViewBuilder
    private var status: some View {
        if model.running, let live = model.live, live.id == variant.id {
            TimelineView(.periodic(from: live.startedAt, by: 0.25)) { context in
                HStack(spacing: 6) {
                    Circle()
                        .fill(palette.accent)
                        .frame(width: 7, height: 7)
                    Text("rendering… \(formatElapsed(context.date.timeIntervalSince(live.startedAt)))")
                        .font(Brand.mono(10))
                        .monospacedDigit()
                        .foregroundStyle(palette.accentInk)
                }
            }
            .accessibilityElement(children: .combine)
        } else if let stat = model.measure(variant, media: editor.active?.id) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(Brand.sans(10, weight: .bold))
                    .foregroundStyle(palette.ok)
                Text(describeExportStat(stat))
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
            }
            .accessibilityElement(children: .combine)
        }
    }

    // MARK: - menu keys

    static func resolutionKey(_ resolution: VariantResolution) -> String {
        switch resolution {
        case .source: return "source"
        case .shortSide: return variantResolutionLabel(resolution)
        }
    }

    static func rateKey(_ rate: ExportFrameRate) -> String {
        switch rate {
        case .source: return "source"
        case .fps: return describeFrameRate(rate)
        }
    }

    static func rateLabel(_ rate: ExportFrameRate, sourceFps: Double?) -> String {
        switch rate {
        case .source: return frameRateSourceLabel(sourceFps)
        case .fps: return describeFrameRate(rate)
        }
    }
}

#Preview("Variants") {
    ScrollView {
        StudioExportVariantsSection(editor: StudioExportPreview.editor())
            .padding(.horizontal, 14)
    }
    .frame(width: 360, height: 760)
    .darkroom()
}
