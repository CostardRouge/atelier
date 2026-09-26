// A `.cube` 3D LUT — the file, the lattice, and how a colour is read from it.
// Port of `src/shared/lib/cube-parser.ts` and `src/shared/lut/interpolate.ts`.
//
// TETRAHEDRAL is the default everywhere: all six tetrahedra share the
// c000→c111 edge — the neutral axis — so a grey interpolates between two greys
// and NEUTRALS STAY NEUTRAL exactly. Trilinear averages the cell's eight
// corners, two of which lie on the far diagonal, and tints greys on a
// channel-asymmetric look. Whatever is chosen must be used both by the bake
// and by the renderer, or the preview and the export stop agreeing.

import Foundation

public enum Interpolation: String, Codable, Sendable {
    case trilinear, tetrahedral
}

public struct CubeLut: Equatable, Sendable {
    /// Grid size N along each axis (LUT_3D_SIZE), typically 17, 33 or 65.
    public var size: Int
    /// Flat RGB triplets, `size³ × 3`, in `.cube` order: red varies fastest,
    /// then green, then blue — the memory order a 3D texture expects.
    public var data: [Float]
    public var title: String?
    public var domainMin: (Double, Double, Double)
    public var domainMax: (Double, Double, Double)

    public init(size: Int, data: [Float], title: String? = nil,
                domainMin: (Double, Double, Double) = (0, 0, 0), domainMax: (Double, Double, Double) = (1, 1, 1)) {
        self.size = size; self.data = data; self.title = title; self.domainMin = domainMin; self.domainMax = domainMax
    }

    public static func == (a: CubeLut, b: CubeLut) -> Bool {
        a.size == b.size && a.title == b.title && a.data == b.data
            && a.domainMin == b.domainMin && a.domainMax == b.domainMax
    }

    /// The smallest cube that changes nothing.
    public static func identity() -> CubeLut {
        var data = [Float](repeating: 0, count: 2 * 2 * 2 * 3)
        for b in 0..<2 { for g in 0..<2 { for r in 0..<2 {
            let o = (r + g * 2 + b * 4) * 3
            data[o] = Float(r)
            data[o + 1] = Float(g)
            data[o + 2] = Float(b)
        } } }
        return CubeLut(size: 2, data: data)
    }

    /// A `size³` cube from a per-channel function — the test helper the web's
    /// specs use, and how a synthetic look is built.
    public static func make(size: Int, _ fn: (Double, Double, Double) -> (Double, Double, Double),
                            domainMin: (Double, Double, Double) = (0, 0, 0),
                            domainMax: (Double, Double, Double) = (1, 1, 1)) -> CubeLut {
        var data = [Float](repeating: 0, count: size * size * size * 3)
        let last = Double(size - 1)
        for bi in 0..<size { for gi in 0..<size { for ri in 0..<size {
            let (r, g, b) = fn(Double(ri) / last, Double(gi) / last, Double(bi) / last)
            let o = (ri + gi * size + bi * size * size) * 3
            data[o] = Float(r)
            data[o + 1] = Float(g)
            data[o + 2] = Float(b)
        } } }
        return CubeLut(size: size, data: data, domainMin: domainMin, domainMax: domainMax)
    }
}

// MARK: - parsing

/// Parse the contents of a `.cube` file, or nil if it is not a usable 3D LUT
/// (a 1D LUT, a missing size, a row count that does not match `size³`).
/// Tolerant to unknown keywords, comments and either line ending.
public func parseCube(_ text: String) -> CubeLut? {
    var size = 0
    var title: String?
    var domainMin = (0.0, 0.0, 0.0)
    var domainMax = (1.0, 1.0, 1.0)
    var data: [Float]? = nil
    var writeIndex = 0

    let normalised = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    for rawLine in normalised.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.isEmpty || line.hasPrefix("#") { continue }
        let first = line.first!
        let looksNumeric = first == "-" || first == "." || first.isNumber

        if !looksNumeric {
            // `\s+`, as the web's patterns read it: a tab is a separator too
            // (DJI's own LUTs write `LUT_3D_SIZE<TAB>33`).
            let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            guard let keyword = fields.first else { continue }
            switch keyword {
            case "TITLE":
                var t = String(line.dropFirst("TITLE".count)).trimmingCharacters(in: .whitespaces)
                if t.hasPrefix("\"") { t.removeFirst() }
                if t.hasSuffix("\"") { t.removeLast() }
                title = t
            case "LUT_1D_SIZE":
                return nil
            case "LUT_3D_SIZE":
                guard fields.count >= 2, let n = Int(fields[1]) else { continue }
                size = n
            case "DOMAIN_MIN":
                guard fields.count >= 4, let a = Double(fields[1]), let b = Double(fields[2]), let c = Double(fields[3]) else { continue }
                domainMin = (a, b, c)
            case "DOMAIN_MAX":
                guard fields.count >= 4, let a = Double(fields[1]), let b = Double(fields[2]), let c = Double(fields[3]) else { continue }
                domainMax = (a, b, c)
            default:
                continue
            }
            continue
        }

        if size <= 0 { return nil }
        if data == nil { data = [Float](repeating: 0, count: size * size * size * 3) }
        let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard fields.count == 3, let r = Float(fields[0]), let g = Float(fields[1]), let b = Float(fields[2]) else { continue }
        if writeIndex + 3 > data!.count { return nil }
        data![writeIndex] = r
        data![writeIndex + 1] = g
        data![writeIndex + 2] = b
        writeIndex += 3
    }

    guard let table = data, size > 0, writeIndex == table.count else { return nil }
    return CubeLut(size: size, data: table, title: title, domainMin: domainMin, domainMax: domainMax)
}

// MARK: - sampling

/// Map a colour onto lattice coordinates in [0, size−1], honouring the cube's
/// declared input domain; out-of-domain inputs clamp like `CLAMP_TO_EDGE`.
@inline(__always) private func latticeCoords(_ lut: CubeLut, _ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let last = Double(lut.size - 1)
    @inline(__always) func norm(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
        let span = hi - lo
        return clamp01(span == 0 ? 0 : (v - lo) / span) * last
    }
    return (norm(r, lut.domainMin.0, lut.domainMax.0), norm(g, lut.domainMin.1, lut.domainMax.1), norm(b, lut.domainMin.2, lut.domainMax.2))
}

/// Trilinear: the weighted average of the cell's 8 corners.
public func sampleTrilinear(_ lut: CubeLut, _ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let n = lut.size
    let last = n - 1
    let (x, y, z) = latticeCoords(lut, r, g, b)
    let x0 = Int(x.rounded(.down)), y0 = Int(y.rounded(.down)), z0 = Int(z.rounded(.down))
    let x1 = min(x0 + 1, last), y1 = min(y0 + 1, last), z1 = min(z0 + 1, last)
    let fx = x - Double(x0), fy = y - Double(y0), fz = z - Double(z0)
    @inline(__always) func at(_ xi: Int, _ yi: Int, _ zi: Int) -> Int { (xi + yi * n + zi * n * n) * 3 }
    var out = (0.0, 0.0, 0.0)
    for c in 0..<3 {
        let d = lut.data
        let c000 = Double(d[at(x0, y0, z0) + c]), c100 = Double(d[at(x1, y0, z0) + c])
        let c010 = Double(d[at(x0, y1, z0) + c]), c110 = Double(d[at(x1, y1, z0) + c])
        let c001 = Double(d[at(x0, y0, z1) + c]), c101 = Double(d[at(x1, y0, z1) + c])
        let c011 = Double(d[at(x0, y1, z1) + c]), c111 = Double(d[at(x1, y1, z1) + c])
        let c00 = c000 + (c100 - c000) * fx
        let c10 = c010 + (c110 - c010) * fx
        let c01 = c001 + (c101 - c001) * fx
        let c11 = c011 + (c111 - c011) * fx
        let c0 = c00 + (c10 - c00) * fy
        let c1 = c01 + (c11 - c01) * fy
        let v = c0 + (c1 - c0) * fz
        switch c { case 0: out.0 = v; case 1: out.1 = v; default: out.2 = v }
    }
    return out
}

/// Tetrahedral (Kasson): one of 6 tetrahedra by ordering the fractions, then
/// interpolate from its 4 vertices. On the neutral axis every branch reduces to
/// `c000 + (c111 − c000) · f`.
public func sampleTetrahedral(_ lut: CubeLut, _ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    let n = lut.size
    let last = n - 1
    let (x, y, z) = latticeCoords(lut, r, g, b)
    let x0 = Int(x.rounded(.down)), y0 = Int(y.rounded(.down)), z0 = Int(z.rounded(.down))
    let x1 = min(x0 + 1, last), y1 = min(y0 + 1, last), z1 = min(z0 + 1, last)
    let fx = x - Double(x0), fy = y - Double(y0), fz = z - Double(z0)
    @inline(__always) func at(_ xi: Int, _ yi: Int, _ zi: Int) -> Int { (xi + yi * n + zi * n * n) * 3 }
    let i000 = at(x0, y0, z0), i100 = at(x1, y0, z0), i010 = at(x0, y1, z0), i110 = at(x1, y1, z0)
    let i001 = at(x0, y0, z1), i101 = at(x1, y0, z1), i011 = at(x0, y1, z1), i111 = at(x1, y1, z1)
    let d = lut.data
    var out = (0.0, 0.0, 0.0)
    for c in 0..<3 {
        let c000 = Double(d[i000 + c]), c100 = Double(d[i100 + c]), c010 = Double(d[i010 + c]), c110 = Double(d[i110 + c])
        let c001 = Double(d[i001 + c]), c101 = Double(d[i101 + c]), c011 = Double(d[i011 + c]), c111 = Double(d[i111 + c])
        let v: Double
        if fx > fy {
            if fy > fz {
                v = c000 + (c100 - c000) * fx + (c110 - c100) * fy + (c111 - c110) * fz
            } else if fx > fz {
                v = c000 + (c100 - c000) * fx + (c111 - c101) * fy + (c101 - c100) * fz
            } else {
                v = c000 + (c101 - c001) * fx + (c111 - c101) * fy + (c001 - c000) * fz
            }
        } else {
            if fz > fy {
                v = c000 + (c111 - c011) * fx + (c011 - c001) * fy + (c001 - c000) * fz
            } else if fz > fx {
                v = c000 + (c111 - c011) * fx + (c010 - c000) * fy + (c011 - c010) * fz
            } else {
                v = c000 + (c110 - c010) * fx + (c010 - c000) * fy + (c111 - c110) * fz
            }
        }
        switch c { case 0: out.0 = v; case 1: out.1 = v; default: out.2 = v }
    }
    return out
}

/// Sample `lut` the chosen way.
public func sampleWith(_ lut: CubeLut, _ r: Double, _ g: Double, _ b: Double, _ mode: Interpolation) -> (Double, Double, Double) {
    mode == .tetrahedral ? sampleTetrahedral(lut, r, g, b) : sampleTrilinear(lut, r, g, b)
}

/// Trilinear sample — the module's historical name, kept so specs read the same.
public func sampleLut(_ lut: CubeLut, _ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
    sampleTrilinear(lut, r, g, b)
}
