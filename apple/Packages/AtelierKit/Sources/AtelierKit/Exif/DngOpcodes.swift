// The CALIBRATION a DNG carries for the body that shot it — port of
// `src/shared/exif/dng-opcodes.ts`. Read from the file, never invented.
//
// A DNG's `OpcodeList1/2/3` tags hold a list of operations the camera says a
// correct conversion must apply. Two opcodes are read here, the two a DJI file
// writes: **GainMap (9)**, a grid of multiplicative gains per colour plane —
// NOT radial, so no vignette formula can express it — and **WarpRectilinear
// (1)**, a per-plane radial polynomial about an optical centre.
//
// The rules it keeps (`docs/memory/raw.md`, «The calibration a DNG carries»):
// - **The bytes are always BIG-ENDIAN**, whatever the TIFF's own byte order —
//   the one trap in this format. A little-endian read of a DJI file gives
//   gains around 1e-40 rather than around 1, a correction that turns a picture
//   black rather than one that merely looks wrong.
// - A GainMap with a row or column PITCH above 1 addresses one CFA plane of a
//   mosaic and is REFUSED, not applied to every pixel; `unread` names it.
// - Anything malformed yields what was read so far rather than an error: a
//   partial calibration is still calibration.
// - Sizes are the spec's: a GainMap is 76 bytes + rows × cols × planes
//   float32s; a three-plane WarpRectilinear is 4 + 3·6·8 + 16 = 164 bytes.

import Foundation

/// DNG opcode ids, of the two this reads.
private let opWarpRectilinear = 1
private let opGainMap = 9

public struct DngRect: Equatable, Sendable {
    public var top: Int
    public var left: Int
    public var bottom: Int
    public var right: Int
    public init(top: Int, left: Int, bottom: Int, right: Int) {
        self.top = top; self.left = left; self.bottom = bottom; self.right = right
    }
}

/// One GainMap opcode: a grid of gains over a rectangle of the image.
///
/// `rect` is in the image's own PIXELS, as the file states it; the nodes sit
/// at `origin + i·spacing` in coordinates where that rectangle is [0,1].
public struct DngGainMap: Equatable, Sendable {
    public var rect: DngRect
    /// The first colour plane this map applies to, and how many it covers.
    public var plane: Int
    public var planes: Int
    public var rows: Int
    public var cols: Int
    public var originV: Double
    public var originH: Double
    public var spacingV: Double
    public var spacingH: Double
    /// How many planes the GRID itself holds: 1 (shared) or one per plane.
    public var mapPlanes: Int
    /// Row-major, `rows × cols × mapPlanes` gains — the file's float32s.
    public var gains: [Float]

    public init(rect: DngRect, plane: Int, planes: Int, rows: Int, cols: Int, originV: Double, originH: Double,
                spacingV: Double, spacingH: Double, mapPlanes: Int, gains: [Float]) {
        self.rect = rect; self.plane = plane; self.planes = planes; self.rows = rows; self.cols = cols
        self.originV = originV; self.originH = originH; self.spacingV = spacingV; self.spacingH = spacingH
        self.mapPlanes = mapPlanes; self.gains = gains
    }
}

/// One plane's WarpRectilinear terms: four radial, two tangential.
public struct DngWarpPlane: Equatable, Sendable {
    /// `k0..k3`: `ratio = k0 + k1·r² + k2·r⁴ + k3·r⁶`, k0 a pure magnification. Four terms.
    public var radial: [Double]
    /// The two tangential terms, zero on a well-centred lens.
    public var tangential: [Double]
    public init(radial: [Double], tangential: [Double]) {
        self.radial = radial; self.tangential = tangential
    }
}

public struct DngWarp: Equatable, Sendable {
    /// One entry (shared by every plane) or three, red first.
    public var planes: [DngWarpPlane]
    /// The optical centre, in [0,1] of the image.
    public var centerH: Double
    public var centerV: Double
    public init(planes: [DngWarpPlane], centerH: Double, centerV: Double) {
        self.planes = planes; self.centerH = centerH; self.centerV = centerV
    }
}

public struct DngOpcodes: Equatable, Sendable {
    public var gainMaps: [DngGainMap]
    public var warp: DngWarp?
    /// Ids present that this reader does not apply — said, never silently dropped.
    public var unread: [Int]
    public init(gainMaps: [DngGainMap] = [], warp: DngWarp? = nil, unread: [Int] = []) {
        self.gainMaps = gainMaps; self.warp = warp; self.unread = unread
    }
    public static let empty = DngOpcodes()
}

/// Read one opcode list's bytes.
///
/// Anything malformed yields what was read so far rather than an error: a
/// partial calibration is still calibration, and a file we cannot parse must
/// degrade to "no rungs offered", never to a failure inside a decode.
public func parseOpcodeList(_ view: ByteView, offset: Int, length: Int) -> DngOpcodes {
    if length < 4 { return .empty }
    if offset < 0 || offset + length > view.byteLength { return .empty }
    var gainMaps: [DngGainMap] = []
    var unread: [Int] = []
    var warp: DngWarp? = nil
    let end = offset + length
    let count = Int(view.uint32(offset))
    var at = offset + 4
    // A count a corrupt tag could make enormous is bounded by the bytes: each
    // opcode costs at least its 16-byte header.
    var i = 0
    while i < count, at + 16 <= end {
        let id = Int(view.uint32(at))
        let bytes = Int(view.uint32(at + 12))
        let params = at + 16
        if params + bytes > end { break }
        if id == opGainMap {
            if let map = readGainMap(view, params, bytes) { gainMaps.append(map) } else { unread.append(id) }
        } else if id == opWarpRectilinear {
            if let w = readWarp(view, params, bytes) { warp = w } else { unread.append(id) }
        } else if !unread.contains(id) {
            unread.append(id)
        }
        at = params + bytes
        i += 1
    }
    return DngOpcodes(gainMaps: gainMaps, warp: warp, unread: unread)
}

/// The 76 fixed bytes of a GainMap, then `rows × cols × mapPlanes` float32s.
private func readGainMap(_ view: ByteView, _ at: Int, _ bytes: Int) -> DngGainMap? {
    if bytes < 76 { return nil }
    func u32(_ i: Int) -> Int { Int(view.uint32(at + i * 4)) }
    func f64(_ i: Int) -> Double { view.float64(at + 40 + i * 8) }
    let top = u32(0)
    let left = u32(1)
    let bottom = u32(2)
    let right = u32(3)
    let plane = u32(4)
    let planes = u32(5)
    let rowPitch = u32(6)
    let colPitch = u32(7)
    let rows = u32(8)
    let cols = u32(9)
    let mapPlanes = Int(view.uint32(at + 72))
    // A pitch above 1 addresses ONE CFA plane of a mosaic (OpcodeList2's job),
    // not the demosaiced image this applies to. Refused rather than applied to
    // every pixel, which would be a real correction of the wrong thing.
    if rowPitch != 1 || colPitch != 1 { return nil }
    if rows <= 0 || cols <= 0 || mapPlanes <= 0 || mapPlanes > 4 { return nil }
    if bottom <= top || right <= left { return nil }
    // Compared in doubles, as the web does: three uint32s multiplied can pass
    // an Int64, and a corrupt count must refuse, not trap.
    let need = Double(rows) * Double(cols) * Double(mapPlanes)
    if 76 + need * 4 > Double(bytes) { return nil }
    let n = Int(need)
    var gains = [Float](repeating: 0, count: n)
    for i in 0..<n { gains[i] = view.float32(at + 76 + i * 4) }
    return DngGainMap(
        rect: DngRect(top: top, left: left, bottom: bottom, right: right),
        plane: plane,
        planes: planes,
        rows: rows,
        cols: cols,
        originV: f64(2),
        originH: f64(3),
        spacingV: f64(0),
        spacingH: f64(1),
        mapPlanes: mapPlanes,
        gains: gains
    )
}

/// `N`, then `N × 6` doubles, then the optical centre's two.
private func readWarp(_ view: ByteView, _ at: Int, _ bytes: Int) -> DngWarp? {
    if bytes < 4 { return nil }
    let n = Int(view.uint32(at))
    if n != 1 && n != 3 { return nil }
    if bytes < 4 + n * 48 + 16 { return nil }
    var planes: [DngWarpPlane] = []
    for p in 0..<n {
        let base = at + 4 + p * 48
        func k(_ i: Int) -> Double { view.float64(base + i * 8) }
        planes.append(DngWarpPlane(radial: [k(0), k(1), k(2), k(3)], tangential: [k(4), k(5)]))
    }
    let c = at + 4 + n * 48
    return DngWarp(planes: planes, centerH: view.float64(c), centerV: view.float64(c + 8))
}

/// True when this warp would move no pixel — every plane an identity.
public func isIdentityWarp(_ w: DngWarp?) -> Bool {
    guard let w, !w.planes.isEmpty else { return true }
    return w.planes.allSatisfy { p in
        guard p.radial.count >= 4, p.tangential.count >= 2 else { return false }
        return p.radial[0] == 1 && p.radial[1] == 0 && p.radial[2] == 0 && p.radial[3] == 0
            && p.tangential[0] == 0 && p.tangential[1] == 0
    }
}

/// One plane's terms, by index — a one-plane warp answers for all three. Nil
/// only for a warp holding no plane at all, which no file yields.
public func warpPlane(_ w: DngWarp, _ plane: Int) -> DngWarpPlane? {
    if w.planes.isEmpty { return nil }
    return w.planes[min(plane, w.planes.count - 1)]
}

/// `gain map 32×32 ×3 · up to 5.93× · warp ×1.049` — what the file really asks
/// for, in the numbers a person can check against the picture.
public func describeOpcodes(_ o: DngOpcodes?) -> String {
    guard let o else { return "" }
    var parts: [String] = []
    for m in o.gainMaps {
        var maxGain: Double = 1
        for g in m.gains where Double(g) > maxGain { maxGain = Double(g) }
        parts.append("gain map \(m.cols)×\(m.rows) ×\(m.mapPlanes) · up to \(ExifText.toFixed(maxGain, 2))×")
    }
    if let warp = o.warp, !isIdentityWarp(warp) {
        let k0 = warp.planes.map { $0.radial.first ?? 0 }
        let mid = k0[k0.count / 2]
        parts.append("warp ×\(ExifText.toFixed(mid, 3))")
    }
    if !o.unread.isEmpty {
        parts.append("\(o.unread.count) opcode\(o.unread.count > 1 ? "s" : "") not applied")
    }
    return parts.joined(separator: " · ")
}
