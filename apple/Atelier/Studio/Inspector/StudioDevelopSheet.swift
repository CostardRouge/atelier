// The Studio's DEVELOP sheet — the web's `DevelopSheet` as the Studio opens
// it from the Grade tab's settled row (`studio.md`, «A media's DEVELOP is
// bound-half»): the open media's own correction, drawn by the very Develop
// panels (`Develop/Panels/*`) over a DRAFT, with the picture it is judged on —
// a still, or the clip's frame at the moment the sheet opened (never live).
// The preview is graded as the stage grades: the draft develop FIRST, then the
// project's look, baked into one cube — correction before look, on screen as
// in the cube. The stage behind keeps the STORED value until Done.
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
    @State private var source: CIImage?
    @State private var resolved: ResolvedLook?
    @State private var renderer = StageRenderer()
    @State private var grader = FrameGrader()
    @State private var histogram: Histogram?
    @State private var stats: SourceStats?
    @State private var told: String?
    @State private var naming = false
    @State private var presetName = ""
    @State private var seeded = false

    /// The preview's long edge — a sheet's picture, never the file's density.
    private static let previewEdge = 1600

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    picture
                        .padding(.bottom, 12)
                    DevelopHistogramView(histogram: histogram)
                        .padding(.bottom, 8)
                    if let told {
                        Text(told)
                            .font(Brand.mono(11))
                            .foregroundStyle(palette.muted)
                            .padding(.bottom, 8)
                    }
                    presetsRow
                    DevelopAutoSection(settings: $draft, stats: stats, onTold: { told = $0 })
                    DevelopSlidersSection(settings: $draft, foldPrefix: "studio.")
                    WhiteBalanceSection(settings: $draft, white: nil)
                    DevelopCurveSection(settings: $draft, histogram: histogram, foldPrefix: "studio.")
                    DevelopLevelsSection(settings: $draft)
                    DevelopMixerSection(settings: $draft)
                    DevelopGradingSection(settings: $draft)
                    footer
                }
                .padding(16)
            }
            .background(palette.surface)
            .navigationTitle(editor.activeFile?.name ?? "Develop")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editor.developOpen = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        editor.setActiveDevelop(isDefaultDevelop(draft) ? nil : draft)
                        editor.developOpen = false
                    }
                }
            }
        }
        .task { await seed() }
        .onChange(of: draft) { _, _ in render() }
        .onChange(of: renderer.image.map { ObjectIdentifier($0) }) { _, _ in
            guard let image = renderer.image else { return }
            Task { histogram = await StudioDevelopSheet.measure(image) }
        }
        .alert("Save as a preset", isPresented: $naming) {
            TextField("Name", text: $presetName)
            Button("Save") {
                if presets.save(name: presetName, settings: draft) { told = "saved “\(presetName)”" }
                presetName = ""
            }
            Button("Cancel", role: .cancel) { presetName = "" }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 700)
        #endif
        .darkroom()
    }

    // MARK: - the picture

    private var picture: some View {
        ZStack {
            palette.frame
            if let image = renderer.image {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(contentMode: .fit)
            } else {
                ProgressView().tint(palette.onMedia)
            }
        }
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .accessibilityLabel("The picture with this correction and the project's look")
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

    // MARK: - rendering

    private func seed() async {
        guard !seeded else { return }
        seeded = true
        draft = editor.activeDevelop ?? .default
        guard let frame = editor.source else { return }
        let fitted = FrameGrader.fit(frame, longEdge: StudioDevelopSheet.previewEdge).image
        source = fitted
        resolved = await LookLibrary.shared.resolve(editor.edit.grade ?? RollGrade())
        stats = await Task.detached(priority: .userInitiated) { () -> SourceStats? in
            guard let bytes = PictureRenderer.shared.rgbaBytes(fitted, longEdge: 256) else { return nil }
            return measureSource(bytes)
        }.value
        render()
    }

    /// The draft develop FIRST, then the look — baked off the main actor, the
    /// latest request winning, so a slider never queues behind the last step.
    private func render() {
        guard let source else { return }
        let look = resolved
        let develop = draft
        let interpolation = LookLibrary.shared.interpolation
        let film = editor.edit.film
        let grader = self.grader
        renderer.submit {
            let cube: CubeLut?
            if let look {
                cube = look.cube(develop: develop, interpolation: interpolation)
            } else {
                cube = composeLutStack([], output: OutputTransform.none, interpolation: interpolation, develop: develop)
            }
            grader.setCube(cube, intensity: 1, interpolation: interpolation)
            grader.setFilm(FilmPass(film))
            return FrameGrader.cgImage(grader.render(source: source))
        }
    }

    /// The histogram of what the preview shows — a quarter-K draw of it.
    private static func measure(_ image: CGImage) async -> Histogram? {
        await Task.detached(priority: .utility) { () -> Histogram? in
            let width = 256
            let height = max(1, Int((Double(image.height) / Double(max(1, image.width)) * 256).rounded()))
            var bytes = [UInt8](repeating: 0, count: width * height * 4)
            guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
            let drawn = bytes.withUnsafeMutableBytes { raw -> Bool in
                guard let ctx = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                ctx.interpolationQuality = .medium
                ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                return true
            }
            return drawn ? luminanceHistogram(bytes) : nil
        }.value
    }
}
