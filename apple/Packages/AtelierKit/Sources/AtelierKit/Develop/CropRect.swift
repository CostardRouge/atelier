// The Develop tool's crop as a ZONE drawn over the whole picture — the
// arithmetic of the classic crop the maintainer asked for (2026-09-19). Port
// of `src/shared/develop/crop-rect.ts`.
//
// The roll does not store a zone: it stores what it always stored, an
// `aspect` and a `Framing` (`Framing.swift`, `fit: .cover`), which every
// renderer already draws. The editor manipulates a zone and converts both
// ways, so nothing migrates.
//
// The zone lives in the TURNED picture's frame: source pixels, origin at the
// picture's centre, the picture rotated (and mirrored) about that centre the
// way `drawFramed` turns it — so on the crop stage the picture turns UNDER an
// axis-aligned zone. Written out:
//
//   screen = R(θ)·M·q        (q: a source pixel from the picture's centre)
//   the frame shows [cx ± w/2] × [cy ± h/2] of that screen
//   scale = 1 / max((w·c + h·s)/W, (w·s + h·c)/H)       c = |cos θ|, s = |sin θ|
//   (px, py) = R(−θ)·(−cx, −cy),  x = px / max(w, h),  y = py / max(w, h)
//
// which is exactly `framingTransform`'s cover condition run backwards.
//
// Every gesture produces a CANDIDATE zone and is then CLAMPED: from the last
// valid zone toward the candidate, by bisection over the four edges
// interpolated together. That one rule keeps a handle anchored on its opposite
// edge, keeps a locked ratio, and stops a drag at the picture's edge instead
// of letting it jump.

import Foundation

/// A crop zone in the turned picture's frame, in source pixels from its centre.
public struct CropZone: Equatable, Sendable {
    public var cx: Double
    public var cy: Double
    public var w: Double
    public var h: Double

    public init(cx: Double, cy: Double, w: Double, h: Double) {
        self.cx = cx; self.cy = cy; self.w = w; self.h = h
    }
}

/// A picture's pixel size — the web's `PictureDims`, which is Geometry's `Size`.
public typealias PictureDims = Size

private let radiansPerDegree = Double.pi / 180

/// How far a zone may overhang the picture before it reads as a gap — float noise, never a pixel.
private let overhangEpsilon = 1e-9

private struct Turn {
    let cos: Double
    let sin: Double
    /// |cos θ| and |sin θ|.
    let c: Double
    let s: Double
}

private func turn(_ deg: Double) -> Turn {
    let a = wrapDegrees(deg) * radiansPerDegree
    let cosA = Foundation.cos(a)
    let sinA = Foundation.sin(a)
    return Turn(cos: cosA, sin: sinA, c: abs(cosA), s: abs(sinA))
}

/// The zone's centre in the picture's own (un-turned) axes: R(−θ)·c.
private func intoPicture(_ cx: Double, _ cy: Double, _ deg: Double) -> (qx: Double, qy: Double) {
    let t = turn(deg)
    return (cx * t.cos + cy * t.sin, -cx * t.sin + cy * t.cos)
}

/// JavaScript's `x || 0`: a −0 or a NaN spelled 0.
private func orZero(_ v: Double) -> Double {
    v == 0 || v.isNaN ? 0 : v
}

/// JavaScript's `Math.round`: halves go toward +∞.
private func roundHalfUp(_ x: Double) -> Double {
    let f = x.rounded(.down)
    return x - f >= 0.5 ? f + 1 : f
}

/// `Math.sign`: 1, −1 or 0.
private func signum(_ v: Double) -> Double {
    v > 0 ? 1 : (v < 0 ? -1 : 0)
}

/// How much of the picture a zone of this size takes, the larger of its two
/// axes once turned back: 1 is a zone that exactly covers at scale 1, 1/8 the
/// smallest `maxFramingScale` allows.
public func zoneBase(_ w: Double, _ h: Double, _ deg: Double, _ src: PictureDims) -> Double {
    let t = turn(deg)
    return max((w * t.c + h * t.s) / src.width, (w * t.s + h * t.c) / src.height)
}

// MARK: - the stored crop, both ways

/// The aspect id a zone of this ratio is stored as: one of the suite's named
/// formats when it IS one (to a thousandth), else a free zone carrying its own
/// ratio. `original` is the caller's to ask for.
public func aspectIdFor(_ ratio: Double) -> String {
    if let preset = aspectPresets.first(where: { abs($0.w / $0.h / ratio - 1) < 1e-3 }) { return preset.id }
    return freeAspectId(ratio)
}

/// The framing a zone is stored as — always `fit: .cover`, the rotation and the
/// flips as given (the zone does not carry them: it is drawn over a picture
/// ALREADY turned by them).
public func cropFromZone(_ src: PictureDims, _ zone: CropZone, _ rotation: Double, _ flipX: Bool, _ flipY: Bool) -> Framing {
    let t = turn(rotation)
    let base = zoneBase(zone.w, zone.h, rotation, src)
    let raw = min(maxFramingScale, max(1, base > 0 ? 1 / base : 1))
    // Float noise snapped away: the largest zone must store as scale 1, or an
    // untouched picture reads as cropped and counts as developed.
    let scale = abs(raw - 1) < 1e-6 ? 1 : raw
    let unit = max(zone.w, zone.h)
    let px = -(zone.cx * t.cos + zone.cy * t.sin)
    let py = -(-zone.cx * t.sin + zone.cy * t.cos)
    func snap(_ v: Double) -> Double { abs(v) < 1e-9 ? 0 : v }
    return Framing(
        scale: scale,
        x: unit > 0 ? snap(px / unit) : 0,
        y: unit > 0 ? snap(py / unit) : 0,
        rotation: wrapDegrees(rotation),
        flipX: flipX,
        flipY: flipY,
        fit: .cover
    )
}

/// The zone a stored crop shows — read through `framingTransform` itself, so
/// the pan is clamped exactly as the renderers clamp it. A `contain` framing
/// (the retired Whole) is read as its cover twin: the caller decides what to do
/// with a legacy picture (`legacyWholeBorder`).
public func zoneFromCrop(_ src: PictureDims, _ aspectRatio: Double, _ framing: Framing) -> CropZone {
    let r = aspectRatio > 0 ? aspectRatio : src.width / src.height
    let t = turn(framing.rotation)
    let zoom = min(maxFramingScale, max(1, framing.scale))
    // The zone of ratio r that exactly covers at scale 1, shrunk by the zoom.
    let across = (r * t.c + t.s) / src.width
    let down = (r * t.s + t.c) / src.height
    let h = 1 / zoom / max(across, down)
    let w = h * r
    var cover = framing
    cover.fit = .cover
    let ft = framingTransform(src.width, src.height, w, h, cover)
    let px = ft.scale > 0 ? ft.panX / ft.scale : 0
    let py = ft.scale > 0 ? ft.panY / ft.scale : 0
    // c = −R(θ)·p
    return CropZone(cx: orZero(-(px * t.cos - py * t.sin)), cy: orZero(-(px * t.sin + py * t.cos)), w: w, h: h)
}

// MARK: - validity and the clamp

/// Every corner of the zone inside the turned picture — Fill's invariant.
public func zoneContained(_ zone: CropZone, _ deg: Double, _ src: PictureDims) -> Bool {
    let t = turn(deg)
    let q = intoPicture(zone.cx, zone.cy, deg)
    let tol = overhangEpsilon * max(src.width, src.height)
    let halfX = (zone.w * t.c + zone.h * t.s) / 2
    let halfY = (zone.w * t.s + zone.h * t.c) / 2
    return abs(q.qx) + halfX <= src.width / 2 + tol && abs(q.qy) + halfY <= src.height / 2 + tol
}

/// A zone the roll can store: inside the picture, no smaller than the deepest
/// zoom a framing allows, and no stranger a shape than a free aspect may be.
public func zoneValid(_ zone: CropZone, _ deg: Double, _ src: PictureDims) -> Bool {
    if !(zone.w > 0 && zone.h > 0) || !zone.cx.isFinite || !zone.cy.isFinite { return false }
    let ratio = zone.w / zone.h
    if ratio < freeAspectMin * (1 - 1e-4) || ratio > freeAspectMax * (1 + 1e-4) { return false }
    if zoneBase(zone.w, zone.h, deg, src) < 1 / maxFramingScale - 1e-9 { return false }
    return zoneContained(zone, deg, src)
}

private func lerpZone(_ a: CropZone, _ b: CropZone, _ t: Double) -> CropZone {
    // The four EDGES interpolated, not the centre and size: the same thing
    // numerically, but it is the edges that must stay put under a handle.
    let aLeft = a.cx - a.w / 2
    let aRight = a.cx + a.w / 2
    let aTop = a.cy - a.h / 2
    let aBottom = a.cy + a.h / 2
    let l = aLeft + (b.cx - b.w / 2 - aLeft) * t
    let r = aRight + (b.cx + b.w / 2 - aRight) * t
    let top = aTop + (b.cy - b.h / 2 - aTop) * t
    let bot = aBottom + (b.cy + b.h / 2 - aBottom) * t
    return CropZone(cx: (l + r) / 2, cy: (top + bot) / 2, w: r - l, h: bot - top)
}

/// The candidate if it is valid, else the zone furthest along the way from
/// `from` (the last valid one) toward it that still is. `from` itself is
/// returned when it is not valid either — a zone the editor did not draw (an
/// undo, a legacy framing) is left for the next gesture to replace.
public func clampToward(_ from: CropZone, _ to: CropZone, _ deg: Double, _ src: PictureDims,
                        valid: ((CropZone) -> Bool)? = nil) -> CropZone {
    let isValid = valid ?? { zoneValid($0, deg, src) }
    if isValid(to) { return to }
    if !isValid(from) { return from }
    var lo = 0.0
    var hi = 1.0
    for _ in 0..<30 {
        let mid = (lo + hi) / 2
        if isValid(lerpZone(from, to, mid)) { lo = mid } else { hi = mid }
    }
    return lo == 0 ? from : lerpZone(from, to, lo)
}

// MARK: - gestures

/// The zone moved by (dx, dy), SLIDING along the picture's edge: the whole move
/// as far as it goes, then what is left of it on x alone, then on y — so a drag
/// into a corner keeps travelling along the side it reached instead of sticking.
public func moveZone(_ zone: CropZone, _ dx: Double, _ dy: Double, _ deg: Double, _ src: PictureDims) -> CropZone {
    func shift(_ z: CropZone, _ x: Double, _ y: Double) -> CropZone {
        CropZone(cx: z.cx + x, cy: z.cy + y, w: z.w, h: z.h)
    }
    let full = clampToward(zone, shift(zone, dx, dy), deg, src)
    let alongX = clampToward(full, shift(full, zone.cx + dx - full.cx, 0), deg, src)
    return clampToward(alongX, shift(alongX, 0, zone.cy + dy - alongX.cy), deg, src)
}

/// The smallest a side is let get while a handle is dragged across its anchor.
private func minSide(_ src: PictureDims) -> Double {
    max(src.width, src.height) * 1e-3
}

/// What a handle asks for, before the clamp: the handle's edge (or corner)
/// follows the pointer and the OPPOSITE edge (or corner) stays where it was
/// when the drag began. With a locked ratio a corner keeps it from the opposite
/// corner, taking the larger of the two sides the pointer asks for; an edge
/// adjusts the other side about the centre.
public func resizeCandidate(_ start: CropZone, _ handle: CropHandle, _ px: Double, _ py: Double,
                            _ lock: Double?, _ src: PictureDims) -> CropZone {
    let name = handle.rawValue
    let sx: Double = name.contains("e") ? 1 : (name.contains("w") ? -1 : 0)
    let sy: Double = name.contains("s") ? 1 : (name.contains("n") ? -1 : 0)
    let m = minSide(src)
    // The anchor: the opposite edge on each axis the handle moves.
    let ax = start.cx - (sx * start.w) / 2
    let ay = start.cy - (sy * start.h) / 2
    var w = sx != 0 ? max(m, sx * (px - ax)) : start.w
    var h = sy != 0 ? max(m, sy * (py - ay)) : start.h
    if let lock, lock > 0 {
        if sx != 0 && sy != 0 {
            w = max(w, h * lock)
            h = w / lock
        } else if sx != 0 {
            h = w / lock
        } else {
            w = h * lock
        }
    }
    return CropZone(
        cx: sx != 0 ? ax + (sx * w) / 2 : start.cx,
        cy: sy != 0 ? ay + (sy * h) / 2 : start.cy,
        w: w,
        h: h
    )
}

/// A handle dragged to (px, py): the candidate, clamped from the zone on screen now.
public func resizeZone(_ start: CropZone, _ current: CropZone, _ handle: CropHandle, _ px: Double, _ py: Double,
                       _ lock: Double?, _ deg: Double, _ src: PictureDims) -> CropZone {
    clampToward(current, resizeCandidate(start, handle, px, py, lock, src), deg, src)
}

/// A zone drawn from `anchor` to the pointer — the rectangle between them, at
/// the locked ratio when there is one (the larger side wins, as a corner's).
/// Grown about the anchor to the smallest zone a framing allows, so the first
/// few pixels of a draw do not read as refused.
public func drawCandidate(_ anchor: Point, _ px: Double, _ py: Double, _ lock: Double?, _ deg: Double,
                          _ src: PictureDims) -> CropZone {
    let dirX: Double = px >= anchor.x ? 1 : -1
    let dirY: Double = py >= anchor.y ? 1 : -1
    let m = minSide(src)
    var w = max(m, abs(px - anchor.x))
    var h = max(m, abs(py - anchor.y))
    if let lock, lock > 0 {
        w = max(w, h * lock)
        h = w / lock
    } else {
        let ratio = min(freeAspectMax, max(freeAspectMin, w / h))
        if w / h > ratio { w = h * ratio } else { h = w / ratio }
    }
    let base = zoneBase(w, h, deg, src)
    let grow = base > 0 && base < 1 / maxFramingScale ? 1 / maxFramingScale / base : 1
    w *= grow
    h *= grow
    return CropZone(cx: anchor.x + (dirX * w) / 2, cy: anchor.y + (dirY * h) / 2, w: w, h: h)
}

/// The largest zone of `w : h` centred on (cx, cy) — no larger than `cap` times
/// the size given — that fits the turned picture, the centre pulled toward the
/// middle only as far as a zone of the smallest allowed size needs. One
/// function behind choosing a format, swapping it, the double-click and
/// straightening from an intent.
public func fitAround(_ cx: Double, _ cy: Double, _ w: Double, _ h: Double, _ deg: Double, _ src: PictureDims,
                      cap: Double = .infinity) -> CropZone {
    if !(w > 0 && h > 0) { return CropZone(cx: 0, cy: 0, w: src.width, h: src.height) }
    let t = turn(deg)
    let halfX = (w * t.c + h * t.s) / 2
    let halfY = (w * t.s + h * t.c) / 2
    let kMin = 1 / maxFramingScale / zoneBase(w, h, deg, src)
    func kAt(_ x: Double, _ y: Double) -> Double {
        let q = intoPicture(x, y, deg)
        let byX = (src.width / 2 - abs(q.qx)) / halfX
        let byY = (src.height / 2 - abs(q.qy)) / halfY
        return min(cap, byX, byY)
    }
    var x = cx
    var y = cy
    var k = kAt(x, y)
    if !(k >= kMin) {
        // Pulled toward the middle, as little as it takes.
        var lo = 0.0
        var hi = 1.0
        for _ in 0..<30 {
            let mid = (lo + hi) / 2
            if kAt(cx * (1 - mid), cy * (1 - mid)) >= kMin { hi = mid } else { lo = mid }
        }
        x = cx * (1 - hi)
        y = cy * (1 - hi)
        k = max(kMin, kAt(x, y))
    }
    // A hair inside, so float noise never reads as a gap on the next check.
    let kk = k * (1 - 1e-9)
    return CropZone(cx: x, cy: y, w: w * kk, h: h * kk)
}

/// The largest zone of this ratio in the turned picture, centred — the double-click.
public func maxZone(_ ratio: Double, _ deg: Double, _ src: PictureDims) -> CropZone {
    fitAround(0, 0, ratio, 1, deg, src)
}

/// After a rotation: the INTENT (the last zone the author drew) shrunk just
/// enough to fit the picture at its new angle, never grown past it — so a
/// straighten to 3° and back to 0° gives the drawn zone back.
public func fitIntent(_ intent: CropZone, _ deg: Double, _ src: PictureDims) -> CropZone {
    fitAround(intent.cx, intent.cy, intent.w, intent.h, deg, src, cap: 1)
}

/// The crop a zoomed VIEW asks for — "crop to what I am looking at", the verb
/// the Develop stage offers once zoomed (2026-09-23): the part of the delivered
/// canvas on screen (`win`, shares of the canvas from `visibleWindow`) read
/// back into the zone's frame through the crop the canvas shows now (`shown`,
/// `zoneFromCrop`'s answer) and the border it sits in (`layout`, any units —
/// only its proportions are read).
///
/// Nil when there is nothing to crop: the whole crop is on screen, or only the
/// border is. Otherwise the zone, held inside a free aspect's 1:5..5:1 about
/// its centre and grown to the smallest zone a framing allows, slid in only as
/// far as the picture's edge needs — and `clamped` says it was.
public func zoneFromView(_ shown: CropZone, _ layout: BorderLayout, _ win: PictureWindow, _ deg: Double,
                         _ src: PictureDims) -> (zone: CropZone, clamped: Bool)? {
    if !(layout.pw > 0 && layout.ph > 0 && shown.w > 0 && shown.h > 0) { return nil }
    let l = max(layout.x, win.x0 * layout.w)
    let r = min(layout.x + layout.pw, win.x1 * layout.w)
    let t = max(layout.y, win.y0 * layout.h)
    let b = min(layout.y + layout.ph, win.y1 * layout.h)
    if !(r - l > 0 && b - t > 0) { return nil }
    let kx = shown.w / layout.pw
    let ky = shown.h / layout.ph
    var w = (r - l) * kx
    var h = (b - t) * ky
    // A tolerance a pixel of the canvas cannot reach: the fit shows the whole
    // crop, and a view that does is not asking for one.
    if w >= shown.w * (1 - 1e-3) && h >= shown.h * (1 - 1e-3) { return nil }
    let cx = shown.cx - shown.w / 2 + ((l + r) / 2 - layout.x) * kx
    let cy = shown.cy - shown.h / 2 + ((t + b) / 2 - layout.y) * ky
    var clamped = false
    if w / h > freeAspectMax {
        w = h * freeAspectMax
        clamped = true
    } else if w / h < freeAspectMin {
        h = w / freeAspectMin
        clamped = true
    }
    // Grown about the view's centre to the smallest zone a framing allows — a
    // view at 4000 % is far closer than a crop may go.
    let base = zoneBase(w, h, deg, src)
    if base > 0 && base < 1 / maxFramingScale {
        let grow = (1 / maxFramingScale / base) * (1 + 1e-9)
        w *= grow
        h *= grow
        clamped = true
    }
    // Then slid back inside the turned picture, the nearest place it fits — in
    // the picture's own axes the centre's room is a rectangle, so a clamp there
    // is exact. A zone that was not grown is inside already and does not move.
    let tr = turn(deg)
    let roomX = max(0, src.width / 2 - (w * tr.c + h * tr.s) / 2)
    let roomY = max(0, src.height / 2 - (w * tr.s + h * tr.c) / 2)
    let q = intoPicture(cx, cy, deg)
    let qx = max(-roomX, min(roomX, q.qx))
    let qy = max(-roomY, min(roomY, q.qy))
    let zone = CropZone(cx: qx * tr.cos - qy * tr.sin, cy: qx * tr.sin + qy * tr.cos, w: w, h: h)
    return (zone, clamped)
}

/// The zone turned with the picture by a quarter: clockwise (cx, cy, w, h) → (−cy, cx, h, w).
public func quarterTurnZone(_ zone: CropZone, _ dir: Int) -> CropZone {
    dir == 1
        ? CropZone(cx: orZero(-zone.cy), cy: zone.cx, w: zone.h, h: zone.w)
        : CropZone(cx: zone.cy, cy: orZero(-zone.cx), w: zone.h, h: zone.w)
}

/// The zone mirrored with what the frame shows: its centre across that axis (`flipFraming`'s zone).
public func flipZone(_ zone: CropZone, _ axis: Character) -> CropZone {
    var out = zone
    if axis == "x" { out.cx = orZero(-zone.cx) } else { out.cy = orZero(-zone.cy) }
    return out
}

/// The correction a Level line asks for, in degrees: the line drawn along what
/// should be the horizon (or a vertical — whichever it is closer to) turned
/// level. On screen, y down, so a line falling to the right is a clockwise tilt
/// and is corrected anticlockwise.
public func levelDelta(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Double {
    if x1 == x2 && y1 == y2 { return 0 }
    var a = atan2(y2 - y1, x2 - x1) / radiansPerDegree // (−180, 180]
    // A line drawn right-to-left is the same line.
    if a > 90 { a -= 180 } else if a <= -90 { a += 180 }
    let delta = abs(a) <= 45 ? -a : -(a - signum(a) * 90)
    return orZero(delta)
}

/// The fine angle within its quarter, and the quarter it sits in: 93° → 90 + 3.
public func splitRotation(_ deg: Double) -> (quarter: Double, fine: Double) {
    let d = wrapDegrees(deg)
    let quarter = roundHalfUp(d / 90) * 90
    return (wrapDegrees(quarter), d - quarter)
}

/// The turned picture's four corners in the zone's frame — the outline the stage dashes.
public func turnedCorners(_ deg: Double, _ src: PictureDims) -> [Point] {
    let t = turn(deg)
    let hw = src.width / 2
    let hh = src.height / 2
    let corners: [(Double, Double)] = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    return corners.map { c in Point(c.0 * t.cos - c.1 * t.sin, c.0 * t.sin + c.1 * t.cos) }
}

/// Whether a point of the zone's frame falls on the turned picture — where a draw may begin.
public func pointOnPicture(_ x: Double, _ y: Double, _ deg: Double, _ src: PictureDims) -> Bool {
    let q = intoPicture(x, y, deg)
    return abs(q.qx) <= src.width / 2 && abs(q.qy) <= src.height / 2
}

/// A stored crop's zone, scaled to the full-size source: the stage works on the
/// decoded preview, and the tag says what the FILE will give.
public func zoneInSourcePixels(_ zone: CropZone, _ preview: PictureDims, _ source: PictureDims?) -> (w: Int, h: Int) {
    let k: Double
    if let source, preview.width > 0 { k = source.width / preview.width } else { k = 1 }
    return (Int(roundHalfUp(zone.w * k)), Int(roundHalfUp(zone.h * k)))
}
