// A QR code encoder — byte mode, error-correction level M, versions 1 to 10.
// Port of `src/shared/lib/qr.ts`.
//
// Hand-rolled rather than pulled in, for the reason the whole suite exists:
// nothing may leave the machine, and a call-to-action slide that fetched its
// QR from a web service would be the one place the tool phoned home. Small
// enough to hold: ~250 lines against a spec that has not moved since 2000.
//
// Scope is deliberate. Byte mode encodes any UTF-8 string, so numeric and
// alphanumeric modes would only buy density nobody needs here; level M gives
// ~15 % recovery, the usual choice for something printed large; version 10
// holds 213 bytes, several times any URL worth putting on a slide. A string
// that does not fit returns nil rather than silently truncating — a QR that
// scans to half a URL is worse than no QR.
//
// Pure. The drawing (whole-pixel modules, a four-module quiet zone) is the
// app's; the web's is in `roadtrip/badge-render.ts`. The web verified this
// encoder by DECODING the rendered canvas with a decoder kept out of the repo;
// the spec here pins the module matrix through the same structural checks the
// web's unit spec makes, and the same worked example from ISO/IEC 18004.

import Foundation

/// A finished code: `size × size` modules, row-major, true = dark.
public struct QrMatrix: Equatable, Sendable {
    public var version: Int
    public var size: Int
    public var modules: [Bool]

    public init(version: Int, size: Int, modules: [Bool]) {
        self.version = version
        self.size = size
        self.modules = modules
    }

    /// The module at `(row, col)`.
    public func dark(_ row: Int, _ col: Int) -> Bool {
        modules[row * size + col]
    }
}

/// Longest UTF-8 payload this encoder can carry.
public let qrMaxBytes = 213

/// Whether `text` fits, so a caller can say so before drawing nothing.
public func qrFits(_ text: String) -> Bool {
    text.utf8.count <= qrMaxBytes
}

// MARK: - GF(256), the field Reed–Solomon works in

private let gfTables: (exp: [Int], log: [Int]) = {
    var exp = [Int](repeating: 0, count: 512)
    var log = [Int](repeating: 0, count: 256)
    var x = 1
    for i in 0..<255 {
        exp[i] = x
        log[x] = i
        x <<= 1
        // The primitive polynomial x⁸+x⁴+x³+x²+1, as the standard fixes it.
        if x & 0x100 != 0 { x ^= 0x11d }
    }
    for i in 255..<512 { exp[i] = exp[i - 255] }
    return (exp, log)
}()

private func gmul(_ a: Int, _ b: Int) -> Int {
    a == 0 || b == 0 ? 0 : gfTables.exp[gfTables.log[a] + gfTables.log[b]]
}

/// g(x) = ∏(x − α^i), ascending coefficients; monic, so the top one is 1.
private func rsGenerator(_ degree: Int) -> [Int] {
    var c = [1]
    for i in 0..<degree {
        var out = [Int](repeating: 0, count: c.count + 1)
        for k in 0...c.count {
            let shifted = k > 0 ? c[k - 1] : 0
            let scaled = k < c.count ? gmul(c[k], gfTables.exp[i]) : 0
            out[k] = shifted ^ scaled
        }
        c = out
    }
    return c
}

/// The error-correction codewords for one block: polynomial long division.
public func rsEncode(_ data: [UInt8], _ ecLength: Int) -> [UInt8] {
    guard ecLength >= 1 else { return [] }
    let gen = Array(rsGenerator(ecLength).reversed()) // descending; gen[0] == 1
    var work = [Int](repeating: 0, count: data.count + ecLength)
    for (i, byte) in data.enumerated() { work[i] = Int(byte) }
    for i in 0..<data.count {
        let coef = work[i]
        if coef == 0 { continue }
        for j in 1...ecLength { work[i + j] ^= gmul(gen[j], coef) }
    }
    return work[data.count...].map { UInt8($0) }
}

// MARK: - The version tables (error-correction level M only)

private struct VersionSpec {
    /// Data + error-correction codewords together.
    let total: Int
    /// Error-correction codewords per block.
    let ec: Int
    /// `(blocks, data codewords each)`, in interleaving order.
    let groups: [(blocks: Int, each: Int)]
}

private let versions: [VersionSpec] = [
    VersionSpec(total: 26, ec: 10, groups: [(1, 16)]),
    VersionSpec(total: 44, ec: 16, groups: [(1, 28)]),
    VersionSpec(total: 70, ec: 26, groups: [(1, 44)]),
    VersionSpec(total: 100, ec: 18, groups: [(2, 32)]),
    VersionSpec(total: 134, ec: 24, groups: [(2, 43)]),
    VersionSpec(total: 172, ec: 16, groups: [(4, 27)]),
    VersionSpec(total: 196, ec: 18, groups: [(4, 31)]),
    VersionSpec(total: 242, ec: 22, groups: [(2, 38), (2, 39)]),
    VersionSpec(total: 292, ec: 22, groups: [(3, 36), (2, 37)]),
    VersionSpec(total: 346, ec: 26, groups: [(4, 43), (1, 44)]),
]

/// Alignment-pattern centres per version (none on version 1).
private let alignment: [[Int]] = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
]

private func dataCodewords(_ spec: VersionSpec) -> Int {
    spec.groups.reduce(0) { $0 + $1.blocks * $1.each }
}

// MARK: - Encoding

private func bitsFor(_ value: Int, _ length: Int, _ out: inout [Int]) {
    for i in stride(from: length - 1, through: 0, by: -1) { out.append((value >> i) & 1) }
}

/// The smallest version that holds `byteLength`, or nil when none does.
private func chooseVersion(_ byteLength: Int) -> Int? {
    for v in 1...versions.count {
        let spec = versions[v - 1]
        let countBits = v <= 9 ? 8 : 16
        let available = dataCodewords(spec) * 8 - 4 - countBits
        if byteLength * 8 <= available { return v }
    }
    return nil
}

/// Data codewords: header, payload, terminator, padding.
private func buildCodewords(_ bytes: [UInt8], _ version: Int) -> [UInt8] {
    let spec = versions[version - 1]
    let capacity = dataCodewords(spec)
    var bits: [Int] = []

    bitsFor(0b0100, 4, &bits) // byte mode
    bitsFor(bytes.count, version <= 9 ? 8 : 16, &bits)
    for b in bytes { bitsFor(Int(b), 8, &bits) }

    // Terminator, then out to a whole byte.
    let room = capacity * 8 - bits.count
    bitsFor(0, min(4, room), &bits)
    while bits.count % 8 != 0 { bits.append(0) }

    var out = [UInt8](repeating: 0, count: capacity)
    var i = 0
    while i < bits.count {
        var byte = 0
        for j in 0..<8 { byte = (byte << 1) | bits[i + j] }
        out[i / 8] = UInt8(byte)
        i += 8
    }
    // The two pad bytes the standard names, alternating.
    var k = bits.count / 8
    var alt = 0
    while k < capacity {
        out[k] = alt % 2 == 0 ? 0xec : 0x11
        k += 1
        alt += 1
    }
    return out
}

/// Split into blocks, add error correction, interleave both halves.
private func interleave(_ data: [UInt8], _ version: Int) -> [UInt8] {
    let spec = versions[version - 1]
    var dataBlocks: [[UInt8]] = []
    var ecBlocks: [[UInt8]] = []

    var offset = 0
    for group in spec.groups {
        for _ in 0..<group.blocks {
            let block = Array(data[offset..<(offset + group.each)])
            offset += group.each
            dataBlocks.append(block)
            ecBlocks.append(rsEncode(block, spec.ec))
        }
    }

    var out = [UInt8](repeating: 0, count: spec.total)
    var k = 0
    let longest = dataBlocks.map(\.count).max() ?? 0
    for i in 0..<longest {
        for block in dataBlocks where i < block.count {
            out[k] = block[i]
            k += 1
        }
    }
    for i in 0..<spec.ec {
        for block in ecBlocks {
            out[k] = block[i]
            k += 1
        }
    }
    return out
}

// MARK: - The matrix

private final class Grid {
    let size: Int
    var modules: [Bool]
    /// Function patterns, which the data skips and the mask never touches.
    var reserved: [Bool]

    init(version: Int) {
        size = version * 4 + 17
        modules = [Bool](repeating: false, count: size * size)
        reserved = [Bool](repeating: false, count: size * size)
    }

    func set(_ row: Int, _ col: Int, _ dark: Bool, function: Bool = false) {
        if row < 0 || col < 0 || row >= size || col >= size { return }
        modules[row * size + col] = dark
        if function { reserved[row * size + col] = true }
    }

    func get(_ row: Int, _ col: Int) -> Bool {
        modules[row * size + col]
    }

    func isReserved(_ row: Int, _ col: Int) -> Bool {
        reserved[row * size + col]
    }
}

private func drawFinder(_ grid: Grid, _ row: Int, _ col: Int) {
    // The 7×7 eye plus its one-module separator, clipped at the frame's edge.
    for r in -1...7 {
        for c in -1...7 {
            let ring = r >= 0 && r <= 6 && (c == 0 || c == 6)
            let bar = c >= 0 && c <= 6 && (r == 0 || r == 6)
            let core = r >= 2 && r <= 4 && c >= 2 && c <= 4
            grid.set(row + r, col + c, ring || bar || core, function: true)
        }
    }
}

private func drawAlignment(_ grid: Grid, _ row: Int, _ col: Int) {
    for r in -2...2 {
        for c in -2...2 {
            let dark = max(abs(r), abs(c)) != 1
            grid.set(row + r, col + c, dark, function: true)
        }
    }
}

private func drawFunctionPatterns(_ grid: Grid, _ version: Int) {
    let size = grid.size

    drawFinder(grid, 0, 0)
    drawFinder(grid, 0, size - 7)
    drawFinder(grid, size - 7, 0)

    // Timing lines, running between the finders.
    for i in 8..<(size - 8) {
        grid.set(6, i, i % 2 == 0, function: true)
        grid.set(i, 6, i % 2 == 0, function: true)
    }

    let centres = alignment[version - 1]
    for r in centres {
        for c in centres {
            // The three that would sit on a finder are omitted.
            let onFinder = (r == 6 && c == 6) || (r == 6 && c == size - 7) || (r == size - 7 && c == 6)
            if !onFinder { drawAlignment(grid, r, c) }
        }
    }

    // Reserve the format strips (written after the mask is chosen). Index 6 is
    // skipped on purpose: row 6 and column 6 belong to the timing patterns, and
    // blanking them here silently punched two holes in the very lines a decoder
    // uses to find the module grid. Error correction hid it from a round trip.
    for i in 0..<9 where i != 6 {
        grid.set(8, i, false, function: true)
        grid.set(i, 8, false, function: true)
    }
    for i in 0..<8 {
        grid.set(8, size - 1 - i, false, function: true)
        grid.set(size - 1 - i, 8, false, function: true)
    }
    // The one module that is always dark.
    grid.set(size - 8, 8, true, function: true)

    if version >= 7 {
        let bits = versionBits(version)
        for i in 0..<18 {
            let bit = ((bits >> i) & 1) == 1
            let a = size - 11 + (i % 3)
            let b = i / 3
            grid.set(b, a, bit, function: true)
            grid.set(a, b, bit, function: true)
        }
    }
}

/// BCH(18,6) over the version number.
private func versionBits(_ version: Int) -> Int {
    var rem = version
    for _ in 0..<12 { rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25) }
    return (version << 12) | rem
}

/// BCH(15,5) over the EC level and mask, masked as the standard requires.
private func formatBits(_ mask: Int) -> Int {
    // Level M is `00`.
    let data = (0b00 << 3) | mask
    var rem = data
    for _ in 0..<10 { rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537) }
    return ((data << 10) | rem) ^ 0x5412
}

private func drawFormat(_ grid: Grid, _ mask: Int) {
    let bits = formatBits(mask)
    let size = grid.size
    func bit(_ i: Int) -> Bool { ((bits >> i) & 1) == 1 }

    for i in 0...5 { grid.set(i, 8, bit(i), function: true) }
    grid.set(7, 8, bit(6), function: true)
    grid.set(8, 8, bit(7), function: true)
    grid.set(8, 7, bit(8), function: true)
    for i in 9..<15 { grid.set(8, 14 - i, bit(i), function: true) }

    for i in 0..<8 { grid.set(8, size - 1 - i, bit(i), function: true) }
    for i in 8..<15 { grid.set(size - 15 + i, 8, bit(i), function: true) }
    grid.set(size - 8, 8, true, function: true)
}

/// Zigzag placement: two columns at a time, right to left, skipping column 6.
private func drawCodewords(_ grid: Grid, _ codewords: [UInt8]) {
    let size = grid.size
    var i = 0
    let totalBits = codewords.count * 8

    var right = size - 1
    while right >= 1 {
        if right == 6 { right = 5 }
        for vert in 0..<size {
            for j in 0..<2 {
                let col = right - j
                let upward = ((right + 1) & 2) == 0
                let row = upward ? size - 1 - vert : vert
                if grid.isReserved(row, col) { continue }
                // Past the data sit the version's remainder bits, which are
                // zeros — already what an untouched module is, so nothing to
                // write.
                if i < totalBits {
                    let dark = ((Int(codewords[i >> 3]) >> (7 - (i & 7))) & 1) == 1
                    grid.set(row, col, dark)
                }
                i += 1
            }
        }
        right -= 2
    }
}

private func maskAt(_ mask: Int, _ row: Int, _ col: Int) -> Bool {
    switch mask {
    case 0: return (row + col) % 2 == 0
    case 1: return row % 2 == 0
    case 2: return col % 3 == 0
    case 3: return (row + col) % 3 == 0
    case 4: return (col / 3 + row / 2) % 2 == 0
    case 5: return ((col * row) % 2) + ((col * row) % 3) == 0
    case 6: return (((col * row) % 2) + ((col * row) % 3)) % 2 == 0
    default: return (((col + row) % 2) + ((col * row) % 3)) % 2 == 0
    }
}

private func applyMask(_ grid: Grid, _ mask: Int) {
    for row in 0..<grid.size {
        for col in 0..<grid.size {
            if grid.isReserved(row, col) { continue }
            if maskAt(mask, row, col) {
                grid.set(row, col, !grid.get(row, col))
            }
        }
    }
}

/// The standard's four penalties. Only their ORDER matters — any mask scans.
private func penalty(_ grid: Grid) -> Int {
    let size = grid.size
    var score = 0

    for a in 0..<size {
        var rowRun = 1
        var colRun = 1
        for b in 1..<size {
            rowRun = grid.get(a, b) == grid.get(a, b - 1) ? rowRun + 1 : 1
            if rowRun == 5 {
                score += 3
            } else if rowRun > 5 {
                score += 1
            }
            colRun = grid.get(b, a) == grid.get(b - 1, a) ? colRun + 1 : 1
            if colRun == 5 {
                score += 3
            } else if colRun > 5 {
                score += 1
            }
        }
    }

    for row in 0..<(size - 1) {
        for col in 0..<(size - 1) {
            let v = grid.get(row, col)
            if v == grid.get(row, col + 1) && v == grid.get(row + 1, col) && v == grid.get(row + 1, col + 1) {
                score += 3
            }
        }
    }

    // The finder-like run, in both directions and both polarities.
    let pattern = [true, false, true, true, true, false, true]
    func hasAt(_ get: (Int) -> Bool, _ start: Int, _ len: Int) -> Bool {
        for i in 0..<7 where get(start + i) != pattern[i] { return false }
        var before = true
        for i in 0..<4 {
            let idx = start - 1 - i
            if !(idx < 0 || !get(idx)) {
                before = false
                break
            }
        }
        var after = true
        for i in 0..<4 {
            let idx = start + 7 + i
            if !(idx >= len || !get(idx)) {
                after = false
                break
            }
        }
        return before || after
    }
    for a in 0..<size {
        var b = 0
        while b + 7 <= size {
            if hasAt({ grid.get(a, $0) }, b, size) { score += 40 }
            if hasAt({ grid.get($0, a) }, b, size) { score += 40 }
            b += 1
        }
    }

    var dark = 0
    for m in grid.modules where m { dark += 1 }
    let percent = Double(dark * 100) / Double(size * size)
    score += Int(floor(abs(percent - 50) / 5)) * 10

    return score
}

/// Encode `text` as a QR code, or nil when it is empty or too long for
/// version 10 at level M (213 bytes of UTF-8).
public func encodeQr(_ text: String) -> QrMatrix? {
    let bytes = Array(text.utf8)
    if bytes.isEmpty { return nil }
    guard let version = chooseVersion(bytes.count) else { return nil }

    let codewords = interleave(buildCodewords(bytes, version), version)

    var best: Grid? = nil
    var bestScore = Int.max
    for mask in 0..<8 {
        let grid = Grid(version: version)
        drawFunctionPatterns(grid, version)
        drawCodewords(grid, codewords)
        applyMask(grid, mask)
        drawFormat(grid, mask)
        let score = penalty(grid)
        if score < bestScore {
            bestScore = score
            best = grid
        }
    }
    guard let best else { return nil }

    return QrMatrix(version: version, size: best.size, modules: best.modules)
}
