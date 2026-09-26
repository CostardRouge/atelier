// The GRADE — a stack of looks applied top to bottom, each with its own
// strength and a bypass, then the grain and halation, then the delivery
// stage. The web's `GradePanel.tsx`, tool-agnostic: it edits a
// `Binding<RollGrade?>`, so Develop binds it to the open picture's look (roll
// v5) and Trips and the Studio will bind it to theirs with no change here.
//
// It edits the look AS STORED (`GradeEdits.swift`): a built-in by its
// `builtin:<id>`, a film stock by its settings, a pack look — an upload
// included — by its REFERENCE, never a lattice; an empty look is written as
// nil. Lattices are resolved only to SAY what cannot grade here: a pack look
// this device does not hold stays in its place and says why, where its
// strength would be, rather than grading as nothing.
//
// Order matters (a contrast look before or after a film print reads
// differently), so layers move with ↑/↓ — plain buttons, as on the web, a drag
// being fiddly in a narrow column. The stack bakes into ONE cube, so the
// stage, the stills and every export grade identically.

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct GradeStackView: View {
    @Binding var grade: RollGrade?
    /// The picture on the host's stage — the gallery's truest preview.
    var picture: LookPicture?
    /// The height in pixels the host really draws its preview at — what tells
    /// the texture whether its grain can be SEEN here. Nil claims nothing.
    var previewHeight: Double?
    /// False where the host's preview does not draw the film node.
    var previewDraws = true

    @Environment(LookLibrary.self) private var library
    @Environment(\.palette) private var palette
    @State private var galleryOpen = false
    @State private var uploading = false
    @State private var busy = false
    @State private var error: String?
    @State private var resolved: ResolvedLook?
    @State private var infoOpen = false

    private var current: RollGrade { grade ?? RollGrade() }

    /// Every write: the look as stored, nil when it is no look.
    private func write(_ next: RollGrade) {
        grade = storedLook(next)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            addRow
            if let error {
                Text(error)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            stack
            FilmTextureDialsView(texture: textureBinding, previewHeight: previewHeight, previewDraws: previewDraws)
            outputRow
            interpolationRow
            footer
        }
        .task(id: resolveKey) {
            resolved = await library.resolve(current)
        }
        .lookGallery(isPresented: $galleryOpen) {
            LookGalleryView(includeFilm: true, picture: picture, onPick: { id, strength in
                galleryOpen = false
                Task { await add(id, strength) }
            }, onClose: { galleryOpen = false })
            .environment(library)
        }
        .fileImporter(isPresented: $uploading, allowedContentTypes: [InstrumentFileTypes.cube, .data]) { result in
            if case .success(let url) = result { Task { await upload(url) } }
        }
    }

    /// Re-resolved when the look changes, and when the vault does — a pack
    /// imported a moment later turns a missing layer back into a look.
    private var resolveKey: String {
        gradeKey(grade.map { SavedGrade($0) }) + "|" + library.packs.map(\.id).joined(separator: ",")
    }

    // MARK: - adding a look

    private var addRow: some View {
        HStack(spacing: 8) {
            Text("Add a look")
                .font(Brand.sans(12))
                .foregroundStyle(palette.ink)
            Spacer(minLength: 6)
            addMenu
            Button {
                galleryOpen = true
            } label: {
                Image(systemName: "square.grid.2x2")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderless)
            .help("Browse every look on a real picture")
            .accessibilityLabel("Browse every look on a real picture")
            // An upload is kept in this device's vault and the look stores a
            // reference to it, never the lattice (`docs/lut-packs.md` §3.1).
            Button(".cube…") { uploading = true }
                .buttonStyle(DevelopPillButtonStyle())
                .help("Load a .cube file from disk — kept in this device’s vault, never written into the document")
                .disabled(busy)
        }
    }

    /// The families as the menu's sections — ★ first, then the film stocks,
    /// the built-ins, and each pack's tree written out (`pack · category`),
    /// the same grouping the gallery's rail draws.
    private var addMenu: some View {
        Menu {
            let favourites = library.favouriteItems
            if !favourites.isEmpty {
                Section("★ FAVOURITES") {
                    ForEach(favourites, id: \.id) { item in
                        Button(item.name) { pick(item.id) }
                    }
                }
            }
            Section(filmGroupLabel) {
                ForEach(filmStocks, id: \.id) { stock in
                    Button(stock.name) { pick("\(filmPick)\(stock.id.rawValue)") }
                }
            }
            ForEach(BuiltinLutFiles.ungrouped, id: \.id) { lut in
                Button(lut.name) { pick(lut.id) }
            }
            ForEach(BuiltinLutFiles.groups, id: \.label) { group in
                Section(group.label) {
                    ForEach(group.luts, id: \.id) { lut in
                        Button(lut.name) { pick(lut.id) }
                    }
                }
            }
            ForEach(Array(packSections.enumerated()), id: \.offset) { _, section in
                Section(section.label) {
                    ForEach(section.looks, id: \.id) { look in
                        Button(look.label) { pick(packPickId(section.packId, look.id)) }
                    }
                }
            }
            if !BuiltinLutFiles.available {
                Text("The built-in looks are not in this build.")
            }
        } label: {
            Text(busy ? "Loading…" : "Built-in…")
                .font(Brand.sans(12, weight: .semibold))
        }
        .fixedSize()
        .disabled(busy)
        .accessibilityLabel("Add a built-in look")
    }

    private struct PackSection {
        let label: String
        let packId: String
        let looks: [PackLook]
    }

    /// A pack's own tree, flattened into section labels — sections do not
    /// nest, so author → category → camera is written out. Hidden looks are
    /// left out.
    private var packSections: [PackSection] {
        var out: [PackSection] = []
        for pack in library.packs {
            let packLabel = (pack.name.isEmpty ? (pack.author.isEmpty ? "Pack" : pack.author) : pack.name).uppercased()
            let root = visibleLooks(pack).filter { $0.node.isEmpty }
            if !root.isEmpty { out.append(PackSection(label: packLabel, packId: pack.id, looks: root)) }
            for entry in flattenNodes(pack.tree) {
                let looks = looksUnder(pack, entry.node.id).filter { $0.node == entry.node.id }
                guard !looks.isEmpty else { continue }
                let path = nodeLabelPath(pack.tree, entry.node.id).map { $0.uppercased() }
                out.append(PackSection(label: ([packLabel] + path).joined(separator: " · "), packId: pack.id, looks: looks))
            }
        }
        return out
    }

    private func pick(_ id: String) {
        Task { await add(id, 1) }
    }

    /// A look as a new layer at the END of the stack, at the strength it was
    /// judged at (the gallery's scene) or as authored (the menu).
    private func add(_ id: String, _ intensity: Double) async {
        error = nil
        busy = true
        let made = await library.layer(forPick: id, intensity: intensity)
        busy = false
        guard let made else {
            error = "That look is no longer available."
            return
        }
        // Read AFTER the await: the look may have moved while the vault answered.
        let base = current
        if let stock = made.stock {
            write(base.addingFilm(made.layer, stock: stock))
        } else {
            write(base.adding(made.layer))
        }
    }

    /// "Upload .cube": into the vault as a look of "My looks", and the layer
    /// stores the reference — a refused store is said, never inlined.
    private func upload(_ url: URL) async {
        error = nil
        busy = true
        do {
            let uploaded = try await library.upload(url)
            let layer = packLookLayer(id: UUID().uuidString.lowercased(), ref: uploaded.ref, name: uploaded.name)
            write(current.adding(layer))
        } catch let failure as PackVaultError {
            error = failure.message
        } catch {
            self.error = "Could not read that .cube file."
        }
        busy = false
    }

    // MARK: - the stack

    @ViewBuilder
    private var stack: some View {
        let layers = current.layers
        if layers.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Stack")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Text("No look yet — the picture grades through untouched.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            ForEach(Array(layers.enumerated()), id: \.element.id) { index, layer in
                layerRow(layer, index: index, count: layers.count)
            }
        }
    }

    private func layerRow(_ layer: SavedLutLayer, index: Int, count: Int) -> some View {
        let missing = resolved?.missing[layer.id]
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Toggle(isOn: Binding(get: { layer.enabled }, set: { on in write(current.settingEnabled(layer.id, on)) })) {
                    EmptyView()
                }
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(palette.accent)
                .accessibilityLabel(layer.enabled ? "Bypass \(layer.name)" : "Enable \(layer.name)")
                Text(layer.name)
                    .font(Brand.sans(13, weight: .medium))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(layer.name)
                Spacer(minLength: 4)
                iconButton("chevron.up", "Apply earlier", disabled: index == 0) {
                    write(current.moving(layer.id, -1))
                }
                iconButton("chevron.down", "Apply later", disabled: index == count - 1) {
                    write(current.moving(layer.id, 1))
                }
                iconButton("xmark", "Remove from the stack", disabled: false) {
                    write(current.removing(layer.id))
                }
            }
            if let missing {
                // A look this device cannot grade with: the layer stays, in its
                // place, and says why rather than grading as identity.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Missing")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.ink)
                    Text(missing)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.warn)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                DevelopRangeSlider("Strength", value: layer.intensity, in: 0...maxLayerIntensity, step: 0.05, reset: 1,
                                   printed: "\(Int((layer.intensity * 100).rounded()))%") { value in
                    write(current.settingIntensity(layer.id, value))
                }
                .disabled(!layer.enabled)
            }
            if isFilmLayer(layer) {
                if let settings = readFilmSettings(layer.customText) {
                    FilmLayerDials(settings: settings) { next in
                        write(current.settingFilm(layer.id, next))
                    }
                } else {
                    Text("This film layer lost its settings — remove it and add the stock again.")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.danger)
                }
            }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(layer.enabled ? palette.accent : palette.line)
                .frame(width: 2)
        }
        .opacity(layer.enabled ? 1 : 0.6)
    }

    private func iconButton(_ symbol: String, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(disabled)
        .accessibilityLabel(label)
        .help(label)
    }

    // MARK: - the texture, the delivery stage, the lattice lookup

    private var textureBinding: Binding<FilmTexture?> {
        Binding(get: { filmTextureOrNull(current.film) }, set: { next in write(current.settingTexture(next)) })
    }

    private var outputRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Output")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Picker("Output transform", selection: Binding(get: { current.output },
                                                               set: { write(current.settingOutput($0)) })) {
                    ForEach(OutputTransform.allCases, id: \.self) { transform in
                        Text(transform.label).tag(transform)
                    }
                }
                .labelsHidden()
                .fixedSize()
            }
            // Conversion LUTs are authored for a Rec.709 reference display
            // (~gamma 2.4) while a screen shows ~2.2.
            Text(current.output.hint)
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var interpolationRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Interpolation")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.ink)
                Spacer(minLength: 8)
                Picker("Interpolation", selection: Binding(get: { library.interpolation },
                                                            set: { library.setInterpolation($0) })) {
                    Text("Tetrahedral").tag(Interpolation.tetrahedral)
                    Text("Trilinear").tag(Interpolation.trilinear)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 220)
            }
            Text(library.interpolation == .tetrahedral
                 ? "Reads the 4 lattice corners that matter, so greys stay grey — what Resolve uses."
                 : "Averages all 8 corners: faster, and it can tint greys. Look at skies and gradients.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// How looks combine is read once and true every time: behind the dot.
    /// How many are on is a state, and stays in the open.
    private var footer: some View {
        let layers = current.layers
        let active = layers.filter { $0.enabled && $0.intensity > 0 }.count
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if layers.count > 1 {
                    Text("\(active) of \(layers.count) looks active")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                }
                DevelopInfoDot(about: "how looks combine", isOpen: $infoOpen)
            }
            if infoOpen {
                DevelopNote(paragraphs: [
                    "Looks apply top to bottom and bake into one LUT — the preview, the stills and every export grade identically. Above 100% a look extrapolates past what it was authored for. A film stock goes after a conversion LUT, never before it. Its grain and halation are not in the LUT: they are drawn after it, at the size the frame is delivered at.",
                ])
            }
        }
    }
}

#Preview("Grade") {
    DevelopPreviewState(RollGrade?.some(LookFixtures.grade)) { grade in
        GradeStackView(grade: grade, picture: LookFixtures.picture, previewHeight: 1400)
    }
    .environment(LookLibrary.preview)
}
