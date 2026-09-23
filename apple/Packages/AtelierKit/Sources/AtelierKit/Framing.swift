// How a source picture sits inside an output frame: pan, zoom, rotation and a
// mirror, over the cover-crop or a fit that shows the whole picture with black
// bars. Port of `src/shared/media/framing.ts`.
//
// Two invariants make it safe to store: a gap is only ever asked for (`scale`
// is clamped at 1, the pan to the slack that scale leaves), and everything is
// resolution-independent (the pan is a fraction of the output's long edge).
// Under `cover` the pan runs along the PICTURE's axes; under `contain` along
// the FRAME's. The mirror is in the picture's own axes, before the rotation.

import Foundation

public enum Fit: String, Codable, Sendable {
    case cover, contain
}

/// Where a picture sits in its frame. The default is the centred cover-crop.
public struct Framing: Codable, Equatable, Sendable {
    /// 1 = exactly covers the frame (or exactly fits it, under `contain`).
    public var scale: Double = 1
    /// Pan as a fraction of the frame's long edge.
    public var x: Double = 0
    public var y: Double = 0
    /// Clockwise, in degrees.
    public var rotation: Double = 0
    public var flipX: Bool = false
    public var flipY: Bool = false
    public var fit: Fit = .cover

    public init(scale: Double = 1, x: Double = 0, y: Double = 0, rotation: Double = 0,
                flipX: Bool = false, flipY: Bool = false, fit: Fit = .cover) {
        self.scale = scale; self.x = x; self.y = y; self.rotation = rotation
        self.flipX = flipX; self.flipY = flipY; self.fit = fit
    }

    public static let `default` = Framing()
}

/// The most a picture can be zoomed in. Past this a JPEG is mush anyway.
public let maxFramingScale = 8.0

@inline(__always) private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    v < lo ? lo : (v > hi ? hi : v)
}

private func num(_ v: Double, _ fallback: Double) -> Double { v.isFinite ? v : fallback }

/// A zoom factor applied to a framing's scale, held between covering the frame
/// and the ceiling — one function for every way a zoom is asked for.
public func scaleFramingBy(_ scale: Double, _ factor: Double) -> Double {
    let from = scale.isFinite ? scale : 1
    if !factor.isFinite || factor <= 0 { return clamp(from, 1, maxFramingScale) }
    return clamp(from * factor, 1, maxFramingScale)
}

/// Two framings that put the picture in the same place — nil reads as the default.
public func sameFraming(_ a: Framing?, _ b: Framing?) -> Bool {
    (a ?? .default) == (b ?? .default)
}

public func isDefaultFraming(_ f: Framing?) -> Bool {
    guard let f else { return true }
    return f.scale == 1 && f.x == 0 && f.y == 0 && f.rotation == 0 && !f.flipX && !f.flipY && f.fit != .contain
}

/// Any angle onto (−180, 180], so a stored rotation never grows without bound.
public func wrapDegrees(_ deg: Double) -> Double {
    if !deg.isFinite { return 0 }
    let wrapped = ((deg + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) - 180
    return wrapped == -180 ? 180 : wrapped
}

/// Read a framing out of anything (a stored doc, an imported file).
public func normaliseFraming(_ v: JSONValue?) -> Framing {
    guard let f = v?.objectValue else { return .default }
    return Framing(
        scale: clamp(f["scale"]?.finiteNumber ?? 1, 1, maxFramingScale),
        x: f["x"]?.finiteNumber ?? 0,
        y: f["y"]?.finiteNumber ?? 0,
        rotation: wrapDegrees(f["rotation"]?.finiteNumber ?? 0),
        flipX: f["flipX"]?.boolValue == true,
        flipY: f["flipY"]?.boolValue == true,
        fit: f["fit"]?.stringValue == "contain" ? .contain : .cover
    )
}

/// Mirror what the FRAME shows — left ↔ right or top ↔ bottom — whatever the
/// rotation and the pan: M·R(θ) = R(−θ)·M, exact at any angle.
public func flipFraming(_ f: Framing, axis: Character) -> Framing {
    var out = f
    out.rotation = wrapDegrees(-f.rotation)
    if axis == "x" {
        out.flipX.toggle()
        out.x = -f.x == 0 ? 0 : -f.x
    } else {
        out.flipY.toggle()
        out.y = -f.y == 0 ? 0 : -f.y
    }
    return out
}

/// The transform to draw with, in the output frame's pixels.
public struct FramingTransform: Equatable, Sendable {
    /// Radians, clockwise.
    public var angle: Double
    /// Multiplier from source pixels to output pixels.
    public var scale: Double
    public var mirrorX: Double
    public var mirrorY: Double
    /// Pan actually applied, in output pixels along the picture's axes.
    public var panX: Double
    public var panY: Double
    /// The same pan in the axes the framing STORES it in, clamped, in output pixels.
    public var offsetX: Double
    public var offsetY: Double
    /// How far `offset` COULD go, in output pixels along those same axes.
    public var slackX: Double
    public var slackY: Double
}

/// The transform that draws `srcW × srcH` into `dstW × dstH` under `framing`.
/// The cover condition with rotation is tight, not conservative; the contain
/// condition is the same argument turned round.
public func framingTransform(_ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ framing: Framing = .default) -> FramingTransform {
    let angle = wrapDegrees(framing.rotation) * Double.pi / 180
    let mirrorX: Double = framing.flipX ? -1 : 1
    let mirrorY: Double = framing.flipY ? -1 : 1
    if srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 {
        return FramingTransform(angle: angle, scale: 1, mirrorX: mirrorX, mirrorY: mirrorY, panX: 0, panY: 0, offsetX: 0, offsetY: 0, slackX: 0, slackY: 0)
    }
    let c = abs(cos(angle))
    let s = abs(sin(angle))
    let zoom = clamp(num(framing.scale, 1), 1, maxFramingScale)
    let unit = max(dstW, dstH)

    if framing.fit == .contain {
        let boxW = srcW * c + srcH * s
        let boxH = srcW * s + srcH * c
        let scale = min(dstW / boxW, dstH / boxH) * zoom
        let slackX = abs(dstW - boxW * scale) / 2
        let slackY = abs(dstH - boxH * scale) / 2
        let offsetX = clamp(num(framing.x, 0) * unit, -slackX, slackX)
        let offsetY = clamp(num(framing.y, 0) * unit, -slackY, slackY)
        let cosA = cos(angle)
        let sinA = sin(angle)
        return FramingTransform(
            angle: angle, scale: scale, mirrorX: mirrorX, mirrorY: mirrorY,
            panX: offsetX * cosA + offsetY * sinA,
            panY: -offsetX * sinA + offsetY * cosA,
            offsetX: offsetX, offsetY: offsetY, slackX: slackX, slackY: slackY
        )
    }

    let needW = dstW * c + dstH * s
    let needH = dstW * s + dstH * c
    let scale = max(needW / srcW, needH / srcH) * zoom
    let slackX = max(0, (srcW * scale - needW) / 2)
    let slackY = max(0, (srcH * scale - needH) / 2)
    let panX = clamp(num(framing.x, 0) * unit, -slackX, slackX)
    let panY = clamp(num(framing.y, 0) * unit, -slackY, slackY)
    return FramingTransform(angle: angle, scale: scale, mirrorX: mirrorX, mirrorY: mirrorY,
                            panX: panX, panY: panY, offsetX: panX, offsetY: panY, slackX: slackX, slackY: slackY)
}

/// Whether this framing leaves any room to pan at all.
public func canPan(_ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ framing: Framing) -> Bool {
    let t = framingTransform(srcW, srcH, dstW, dstH, framing)
    return t.slackX > 0.5 || t.slackY > 0.5
}

/// Move the picture by a pointer delta given in the FRAME's axes, returning a
/// framing whose pan is already clamped.
public func panBy(_ framing: Framing, _ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ dxPx: Double, _ dyPx: Double) -> Framing {
    let t = framingTransform(srcW, srcH, dstW, dstH, framing)
    var dx = dxPx
    var dy = dyPx
    if framing.fit != .contain {
        let cosA = cos(-t.angle)
        let sinA = sin(-t.angle)
        dx = dxPx * cosA - dyPx * sinA
        dy = dxPx * sinA + dyPx * cosA
    }
    let unit = max(dstW, dstH)
    if unit <= 0 { return framing }
    var out = framing
    let x = clamp(t.offsetX + dx, -t.slackX, t.slackX) / unit
    let y = clamp(t.offsetY + dy, -t.slackY, t.slackY) / unit
    // `−0` is spelled 0: a framing at rest must read as the default it is.
    out.x = x == 0 ? 0 : x
    out.y = y == 0 ? 0 : y
    return out
}

/// Re-clamp a framing's pan for its own scale and rotation.
public func reclampFraming(_ framing: Framing, _ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double) -> Framing {
    let t = framingTransform(srcW, srcH, dstW, dstH, framing)
    let unit = max(dstW, dstH)
    if unit <= 0 { return framing }
    var out = framing
    out.x = t.offsetX / unit
    out.y = t.offsetY / unit
    return out
}

/// Where a point of the DRAWN frame came from in the source picture, in source
/// pixels — the exact inverse of what `drawFramed` composes.
public func unframePoint(_ dstX: Double, _ dstY: Double, _ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ framing: Framing = .default) -> (Double, Double) {
    let t = framingTransform(srcW, srcH, dstW, dstH, framing)
    var x = dstX - dstW / 2
    var y = dstY - dstH / 2
    let cosA = cos(-t.angle)
    let sinA = sin(-t.angle)
    let rx = x * cosA - y * sinA
    let ry = x * sinA + y * cosA
    x = rx - t.panX
    y = ry - t.panY
    x /= t.scale * t.mirrorX
    y /= t.scale * t.mirrorY
    return (x + srcW / 2, y + srcH / 2)
}

/// Where a point of the SOURCE picture lands in the drawn frame, in frame pixels.
public func framePoint(_ srcX: Double, _ srcY: Double, _ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double, _ framing: Framing = .default) -> (Double, Double) {
    let t = framingTransform(srcW, srcH, dstW, dstH, framing)
    let x = (srcX - srcW / 2) * t.scale * t.mirrorX + t.panX
    let y = (srcY - srcH / 2) * t.scale * t.mirrorY + t.panY
    let cosA = cos(t.angle)
    let sinA = sin(t.angle)
    return (x * cosA - y * sinA + dstW / 2, x * sinA + y * cosA + dstH / 2)
}

/// The framing at `scale` with the picture under `anchor` (a point of the
/// FRAME) kept still — the wheel's pointer, a pinch's live centre.
public func zoomFramingAbout(_ framing: Framing, _ scale: Double, anchorX: Double, anchorY: Double,
                             _ srcW: Double, _ srcH: Double, _ dstW: Double, _ dstH: Double) -> Framing {
    let next = scaleFramingBy(scale, 1)
    var rescaled = framing
    rescaled.scale = next
    if srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 { return rescaled }
    let (sx, sy) = unframePoint(anchorX, anchorY, srcW, srcH, dstW, dstH, framing)
    let (px, py) = framePoint(sx, sy, srcW, srcH, dstW, dstH, rescaled)
    return panBy(rescaled, srcW, srcH, dstW, dstH, anchorX - px, anchorY - py)
}
