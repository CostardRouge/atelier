// "Choose a look" — the web's `LutGalleryModal.tsx`, tool-agnostic: Develop's
// Look section, the LUT instrument, and Trips and the Studio once they land,
// all open this one sheet.
//
// A rail of families on the left (★ Favourites, the film stocks, the
// built-ins and their folders, one branch per pack — variant B of
// `docs/lut-packs.md` §6, the maintainer's choice), a grid of looks on a real
// photograph on the right, and — where the host handed its picture over — the
// SCENE above them: the aimed look on that picture, with the STRENGTH it is
// judged at and a before/after wipe. With a scene a tap AIMS and the pick is
// the second tap, "Use this look" or Return; without one a tap IS the pick.
//
// On a phone the GRID is what the screen is for (the maintainer's report on
// the web: "we barely see the look we want to pick"), so the compact width is
// a different arrangement of the same parts rather than the same one squeezed:
// a one-row header; the scene at a quarter of the height with ONE row under
// it (the strength and the Compare switch — the wipe is the drag across the
// picture); the filter beside a ⋯ holding the "tiles on…" choices; the
// families as ONE swipeable line of crumbs pinned above the grid; and "Use
// this look" in a footer in the thumb's reach. On a wide screen the sheet is
// as tall as the screen allows and the scene takes a SHARE of it, so every
// point a taller screen brings is a point of grid.

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct LookGalleryView: View {
    let title: String
    let onPick: (String, Double) -> Void
    let onClose: () -> Void
    @State private var model: LookGalleryModel

    /// - Parameters:
    ///   - selected: the worn look — a built-in id, `film:<stock>`, `pack:<pack>/<look>` or `none`.
    ///   - allowNone: a "No look (original)" tile first — a single-pick control wants it.
    ///   - includeFilm: the film stocks' family — a stack's "Add a look" offers them.
    ///   - picture: the host's picture, OFFERED to the scene; nil where the host has none.
    ///   - intensity: what the strength starts at — a host adding a layer leaves it at 1.
    ///   - onPick: the look, and how strongly the author judged it.
    init(title: String = "Choose a look", selected: String? = nil, allowNone: Bool = false,
         includeFilm: Bool = false, picture: LookPicture? = nil, intensity: Double = 1,
         onPick: @escaping (String, Double) -> Void, onClose: @escaping () -> Void) {
        self.title = title
        self.onPick = onPick
        self.onClose = onClose
        _model = State(initialValue: LookGalleryModel(selected: selected, allowNone: allowNone, includeFilm: includeFilm,
                                                      picture: picture, intensity: intensity))
    }

    var body: some View {
        LookGalleryContent(title: title, model: model, onPick: onPick, onClose: onClose)
            // A picker is paper, like the web's modal portalled out of the
            // darkroom: it is a place you pick FROM.
            .environment(\.palette, .paper)
    }
}

private struct LookGalleryContent: View {
    let title: String
    @Bindable var model: LookGalleryModel
    let onPick: (String, Double) -> Void
    let onClose: () -> Void

    @Environment(LookLibrary.self) private var library
    @Environment(\.palette) private var palette
    @State private var choosingFile = false
    @State private var choosingPhoto = false
    @State private var askingWhere = false
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 820
            let nodes = model.nodes(library)
            Group {
                if compact {
                    compactLayout(nodes, height: geo.size.height)
                } else {
                    regularLayout(nodes, height: geo.size.height)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .background(palette.surface)
        .task { await model.start(library) }
        .sheet(isPresented: $model.packsOpen) {
            PackManagerView()
                .environment(library)
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            Task {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else {
                    model.failImage(url.lastPathComponent)
                    return
                }
                await model.useCustom(data: data, name: url.lastPathComponent)
            }
        }
        .photosPicker(isPresented: $choosingPhoto, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                photoItem = nil
                guard let data else {
                    model.failImage("that photo")
                    return
                }
                await model.useCustom(data: data, name: "Photo")
            }
        }
        .confirmationDialog("Preview on a photo", isPresented: $askingWhere) {
            Button("From Photos…") { choosingPhoto = true }
            Button("From Files…") { choosingFile = true }
        }
        #if os(macOS)
        .frame(minWidth: 860, idealWidth: 1180, minHeight: 620, idealHeight: 860)
        #endif
    }

    // MARK: - the two arrangements

    private func regularLayout(_ nodes: [GalleryNode], height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            header(compact: false)
            if model.scene {
                Hairline()
                regularScene(height: height)
            }
            sourceBar
            if let error = model.imageError { errorLine(error) }
            HStack(alignment: .top, spacing: 16) {
                rail(nodes)
                    .frame(width: 216)
                Rectangle().fill(palette.line).frame(width: 1)
                grid(nodes, compact: false)
            }
            .frame(maxHeight: .infinity)
            Hairline()
            HStack {
                Text("Baked from the same lattice the export uses — what you see here is what you get.")
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.muted)
                Spacer(minLength: 8)
                Button("Close", action: onClose)
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 22)
        .padding(.bottom, 18)
    }

    private func compactLayout(_ nodes: [GalleryNode], height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            header(compact: true)
            if model.scene { compactScene(height: height) }
            HStack(spacing: 8) {
                sampleThumb
                filterField(compact: true)
                sourceMenu
            }
            if let error = model.imageError { errorLine(error) }
            crumbs(nodes)
            grid(nodes, compact: true)
                .frame(maxHeight: .infinity)
            if model.scene {
                Hairline()
                HStack(spacing: 12) {
                    Text(footerLine)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    useThisLook(prominent: true)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
    }

    // MARK: - the header

    private func header(compact: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Brand.display(compact ? 22 : 30))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                if !compact {
                    Text(model.scene
                         ? "Aim a look to see it on your picture — click it again to use it."
                         : "Every look, on a real picture — click one to use it.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                }
            }
            Spacer(minLength: 8)
            // Purchased packs live in this device's vault, not in the build, so
            // importing one is a verb of the picker.
            Button("Packs…") { model.packsOpen = true }
                .buttonStyle(.borderless)
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Close")
            .keyboardShortcut(compact ? KeyboardShortcut.cancelAction : nil)
        }
    }

    // MARK: - the scene

    private func sceneView() -> some View {
        LookSceneView(
            original: model.sceneOriginal,
            graded: model.sceneGraded,
            compare: model.compare,
            splitX: model.splitX,
            onSplit: { x in
                model.compare = true
                model.splitX = x
            },
            busy: model.aimedBusy,
            error: model.aimedError,
            resetKey: model.picture?.key ?? ""
        )
    }

    private func regularScene(height: CGFloat) -> some View {
        let band = min(336, max(208, height * 0.28))
        return HStack(alignment: .top, spacing: 16) {
            sceneView()
                .frame(maxWidth: .infinity)
                .frame(height: band)
            VStack(alignment: .leading, spacing: 8) {
                Text(model.aimedName(library) ?? "Your picture, as it is")
                    .font(Brand.sans(16, weight: .medium))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                Text(sceneFileLine)
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.muted)
                    .lineLimit(2)
                // The comparison: what the picture is worth against the
                // original, said with a control you can put anywhere — moving
                // it turns the wipe ON.
                HStack(spacing: 10) {
                    compareToggle
                    Slider(value: Binding(get: { model.splitX }, set: { value in
                        model.compare = true
                        model.splitX = value
                    }), in: 0...1)
                    .accessibilityLabel("Where the before/after divider sits")
                }
                .padding(.top, 4)
                HStack(spacing: 10) {
                    Text("STRENGTH")
                        .font(Brand.mono(10))
                        .kerning(1.2)
                        .foregroundStyle(palette.muted)
                    strengthSlider
                }
                if let note = sceneNote(model.aimedFamily(library), sourceIsLog: model.picture?.isLog ?? false) {
                    Text(note)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.warn)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(palette.warn.opacity(0.1), in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.warn.opacity(0.35), lineWidth: 1))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    useThisLook(prominent: false)
                    Text("One lattice read — and the strength goes with your pick.")
                        .font(Brand.sans(11))
                        .foregroundStyle(palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(width: 336, height: band, alignment: .topLeading)
        }
    }

    private func compactScene(height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sceneView()
                .frame(height: max(128, height * 0.25))
            HStack(spacing: 8) {
                if noLook {
                    Text(model.aimedName(library) ?? "Your picture, as it is")
                        .font(Brand.sans(14, weight: .medium))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    strengthSlider
                }
                if let note = sceneNote(model.aimedFamily(library), sourceIsLog: model.picture?.isLog ?? false) {
                    Circle()
                        .fill(palette.warn)
                        .frame(width: 8, height: 8)
                        .help(note)
                        .accessibilityLabel(note)
                }
                compareToggle
            }
        }
    }

    /// The picture's name, and what the scene shows of it.
    private var sceneFileLine: String {
        var parts: [String] = []
        if let label = model.picture?.label { parts.append(label) }
        if model.aimed != nil { parts.append("the look alone, without your correction") }
        return parts.joined(separator: " · ")
    }

    /// No look is aimed: the strength has nothing to strengthen.
    private var noLook: Bool { model.aimed == nil || model.aimed == "none" }

    /// The strength, beside the picture it is judged on — shown disabled
    /// rather than hidden, so the row does not come and go under the pointer.
    private var strengthSlider: some View {
        HStack(spacing: 8) {
            Slider(value: Binding(get: { model.strength }, set: { model.setStrength($0) }),
                   in: 0...maxLayerIntensity, step: 0.05)
                .disabled(noLook)
                .accessibilityLabel("How strongly the look is applied")
            Button {
                model.setStrength(1)
            } label: {
                Text("\(Int((model.strength * 100).rounded()))%")
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .foregroundStyle(palette.muted)
                    .frame(minWidth: 40, alignment: .trailing)
            }
            .buttonStyle(.plain)
            .help("How strongly the look is applied (tap for 100%)")
        }
    }

    /// The wipe as a switch: what it IS, not what pressing it does.
    private var compareToggle: some View {
        Button {
            model.compare.toggle()
        } label: {
            Text("COMPARE")
                .font(Brand.mono(10))
                .kerning(0.8)
                .foregroundStyle(model.compare ? palette.accentInk : palette.muted)
                .padding(.horizontal, 8)
                .frame(height: 28)
                .background(model.compare ? palette.accentWash : palette.paper,
                            in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius)
                    .stroke(model.compare ? palette.accent : palette.lineStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.compare ? .isSelected : [])
        .help(model.compare ? "Show the graded picture whole" : "Wipe it against the original")
    }

    private func useThisLook(prominent: Bool) -> some View {
        Button("Use this look") {
            if let aimed = model.aimed { onPick(aimed, model.strength) }
        }
        .modifier(ProminentIf(prominent: prominent))
        .disabled(model.aimed == nil || model.aimedBusy)
        .keyboardShortcut(.defaultAction)
    }

    private var footerLine: String {
        guard let name = model.aimedName(library) else { return "Tap a look to see it on your picture." }
        return noLook || model.strength == 1 ? name : "\(name) · \(Int((model.strength * 100).rounded()))%"
    }

    // MARK: - what the tiles are shown on

    @ViewBuilder
    private var sampleThumb: some View {
        if model.effectiveSource != nil, let tile = model.noneTile {
            Image(decorative: tile, scale: 1, orientation: .up)
                .resizable()
                .scaledToFill()
                .frame(width: 32, height: 32)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(palette.line, lineWidth: 1))
                .help(model.sourceLine)
        }
    }

    private var sourceBar: some View {
        HStack(spacing: 12) {
            sampleThumb
            Text(model.sourceLine)
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
                .lineLimit(1)
            ForEach(sourceVerbs, id: \.id) { verb in
                Button(verb.label, action: verb.run)
                    .buttonStyle(.borderless)
                    .font(Brand.sans(12, weight: .semibold))
                    .disabled(verb.disabled)
            }
            Spacer(minLength: 8)
            filterField(compact: false)
                .frame(minWidth: 192, maxWidth: 352)
        }
        .padding(.vertical, 10)
        .overlay(alignment: .top) { Hairline() }
        .overlay(alignment: .bottom) { Hairline() }
    }

    private var sourceMenu: some View {
        Menu {
            Text(model.sourceLine)
            ForEach(sourceVerbs, id: \.id) { verb in
                Button(verb.label, action: verb.run).disabled(verb.disabled)
            }
        } label: {
            Image(systemName: "ellipsis")
                .frame(width: 34, height: 34)
                .background(palette.paper, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.lineStrong, lineWidth: 1))
        }
        .menuIndicator(.hidden)
        .accessibilityLabel("What the tiles are shown on")
    }

    private struct SourceVerb {
        let id: String
        let label: String
        var disabled = false
        let run: () -> Void
    }

    private var sourceVerbs: [SourceVerb] {
        var verbs: [SourceVerb] = []
        if model.picture != nil && model.liveOn != .open {
            verbs.append(SourceVerb(id: "open", label: model.scene ? "Tiles on my picture too" : "Preview on the open picture") {
                model.showOnOpenPicture()
            })
        }
        let customLabel: String
        if model.imageBusy {
            customLabel = "Reading…"
        } else if model.hasCustomPicture, let name = model.customLabel {
            customLabel = "Preview on “\(name)”"
        } else {
            customLabel = "Preview on a photo…"
        }
        verbs.append(SourceVerb(id: "custom", label: customLabel, disabled: model.imageBusy || model.liveOn == .custom) {
            if model.hasCustomPicture {
                model.showOnCustom()
            } else {
                #if os(iOS)
                askingWhere = true
                #else
                choosingFile = true
                #endif
            }
        })
        if model.liveOn != nil {
            verbs.append(SourceVerb(id: "reference", label: "Use the reference frames") { model.showOnReference() })
        }
        return verbs
    }

    private func filterField(compact: Bool) -> some View {
        TextField("Filter looks…", text: $model.query)
            .textFieldStyle(.roundedBorder)
            // 16 points on a phone, or iOS zooms on focus — the web's rule; a
            // native field does not zoom, and keeps the size for the thumb.
            .font(Brand.sans(compact ? 16 : 13))
            .accessibilityLabel("Filter looks")
            #if os(iOS)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            #endif
    }

    private func errorLine(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(12))
            .foregroundStyle(palette.danger)
    }

    // MARK: - the rail and the crumbs

    private func rail(_ nodes: [GalleryNode]) -> some View {
        let filtering = !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let openId = model.open(nodes)?.id
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(nodes, id: \.id) { node in
                    RailRow(node: node, open: !filtering && node.id == openId) { model.openNode(node) }
                }
            }
            .padding(.trailing, 4)
        }
        .accessibilityLabel("Look families")
    }

    private func crumbs(_ nodes: [GalleryNode]) -> some View {
        let openId = model.open(nodes)?.id
        return ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.crumbs(nodes), id: \.id) { node in
                        let isOpen = node.id == openId
                        Button {
                            model.openNode(node)
                        } label: {
                            HStack(spacing: 6) {
                                (Text(node.depth > 0 ? "› " : "").foregroundStyle(palette.muted)
                                    + Text(node.label))
                                    .font(Brand.sans(14))
                                    .lineLimit(1)
                                Text("\(node.items.count)")
                                    .font(Brand.mono(10))
                                    .foregroundStyle(palette.muted)
                                    .monospacedDigit()
                            }
                            .foregroundStyle(isOpen ? palette.accentInk : palette.inkSoft)
                            .padding(.horizontal, 12)
                            .frame(height: 34)
                            .background(isOpen ? palette.accentWash : palette.paper, in: Capsule())
                            .overlay(Capsule().stroke(isOpen ? palette.accent : palette.lineStrong, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .id(node.id)
                        .accessibilityAddTraits(isOpen ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 12)
            }
            .padding(.horizontal, -12)
            .onChange(of: openId) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.2)) { reader.scrollTo(id) }
            }
        }
        .accessibilityLabel("Look families")
    }

    // MARK: - the grid

    private func grid(_ nodes: [GalleryNode], compact: Bool) -> some View {
        let shown = model.shown(nodes).enumerated().map { ShownSection(index: $0.offset, node: $0.element.node, items: $0.element.items) }
        let pending = shown.flatMap(\.items).filter { $0.thumb == nil }
        let filtering = !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let noneAlone = model.showsNone && !(compact && !shown.isEmpty)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if noneAlone {
                    LazyVGrid(columns: columns, spacing: 8) { noneTile(compact: compact) }
                }
                ForEach(shown) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        if !compact || filtering || section.node.pack != nil || section.node.hint != nil {
                            sectionHeader(section.node)
                        }
                        if model.credits == section.node.id, let pack = section.node.pack {
                            credits(pack)
                        }
                        LazyVGrid(columns: columns, spacing: 8) {
                            if model.showsNone && compact && section.index == 0 { noneTile(compact: compact) }
                            ForEach(section.items, id: \.id) { item in
                                tile(item, compact: compact)
                            }
                        }
                    }
                }
                if shown.isEmpty && !model.showsNone {
                    Text(filtering ? "No look matches “\(model.query)”." : "Nothing here yet.")
                        .font(Brand.sans(14))
                        .foregroundStyle(palette.muted)
                }
            }
            .padding(.bottom, 12)
        }
        .task(id: model.bakeKey(pending)) {
            await model.bake(pending, library)
        }
    }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 88), spacing: 8)]
    }

    private func sectionHeader(_ node: GalleryNode) -> some View {
        HStack(spacing: 8) {
            Text(node.label.uppercased())
                .font(Brand.mono(10))
                .kerning(1.6)
                .foregroundStyle(palette.muted)
            if node.pack != nil {
                Button {
                    model.credits = model.credits == node.id ? nil : node.id
                } label: {
                    Image(systemName: "info.circle").font(.system(size: 12))
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("About \(node.label)")
            }
            if let hint = node.hint {
                Text(hint)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.warn)
            }
        }
    }

    /// Who made the pack and where it came from — credits behind an ⓘ.
    private func credits(_ pack: LutPackIndex) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(pack.name.isEmpty ? "Pack" : pack.name)
                    .font(Brand.sans(12, weight: .medium))
                    .foregroundStyle(palette.ink)
                if !pack.author.isEmpty {
                    Text("— \(pack.author)")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.inkSoft)
                }
                if let link = pack.url, let url = URL(string: link) {
                    Text("·").foregroundStyle(palette.muted)
                    Link("where it came from", destination: url)
                        .font(Brand.sans(12))
                }
            }
            Text("Bought looks, kept on this device — they never leave it.")
                .font(Brand.sans(12))
                .foregroundStyle(palette.muted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.paper2, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }

    /// What the ring sits on: the aimed look, or the worn one where nothing can aim.
    private var ringed: String? { model.scene ? model.aimed : model.selected }

    private func noneTile(compact: Bool) -> some View {
        let shipped = model.effectiveSource == nil ? BuiltinLutFiles.thumbs["none"].flatMap { LookTiles.shared.image($0) } : nil
        return LookTileView(name: "No look (original)", image: shipped ?? model.noneTile,
                            selected: model.selected == "none", aimed: ringed == "none", compact: compact,
                            onPick: { touch("none") })
    }

    private func tile(_ item: GalleryItem, compact: Bool) -> some View {
        let image = item.thumb.flatMap { LookTiles.shared.image($0) } ?? model.liveTiles[item.id]
        return LookTileView(
            name: item.name,
            image: image,
            failed: model.failedTiles.contains(item.id),
            selected: model.selected == item.id,
            aimed: ringed == item.id,
            favourite: library.isFavourite(item.id),
            compact: compact,
            onPick: { touch(item.id) },
            onToggleFavourite: { library.toggleFavourite(item.id) }
        )
    }

    private func touch(_ id: String) {
        model.touch(id, library) { pickId, strength in onPick(pickId, strength) }
    }
}

/// One family's looks on screen — the open node, or a filter's match.
private struct ShownSection: Identifiable {
    let index: Int
    let node: GalleryNode
    let items: [GalleryItem]
    var id: String { node.id }
}

/// One family in the rail: its name, its depth, how many looks it holds.
private struct RailRow: View {
    let node: GalleryNode
    let open: Bool
    let onOpen: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 8) {
                Text(node.label)
                    .font(Brand.sans(13, weight: node.depth == 0 ? .medium : .regular))
                    .foregroundStyle(open ? palette.accentInk : (node.depth == 0 ? palette.ink : palette.inkSoft))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if node.hint != nil {
                    Text("•").foregroundStyle(palette.warn).accessibilityHidden(true)
                }
                Text("\(node.items.count)")
                    .font(Brand.mono(10))
                    .foregroundStyle(palette.muted)
                    .monospacedDigit()
            }
            .padding(.vertical, 6)
            .padding(.trailing, 8)
            .padding(.leading, 8 + CGFloat(node.depth) * 13.6)
            .background(open ? palette.accentWash : Color.clear, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(node.hint ?? node.label)
        .accessibilityAddTraits(open ? .isSelected : [])
    }
}

/// `.borderedProminent` where the verb is the one in the thumb's reach, the
/// plain bordered button elsewhere.
private struct ProminentIf: ViewModifier {
    let prominent: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if prominent {
            content.buttonStyle(.borderedProminent)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}

// MARK: - presenting it

extension View {
    /// Present the gallery the way the platform presents a picker as tall as
    /// the screen: the whole screen on a phone and an iPad, a large sheet on
    /// a Mac.
    func lookGallery<Content: View>(isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content) -> some View {
        #if os(iOS)
        return fullScreenCover(isPresented: isPresented, content: content)
        #else
        return sheet(isPresented: isPresented, content: content)
        #endif
    }
}

#Preview("Gallery, with a picture") {
    LookGalleryView(includeFilm: true, picture: LookFixtures.picture, onPick: { _, _ in }, onClose: {})
        .environment(LookLibrary.preview)
}

#Preview("Gallery, phone") {
    LookGalleryView(allowNone: true, onPick: { _, _ in }, onClose: {})
        .environment(LookLibrary.preview)
        .frame(width: 390, height: 844)
}
