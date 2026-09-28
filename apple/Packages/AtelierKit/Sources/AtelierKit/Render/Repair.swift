// REPAIR — a patch list: dust, healing, cloning. Port of
// `src/shared/render/repair.ts` — the record, the coverage, the ring, the
// means, `repairAt`, the source placement and the dust field; every function
// the pure twin the app's Core Image kernel is held to, on the same
// continuous, bilinear sampling the GPU does (`sampleAt`).
//
// A PATCH is a disc on the picture whose pixels are replaced by another
// disc's, feathered at its edge — `clone` copies the source as it is, `heal`
// copies its TEXTURE and shifts it to the destination's own tone. Every patch
// is a handful of numbers and the document stays small and resolution-free.
//
// Rules kept:
// - ONE composite pass draws the whole list, in order, over the source BEFORE
//   everything else, so a copied pixel takes the same develop, look, warp and
//   layer as its neighbours.
// - A heal matches the destination's SURROUNDINGS, never its middle: the ring
//   (`ringWeightAt`) is zero in the hard core — that mean IS the dust.
// - Coordinates follow the mask's: a centre in [0,1] of the frame, a radius
//   in the CENTRED space whose half-diagonal is 1; the source is an OFFSET in
//   frame units, so a patch moved keeps its source with it.
// - The source turns with the hand at any distance (`placeSource` reads the
//   angle inside the disc too), never nearer than the two discs touching.
// - Dust is FOUND, not painted: `dustField` walks a small copy of the picture
//   once, `dustSpots` reads the field at a sensitivity and never the picture
//   again, gated on prominence over the ground's deviation, a flat ring and a
//   round shape; a spot is PROPOSED, never dumped as a patch.

import Foundation

public enum PatchKind: String, Codable, Sendable {
    case heal, clone
}

public struct Patch: Equatable, Sendable {
    public var id: String
    public var kind: PatchKind
    /// The centre of the disc to replace, in [0,1] of the frame.
    public var x: Double
    public var y: Double
    /// Its radius, in the centred space whose half-diagonal is 1.
    public var radius: Double
    /// 0..1, the share of the radius that fades to nothing at the edge.
    public var feather: Double
    /// Where the pixels come FROM, as an offset in frame units: the source disc is the destination moved by this.
    public var dx: Double
    public var dy: Double

    public init(id: String, kind: PatchKind, x: Double, y: Double, radius: Double, feather: Double, dx: Double, dy: Double) {
        self.id = id
        self.kind = kind
        self.x = x
        self.y = y
        self.radius = radius
        self.feather = feather
        self.dx = dx
        self.dy = dy
    }

    /// The record as the web writes it.
    public var json: JSONValue {
        .object([
            "id": .string(id), "kind": .string(kind.rawValue),
            "x": .number(x), "y": .number(y), "radius": .number(radius), "feather": .number(feather),
            "dx": .number(dx), "dy": .number(dy),
        ])
    }
}

public let maxPatches = 64
public let defaultPatchRadius = 0.03
public let defaultPatchFeather = 0.5
public let patchRadiusRange = (min: 0.004, max: 0.4)
/// How far a source sits from its destination when nothing says otherwise, in
/// radii: apart, so a heal's two rings measure different ground.
public let defaultSourceRadii = 2.5
/// The closest a source may come, in radii — the two discs touching. Any
/// nearer and the source disc holds the very defect it is meant to cover.
public let minSourceRadii = 2.0

/// JavaScript's `Math.round`: half up, whatever the sign.
@inline(__always)
private func jsRound(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

public func normalisePatch(_ raw: JSONValue?) -> Patch? {
    guard let r = raw?.objectValue else { return nil }
    guard let id = r["id"]?.stringValue, !id.isEmpty else { return nil }
    func num(_ key: String, _ fallback: Double) -> Double { r[key]?.finiteNumber ?? fallback }
    let kind: PatchKind = r["kind"]?.stringValue == "clone" ? .clone : .heal
    return Patch(
        id: id,
        kind: kind,
        x: clamp(num("x", 0.5), 0, 1),
        y: clamp(num("y", 0.5), 0, 1),
        radius: clamp(num("radius", defaultPatchRadius), patchRadiusRange.min, patchRadiusRange.max),
        feather: clamp(num("feather", defaultPatchFeather), 0, 1),
        dx: clamp(num("dx", 0), -1, 1),
        dy: clamp(num("dy", 0), -1, 1)
    )
}

/// A fresh id — the web's `crypto.randomUUID()`, lowercase.
public func newPatchId() -> String {
    UUID().uuidString.lowercased()
}

/// A stored list read back: junk dropped, the list capped, a second entry for an id dropped.
public func readPatches(_ raw: JSONValue?) -> [Patch] {
    guard let list = raw?.arrayValue else { return [] }
    var out: [Patch] = []
    var seen = Set<String>()
    for item in list {
        guard let p = normalisePatch(item), !seen.contains(p.id) else { continue }
        seen.insert(p.id)
        out.append(p)
        if out.count >= maxPatches { break }
    }
    return out
}

public func samePatch(_ a: Patch, _ b: Patch) -> Bool {
    a.id == b.id && a.kind == b.kind && a.x == b.x && a.y == b.y
        && a.radius == b.radius && a.feather == b.feather && a.dx == b.dx && a.dy == b.dy
}

public func samePatches(_ a: [Patch]?, _ b: [Patch]?) -> Bool {
    let x = a ?? []
    let y = b ?? []
    if x.count != y.count { return false }
    for i in 0..<x.count where !samePatch(x[i], y[i]) { return false }
    return true
}

/// A copy of the list — a value type copies on its own; kept for the web's name.
public func clonePatches(_ list: [Patch]?) -> [Patch] {
    list ?? []
}

/// The patch moved so its destination is at frame point (x, y); the source travels with it.
public func movePatch(_ patch: Patch, _ x: Double, _ y: Double) -> Patch {
    var out = patch
    out.x = clamp(x, 0, 1)
    out.y = clamp(y, 0, 1)
    return out
}

/// A patch with one or more of its numbers changed, each held to its range.
public func adjustPatch(_ patch: Patch, kind: PatchKind? = nil, radius: Double? = nil, feather: Double? = nil) -> Patch {
    var out = patch
    if let kind { out.kind = kind }
    if let radius { out.radius = clamp(radius, patchRadiusRange.min, patchRadiusRange.max) }
    if let feather { out.feather = clamp(feather, 0, 1) }
    return out
}

/// Where a patch borrows from when nobody has said: `defaultSourceRadii` to
/// the right, mirrored to the left when that would leave the frame, so a tap
/// on a spot is a whole repair.
public func defaultSource(_ patch: Patch, _ aspectRatio: Double) -> (dx: Double, dy: Double) {
    let ru = patchExtent(patch, aspectRatio).ru
    let fits = patch.x + ru * defaultSourceRadii + ru <= 1
    let dx = fits ? ru * defaultSourceRadii : -ru * defaultSourceRadii
    return (dx: dx, dy: 0)
}

/// Where a patch borrows from when the hand points somewhere: the source disc
/// placed on the LINE from the destination through the pointer, at the
/// pointer's distance but never nearer than the two discs touching
/// (`minSourceRadii`), and held inside the frame. The angle is read whatever
/// the distance — inside the destination's own disc too; only a pointer still
/// within `deadRadii` of the centre says nothing (nil). Measured in the
/// centred space, so the minimum is a circle on the picture.
public func placeSource(_ patch: Patch, _ pointer: Point, _ aspectRatio: Double, deadRadii: Double = 0.2) -> (dx: Double, dy: Double)? {
    let extent = patchExtent(patch, aspectRatio)
    let ru = extent.ru
    let rv = extent.rv
    if !(ru > 0) || !(rv > 0) { return nil }
    // The pointer in radii, along each axis.
    let nx = (pointer.x - patch.x) / ru
    let ny = (pointer.y - patch.y) / rv
    let len = hypot(nx, ny)
    if !(len > deadRadii) { return nil }
    let k = max(len, minSourceRadii) / len
    var sx = patch.x + nx * k * ru
    var sy = patch.y + ny * k * rv
    // Inside the frame, disc included — a source off the picture samples the
    // clamped edge and smears it; where the frame is narrower than the disc,
    // the middle is the best there is.
    sx = ru * 2 <= 1 ? clamp(sx, ru, 1 - ru) : 0.5
    sy = rv * 2 <= 1 ? clamp(sy, rv, 1 - rv) : 0.5
    return (dx: sx - patch.x, dy: sy - patch.y)
}

/// `3 patches · 2 healed, 1 cloned`, or an empty string.
public func describePatches(_ list: [Patch]?) -> String {
    guard let list, !list.isEmpty else { return "" }
    let n = list.count
    let healed = list.filter { $0.kind == .heal }.count
    let cloned = n - healed
    var parts: [String] = []
    if healed > 0 { parts.append("\(healed) healed") }
    if cloned > 0 { parts.append("\(cloned) cloned") }
    return "\(n) patch\(n == 1 ? "" : "es") · \(parts.joined(separator: ", "))"
}

// MARK: - the maths

/// GLSL's `smoothstep(a, b, x)`.
@inline(__always)
private func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
    let t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/// How much of the patch covers frame point (u, v): 1 inside its hard core,
/// fading over the feathered rim to 0 at the radius.
public func patchCoverageAt(_ patch: Patch, _ u: Double, _ v: Double, _ aspectRatio: Double) -> Double {
    let (px, py) = framePoint(u, v, aspectRatio)
    let (cx, cy) = framePoint(patch.x, patch.y, aspectRatio)
    let d = hypot(px - cx, py - cy)
    let hard = patch.radius * (1 - patch.feather)
    if d <= hard { return 1 }
    if d >= patch.radius { return 0 }
    return 1 - smoothstep(hard, patch.radius, d)
}

/// GL's LINEAR sample with CLAMP_TO_EDGE at a continuous (u, v): the four
/// texel centres around it, blended — texel i sits at (i + 0.5) / size.
public func sampleAt(_ img: DetailImage, _ u: Double, _ v: Double) -> (Double, Double, Double) {
    let w = img.width
    let h = img.height
    let fx = clamp(u * Double(w) - 0.5, 0, Double(w - 1))
    let fy = clamp(v * Double(h) - 0.5, 0, Double(h - 1))
    let x0 = Int(fx.rounded(.down))
    let y0 = Int(fy.rounded(.down))
    let x1 = min(w - 1, x0 + 1)
    let y1 = min(h - 1, y0 + 1)
    let tx = fx - Double(x0)
    let ty = fy - Double(y0)
    let i00 = (y0 * w + x0) * 3
    let i10 = (y0 * w + x1) * 3
    let i01 = (y1 * w + x0) * 3
    let i11 = (y1 * w + x1) * 3
    func channel(_ c: Int) -> Double {
        let top = Double(img.data[i00 + c]) * (1 - tx) + Double(img.data[i10 + c]) * tx
        let bottom = Double(img.data[i01 + c]) * (1 - tx) + Double(img.data[i11 + c]) * tx
        return top * (1 - ty) + bottom * ty
    }
    return (channel(0), channel(1), channel(2))
}

/// How many samples across the patch its means are measured over — a fixed grid, so a kernel can unroll it.
public let meanGrid = 9
/// How far past the radius the surroundings are measured, as a multiple of it.
public let ringReach = 1.5

/// The weight of a point in the SURROUNDINGS of a patch: nothing in its hard
/// core (that is the defect, the very thing not to measure), rising through
/// the feathered rim, full just outside the radius, gone at `ringReach` radii.
public func ringWeightAt(_ patch: Patch, _ u: Double, _ v: Double, _ aspectRatio: Double) -> Double {
    let (px, py) = framePoint(u, v, aspectRatio)
    let (cx, cy) = framePoint(patch.x, patch.y, aspectRatio)
    let d = hypot(px - cx, py - cy)
    if d >= patch.radius * ringReach { return 0 }
    return 1 - patchCoverageAt(patch, u, v, aspectRatio)
}

/// The mean colour AROUND the destination disc and around the source disc,
/// each over a `meanGrid × meanGrid` grid of the patch's reach, weighted by
/// `ringWeightAt` — the surroundings, not the defect. Their difference is what
/// a heal shifts the source's texture by.
public func patchMeans(_ img: DetailImage, _ patch: Patch, _ aspectRatio: Double) -> (dst: (Double, Double, Double), src: (Double, Double, Double)) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let diagonal = hypot(ar, 1)
    // The reach in frame units along each axis (the inverse of framePoint's scale).
    let ru = (patch.radius * ringReach * diagonal) / (2 * ar)
    let rv = (patch.radius * ringReach * diagonal) / 2
    var dst = (0.0, 0.0, 0.0)
    var src = (0.0, 0.0, 0.0)
    var sum = 0.0
    let last = Double(meanGrid - 1)
    for j in 0..<meanGrid {
        for i in 0..<meanGrid {
            let u = patch.x + ru * ((Double(i) / last) * 2 - 1)
            let v = patch.y + rv * ((Double(j) / last) * 2 - 1)
            let w = ringWeightAt(patch, u, v, ar)
            if w <= 0 { continue }
            let d = sampleAt(img, u, v)
            let s = sampleAt(img, u + patch.dx, v + patch.dy)
            dst.0 += d.0 * w
            dst.1 += d.1 * w
            dst.2 += d.2 * w
            src.0 += s.0 * w
            src.1 += s.1 * w
            src.2 += s.2 * w
            sum += w
        }
    }
    if sum > 0 {
        dst = (dst.0 / sum, dst.1 / sum, dst.2 / sum)
        src = (src.0 / sum, src.1 / sum, src.2 / sum)
    }
    return (dst: dst, src: src)
}

/// The repaired colour at frame point (u, v): every patch in order, each mixed
/// over the previous result by its coverage — a clone as the source's pixel, a
/// heal as the source's pixel shifted by the difference of the two means.
/// Reads the ORIGINAL picture for every patch, as the kernel does.
public func repairAt(_ img: DetailImage, _ u: Double, _ v: Double, _ patches: [Patch], _ aspectRatio: Double) -> (Double, Double, Double) {
    var out = sampleAt(img, u, v)
    for patch in patches {
        let cov = patchCoverageAt(patch, u, v, aspectRatio)
        if cov <= 0 { continue }
        let s = sampleAt(img, u + patch.dx, v + patch.dy)
        var healed = s
        if patch.kind == .heal {
            let means = patchMeans(img, patch, aspectRatio)
            let dst = means.dst
            let src = means.src
            healed = (max(0, s.0 + dst.0 - src.0), max(0, s.1 + dst.1 - src.1), max(0, s.2 + dst.2 - src.2))
        }
        out = (out.0 + (healed.0 - out.0) * cov, out.1 + (healed.1 - out.1) * cov, out.2 + (healed.2 - out.2) * cov)
    }
    return out
}

// MARK: - finding dust

/// The long edge the picture is walked at: a spot is not a pixel, and 1024 keeps the walk a few ms.
public let dustScanEdge = 1024
public let dustMaxSpots = 40
/// How far a spot must stand out from its ground — its depth over the
/// ground's own deviation — to be dust rather than grain. Measured on a sky
/// with real spots against a dense texture: the spots stood at 9 to 11, the
/// texture's darkest grains at 4.
public let dustProminence = 4.5
/// The smallest blob answered, in scan pixels: below it a blob is grain or a JPEG's block, not a mark.
private let dustMinArea = 5
/// The sensitivity slider's two ends, as the depth a spot must have in encoded luma.
public let dustThresholdRange = (gentle: 0.14, keen: 0.025)
public let defaultDustSensitivity = 0.5

/// A sensitivity in 0..1 as the depth threshold `dustSpots` reads: 0 finds
/// only a mark a monitor shows at the fit, 1 finds what only a print would.
public func dustThreshold(_ sensitivity: Double) -> Double {
    let t = clamp(sensitivity, 0, 1)
    return dustThresholdRange.gentle + (dustThresholdRange.keen - dustThresholdRange.gentle) * t
}

/// The picture measured ONCE for dust, at `dustScanEdge`: its luma, the local
/// background each pixel is judged against (a box mean over 1.5 % of the long
/// edge) and how UNQUIET that background is (how far the luma rises above it,
/// as a root mean square over a window twice as wide). A sensitivity change
/// reads this and never the picture again.
public struct DustField: Sendable {
    public var width: Int
    public var height: Int
    /// The frame's aspect ratio, as the picture's own — the scan may round it.
    public var aspectRatio: Double
    public var luma: [Float]
    public var background: [Float]
    public var deviation: [Float]

    public init(width: Int, height: Int, aspectRatio: Double, luma: [Float], background: [Float], deviation: [Float]) {
        self.width = width
        self.height = height
        self.aspectRatio = aspectRatio
        self.luma = luma
        self.background = background
        self.deviation = deviation
    }
}

/// A spot the field holds: where (frame [0,1]), how big (a patch radius in
/// the centred space), how deep, how much it stands out.
public struct DustSpot: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var radius: Double
    /// How much darker than its background, in encoded luma.
    public var depth: Double
    /// Its depth over the ground's deviation there — what it is ranked on.
    public var prominence: Double

    public init(x: Double, y: Double, radius: Double, depth: Double, prominence: Double) {
        self.x = x
        self.y = y
        self.radius = radius
        self.depth = depth
        self.prominence = prominence
    }
}

public struct DustOptions {
    /// How much darker than its surroundings a spot must be, in encoded luma.
    public var threshold: Double?
    /// The most spots answered, most prominent first.
    public var max: Int?
    /// Where a new patch's id comes from.
    public var makeId: (() -> String)?

    public init(threshold: Double? = nil, max: Int? = nil, makeId: (() -> String)? = nil) {
        self.threshold = threshold
        self.max = max
        self.makeId = makeId
    }
}

public func dustField(_ img: DetailImage) -> DustField? {
    if img.width < 8 || img.height < 8 { return nil }
    // A small luma copy, box-averaged.
    let factor = max(1, Int((Double(max(img.width, img.height)) / Double(dustScanEdge)).rounded(.up)))
    let w = img.width / factor
    let h = img.height / factor
    var luma = [Float](repeating: 0, count: w * h)
    let inv = 1 / Double(factor * factor)
    let imgWidth = img.width
    img.data.withUnsafeBufferPointer { src in
        luma.withUnsafeMutableBufferPointer { out in
            for y in 0..<h {
                for x in 0..<w {
                    var acc = 0.0
                    for dy in 0..<factor {
                        var i = ((y * factor + dy) * imgWidth + x * factor) * 3
                        for _ in 0..<factor {
                            acc += lumaOf(Double(src[i]), Double(src[i + 1]), Double(src[i + 2]))
                            i += 3
                        }
                    }
                    out[y * w + x] = Float(acc * inv)
                }
            }
        }
    }
    // The local background: a box mean over a radius of 1.5 % of the long edge
    // — wide against a spot, so the spot dents it little, narrow against a
    // sky's gradient.
    let R = max(3, Int(jsRound(Double(max(w, h)) * 0.015)))
    let background = boxMean(luma, w, h, R)
    // How restless the ground is: the root mean square of how far the luma
    // rises ABOVE its background, over a window twice as wide. The bright side
    // only, on purpose — a dust spot is a dark dent, and a measure that counted
    // it would have every spot raise the very bar it has to clear.
    var rises = [Float](repeating: 0, count: w * h)
    for i in 0..<(w * h) {
        let d = Double(luma[i]) - Double(background[i])
        rises[i] = d > 0 ? Float(d * d) : 0
    }
    let deviationSquared = boxMean(rises, w, h, R * 2)
    var local = [Float](repeating: 0, count: w * h)
    for i in 0..<(w * h) { local[i] = Float(Double(deviationSquared[i]).squareRoot()) }
    // Then the WORST ground within reach, not the average: on the border of a
    // texture the mean is half quiet sky, and a dark grain of the texture reads
    // as a spot against it.
    let deviation = boxMax(local, w, h, R * 2)
    return DustField(width: w, height: h, aspectRatio: Double(img.width) / Double(img.height),
                     luma: luma, background: background, deviation: deviation)
}

private struct DustBlob {
    var cx: Double
    var cy: Double
    var size: Int
    var depth: Double
    var prominence: Double
}

/// The dark, small, roughly round spots of the field — the shadows a sensor's
/// dust casts — at a depth threshold, the most PROMINENT first. A spot is a
/// 4-connected blob of pixels darker than the local background by `threshold`
/// AND by `dustProminence` times the ground's own deviation there, at least
/// `dustMinArea` scan pixels and no larger than a fifth of a per cent of the
/// frame, no longer than three times its width, filling at least a third of
/// its box, prominent as a whole and not only at its darkest pixel, and
/// sitting in a FLAT field. Its patch radius is 1.6× the blob, in the centred space.
public func dustSpots(_ field: DustField, threshold: Double? = nil, max maxSpots: Int? = nil) -> [DustSpot] {
    let threshold = threshold ?? dustThreshold(defaultDustSensitivity)
    let limit = maxSpots ?? dustMaxSpots
    let w = field.width
    let h = field.height
    let count = w * h
    let luma = field.luma
    let background = field.background
    let deviation = field.deviation
    // Two gates, as an edge detector has: a blob must hold a pixel that
    // clears the full threshold (a SEED), and its extent is walked at half of
    // it — so a spot whose middle just clears the bar is one whole spot and
    // not two fragments of its darkest pixels, and its size is its own.
    var seed = [Bool](repeating: false, count: count)
    var dark = [Bool](repeating: false, count: count)
    for i in 0..<count {
        let depth = Double(background[i]) - Double(luma[i])
        let bar = max(threshold, dustProminence * Double(deviation[i]))
        seed[i] = depth > bar
        dark[i] = depth > bar * 0.5
    }
    var seen = [Bool](repeating: false, count: count)
    let maxArea = max(dustMinArea, Int(jsRound(Double(count) * 0.002)))
    var found: [DustBlob] = []
    var stack: [Int] = []
    stack.reserveCapacity(256)
    for start in 0..<count {
        if !seed[start] || seen[start] { continue }
        var minX = w
        var maxX = -1
        var minY = h
        var maxY = -1
        var area = 0
        var depth = 0.0
        stack.append(start)
        seen[start] = true
        while let i = stack.popLast() {
            let x = i % w
            let y = (i - x) / w
            area += 1
            depth += Double(background[i]) - Double(luma[i])
            if x < minX { minX = x }
            if x > maxX { maxX = x }
            if y < minY { minY = y }
            if y > maxY { maxY = y }
            // The four neighbours, no wrapping across a row's edge.
            if x > 0 {
                let n = i - 1
                if !seen[n] && dark[n] { seen[n] = true; stack.append(n) }
            }
            if x < w - 1 {
                let n = i + 1
                if !seen[n] && dark[n] { seen[n] = true; stack.append(n) }
            }
            if i - w >= 0 {
                let n = i - w
                if !seen[n] && dark[n] { seen[n] = true; stack.append(n) }
            }
            if i + w < count {
                let n = i + w
                if !seen[n] && dark[n] { seen[n] = true; stack.append(n) }
            }
            // A blob far too big is still walked to its end: leaving it half seen
            // let its remainder start again as several small blobs that were then
            // taken for spots.
        }
        if area < dustMinArea || area > maxArea { continue }
        let bw = maxX - minX + 1
        let bh = maxY - minY + 1
        if max(bw, bh) > 3 * min(bw, bh) + 2 { continue }
        // A disc fills π/4 of its box; a diagonal line fills next to nothing of
        // its own, and the ratio test above cannot see it.
        if Double(area) < Double(bw * bh) / 3 { continue }
        let cx = Double(minX + maxX + 1) / 2
        let cy = Double(minY + maxY + 1) / 2
        let size = max(bw, bh)
        let meanDepth = depth / Double(area)
        // A dent in a FLAT field: the picture on a ring a diameter out must vary
        // less than the blob is deep. The inside corner of a dark shape against
        // the sky is a compact dent the gates above cannot tell from dust — its
        // ring crosses the edge, and this can; a grain of a texture fails it on
        // the grains around it.
        if ringSpread(luma, w, h, cx, cy, Double(max(3, size))) >= meanDepth { continue }
        // Prominent as a WHOLE, not only at its darkest pixel: the seed gate is
        // per pixel, and one dark pixel of a texture's edge grain seeded a blob
        // whose mean was nothing special.
        let gy = Int(jsRound(min(Double(h - 1), cy)))
        let gx = Int(jsRound(min(Double(w - 1), cx)))
        let ground = Double(deviation[gy * w + gx])
        let prominence = meanDepth / (ground + 0.005)
        if prominence < dustProminence { continue }
        found.append(DustBlob(cx: cx, cy: cy, size: size, depth: meanDepth, prominence: prominence))
    }
    // The most prominent first, never the darkest: on a picture with a texture
    // in it the darkest blobs are the texture's, and a cap on the darkest
    // dropped every real spot of the sky. Ties keep their scan order.
    let ordered = found.enumerated().sorted { a, b in
        if a.element.prominence != b.element.prominence { return a.element.prominence > b.element.prominence }
        return a.offset < b.offset
    }.map { $0.element }
    let ar = field.aspectRatio
    let diagonal = hypot(ar, 1)
    return ordered.prefix(Swift.max(0, limit)).map { spot in
        // 1.6× the blob, in the centred space: a size in scan pixels along the
        // width is `size / w` of the frame, which is `size / w × 2ar / diagonal`
        // in centred units.
        let share = (Double(spot.size) * 1.6) / 2 / Double(w)
        let radius = clamp((share * 2 * ar) / diagonal, patchRadiusRange.min, patchRadiusRange.max)
        return DustSpot(x: spot.cx / Double(w), y: spot.cy / Double(h), radius: radius, depth: spot.depth, prominence: spot.prominence)
    }
}

/// The heal for an accepted spot: sourced from whichever of EIGHT neighbours
/// `defaultSourceRadii` away has the background nearest the spot's own and
/// the quietest ground — the cleanest sky to borrow — and inside the frame;
/// nil when no neighbour fits (a spot in a corner the disc cannot leave).
public func dustPatch(_ field: DustField, _ spot: DustSpot, _ makeId: () -> String, feather: Double = defaultPatchFeather) -> Patch? {
    let w = field.width
    let h = field.height
    let background = field.background
    let deviation = field.deviation
    let ar = field.aspectRatio
    let diagonal = hypot(ar, 1)
    let ru = (spot.radius * diagonal) / (2 * ar)
    let rv = (spot.radius * diagonal) / 2
    let reach = defaultSourceRadii
    func at(_ u: Double, _ v: Double) -> Int {
        let row = Int(jsRound(clamp(v, 0, 1) * Double(h - 1)))
        let col = Int(jsRound(clamp(u, 0, 1) * Double(w - 1)))
        return row * w + col
    }
    let here = Double(background[at(spot.x, spot.y)])
    var best: (Double, Double)? = nil
    var bestScore = Double.infinity
    for k in 0..<8 {
        let angle = (Double(k) * Double.pi) / 4
        let dx = cos(angle) * ru * reach
        let dy = sin(angle) * rv * reach
        let su = spot.x + dx
        let sv = spot.y + dy
        if su - ru < 0 || su + ru > 1 || sv - rv < 0 || sv + rv > 1 { continue }
        let i = at(su, sv)
        let score = abs(Double(background[i]) - here) + Double(deviation[i])
        if score < bestScore {
            bestScore = score
            best = (dx, dy)
        }
    }
    guard let best else { return nil }
    return Patch(id: makeId(), kind: .heal, x: spot.x, y: spot.y, radius: spot.radius, feather: feather, dx: best.0, dy: best.1)
}

/// The field as a MAP the eye can read: how far each pixel falls below its
/// background, as a share of the threshold — 0 on quiet ground, 1 at a spot
/// the threshold would find, past it for a deeper one, clamped.
public func dustVeil(_ field: DustField, _ threshold: Double) -> [Float] {
    let count = field.width * field.height
    var out = [Float](repeating: 0, count: count)
    let k = 1 / max(1e-6, threshold)
    for i in 0..<count {
        out[i] = Float(clamp((Double(field.background[i]) - Double(field.luma[i])) * k, 0, 1))
    }
    return out
}

/// Heal patches for the picture's dust in one call — the field, the spots at
/// the threshold, a patch per spot where a neighbour fits. What the workbench
/// does in three steps so a sensitivity slider never walks the picture twice.
public func detectDust(_ img: DetailImage, _ opts: DustOptions = DustOptions()) -> [Patch] {
    guard let field = dustField(img) else { return [] }
    var counter = 0
    let makeId: () -> String = opts.makeId ?? {
        counter += 1
        return "dust_\(counter)"
    }
    var out: [Patch] = []
    for spot in dustSpots(field, threshold: opts.threshold, max: opts.max) {
        if let p = dustPatch(field, spot, makeId) { out.append(p) }
    }
    return out
}

/// How much `field` varies on a ring of radius `r` around (cx, cy): its
/// largest value less its smallest, over 16 samples held inside the frame.
private func ringSpread(_ field: [Float], _ w: Int, _ h: Int, _ cx: Double, _ cy: Double, _ r: Double) -> Double {
    var lo = Double.infinity
    var hi = -Double.infinity
    for k in 0..<16 {
        let a = (Double(k) * Double.pi) / 8
        let x = min(w - 1, max(0, Int(jsRound(cx + cos(a) * r))))
        let y = min(h - 1, max(0, Int(jsRound(cy + sin(a) * r))))
        let v = Double(field[y * w + x])
        if v < lo { lo = v }
        if v > hi { hi = v }
    }
    return hi - lo
}

/// The largest value in a window of `2r + 1` along one line, in one pass
/// whatever the radius (van Herk / Gil–Werman): the line is cut into blocks
/// of the window's size, a running max is taken forward inside each block and
/// backward inside each block, and a window's max is the larger of the
/// backward run at its left end and the forward run at its right end.
private func lineMax(_ src: UnsafeBufferPointer<Float>, _ out: UnsafeMutableBufferPointer<Float>, _ n: Int, _ stride: Int, _ offset: Int, _ r: Int,
                     _ forward: UnsafeMutableBufferPointer<Float>, _ backward: UnsafeMutableBufferPointer<Float>) {
    let k = 2 * r + 1
    for i in 0..<n {
        let v = src[offset + i * stride]
        forward[i] = i % k == 0 ? v : max(forward[i - 1], v)
    }
    var i = n - 1
    while i >= 0 {
        let v = src[offset + i * stride]
        backward[i] = i == n - 1 || (i + 1) % k == 0 ? v : max(backward[i + 1], v)
        i -= 1
    }
    for i in 0..<n {
        let lo = max(0, i - r)
        let hi = min(n - 1, i + r)
        out[offset + i * stride] = max(backward[lo], forward[hi])
    }
}

/// The largest value within `r` of each pixel, in two separable O(n) passes.
private func boxMax(_ src: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
    var tmp = [Float](repeating: 0, count: w * h)
    var out = [Float](repeating: 0, count: w * h)
    var forward = [Float](repeating: 0, count: max(w, h))
    var backward = [Float](repeating: 0, count: max(w, h))
    forward.withUnsafeMutableBufferPointer { fb in
        backward.withUnsafeMutableBufferPointer { bb in
            src.withUnsafeBufferPointer { sb in
                tmp.withUnsafeMutableBufferPointer { tb in
                    for y in 0..<h { lineMax(sb, tb, w, 1, y * w, r, fb, bb) }
                }
            }
            tmp.withUnsafeBufferPointer { tb in
                out.withUnsafeMutableBufferPointer { ob in
                    for x in 0..<w { lineMax(tb, ob, h, w, x, r, fb, bb) }
                }
            }
        }
    }
    return out
}

/// A box mean of radius `r`, clamped at the edges — two running sums, so the
/// cost does not grow with the radius.
private func boxMean(_ src: [Float], _ w: Int, _ h: Int, _ r: Int) -> [Float] {
    var tmp = [Float](repeating: 0, count: w * h)
    let n = Double(2 * r + 1)
    src.withUnsafeBufferPointer { sb in
        tmp.withUnsafeMutableBufferPointer { tb in
            for y in 0..<h {
                let row = y * w
                var acc = 0.0
                // The window over x = 0: r + 1 copies of the first pixel, then the next r.
                for k in -r...r { acc += Double(sb[row + min(w - 1, max(0, k))]) }
                for x in 0..<w {
                    tb[row + x] = Float(acc / n)
                    acc += Double(sb[row + min(w - 1, x + r + 1)]) - Double(sb[row + max(0, x - r)])
                }
            }
        }
    }
    var out = [Float](repeating: 0, count: w * h)
    tmp.withUnsafeBufferPointer { tb in
        out.withUnsafeMutableBufferPointer { ob in
            for x in 0..<w {
                var acc = 0.0
                for k in -r...r { acc += Double(tb[min(h - 1, max(0, k)) * w + x]) }
                for y in 0..<h {
                    ob[y * w + x] = Float(acc / n)
                    acc += Double(tb[min(h - 1, y + r + 1) * w + x]) - Double(tb[max(0, y - r) * w + x])
                }
            }
        }
    }
    return out
}

/// The source disc's centre, in frame units — where a marker for it is drawn.
public func patchSource(_ patch: Patch) -> Point {
    Point(patch.x + patch.dx, patch.y + patch.dy)
}

/// A radius in the centred space as a share of the frame's width and height — for drawing a ring.
public func radiusExtent(_ radius: Double, _ aspectRatio: Double) -> (ru: Double, rv: Double) {
    let ar = aspectRatio.isFinite && aspectRatio > 0 ? aspectRatio : 1
    let diagonal = hypot(ar, 1)
    return (ru: (radius * diagonal) / (2 * ar), rv: (radius * diagonal) / 2)
}

/// A patch's radius as a share of the frame's width and height — for drawing its ring.
public func patchExtent(_ patch: Patch, _ aspectRatio: Double) -> (ru: Double, rv: Double) {
    radiusExtent(patch.radius, aspectRatio)
}
