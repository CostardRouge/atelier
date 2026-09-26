// The colour cube cache — packed lattices kept across renders, carried by
// every `PassContext` (`RenderPass.swift`).
//
// A lattice is packed into the image the cube kernel reads (`CubePass.pack`)
// ONCE per lattice: a stage repainting the same look on every slider step of
// an unrelated control pays one equality check, not a 65³ repack. The web
// keys its 3D texture on the lattice OBJECT (`cube-pass.ts`, "a changed cube
// is a new object"); here the key is EQUALITY, because the app re-bakes a
// develop into a fresh array that may hold the very same numbers — and an
// array compared with itself is answered by Swift's identity fast path, so a
// caller that keeps its `CubeLut` pays nothing for the scan either.
//
// Small and most-recently-used first: the look, plus a few layers' develop
// cubes once adjustment layers arrive. A 65³ lattice packs into 2.2 MB of
// half floats, so four of them are a bounded cost.

import AtelierKit
import CoreImage
import Foundation

final class CubeCache {
    /// How many lattices are kept: the look and three layers' cubes.
    static let defaultCapacity = 4

    let capacity: Int
    private let lock = NSLock()
    private var entries: [(lut: CubeLut, image: CIImage)] = []
    private var packCount = 0

    init(capacity: Int = CubeCache.defaultCapacity) {
        self.capacity = max(1, capacity)
    }

    /// `lut` as the cube kernel reads it — packed now if no equal lattice is
    /// held, handed back from the cache otherwise.
    func packed(_ lut: CubeLut) -> CIImage {
        lock.lock()
        defer { lock.unlock() }
        if let index = entries.firstIndex(where: { $0.lut == lut }) {
            let hit = entries.remove(at: index)
            entries.insert(hit, at: 0)
            return hit.image
        }
        let image = CubePass.pack(lut)
        packCount += 1
        entries.insert((lut: lut, image: image), at: 0)
        if entries.count > capacity {
            entries.removeLast(entries.count - capacity)
        }
        return image
    }

    /// How many lattices were packed since this cache was made — the gate's
    /// proof that a repaint with the same numbers repacks nothing.
    var packs: Int {
        lock.lock()
        defer { lock.unlock() }
        return packCount
    }

    /// How many lattices are held now.
    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }
}
