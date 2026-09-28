// The Trips DEVELOP sheet — the web's `DevelopSheet` as the piece editor opens
// it from the Picture tab's settled row (`roadtrip.md`, «A picture's DEVELOP
// is per slide, and the sheet's draft rides the stack»; `PostEditor.tsx`):
// the SELECTED cell's own correction, drawn by the very Develop panels
// (`Develop/Panels/*`) over a DRAFT, with the picture it is judged on — a
// still, or a clip's frame at the slide's in point (never live).
//
// The picture side is the sheet every host shares (`Develop/Sheet/`): the
// fidelity chip, the session's clipboard (Copy · Paste · As shot, ⌘C / ⌘V),
// the before/after wipe (`A/B`), the Looking zoom to 4000 %, `J`'s clipping
// with the readout under the pointer, and the grey dropper. What Trips ADAPTS
// is its picture (the cell's file, decoded here), its draft, and its grade.
//
// Rules kept:
// - the preview is graded as the stage grades: the draft develop FIRST, then
//   the look this picture WEARS on its rung, baked into one cube; the stage
//   behind keeps the STORED value until Done writes it — it does not chase
//   the sliders;
// - Done writes the selected cell (or the slide) — "writes to cell 2 of the
//   hook", said in the footer; Cancel drops the draft; as shot is written as
//   none;
// - the batch verbs beside Done write a COPY onto each target NOW
//   (`developApplyVerbs`: the piece's other slides, the day's other pieces),
//   the open picture being left to Done;
// - Auto is measured on the picture AS SHOT, so a second press is the same
//   answer; the grey dropper solves the white balance on the picture as shot;
// - the clipboard is the session's, shared with Develop and the Studio; the
//   presets are the person's own book, a chip writing a COPY of its numbers;
// - the look header carries the grade's rung chips, and the look under the
//   correction is the host's own panel on that rung.

import CoreImage
import SwiftUI
import AtelierKit

struct PieceDevelopSheet: View {
    let model: PieceEditorModel
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
    /// The cell names a file the Library could not open.
    @State private var unopened = false

    private var title: String { model.cellRef?.name ?? "this slide" }
    private var asShot: Bool { isDefaultDevelop(draft) }
    private var hasPicture: Bool { !model.isCta && model.cellRef != nil && !unopened }

    private var emptyText: String {
        model.isCta ? "The closing card carries no photograph." : "This slide has no picture yet — tick one in the Library."
    }

    var body: some View {
        lifecycle(presented(NavigationStack { frame }))
    }

    private var frame: some View {
        DevelopSheetFrame(picture: picture, draft: $draft, hasPicture: hasPicture,
                          emptyText: emptyText, onTold: { told = $0 }) {
            column
        }
        .background(palette.surface)
        .navigationTitle("Develop · \(title)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { model.developOpen = false }
                    .keyboardShortcut(.cancelAction)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { done() }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    private var column: some View {
        VStack(alignment: .leading, spacing: 0) {
            DevelopHistogramView(histogram: picture.histogram, clipping: picture.clipping,
                                 onClipping: { picture.toggleClipping() }, readout: picture.readout)
                .padding(.bottom, 8)
            DevelopAutoSection(settings: $draft, stats: picture.stats, picking: picture.picking,
                               onPicking: { picture.setPicking($0) }, onTold: { told = $0 })
            DevelopSlidersSection(settings: $draft, foldPrefix: "trips.")
            WhiteBalanceSection(settings: $draft, white: nil)
            DevelopLevelsSection(settings: $draft)
            DevelopCurveSection(settings: $draft, histogram: picture.histogram, foldPrefix: "trips.")
            DevelopMixerSection(settings: $draft)
            DevelopGradingSection(settings: $draft)
            presetsRow
            applyRow
            lookRow
            footer
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

    private func lifecycle(_ content: some View) -> some View {
        content
            .task { await seed() }
            .task(id: gradeKey(model.gradeShown)) { await resolveLook() }
            .onChange(of: draft) { _, _ in grade() }
    }

    private func done() {
        model.setDevelop(asShot ? nil : draft)
        model.developOpen = false
    }

    // MARK: - presets

    private var presetsRow: some View {
        DevelopSection(id: "trips.develop.presets", title: "Presets", info: [
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
                        .disabled(asShot)
                }
            }
        }
    }

    // MARK: - apply to…

    @ViewBuilder
    private var applyRow: some View {
        let verbs = model.developApplyVerbs
        if !verbs.isEmpty {
            DevelopSection(id: "trips.develop.apply", title: "Apply to…", info: [
                "The same numbers written onto other pictures, now, each as its own copy — the look under it stays theirs. Done still writes this one.",
            ], foldable: verbs.count > 1, remember: .local) {
                ForEach(verbs) { verb in
                    VStack(alignment: .leading, spacing: 3) {
                        Button(verb.label) {
                            verb.run(draft)
                            told = "done · \(verb.label.lowercased())"
                        }
                        .buttonStyle(DevelopPillButtonStyle())
                        Text(verb.hint)
                            .font(Brand.mono(10))
                            .foregroundStyle(palette.faint)
                    }
                }
            }
        }
    }

    // MARK: - the look under it

    @ViewBuilder
    private var lookRow: some View {
        if !model.isCta {
            DevelopSection(id: "trips.develop.look", title: "Look", info: [
                "The same grade the piece already wears, applied AFTER this correction — set both in one place. Looks apply top to bottom and the output transform last.",
            ], marked: !model.gradeShown.layers.isEmpty, remember: .local) {
                OverlayPanelRow("Grade of") {
                    PieceGradeScopeChips(model: model)
                }
                GradeStackView(grade: PieceGradeSection.binding(model), picture: lookPicture, previewHeight: 260)
            }
        }
    }

    private var lookPicture: LookPicture? {
        guard let source = picture.source else { return nil }
        return LookPicture(image: source, label: title, key: "trips.develop|\(title)")
    }

    // MARK: - the footer

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Hairline()
            HStack(spacing: 6) {
                Text(model.developFooterHint)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                if let told {
                    Text("· \(told)")
                        .font(Brand.mono(11))
                        .foregroundStyle(palette.accentInk)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
        }
        .padding(.top, 8)
    }

    // MARK: - the picture and its grade

    /// The draft opens on the stored value, and the picture is decoded once —
    /// a still with what its decode measured (the chip's pixels), a clip at
    /// the slide's in point.
    private func seed() async {
        guard !seeded else { return }
        seeded = true
        draft = model.cellDevelop ?? .default
        guard !model.isCta, let ref = model.cellRef else { return }
        guard let url = model.url(for: ref) else {
            unopened = true
            return
        }
        let origin = mediaOrigin(ref)
        do {
            if BadgeSources.isClip(ref.name) {
                let seconds = model.cellIndex == 0 ? (model.slide?.videoTimeSeconds ?? 0) : 0
                let edge = DevelopSheetPicture.previewEdge
                let loaded = try await BadgeSources.load(url, name: ref.name, videoSeconds: seconds,
                                                         budget: Double(edge * edge))
                // A clip's frame is not measured for the chip, as on the web.
                let facts = DevelopSheetFacts(file: FidelityFile(name: ref.name, origin: origin))
                picture.load(loaded.image, natural: CGSize(width: loaded.width, height: loaded.height), facts: facts)
            } else {
                let decoded = try await DevelopSheetPicture.decodeStill(url, name: ref.name, origin: origin)
                picture.load(decoded.image, natural: decoded.natural, facts: decoded.facts)
            }
        } catch {
            picture.fail(error.localizedDescription, facts: DevelopSheetFacts(file: FidelityFile(name: ref.name, origin: origin)))
            return
        }
        grade()
    }

    /// The look this picture wears, resolved — again whenever its rung or its
    /// layers change (a look edited in this very sheet).
    private func resolveLook() async {
        guard !model.isCta else { return }
        resolved = await LookLibrary.shared.resolve(TripSlideLooks.rollGrade(model.gradeShown))
        grade()
    }

    /// The draft develop FIRST, then the look on its rung and its film.
    private func grade() {
        let film = model.isCta ? nil : model.gradeShown.film
        let look = DevelopSheetLook(look: resolved, film: film, grader: grader,
                                    interpolation: LookLibrary.shared.interpolation)
        picture.grade(draft, through: look)
    }
}

#Preview("Develop sheet") {
    PieceDevelopSheet(model: PieceEditorFixtures.model())
        .environment(PresetBookStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")))
        .environment(LookLibrary.shared)
}
