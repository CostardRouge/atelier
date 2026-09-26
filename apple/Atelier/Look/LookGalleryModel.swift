// The look gallery's STATE — everything `LutGalleryModal.tsx` holds between
// its rail, its grid and its scene; the sheet is `LookGalleryView.swift`.
//
// The economy is the web's, measured there and kept here
// (`docs/lut-packs.md` §7, `media-pipeline.md`):
// - opening it costs NOTHING: every tile it draws was baked once already (a
//   built-in's and a film stock's shipped in the bundle, a pack look's at
//   import), so no `.cube` is read to draw a screen;
// - only the open node's looks are ever resolved — a 25-look pack of 65³
//   lattices is never decoded to draw one family;
// - "tiles on my picture" is a CHOICE, never the default: then, and only
//   then, every look on screen resolves its lattice and is baked on the
//   picture, one at a time with a turn given back between each;
// - the SCENE resolves exactly ONE lattice, the aimed look's.
//
// The STRENGTH is part of the choice (`media-pipeline.md`, «Choosing a look is
// choosing a STRENGTH»): the scene carries it, the pick hands it over, and
// the grid follows it only where it is baking live — a shipped tile was baked
// as the look was authored and the line above the grid says so.

import CoreGraphics
import CoreImage
import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class LookGalleryModel {
    /// What the tiles are shown on, when it is not their reference frames.
    enum LiveOn: Equatable {
        case open
        case custom
    }

    // MARK: - the host's

    let includeFilm: Bool
    let allowNone: Bool
    /// The worn look — ringed when nothing is aimed.
    let selected: String?
    /// The host's picture, the scene's subject — nil where the host has none.
    let picture: LookPicture?
    var scene: Bool { picture != nil }

    // MARK: - the rail and the grid

    var query = ""
    var openId: String
    /// A pack node whose credits are unfolded.
    var credits: String?
    var packsOpen = false
    private(set) var liveOn: LiveOn?
    private(set) var customLabel: String?
    private(set) var imageBusy = false
    private(set) var imageError: String?
    @ObservationIgnored private var customPicture: CIImage?

    /// Tiles baked here, by item id — on the picture, or on the chart where a
    /// look has no tile of its own.
    private(set) var liveTiles: [String: CGImage] = [:]
    private(set) var failedTiles: Set<String> = []
    /// The "No look (original)" tile, on whatever the tiles are shown on.
    private(set) var noneTile: CGImage?
    @ObservationIgnored private var resolvedCubes: [String: CubeLut] = [:]
    @ObservationIgnored private var sample: CIImage = LookTiles.syntheticSample()
    @ObservationIgnored private var bakedAt: String = ""

    // MARK: - the scene

    private(set) var aimed: String?
    var compare = false
    var splitX = 0.5
    /// How strongly the aimed look is applied, and what the pick carries out.
    /// Kept across aims on purpose: judging three looks at 60 % is one decision.
    private(set) var strength: Double

    /// The scene's slider — the aimed look re-rendered at the new strength.
    func setStrength(_ value: Double) {
        let next = lookLayerIntensity(value)
        guard next != strength else { return }
        strength = next
        renderScene()
    }
    private(set) var sceneOriginal: CGImage?
    private(set) var sceneGraded: CGImage?
    private(set) var aimedBusy = false
    private(set) var aimedError: String?
    @ObservationIgnored private var aimedCube: CubeLut?
    @ObservationIgnored private var sceneSource: CIImage?
    @ObservationIgnored private var interpolation: Interpolation = .tetrahedral
    @ObservationIgnored private var sceneRendering = false
    @ObservationIgnored private var sceneOwed = false
    @ObservationIgnored private var aimSerial = 0

    init(selected: String?, allowNone: Bool, includeFilm: Bool, picture: LookPicture?, intensity: Double) {
        self.selected = selected
        self.allowNone = allowNone
        self.includeFilm = includeFilm
        self.picture = picture
        openId = includeFilm ? "film" : "builtin"
        strength = lookLayerIntensity(intensity)
        aimed = picture != nil ? selected : nil
    }

    /// Everything that needs the library: the scene's picture, the aimed look.
    func start(_ library: LookLibrary) async {
        interpolation = library.interpolation
        guard let picture else { return }
        let size = sceneFrame(Double(picture.image.extent.width), Double(picture.image.extent.height))
        let source = picture.image
        let fitted = await Task.detached(priority: .userInitiated) { () -> (CIImage, CGImage?) in
            let edge = max(source.extent.width, source.extent.height)
            let long = max(size.width, size.height)
            let scaled = edge > 0 ? FrameGrader.resampled(source, scale: long / Double(edge)).image : source
            return (scaled, FrameGrader.cgImage(scaled))
        }.value
        sceneSource = fitted.0
        sceneOriginal = fitted.1
        if let aimed, aimed != "none", let found = item(aimed, library) {
            await resolveAimed(found, library)
        }
    }

    // MARK: - the rows

    /// Where the looks are baked, when they are baked here.
    var effectiveSource: CIImage? {
        switch liveOn {
        case .custom: return customPicture
        case .open: return picture?.image
        case nil: return nil
        }
    }

    func nodes(_ library: LookLibrary) -> [GalleryNode] {
        library.nodes(includeFilm: includeFilm, live: effectiveSource != nil)
    }

    /// The node the grid shows — a node forgotten while open falls back to the first.
    func open(_ nodes: [GalleryNode]) -> GalleryNode? {
        nodes.first { $0.id == openId } ?? nodes.first
    }

    /// What the grid shows: every match of a filter, else the open node.
    func shown(_ nodes: [GalleryNode]) -> [(node: GalleryNode, items: [GalleryItem])] {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return matchingItems(nodes, query) }
        guard let node = open(nodes) else { return [] }
        return [(node, node.items)]
    }

    /// The families as one line of crumbs: every root, the open node's
    /// ancestors, its SIBLINGS and its children — and the open node itself.
    func crumbs(_ nodes: [GalleryNode]) -> [GalleryNode] {
        guard let current = open(nodes) else { return nodes.filter { $0.depth == 0 } }
        func parent(_ id: String) -> String {
            guard let cut = id.lastIndex(of: "/") else { return "" }
            return String(id[..<cut])
        }
        let here = current.id
        let above = parent(here)
        return nodes.filter { n in
            let up = parent(n.id)
            return n.depth == 0 || n.id == here || up == above || up == here || here.hasPrefix("\(n.id)/")
        }
    }

    func openNode(_ node: GalleryNode) {
        openId = node.id
        query = ""
    }

    func item(_ id: String, _ library: LookLibrary) -> GalleryItem? {
        nodes(library).lazy.flatMap(\.items).first { $0.id == id }
    }

    /// The "No look" tile is drawn when the host allows it and a filter does
    /// not rule it out.
    var showsNone: Bool {
        guard allowNone else { return false }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return q.isEmpty || "no look".contains(q) || "original".contains(q) || "none".contains(q)
    }

    // MARK: - aiming and picking

    /// A tap on a tile: AIM while there is a scene to answer with, else the
    /// pick itself — asking twice where the first shows nothing would be a
    /// regression. The second tap on the aimed look picks it.
    func touch(_ id: String, _ library: LookLibrary, pick: (String, Double) -> Void) {
        guard scene else {
            // No scene, no strength slider — the look leaves as authored.
            pick(id, 1)
            return
        }
        if id == aimed {
            pick(id, strength)
            return
        }
        aimed = id
        aimedError = nil
        aimedCube = nil
        sceneGraded = nil
        if id == "none" {
            aimedBusy = false
            return
        }
        guard let found = item(id, library) else { return }
        Task { await resolveAimed(found, library) }
    }

    /// The aimed look's name, found across every node.
    func aimedName(_ library: LookLibrary) -> String? {
        guard let aimed else { return nil }
        if aimed == "none" { return "No look (original)" }
        return item(aimed, library)?.name
    }

    func aimedFamily(_ library: LookLibrary) -> PackFamily? {
        guard let aimed, aimed != "none" else { return nil }
        return item(aimed, library)?.family
    }

    /// ONE lattice, the aimed one — the whole economy of the scene.
    private func resolveAimed(_ item: GalleryItem, _ library: LookLibrary) async {
        aimSerial += 1
        let serial = aimSerial
        aimedBusy = true
        let answer = await library.resolve(item.resolve)
        guard serial == aimSerial else { return }
        aimedBusy = false
        switch answer {
        case .cube(let lut):
            aimedCube = lut
            aimedError = nil
            renderScene()
        case .missing(let why):
            aimedCube = nil
            sceneGraded = nil
            aimedError = why.isEmpty ? "That look could not be read here." : why
        }
    }

    /// The scene again — at most one render in flight and one owed, so a
    /// strength dragged at sixty steps a second never piles work up.
    private func renderScene() {
        guard sceneSource != nil else { return }
        sceneOwed = true
        if !sceneRendering { runSceneRender() }
    }

    private func runSceneRender() {
        sceneOwed = false
        guard let source = sceneSource, let cube = aimedCube else {
            sceneGraded = nil
            return
        }
        sceneRendering = true
        let intensity = strength
        let mode = interpolation
        let serial = aimSerial
        Task {
            let image = await Task.detached(priority: .userInitiated) { () -> CGImage? in
                let grader = FrameGrader(lut: cube, intensity: intensity, interpolation: mode)
                return FrameGrader.cgImage(grader.render(source: source))
            }.value
            if serial == aimSerial { sceneGraded = image }
            sceneRendering = false
            if sceneOwed { runSceneRender() }
        }
    }

    // MARK: - what the tiles are shown on

    /// The sentence that says it — one line, whatever the width.
    var sourceLine: String {
        if liveOn == .custom, let customLabel { return "Tiles on “\(customLabel)”" }
        if liveOn == .open { return "Tiles on the open picture — one lattice per look" }
        return scene
            ? "Tiles on their reference frames, so two looks stay comparable"
            : "Each look on its own reference frame — log looks on a D-Log M frame, the rest on a photograph"
    }

    func showOnOpenPicture() {
        liveOn = .open
    }

    func showOnReference() {
        liveOn = nil
    }

    /// Back on a photo already read this session: no second read.
    var hasCustomPicture: Bool { customPicture != nil }

    func showOnCustom() {
        if customPicture != nil { liveOn = .custom }
    }

    /// A photo the author loads right here — its bytes decoded as the stage
    /// decodes a picture.
    func useCustom(data: Data, name: String) async {
        imageError = nil
        imageBusy = true
        let decoded = await Task.detached(priority: .userInitiated) { PictureDecoder.decode(data, name: name)?.image }.value
        imageBusy = false
        guard let decoded else {
            imageError = "Could not read “\(name)” as a photo."
            return
        }
        customPicture = decoded
        customLabel = name
        liveOn = .custom
    }

    func failImage(_ name: String) {
        imageError = "Could not read “\(name)” as a photo."
    }

    // MARK: - the live tiles

    /// What the baking loop is keyed on: which looks are on screen without a
    /// tile, what they are baked on, how strongly.
    func bakeKey(_ pending: [GalleryItem]) -> String {
        let on: String
        switch liveOn {
        case .custom: on = "custom:\(customLabel ?? "")"
        case .open: on = "open:\(picture?.key ?? "")"
        case nil: on = "chart"
        }
        let tileStrength = effectiveSource != nil ? strength : 1
        return "\(on)|\(tileStrength)|\(interpolation.rawValue)|" + pending.map(\.id).joined(separator: ",")
    }

    /// Resolve and bake what is on screen without a tile, one look at a time
    /// with a turn given back between each — the grid fills in rather than
    /// the sheet stalling. A lattice resolved once is kept for the sheet's life.
    func bake(_ pending: [GalleryItem], _ library: LookLibrary) async {
        interpolation = library.interpolation
        let key = sourceKey
        if key != bakedAt {
            bakedAt = key
            liveTiles = [:]
            failedTiles = []
            let source = effectiveSource
            sample = await Task.detached(priority: .userInitiated) { () -> CIImage in
                source.map { LookTiles.sample(of: $0) } ?? LookTiles.syntheticSample()
            }.value
        }
        let onSample = sample
        let tileStrength = effectiveSource != nil ? strength : 1
        let mode = interpolation
        noneTile = await Task.detached(priority: .userInitiated) {
            LookTiles.bake(nil, on: onSample, intensity: 1, interpolation: mode)
        }.value
        for item in pending {
            if Task.isCancelled { return }
            var cube = resolvedCubes[item.id]
            if cube == nil {
                switch await library.resolve(item.resolve) {
                case .cube(let lut):
                    cube = lut
                    resolvedCubes[item.id] = lut
                case .missing:
                    failedTiles.insert(item.id)
                    continue
                }
            }
            guard let lut = cube else { continue }
            let tile = await Task.detached(priority: .userInitiated) {
                LookTiles.bake(lut, on: onSample, intensity: tileStrength, interpolation: mode)
            }.value
            if Task.isCancelled { return }
            if let tile { liveTiles[item.id] = tile } else { failedTiles.insert(item.id) }
            await Task.yield()
        }
    }

    /// What the tiles are baked on, as a key.
    private var sourceKey: String {
        switch liveOn {
        case .custom: return "custom:\(customLabel ?? "")"
        case .open: return "open:\(picture?.key ?? "")"
        case nil: return "chart"
        }
    }
}
