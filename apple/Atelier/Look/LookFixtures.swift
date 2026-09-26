// Fixture data for the Look views' previews — a vault held in memory with one
// small pack in it, the kernel's own synthetic chart as the picture, a warm
// look baked on it. Nothing here is read by the app itself.

import CoreGraphics
import CoreImage
import Foundation
import AtelierKit

/// A vault that keeps everything in memory — the previews', never the app's.
actor MemoryPackStore: PackStore {
    private var packs: [String: LutPackIndex] = [:]
    private var lattices: [String: [UInt8]] = [:]

    init(packs: [LutPackIndex] = []) {
        for pack in packs { self.packs[pack.id] = pack }
    }

    func listStoredPacks() async -> [LutPackIndex] { sortPacks(Array(packs.values)) }
    func putStoredPack(_ index: LutPackIndex) async -> Bool {
        packs[index.id] = index
        return true
    }
    func deleteStoredPack(_ packId: String) async { packs[packId] = nil }
    func deleteStoredLattices(_ hashes: [String]) async {
        for hash in hashes { lattices[hash] = nil }
    }
    func getStoredLattice(_ hash: String) async -> [UInt8]? { lattices[hash] }
    func putStoredLattice(_ hash: String, packId: String, bytes: [UInt8]) async -> Bool {
        guard !hash.isEmpty else { return false }
        lattices[hash] = bytes
        return true
    }
    func storedLatticeHashes() async -> Set<String> { Set(lattices.keys) }
    func storedLatticeSizes() async -> LatticeSizes { lattices.mapValues(\.count) }
}

enum LookFixtures {
    /// A pack as an import leaves it: a category, a camera, three looks.
    static let pack: LutPackIndex = {
        var index = buildPackIndex([
            PackFileEntry(path: "Creative/AUTHENTIC_LUT_Warm Film.cube", bytes: 1_900_000, lattice: 33, hash: "aa"),
            PackFileEntry(path: "Creative/AUTHENTIC_LUT_Teal Night.cube", bytes: 1_900_000, lattice: 33, hash: "bb"),
            PackFileEntry(path: "Conversion/DJI/AUTHENTIC_LUT_DJI_D-Log.cube", bytes: 7_200_000, lattice: 65, hash: "cc"),
        ], BuildPackOptions(id: "pk_preview", name: "AUTHENTIC", author: "Victor Jimenes"))
        index.url = "https://example.com"
        return index
    }()

    /// The kernel's chart — sky, grey ramp, primaries, skin, foliage.
    static let chartImage: CIImage = LookTiles.syntheticSample(240)
    static let chart: CGImage? = FrameGrader.cgImage(LookFixtures.chartImage)

    /// A warm look: red up, blue down, grey kept roughly grey.
    static let warmCube: CubeLut = {
        let n = 9
        var data: [Float] = []
        data.reserveCapacity(n * n * n * 3)
        for b in 0..<n {
            for g in 0..<n {
                for r in 0..<n {
                    let rv = Float(r) / Float(n - 1)
                    let gv = Float(g) / Float(n - 1)
                    let bv = Float(b) / Float(n - 1)
                    data.append(min(1, rv * 1.08 + 0.02))
                    data.append(gv)
                    data.append(max(0, bv * 0.9))
                }
            }
        }
        return CubeLut(size: n, data: data, title: "Warm")
    }()

    static let warmChart: CGImage? = LookTiles.bake(LookFixtures.warmCube, on: LookFixtures.chartImage, intensity: 1,
                                                    interpolation: .tetrahedral)

    /// The chart as a host's picture.
    static let picture = LookPicture(image: LookFixtures.chartImage, label: "chart.png", key: "chart")

    /// A stored look with one of each kind of layer.
    static let grade: RollGrade = {
        let builtin = builtinLookLayer(id: "l1", builtinId: "classic-warm", name: "Warm")
        let film = filmLookLayer(id: "l2", stock: .negativePortrait, intensity: 0.7)
        let pack = packLookLayer(id: "l3", ref: PackRef(pack: "pk_preview", look: "creative/teal-night", hash: "bb"),
                                 name: "AUTHENTIC · Creative · Teal Night")
        return RollGrade(layers: [builtin], output: .rec709ToSrgb)
            .addingFilm(film, stock: .negativePortrait)
            .adding(pack)
    }()
}

extension LookLibrary {
    /// A library over a vault held in memory, one pack in it.
    static let preview = LookLibrary(store: MemoryPackStore(packs: [LookFixtures.pack]),
                                     defaults: UserDefaults(suiteName: "atelier.preview.looks") ?? .standard)
}
