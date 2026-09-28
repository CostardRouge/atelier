// The look an instrument grades through — the web's `useLutSelection` +
// `LutPicker` (`src/shared/lut/`), shared by LUT Studio and the Composer as
// it is on the web, plus the two render choices the Studio's `GradePanel`
// carries: the lattice's interpolation (a per-device preference, as the
// web's `localStorage['atelier.lut.interpolation']`) and the output
// transform (`Transfer.swift`).
//
// The BUILT-IN looks are the bundle's (`public/luts/`, 37 MB, bundled whole —
// the coordinator's call), read through the ONE helper every look reader uses
// (`Look/BuiltinLutFiles.swift`), grouped as the web's picker groups them.
// The grid button opens the look gallery (`Look/LookGalleryView.swift`) with
// "No LUT (original)" first, as the web's `LutPicker` does; a pack look or a
// film stock picked there is resolved to its lattice and worn in the
// uploaded slot, named. A `.cube` the person owns still loads from Files.
//
// The strength is the web LUT Studio's own: with no output transform the
// cube pass blends the look against the original at its strength, exactly
// the web's shader; with one, the kernel's `composeLutStack` bakes the look
// at its strength and THEN the transform into one cube drawn at full
// strength — a strength applied after the transform would scale the
// transform too.

import Foundation
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

/// A look ready to render: the lattice and how to read it. A value, so a
/// render off the main actor takes it as it was when asked.
struct LookGrade: Sendable, Equatable {
    let lut: CubeLut
    /// Bumped per loaded file — what a cache and a view key the lattice on
    /// without comparing 65³ numbers.
    let serial: Int
    let name: String
    let intensity: Double
    let interpolation: Interpolation
    let output: OutputTransform

    static func == (a: LookGrade, b: LookGrade) -> Bool {
        a.serial == b.serial && a.name == b.name && a.intensity == b.intensity
            && a.interpolation == b.interpolation && a.output == b.output
    }
}

/// The lattice and strength a `CubePass` is handed for a grade, the one bake
/// an output transform costs kept until the grade changes.
final class LookCubes: @unchecked Sendable {
    private let lock = NSLock()
    private var key: LookGrade?
    private var baked: CubeLut?

    func resolve(_ grade: LookGrade) -> (lut: CubeLut, intensity: Double) {
        if grade.output == OutputTransform.none { return (grade.lut, grade.intensity) }
        lock.lock()
        defer { lock.unlock() }
        if let key, key == grade, let baked { return (baked, 1) }
        let layer = LutLayer(id: "look", source: "custom", name: grade.name, lut: grade.lut,
                             intensity: grade.intensity)
        let composed = composeLutStack([layer], output: grade.output, interpolation: grade.interpolation) ?? grade.lut
        key = grade
        baked = composed
        return (composed, 1)
    }
}

@MainActor
@Observable
final class InstrumentLook {
    /// The picker's value: the web's `'none' | builtin id | 'custom'`.
    enum Choice: Hashable {
        /// "No LUT (original)".
        case original
        /// A built-in, by its manifest id.
        case builtin(String)
        case custom
    }

    private(set) var choice: Choice = .original
    /// The uploaded look, kept while another is chosen (the web's `customLut`).
    private(set) var customLut: CubeLut?
    private(set) var customName: String?
    /// The built-in worn now, parsed from the bundle.
    private(set) var builtinLut: CubeLut?
    private(set) var builtinName: String?
    private(set) var cubeError: String?
    private(set) var busy = false
    /// Strength, 0…3 — 100 % is the look as authored; it persists across looks.
    var intensity: Double = 1
    var output: OutputTransform = OutputTransform.none
    private(set) var interpolation: Interpolation = InstrumentLook.storedInterpolation()
    /// Bumped per loaded file.
    private(set) var lutSerial = 0

    /// The look to grade through, or nil for the original.
    var lut: CubeLut? {
        switch choice {
        case .original: return nil
        case .builtin: return builtinLut
        case .custom: return customLut
        }
    }

    func choose(_ next: Choice) {
        cubeError = nil
        switch next {
        case .original:
            choice = .original
        case .custom:
            choice = customLut == nil ? .original : .custom
        case .builtin(let id):
            Task { await loadBuiltin(id) }
        }
    }

    /// A built-in from the bundle, parsed off the main actor, chosen once read.
    func loadBuiltin(_ id: String) async {
        cubeError = nil
        busy = true
        let parsed = await BuiltinLutFiles.loadCube(id)
        busy = false
        guard let parsed, let entry = BuiltinLutFiles.lut(id) else {
            cubeError = "That look is no longer available."
            return
        }
        builtinLut = parsed
        builtinName = entry.name
        lutSerial += 1
        choice = .builtin(id)
    }

    /// What the gallery rings: the worn look's pick id.
    var galleryId: String? {
        switch choice {
        case .original: return "none"
        case .builtin(let id): return id
        case .custom: return nil
        }
    }

    /// A pick from the look gallery, at the strength it was judged at — the
    /// gallery's slider IS this one from the moment of the pick.
    func pick(_ id: String, strength: Double, library: LookLibrary) async {
        intensity = strength
        if id == "none" {
            choose(.original)
            return
        }
        if BuiltinLutFiles.lut(id) != nil {
            await loadBuiltin(id)
            return
        }
        // A pack look (or a film stock): resolved to its lattice and worn in
        // the uploaded slot, under its own name.
        let item = library.nodes(includeFilm: true, live: false).lazy.flatMap(\.items).first { $0.id == id }
        guard let item else { return }
        cubeError = nil
        busy = true
        let answer = await library.resolve(item.resolve)
        busy = false
        switch answer {
        case .cube(let parsed):
            customLut = parsed
            customName = item.name
            lutSerial += 1
            choice = .custom
        case .missing(let why):
            cubeError = why
        }
    }

    /// Lattice interpolation is a RENDER preference of this device, never a
    /// document's — the web's rule and key.
    func setInterpolation(_ mode: Interpolation) {
        interpolation = mode
        UserDefaults.standard.set(mode.rawValue, forKey: InstrumentLook.interpolationKey)
    }

    nonisolated static let interpolationKey = "atelier.lut.interpolation"

    nonisolated static func storedInterpolation() -> Interpolation {
        UserDefaults.standard.string(forKey: interpolationKey) == Interpolation.trilinear.rawValue
            ? .trilinear : .tetrahedral
    }

    /// A `.cube` from Files — read under its security scope, parsed by the
    /// kernel off the main actor, chosen at once.
    func load(_ url: URL) async {
        cubeError = nil
        busy = true
        let name = url.lastPathComponent
        let parsed = await Task.detached(priority: .userInitiated) { () -> CubeLut? in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return nil }
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
                return nil
            }
            return parseCube(text)
        }.value
        busy = false
        guard let parsed else {
            cubeError = "\(name) isn't a supported 3D .cube LUT (1D LUTs aren't supported)."
            return
        }
        customLut = parsed
        customName = name
        lutSerial += 1
        choice = .custom
    }

    /// What a renderer is handed now, or nil for the original.
    var grade: LookGrade? {
        guard let lut else { return nil }
        let name = choice == .custom ? customName : builtinName
        return LookGrade(lut: lut, serial: lutSerial, name: name ?? "Look", intensity: intensity,
                         interpolation: interpolation, output: output)
    }
}

// MARK: - the bar

/// The "Look" control: the picker, Upload .cube, the strength — and, where
/// the instrument asks for them, the interpolation and the output transform.
struct InstrumentLookControls: View {
    let look: InstrumentLook
    /// LUT Studio shows the render choices; the Composer, as on the web, does not.
    var showsRender = true
    @State private var importing = false
    @State private var browsing = false
    @Environment(\.palette) private var palette
    @Environment(LookLibrary.self) private var library

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                InstrumentRowLabel("Look")
                Button {
                    browsing = true
                } label: {
                    Image(systemName: "square.grid.2x2")
                }
                .buttonStyle(.borderless)
                .help("Browse looks with a live preview")
                .accessibilityLabel("Browse looks with a live preview")
                picker
                Button {
                    importing = true
                } label: {
                    Label("Upload .cube", systemImage: "square.and.arrow.up")
                        .font(Brand.sans(12, weight: .semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help("Load your own 3D .cube LUT")
                .disabled(look.busy)
                if look.busy { ProgressView().controlSize(.small) }
            }
            if !BuiltinLutFiles.available {
                Text("The built-in looks are not in this build — upload your own .cube.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
            }
            if look.choice != .original { strength }
            if showsRender { renderChoices }
        }
        .lookGallery(isPresented: $browsing) {
            LookGalleryView(selected: look.galleryId, allowNone: true, intensity: look.intensity, onPick: { id, strength in
                browsing = false
                Task { await look.pick(id, strength: strength, library: library) }
            }, onClose: { browsing = false })
            .environment(library)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [InstrumentFileTypes.cube, .data],
                      allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first {
                Task { await look.load(url) }
            }
        }
    }

    private var picker: some View {
        let selection = Binding<InstrumentLook.Choice>(
            get: { look.choice },
            set: { look.choose($0) }
        )
        return Picker("Look", selection: selection) {
            Text("No LUT (original)").tag(InstrumentLook.Choice.original)
            ForEach(BuiltinLutFiles.ungrouped, id: \.id) { lut in
                Text(lut.name).tag(InstrumentLook.Choice.builtin(lut.id))
            }
            ForEach(BuiltinLutFiles.groups, id: \.label) { group in
                Section(group.label) {
                    ForEach(group.luts, id: \.id) { lut in
                        Text(lut.name).tag(InstrumentLook.Choice.builtin(lut.id))
                    }
                }
            }
            if let name = look.customName {
                Text("\(name) (uploaded)").tag(InstrumentLook.Choice.custom)
            }
        }
        .labelsHidden()
        .fixedSize()
        .disabled(look.busy)
    }

    /// 0 % (original) → 100 % (as authored) → 300 % (over-applied). A tap on
    /// the readout puts it back to 100 %, the web's double-click.
    private var strength: some View {
        let value = Binding<Double>(get: { look.intensity }, set: { look.intensity = $0 })
        return HStack(spacing: 10) {
            InstrumentRowLabel("Intensity")
            Slider(value: value, in: 0...maxLayerIntensity, step: 0.01)
                .tint(palette.accent)
                .frame(maxWidth: 220)
                .accessibilityLabel("LUT intensity")
            Button {
                look.intensity = 1
            } label: {
                Text("\(Int((look.intensity * 100).rounded()))%")
                    .font(Brand.mono(12))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
                    .frame(minWidth: 44, alignment: .trailing)
            }
            .buttonStyle(.plain)
            .help("LUT strength (tap to reset to 100%)")
        }
    }

    private var renderChoices: some View {
        let interpolation = Binding<Interpolation>(get: { look.interpolation }, set: { look.setInterpolation($0) })
        let output = Binding<OutputTransform>(get: { look.output }, set: { look.output = $0 })
        let interpolationHint = look.interpolation == .tetrahedral
            ? "Reads the 4 lattice corners that matter, so greys stay grey — what Resolve uses."
            : "Averages all 8 corners: faster, and it can tint greys. Look at skies and gradients."
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                InstrumentRowLabel("Interpolation")
                Picker("Interpolation", selection: interpolation) {
                    Text("Tetrahedral").tag(Interpolation.tetrahedral)
                    Text("Trilinear").tag(Interpolation.trilinear)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 240)
            }
            Text(interpolationHint)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                InstrumentRowLabel("Output")
                Picker("Output transform", selection: output) {
                    ForEach(OutputTransform.allCases, id: \.self) { transform in
                        Text(transform.label).tag(transform)
                    }
                }
                .labelsHidden()
                .fixedSize()
            }
            Text(look.output.hint)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

#Preview("Look controls") {
    InstrumentLookControls(look: InstrumentLook())
        .padding()
        .environment(LookLibrary.preview)
}
