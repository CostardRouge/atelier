// The Trips DEVELOP sheet — the web's `DevelopSheet` as the piece editor opens
// it from the Picture tab's settled row (`roadtrip.md`, «A picture's DEVELOP
// is per slide, and the sheet's draft rides the stack»; `PostEditor.tsx`):
// the SELECTED cell's own correction, drawn by the very Develop panels
// (`Develop/Panels/*`) over a DRAFT, with the picture it is judged on — a
// still, or a clip's frame at the slide's in point (never live).
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
    @State private var source: CIImage?
    @State private var problem: String?
    @State private var resolved: ResolvedLook?
    @State private var renderer = StageRenderer()
    @State private var grader = FrameGrader()
    @State private var histogram: Histogram?
    @State private var stats: SourceStats?
    @State private var told: String?
    @State private var naming = false
    @State private var presetName = ""
    @State private var seeded = false
    @State private var picking = false
    @State private var canPaste = hasCopiedDevelop()
    @State private var unsubscribe: (() -> Void)?

    /// The preview's long edge — a sheet's picture, never the file's density.
    private static let previewEdge = 1600

    private var title: String { model.cellRef?.name ?? "this slide" }
    private var asShot: Bool { isDefaultDevelop(draft) }

    var body: some View {
        lifecycle(presented(NavigationStack { column }))
    }

    private var column: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                picture
                    .padding(.bottom, 12)
                DevelopHistogramView(histogram: histogram)
                    .padding(.bottom, 8)
                clipboardRow
                    .padding(.bottom, 4)
                DevelopAutoSection(settings: $draft, stats: stats, picking: picking,
                                   onPicking: { picking = $0 }, onTold: { told = $0 })
                DevelopSlidersSection(settings: $draft, foldPrefix: "trips.")
                WhiteBalanceSection(settings: $draft, white: nil)
                DevelopLevelsSection(settings: $draft)
                DevelopCurveSection(settings: $draft, histogram: histogram, foldPrefix: "trips.")
                DevelopMixerSection(settings: $draft)
                DevelopGradingSection(settings: $draft)
                presetsRow
                applyRow
                lookRow
                footer
            }
            .padding(16)
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
            .frame(minWidth: 520, minHeight: 700)
            #endif
            .darkroom()
    }

    private func lifecycle(_ content: some View) -> some View {
        content
            .task { await seed() }
            .task(id: gradeKey(model.gradeShown)) { await resolveLook() }
            .onChange(of: draft) { _, _ in render() }
            .onChange(of: renderer.image.map { ObjectIdentifier($0) }) { _, _ in
                guard let image = renderer.image else { return }
                Task { histogram = await PieceDevelopSheet.measure(image) }
            }
            .onAppear {
                unsubscribe = subscribeDevelopClipboard { canPaste = hasCopiedDevelop() }
            }
            .onDisappear {
                unsubscribe?()
                unsubscribe = nil
            }
    }

    private func done() {
        model.setDevelop(asShot ? nil : draft)
        model.developOpen = false
    }

    // MARK: - the picture

    private var picture: some View {
        GeometryReader { geo in
            ZStack {
                palette.frame
                pictureBody
            }
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { at in
                if picking { pick(at, in: geo.size) }
            }
        }
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(alignment: .top) {
            if picking {
                Text("Tap something grey")
                    .font(Brand.sans(12, weight: .semibold))
                    .foregroundStyle(palette.onMedia)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(palette.frame.opacity(0.7)))
                    .padding(.top, 8)
            }
        }
        .accessibilityLabel("The picture with this correction and the look it wears")
    }

    @ViewBuilder
    private var pictureBody: some View {
        if let image = renderer.image {
            Image(decorative: image, scale: 1)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
        } else if let problem {
            say(problem)
        } else if model.isCta {
            say("The closing card carries no photograph.")
        } else if model.cellRef == nil {
            say("This slide has no picture yet — tick one in the Library.")
        } else {
            ProgressView().tint(palette.onMedia)
        }
    }

    private func say(_ words: String) -> some View {
        Text(words)
            .font(Brand.sans(13))
            .foregroundStyle(palette.onMedia.opacity(0.8))
            .multilineTextAlignment(.center)
            .padding(24)
    }

    // MARK: - the clipboard

    private var clipboardRow: some View {
        HStack(spacing: 14) {
            Button("Copy") {
                copyDevelop(draft)
                told = "copied"
            }
            .disabled(asShot)
            .help("Keep these numbers for the next picture, in this session")
            Button("Paste") {
                if let pasted = pasteDevelop() { draft = pasted }
            }
            .disabled(!canPaste)
            .help(canPaste ? "Replace these numbers with the copied ones" : "Nothing copied yet")
            Button("As shot") { draft = .default }
                .disabled(asShot)
            Spacer(minLength: 0)
        }
        .buttonStyle(DevelopLinkButtonStyle())
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
        guard let source else { return nil }
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

    // MARK: - the grey dropper

    /// Solve the white balance on the picture AS SHOT at the tapped point,
    /// write it into the draft and put the dropper down.
    private func pick(_ at: CGPoint, in size: CGSize) {
        guard let source else { return }
        let extent = source.extent
        let rect = stageFitRect(extent.size, in: size)
        guard rect.width > 0, rect.height > 0, rect.contains(at) else { return }
        let u = Double((at.x - rect.minX) / rect.width)
        let v = Double((at.y - rect.minY) / rect.height)
        guard let linear = PieceDevelopSheet.sampleLinear(source, u: u, v: v) else { return }
        let wb = whiteBalanceFor(linear)
        draft.temperature = wb.temperature
        draft.tint = wb.tint
        told = "picked grey · temperature \(Int(wb.temperature)), tint \(Int(wb.tint))"
            + (wb.clamped ? " · as far as the sliders reach" : "")
        picking = false
    }

    /// The average of a 5 × 5 patch of `image` at `[u, v]`, in linear light.
    private static func sampleLinear(_ image: CIImage, u: Double, v: Double) -> (Double, Double, Double)? {
        let extent = image.extent
        let x = Double(extent.minX) + u * Double(extent.width)
        // Core Image counts y up from the bottom; the shares count down.
        let y = Double(extent.minY) + (1 - v) * Double(extent.height)
        let patch = CGRect(x: x - 2.5, y: y - 2.5, width: 5, height: 5).intersection(extent)
        guard !patch.isEmpty else { return nil }
        let average = image.applyingFilter("CIAreaAverage", parameters: [kCIInputExtentKey: CIVector(cgRect: patch)])
        let origin = average.extent.isInfinite ? .zero : average.extent.origin
        let bounds = CGRect(origin: origin, size: CGSize(width: 1, height: 1))
        var pixel = [Float](repeating: 0, count: 4)
        pixel.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress else { return }
            RenderContexts.shared.render(average, toBitmap: base, rowBytes: 16, bounds: bounds, format: .RGBAf, colorSpace: nil)
        }
        return (toLinear(Double(pixel[0]), .srgb), toLinear(Double(pixel[1]), .srgb), toLinear(Double(pixel[2]), .srgb))
    }

    // MARK: - rendering

    /// The draft opens on the stored value, and the picture is decoded once,
    /// at a sheet's size — a clip at the slide's in point.
    private func seed() async {
        guard !seeded else { return }
        seeded = true
        draft = model.cellDevelop ?? .default
        guard !model.isCta, let ref = model.cellRef, let url = model.url(for: ref) else { return }
        let seconds = model.cellIndex == 0 ? (model.slide?.videoTimeSeconds ?? 0) : 0
        let edge = PieceDevelopSheet.previewEdge
        let loaded: BadgeSource
        do {
            loaded = try await BadgeSources.load(url, name: ref.name, videoSeconds: seconds, budget: Double(edge * edge))
        } catch {
            problem = error.localizedDescription
            return
        }
        let fitted = FrameGrader.fit(loaded.image, longEdge: edge).image
        source = fitted
        render()
        stats = await Task.detached(priority: .userInitiated) { () -> SourceStats? in
            guard let bytes = PictureRenderer.shared.rgbaBytes(fitted, longEdge: 256) else { return nil }
            return measureSource(bytes)
        }.value
    }

    /// The look this picture wears, resolved — again whenever its rung or its
    /// layers change (a look edited in this very sheet).
    private func resolveLook() async {
        guard !model.isCta else { return }
        resolved = await LookLibrary.shared.resolve(TripSlideLooks.rollGrade(model.gradeShown))
        render()
    }

    /// The draft develop FIRST, then the look — baked off the main actor, the
    /// latest request winning, so a slider never queues behind the last step.
    private func render() {
        guard let source else { return }
        let look = resolved
        let develop = draft
        let interpolation = LookLibrary.shared.interpolation
        let film = model.isCta ? nil : model.gradeShown.film
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

#Preview("Develop sheet") {
    PieceDevelopSheet(model: PieceEditorFixtures.model())
        .environment(PresetBookStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("atelier-preview")))
        .environment(LookLibrary.shared)
}
