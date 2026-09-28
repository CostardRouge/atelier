// The Studio's DEVELOP sheet — the web's `DevelopSheet` as the Studio opens
// it from the Grade tab's settled row (`studio.md`, «A media's DEVELOP is
// bound-half»): the open media's own correction, drawn by the very Develop
// panels (`Develop/Panels/*`) over a DRAFT, with the picture it is judged on —
// a still, or the clip's frame at the moment the sheet opened (never live).
//
// The picture side is the sheet every host shares (`Develop/Sheet/`): the
// fidelity chip, the session's clipboard, the before/after wipe (`A/B`), the
// Looking zoom to 4000 %, `J`'s clipping with the readout under the pointer,
// and the grey dropper. What the Studio ADAPTS is its picture (the stage's
// own decode, `editor.source`), its draft, and its grade: the draft develop
// FIRST, then the project's look, baked into one cube, and its film after —
// correction before look, on screen as in the cube. The stage behind keeps
// the STORED value until Done.
//
// Auto is measured on the picture AS SHOT, so a second press is the same
// answer; the histogram is the picture as it will be delivered. Done writes
// the open media's develop (keyed by its base name, stamped with its hash);
// Cancel drops the draft; the one batch verb here writes the same numbers onto
// every OTHER media of the project, each under its own hash. The personal
// preset book is drawn as chips (a copy of the numbers, applied, never
// followed) and the draft can be saved into it.

import CoreImage
import SwiftUI
import AtelierKit

struct StudioDevelopSheet: View {
    @Bindable var editor: StudioEditor
    @Environment(PresetBookStore.self) private var presets
    @Environment(\.palette) private var palette

    @State private var draft = DevelopSettings.default
    @State private var picture = DevelopSheetPicture()
    @State private var resolved: ResolvedLook?
    @State private var grader = FrameGrader()
    @State private var told: String?
    @State private var naming = false
    @State private var presetName = ""
    @State private var seeded = false

    private var name: String { editor.activeFile?.name ?? "this media" }

    var body: some View {
        presented(NavigationStack { frame })
            .task { await seed() }
            .onChange(of: draft) { _, _ in grade() }
    }

    private var frame: some View {
        DevelopSheetFrame(picture: picture, draft: $draft, hasPicture: editor.activeFile != nil,
                          emptyText: "No picture to develop yet.", onTold: { told = $0 }) {
            column
        }
        .background(palette.surface)
        .navigationTitle("Develop · \(name)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { editor.developOpen = false }
                    .keyboardShortcut(.cancelAction)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    editor.setActiveDevelop(isDefaultDevelop(draft) ? nil : draft)
                    editor.developOpen = false
                }
                .keyboardShortcut(.defaultAction)
            }
        }
    }

    private func presented(_ content: some View) -> some View {
        content
            .alert("Save as a preset", isPresented: $naming) {
                TextField("Name", text: $presetName)
                Button("Save") {
                    if presets.save(name: presetName, settings: draft) { told = "saved “\(presetName)”" }
                    presetName = ""
                }
                Button("Cancel", role: .cancel) { presetName = "" }
            }
            #if os(macOS)
            .frame(minWidth: 880, idealWidth: 1024, minHeight: 620, idealHeight: 780)
            #endif
            .darkroom()
    }

    // MARK: - the column

    private var column: some View {
        VStack(alignment: .leading, spacing: 0) {
            DevelopHistogramView(histogram: picture.histogram, clipping: picture.clipping,
                                 onClipping: { picture.toggleClipping() }, readout: picture.readout)
                .padding(.bottom, 8)
            if let told {
                Text(told)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .padding(.bottom, 8)
            }
            presetsRow
            DevelopAutoSection(settings: $draft, stats: picture.stats, picking: picture.picking,
                               onPicking: { picture.setPicking($0) }, onTold: { told = $0 })
            DevelopSlidersSection(settings: $draft, foldPrefix: "studio.")
            WhiteBalanceSection(settings: $draft, white: nil)
            DevelopCurveSection(settings: $draft, histogram: picture.histogram, foldPrefix: "studio.")
            DevelopLevelsSection(settings: $draft)
            DevelopMixerSection(settings: $draft)
            DevelopGradingSection(settings: $draft)
            footer
        }
    }

    // MARK: - presets

    @ViewBuilder
    private var presetsRow: some View {
        DevelopSection(id: "studio.develop.presets", title: "Presets", info: [
            "Your own names for a light, kept on this device. A chip writes a COPY of its numbers here — applied, never followed, so editing a preset later changes no picture.",
        ], remember: .local) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(presets.presets, id: \.id) { preset in
                        Button(preset.name) {
                            draft = preset.settings
                            told = "wearing “\(preset.name)”"
                        }
                        .buttonStyle(DevelopPillButtonStyle())
                        .help(describeDevelop(preset.settings))
                    }
                    Button("Save…") { naming = true }
                        .buttonStyle(DevelopLinkButtonStyle())
                        .disabled(isDefaultDevelop(draft))
                }
            }
        }
    }

    // MARK: - the footer

    private var footer: some View {
        let others = editor.clips.filter { $0.id != editor.active?.id }.count
        return VStack(alignment: .leading, spacing: 10) {
            Hairline()
            if let label = developApplyToLabel(others) {
                HStack(spacing: 10) {
                    Button(label) {
                        editor.applyDevelopToOthers(draft)
                        told = "\(label.lowercased()) — each under its own file"
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    Text("every other photo and clip of this project")
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.faint)
                }
            }
            if let base = editor.active?.baseName {
                Text("writes to \(base)")
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
            }
        }
        .padding(.top, 8)
    }

    // MARK: - the picture and its grade

    /// The draft opens on the stored value; the picture is the stage's own
    /// decode — a still at the stage budget, or the clip's frame now — which
    /// the sheet fits to its size.
    private func seed() async {
        guard !seeded else { return }
        seeded = true
        draft = editor.activeDevelop ?? .default
        resolved = await LookLibrary.shared.resolve(editor.edit.grade ?? RollGrade())
        let facts = sheetFacts
        if let frame = editor.source {
            picture.load(frame, natural: naturalSize, facts: facts)
        } else if editor.activeFile != nil {
            picture.fail(editor.photoProblem ?? "The picture is not on the stage yet — close this and open it again once it shows.",
                         facts: facts)
        }
        grade()
    }

    /// The file's own pixels: a still's decode, a clip's display size.
    private var naturalSize: CGSize? {
        if editor.isPhoto { return editor.photoSize }
        guard let w = editor.clipWidth, let h = editor.clipHeight, w > 0, h > 0 else { return nil }
        return CGSize(width: w, height: h)
    }

    /// What the chip may say: the file, where a source says it came from, and
    /// — for a still — the pixels its decode measured. A clip's frame is not
    /// measured, as on the web (`usePicturePixels`).
    private var sheetFacts: DevelopSheetFacts? {
        guard let file = editor.activeFile else { return nil }
        let fidelityFile = FidelityFile(name: file.name, origin: mediaOrigin(file))
        guard editor.isPhoto, let size = editor.photoSize, size.width > 0, size.height > 0 else {
            return DevelopSheetFacts(file: fidelityFile)
        }
        let pixels = FidelityPixels(width: Int(size.width.rounded()), height: Int(size.height.rounded()),
                                    viaRawPreview: isRawImage(file.name))
        return DevelopSheetFacts(file: fidelityFile, pixels: pixels)
    }

    /// The draft develop FIRST, then the project's look and its film.
    private func grade() {
        let look = DevelopSheetLook(look: resolved, film: editor.edit.film, grader: grader,
                                    interpolation: LookLibrary.shared.interpolation)
        picture.grade(draft, through: look)
    }
}
