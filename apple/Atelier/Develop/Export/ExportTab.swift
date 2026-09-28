// The Develop tool's EXPORT tab — the web's `ExportPanel.tsx`, section by
// section in its order: Export (the targets, what the run DELIVERS said before
// a byte moves, *Proxies only, for this run*, and *This picture*), Watermark,
// Pictures (which leave, one row each), Metadata, HDR, Deliver.
//
// Which PIXELS a picture leaves from is not asked here (`capture-renditions.md`
// §13.2): the picture's own answer is its file on this device, and the one
// thing the door still says is *proxies only, for this run* — which never
// touches the roll. Nor are the two choices this app adds, the format and
// Photos: they are this device's (`RollRunState`), so a roll written here
// stays the web's `RollDoc` v6, byte for byte.

import SwiftUI
import AtelierKit

/// The inspector calls the tab by the name its stand-in had (`InspectorView`).
typealias ExportSectionPlaceholder = ExportTab

struct ExportTab: View {
    @Bindable var editor: RollEditor

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ExportSettingsSection(editor: editor)
            ExportWatermarkSection(editor: editor)
            ExportPicturesSection(editor: editor)
            ExportMetadataSection(editor: editor)
            ExportHdrSection(editor: editor)
            ExportDeliverSection(editor: editor)
        }
    }
}

/// A label and its field, the web's `FieldRow`: the name in a narrow column,
/// the control taking the rest.
struct ExportRow<Content: View>: View {
    let label: String
    let content: Content
    @Environment(\.palette) private var palette

    init(_ label: String, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .frame(width: 84, alignment: .leading)
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A line under a control that says what it does.
struct ExportHint: View {
    let text: String
    var tone: Tone = .muted
    @Environment(\.palette) private var palette

    enum Tone { case muted, warn, danger }

    init(_ text: String, tone: Tone = .muted) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(text)
            .font(Brand.sans(11))
            .foregroundStyle(colour)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var colour: Color {
        switch tone {
        case .muted: return palette.muted
        case .warn: return palette.warn
        case .danger: return palette.danger
        }
    }
}

// MARK: - Export: the targets, and the run said before it runs

struct ExportSettingsSection: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    static let info = [
        "Each picture is decoded at its own size, developed under its own look, cropped as the Crop tab shows it and written as a JPEG — or a HEIC, this device’s choice under Deliver. A size is a ceiling — a long edge, a short edge, an area in megapixels or a share of the picture — and a picture is never upscaled to reach it.",
        "One run can write several targets: the full picture for the archive and a 2048 px set for the web, say. Each picture is rendered once and cut to every target. The first writes into the folder you choose; each other one into a folder inside it, named after the target — the files keep their pictures’ own names, so DJI_0101.jpg and Web/DJI_0101.jpg are the same photograph. Sharpen is for a screen, applied to the file after its resize: a picture brought down to 2048 px is softer than it was at its own size, and how much to bring back depends on the size.",
        "A picture leaves carrying the ORIGINAL’s EXIF — its position, its body, its lens, the hour it was taken — so a file developed here still reads like the capture. Only a few tags are corrected: the way up, the size, the thumbnail, which would otherwise show the picture before you developed it — and what the Metadata section below writes.",
        "Which pixels a picture leaves from is the picture’s own answer: its file on this device. Delivers says what that means for the run before anything is read; Proxies only sets a RAW base aside for this run alone, and the roll is untouched. Fetching a full-size original from a Winnow waits for the app’s Winnow client.",
        "A RAW leaves from the sensor’s data, demosaiced by the system’s RAW developer at its own size — not yet the web app’s LibRaw decode, and without the camera calibration the web climbs to.",
    ]

    var body: some View {
        let run = editor.exportRun
        let plan = editor.runPlan
        DevelopSection(id: "export", title: "Export", info: Self.info) {
            ExportTargetsView(editor: editor)
            Hairline()
            ExportRow("Delivers") {
                // The run's sentence; every picture's own line is in the table below.
                Text(plan.summary)
                    .font(Brand.mono(12))
                    .monospacedDigit()
                    .foregroundStyle(palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Toggle(isOn: Binding(get: { run.proxiesOnly }, set: { run.proxiesOnly = $0 })) {
                    Text("Proxies only, for this run")
                        .font(Brand.sans(13))
                        .foregroundStyle(palette.ink)
                }
                .toggleStyle(.switch)
                .accessibilityLabel("Proxies only for this run")
                ExportHint(run.proxiesOnly
                    ? "Every picture leaves from what is in hand; a RAW base is set aside and the run says so. The roll is untouched."
                    : "Writes nothing on the roll — for a run on a slow connection, or from a phone.")
            }
            ExportRow("This picture") {
                ThisPictureLine(editor: editor)
            }
        }
    }
}

/// The calculator's sentence for the picture in hand; it wraps rather than
/// truncates, its end being the verdict.
private struct ThisPictureLine: View {
    @Bindable var editor: RollEditor
    @Environment(\.palette) private var palette

    var body: some View {
        let delivery = editor.openDelivery
        let undrawn = editor.unrendered
        VStack(alignment: .leading, spacing: 3) {
            Text(delivery?.line ?? "—")
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(delivery == nil ? palette.muted : palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let reason = delivery?.reason {
                ExportHint(reason)
            } else if delivery == nil {
                ExportHint("measured once the picture is decoded")
            }
            if !undrawn.isEmpty {
                ExportHint("Not drawn here yet: \(undrawn.joined(separator: ", ")) — this picture leaves without it; the web app delivers it.", tone: .warn)
            }
        }
    }
}

// MARK: - previews

/// A roll to preview the tab on: three pictures this device cannot decode —
/// a preview has no files — one edited, one held, a Web target beside the first.
enum ExportPreview {
    @MainActor static func editor() -> RollEditor {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("atelier-export-preview")
        let store = RollStore(root: root)
        let pool = PicturePool(store: store)
        let presets = PresetBookStore(root: root)
        let roll = store.rolls.first ?? store.create(name: "Coast · 12 Sep")
        if store.roll(roll.id)?.pictures.isEmpty ?? true {
            for i in 1...3 {
                store.addPicture(to: roll.id, data: Data(repeating: UInt8(i), count: 64 + i), name: "DJI_010\(i).JPG")
            }
        }
        let editor = RollEditor(store: store, pool: pool, presets: presets, rollId: roll.id)
        if let first = editor.pictures.first?.id, editor.pictures.count > 2 {
            editor.update { r in
                var out = patchPicture(r, first) { p in
                    var d = DevelopSettings.default
                    d.exposure = 0.4
                    p.develop = d
                    p.title = "Dawn at the jetty"
                }
                out = setDelivery(out, [out.pictures[2].id], .no)
                if out.export.targets.count < 2 { out.export.targets.append(targetPresets[1].target) }
                return out
            }
        }
        return editor
    }
}

#Preview("Export tab") {
    ScrollView {
        ExportTab(editor: ExportPreview.editor())
            .padding(.horizontal, 14)
    }
    .frame(width: 360, height: 900)
    .darkroom()
}
