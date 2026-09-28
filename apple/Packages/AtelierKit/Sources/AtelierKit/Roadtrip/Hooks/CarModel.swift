// The car — a cartoon Toyota Land Cruiser Prado (J120), as parts for
// `Mesh3D`, with the gear the maintainer's own wears. Port of
// `src/shared/roadtrip/hooks/car-model.ts`, every number unchanged.
//
// A miniature, not a model: a Prado's proportions (a tall, upright SUV, a long
// hood, roof rails, the spare on the tailgate, the tall tail lights wrapping
// the rear corners) pushed the way a toy pushes them. Model units are about
// metres: 4.6 long, 1.9 wide, 1.95 to the roof, the ground at z = 0, the nose
// toward +y, x to the right. Colours are ROLES, resolved through `carPalette`
// — the body colour is the author's, the rest is the car's; the FINISH is a
// light (`carLight`).
//
// The rules it keeps (`roadtrip.md`, «Virée»):
// - every part is CONVEX, so the painter's order is right from any heading;
//   anything hollow — a bull-bar hoop, the basket's rail, a jerry can's
//   handle — is several boxes, never one part with a hole;
// - the hull is not one box: it is a stack of convex SLICES cut at a car's
//   real shut lines (the base of the windscreen, the top of the tailgate) and,
//   below the shoulder, at the arches — so no polygon spans the model (one
//   4.6 m polygon sorts from whichever END is farthest and the bonnet showed
//   through) and nothing shares a volume;
// - the wheel arches are ABSENCES: across each axle the skirt is simply not
//   built, and a face buried against the block stacked on it is not built
//   either (`ExtrudeRoles` with a nil cap) — the cheapest correct surface is
//   the one not built;
// - a decal lies INSIDE the one face it is pushed off, cut at the shoulder
//   where it would cross it (`bands`), so the farthest-vertex key orders it
//   exactly.

import Foundation

/// The car's footprint, for its shadow and its scale on the map — the web's `CAR_LENGTH`.
public let carLength = 4.6
/// The web's `CAR_WIDTH`.
public let carWidth = 1.9
/// The web's `WHEEL_RADIUS`.
public let wheelRadius = 0.44

/// The ids the pose spins — the four road wheels. The web's `WHEEL_IDS`.
public let wheelIds = ["wheel-fl", "wheel-fr", "wheel-rl", "wheel-rr"]

/// The car's colours by role, given the author's body colour.
public func carPalette(_ bodyColor: String) -> [String: String] {
    [
        "body": bodyColor,
        "cladding": "#2a2a2d",
        "glass": "#33465a",
        "roof": bodyColor,
        "tyre": "#1b1b1c",
        "tread": "#262628",
        "rim": "#a7a9ad",
        "hub": "#6d6f73",
        "trim": "#141416",
        "light": "#f7efc9",
        "tail": "#c8301f",
        "rail": "#1f1f22",
        "steel": "#b4b8bd",
        "lamp": "#f4f1e0",
        "basket": "#26262a",
        "solar": "#1b2a44",
        "solarFrame": "#2e3339",
        "alu": "#b9bcc0",
        "jerryWater": "#5f6b3a",
        "jerryFuel": "#b8262a",
        "bag": "#1d1d1f",
        "flap": "#151517",
        "visor": "#1a1f26",
        "badge": "#c9ccd1",
    ]
}

/// The light a finish is seen under. Factory paint keeps the renderer's
/// default — a highlight that lets a dark car read as a shape. A matte coating
/// throws almost no highlight; what keeps it a shape is a broad sheen and a
/// little more ambient, not a specular spot.
public func carLight(_ finish: CarFinish) -> Mesh3D.Light {
    guard finish == .matte else { return .default }
    var light = Mesh3D.Light.default
    light.gloss = 0.04
    light.sheen = 0.12
    light.ambient = 0.48
    return light
}

/// Build the car, with the gear asked for (the maintainer's, by default).
public func buildCar(_ gear: CarGear = .default) -> [Mesh3D.Part] {
    PradoBuild.car(gear)
}

/// The builder's helpers, kept off the module scope (their web names —
/// `cabin`, `wheel`, `bands` — are too generic to live there).
private enum PradoBuild {
    typealias Vec3 = Mesh3D.Vec3
    typealias Part = Mesh3D.Part
    typealias Face = Mesh3D.Face

    /// The hull's own dimensions, in one place — everything that has to sit ON
    /// the hull reads these, so a change to the body cannot detach the corner
    /// lights from the corner they lie on.
    enum Hull {
        static let halfWidth = 0.95
        static let halfLength = 2.3
        static let chamfer = 0.2
        /// The beltline: the body stops here and the greenhouse starts.
        static let top = 1.15
        /// The bottom of the painted bodywork, where the charcoal band takes over.
        static let bottom = 0.5
        /// Above this the body may run its full width, clear of the wheels
        /// (whose tops are at 2 × `wheelRadius`); below it, across an axle, it
        /// pulls in to `archHalfWidth` — that gap IS the wheel arch.
        static let shoulder = 0.88
        /// Inboard of this a block clears a wheel, whose inner face is at 0.68.
        static let archHalfWidth = 0.66
    }

    /// How far each axle's arch reaches fore and aft of the wheel's centre.
    enum Arch {
        static let y = 1.45
        static let half = 0.44
    }

    /// The greenhouse's section: narrower at the roof than at the beltline, the
    /// windshield raked, the tailgate upright. Shared by the cabin and the
    /// visors, which sit on the same slanted plane.
    enum Cabin {
        static let xb = 0.86 // half width at the beltline
        static let xt = 0.74 // half width at the roof
        static let zb = 1.15
        static let zt = 1.95
        static let rearB = -2.12
        static let rearT = -2.02
        static let frontB = 0.95
        static let frontT = 0.35
    }

    /// The pillars and windows along the side, from the A pillar back.
    struct SideBand {
        let role: String
        let b0: Double
        let b1: Double
        let t0: Double
        let t1: Double
    }

    static let sideBands: [SideBand] = [
        SideBand(role: "body", b0: Cabin.frontB, b1: 0.72, t0: Cabin.frontT, t1: 0.14), // A pillar
        SideBand(role: "glass", b0: 0.72, b1: -0.5, t0: 0.14, t1: -0.5), // front door glass
        SideBand(role: "body", b0: -0.5, b1: -0.62, t0: -0.5, t1: -0.62), // B pillar
        SideBand(role: "glass", b0: -0.62, b1: -1.72, t0: -0.62, t1: -1.72), // rear door glass
        SideBand(role: "body", b0: -1.72, b1: Cabin.rearB, t0: -1.72, t1: Cabin.rearT), // C pillar and quarter
    ]

    /// JavaScript's `Math.max(0, v)`.
    static func atLeastZero(_ v: Double) -> Double { v > 0 ? v : 0 }

    /// The plan of a slice of the hull between two y's, the chamfered corners
    /// carried through wherever the slice reaches them. A slice is keyed by its
    /// own extent, which is why the hull is a stack of them.
    static func hullSlice(_ halfWidth: Double, _ halfLength: Double, _ chamfer: Double,
                          _ y0: Double, _ y1: Double) -> [Point] {
        func widthAt(_ y: Double) -> Double {
            let inFromEnd = halfLength - abs(y)
            return inFromEnd >= chamfer ? halfWidth : atLeastZero(halfWidth - (chamfer - inFromEnd))
        }
        var ys = [y0]
        for corner in [-(halfLength - chamfer), halfLength - chamfer] where corner > y0 && corner < y1 {
            ys.append(corner)
        }
        ys.append(y1)
        ys.sort()
        let right = ys.map { Point(widthAt($0), $0) }
        let left = right.reversed().map { Point(-$0.x, $0.y) }
        return right + left
    }

    /// One convex slice of the painted body, between two y's and two heights.
    /// `buriedTop` / `buriedBottom` drop the faces another slice sits directly
    /// on: never seen from above, but still a face the order has to place, and
    /// it landed on the bodywork often enough to look like a hole in the bonnet.
    static func hullBlock(_ id: String, _ y0: Double, _ y1: Double, _ z0: Double, _ z1: Double,
                          halfWidth: Double = Hull.halfWidth, buriedTop: Bool = false,
                          buriedBottom: Bool = false) -> Part {
        let plan = hullSlice(halfWidth, Hull.halfLength, Hull.chamfer, y0, y1)
        let roles = Mesh3D.ExtrudeRoles(side: "body", top: buriedTop ? nil : "body",
                                        bottom: buriedBottom ? nil : "body")
        return Mesh3D.extrude(id, plan, z0, z1, roles)
    }

    /// A point on a side plane at a share `u` of the way from the beltline to the roof.
    static func sidePoint(_ sign: Double, _ y: Double, _ u: Double) -> Vec3 {
        let x = sign * (Cabin.xb + (Cabin.xt - Cabin.xb) * u)
        let z = Cabin.zb + (Cabin.zt - Cabin.zb) * u
        return Vec3(x, y, z)
    }

    /// The side plane's outward normal.
    static func sideNormal(_ sign: Double) -> Vec3 {
        Mesh3D.normalise(Vec3(sign * (Cabin.zt - Cabin.zb), 0, Cabin.xb - Cabin.xt))
    }

    /// The greenhouse: its sides split into pillars and windows along one
    /// plane, so the glass reads as glass and the pillars keep the body colour.
    static func cabin() -> [Part] {
        let rearB = Cabin.rearB, rearT = Cabin.rearT, frontB = Cabin.frontB, frontT = Cabin.frontT
        var faces: [Face] = []
        for sign in [1.0, -1.0] {
            for band in sideBands {
                let verts = [sidePoint(sign, band.b0, 0), sidePoint(sign, band.b1, 0),
                             sidePoint(sign, band.t1, 1), sidePoint(sign, band.t0, 1)]
                faces.append(Face(verts: verts, role: band.role))
            }
        }
        // The roof.
        faces.append(Face(verts: [sidePoint(1, frontT, 1), sidePoint(1, rearT, 1),
                                  sidePoint(-1, rearT, 1), sidePoint(-1, frontT, 1)], role: "roof"))
        // The windshield, raked.
        faces.append(Face(verts: [sidePoint(1, frontB, 0), sidePoint(-1, frontB, 0),
                                  sidePoint(-1, frontT, 1), sidePoint(1, frontT, 1)], role: "glass"))
        // The tailgate: metal below, glass above, one plane.
        let split = 0.38
        let ySplit = rearB + (rearT - rearB) * split
        faces.append(Face(verts: [sidePoint(1, rearB, 0), sidePoint(-1, rearB, 0),
                                  sidePoint(-1, ySplit, split), sidePoint(1, ySplit, split)], role: "body"))
        faces.append(Face(verts: [sidePoint(1, ySplit, split), sidePoint(-1, ySplit, split),
                                  sidePoint(-1, rearT, 1), sidePoint(1, rearT, 1)], role: "glass"))
        // The floor closes the solid (never visible from above; it keeps `outward` honest).
        faces.append(Face(verts: [sidePoint(1, frontB, 0), sidePoint(1, rearB, 0),
                                  sidePoint(-1, rearB, 0), sidePoint(-1, frontB, 0)], role: "body"))
        return [Mesh3D.solid("cabin", faces)]
    }

    /// The tinted visors over the two door windows, a hair off the side plane.
    static func visors() -> [Part] {
        var parts: [Part] = []
        let u0 = 0.8
        for sign in [1.0, -1.0] {
            let n = sideNormal(sign)
            func lift(_ p: Vec3) -> Vec3 {
                Vec3(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012)
            }
            let glass = sideBands.filter { $0.role == "glass" }
            for (i, band) in glass.enumerated() {
                // The band's front edge may be raked: interpolate its y along the height.
                let yAtU0 = band.b0 + (band.t0 - band.b0) * u0
                let verts = [
                    lift(sidePoint(sign, yAtU0, u0)),
                    lift(sidePoint(sign, band.b1, u0)),
                    lift(sidePoint(sign, band.t1, 1)),
                    lift(sidePoint(sign, band.t0, 1)),
                ]
                parts.append(Mesh3D.decal("visor-\(sign < 0 ? "l" : "r")-\(i)", verts, "visor", n))
            }
        }
        return parts
    }

    static func wheel(_ id: String, _ x: Double, _ y: Double) -> Part {
        Mesh3D.cylinder(id, Vec3(x, y, wheelRadius), .x, wheelRadius, 0.16, 14,
                        Mesh3D.CylinderRoles(side: "tyre", sideAlt: "tread", cap: "tyre"),
                        outline: false, spin: true)
    }

    /// The rim and its spokes, on the outer face of a wheel, turning with it.
    static func rimParts(_ id: String, _ x: Double, _ y: Double, _ outerSign: Double) -> [Part] {
        let pivot = Vec3(x, y, wheelRadius)
        let px = x + outerSign * 0.165
        func ring(_ r: Double, _ count: Int, _ phase: Double = 0) -> [Vec3] {
            (0..<count).map { i in
                let a = phase + Double(i) / Double(count) * Double.pi * 2
                return Vec3(px, y + r * cos(a), wheelRadius + r * sin(a))
            }
        }
        let normal = Vec3(outerSign, 0, 0)
        let rim = Mesh3D.decal("\(id)-rim", ring(0.27, 14), "rim", normal)
        // Five spokes as slim quads from the hub to the rim.
        let sx = px + outerSign * 0.006
        let spokes: [Part] = (0..<5).map { i in
            let a = Double(i) / 5 * Double.pi * 2
            let b = a + 0.16
            let c = a - 0.16
            let verts = [
                Vec3(sx, y + 0.06 * cos(c), wheelRadius + 0.06 * sin(c)),
                Vec3(sx, y + 0.06 * cos(b), wheelRadius + 0.06 * sin(b)),
                Vec3(sx, y + 0.25 * cos(a + 0.05), wheelRadius + 0.25 * sin(a + 0.05)),
                Vec3(sx, y + 0.25 * cos(a - 0.05), wheelRadius + 0.25 * sin(a - 0.05)),
            ]
            var part = Mesh3D.decal("\(id)-spoke-\(i)", verts, "hub", normal)
            part.spin = Mesh3D.Spin(pivot: pivot, axis: .x)
            return part
        }
        let hubRing = ring(0.07, 8).map { Vec3($0.x + outerSign * 0.012, $0.y, $0.z) }
        let hub = Mesh3D.decal("\(id)-hub", hubRing, "rim", normal)
        return [rim] + spokes + [hub]
    }

    /// The heights a decal on the hull's nose or tail must be cut at: the hull
    /// is split at the shoulder, so a lamp crossing that line belongs to two
    /// faces at once and the upper block paints over its own lamp. A decal
    /// carries no ink of its own, so the cut is invisible.
    static func bands(_ z0: Double, _ z1: Double) -> [(Double, Double)] {
        let s = Hull.shoulder
        return z0 < s && z1 > s ? [(z0, s), (s, z1)] : [(z0, z1)]
    }

    /// A quad on one of the body's chamfered corners, pushed a hair off it.
    static func cornerDecal(_ id: String, _ role: String, _ xSign: Double, _ ySign: Double,
                            _ z0: Double, _ z1: Double) -> [Part] {
        // The corner segment runs from (x1, y1 − c) to (x1 − c, y1) on the ±x, ±y corner.
        let w = Hull.halfWidth, l = Hull.halfLength, c = Hull.chamfer
        let ax = xSign * w
        let ay = ySign * (l - c)
        let bx = xSign * (w - c)
        let by = ySign * l
        let n = Mesh3D.normalise(Vec3(xSign, ySign, 0))
        func at(_ t: Double, _ z: Double) -> Vec3 {
            let x = ax + (bx - ax) * t + n.x * 0.004
            let y = ay + (by - ay) * t + n.y * 0.004
            return Vec3(x, y, z)
        }
        return bands(z0, z1).enumerated().map { i, band in
            let (a, b) = band
            return Mesh3D.decal(i == 0 ? id : "\(id)-\(i)", [at(0.15, a), at(0.85, a), at(0.85, b), at(0.15, b)],
                                role, n)
        }
    }

    /// A flat lamp or bar on the hull's nose or tail, cut at the shoulder if it crosses.
    static func faceDecal(_ id: String, _ role: String, _ x0: Double, _ x1: Double, _ y: Double,
                          _ z0: Double, _ z1: Double) -> [Part] {
        let n = y > 0 ? Vec3(0, 1, 0) : Vec3(0, -1, 0)
        return bands(z0, z1).enumerated().map { i, band in
            let (a, b) = band
            let verts = [Vec3(x0, y, a), Vec3(x1, y, a), Vec3(x1, y, b), Vec3(x0, y, b)]
            return Mesh3D.decal(i == 0 ? id : "\(id)-\(i)", verts, role, n)
        }
    }

    /// The bull bar: a hoop around each headlight, a bar across the top, a plate below.
    static func bullBar(_ withLights: Bool) -> [Part] {
        var parts: [Part] = []
        let y0 = 2.5
        let y1 = 2.6
        parts.append(Mesh3D.box("bullbar-top", Vec3(-0.92, y0, 1.14), Vec3(0.92, y1, 1.24), "steel"))
        parts.append(Mesh3D.box("bullbar-low", Vec3(-0.92, y0, 0.56), Vec3(0.92, y1, 0.66), "steel"))
        parts.append(Mesh3D.box("bullbar-pan", Vec3(-0.92, 2.37, 0.34), Vec3(0.92, 2.56, 0.56), "steel"))
        for s in [-1.0, 1.0] {
            let side = s < 0 ? "l" : "r"
            parts.append(Mesh3D.box("bullbar-hoop-\(side)-in", Vec3(s * 0.4, y0, 0.66), Vec3(s * 0.5, y1, 1.14), "steel"))
            parts.append(Mesh3D.box("bullbar-hoop-\(side)-out", Vec3(s * 0.84, y0, 0.66), Vec3(s * 0.94, y1, 1.14), "steel"))
        }
        if withLights {
            for s in [-1.0, 1.0] {
                let side = s < 0 ? "l" : "r"
                let centre = Vec3(s * 0.4, 2.55, 1.34)
                parts.append(Mesh3D.cylinder("spot-\(side)", centre, .y, 0.1, 0.06, 10,
                                             Mesh3D.CylinderRoles(side: "trim", cap: "trim"),
                                             outline: false, spin: false))
                let lamp: [Vec3] = (0..<10).map { i in
                    let a = Double(i) / 10 * Double.pi * 2
                    return Vec3(centre.x + 0.08 * cos(a), centre.y + 0.064, centre.z + 0.08 * sin(a))
                }
                parts.append(Mesh3D.decal("spot-\(side)-lamp", lamp, "lamp", Vec3(0, 1, 0)))
            }
        }
        return parts
    }

    /// The roof basket, and what rides in it.
    static func basket(_ gear: CarGear) -> [Part] {
        var parts: [Part] = []
        // The floor sits INSIDE its four rails and on top of the roof rails,
        // rather than through them: two solids sharing a volume have no right
        // order at all.
        let z0 = 2.06
        let innerX = 0.65, innerY0 = -1.86, innerY1 = 0.26
        parts.append(Mesh3D.box("basket-floor", Vec3(-innerX, innerY0, z0), Vec3(innerX, innerY1, z0 + 0.03), "basket"))
        parts.append(Mesh3D.box("basket-front", Vec3(-0.7, innerY1, z0), Vec3(0.7, innerY1 + 0.05, z0 + 0.19), "basket"))
        parts.append(Mesh3D.box("basket-back", Vec3(-0.7, innerY0 - 0.05, z0), Vec3(0.7, innerY0, z0 + 0.19), "basket"))
        parts.append(Mesh3D.box("basket-left", Vec3(-0.7, innerY0, z0), Vec3(-innerX, innerY1, z0 + 0.19), "basket"))
        parts.append(Mesh3D.box("basket-right", Vec3(innerX, innerY0, z0), Vec3(0.7, innerY1, z0 + 0.19), "basket"))
        let top = z0 + 0.03
        if gear.solar {
            parts.append(Mesh3D.box("solar-frame", Vec3(-0.64, -1.3, top), Vec3(-0.06, 0.22, top + 0.03), "solarFrame"))
            let z = top + 0.034
            let panel = [Vec3(-0.62, -1.28, z), Vec3(-0.08, -1.28, z), Vec3(-0.08, 0.2, z), Vec3(-0.62, 0.2, z)]
            parts.append(Mesh3D.decal("solar-panel", panel, "solar", Vec3(0, 0, 1)))
        }
        if gear.box {
            parts.append(Mesh3D.box("storage-box", Vec3(0.08, -1.0, top), Vec3(0.62, 0.22, top + 0.36), "alu"))
        }
        if gear.jerryCans {
            let cans: [(String, Double, String)] = [
                ("jerry-water-l", -0.43, "jerryWater"),
                ("jerry-fuel", 0, "jerryFuel"),
                ("jerry-water-r", 0.43, "jerryWater"),
            ]
            for (id, cx, role) in cans {
                parts.append(Mesh3D.box(id, Vec3(cx - 0.17, -1.84, top), Vec3(cx + 0.17, -1.47, top + 0.42), role))
                parts.append(Mesh3D.box("\(id)-handle", Vec3(cx - 0.05, -1.71, top + 0.42),
                                        Vec3(cx + 0.05, -1.6, top + 0.49), role))
            }
        }
        if gear.awning {
            parts.append(Mesh3D.box("awning-bag", Vec3(-0.82, -1.9, z0 + 0.04), Vec3(-0.7, 0.1, z0 + 0.19), "bag"))
        }
        return parts
    }

    /// The mud flaps behind each wheel.
    static func mudFlaps() -> [Part] {
        let flaps: [(String, Double, Double)] = [
            ("flap-fl", -0.84, 1.45),
            ("flap-fr", 0.84, 1.45),
            ("flap-rl", -0.84, -1.45),
            ("flap-rr", 0.84, -1.45),
        ]
        return flaps.map { id, x, y in
            let s: Double = x < 0 ? -1 : 1
            return Mesh3D.box(id, Vec3(s * 0.72, y - 0.66, 0.1), Vec3(s * 0.98, y - 0.62, 0.5), "flap")
        }
    }

    // MARK: the car

    /// Bumpers and sills: the charcoal band the body sits on, split at the axles
    /// like the body above it and pulled in to the arch width between them, so
    /// no wheel is modelled inside it. Its top meets the body's bottom exactly.
    enum Clad {
        static let halfWidth = 0.9
        static let halfLength = 2.36
        static let chamfer = 0.22
        static let z0 = 0.34
        static let z1 = Hull.bottom
    }

    static func cladSlice(_ id: String, _ y0: Double, _ y1: Double, halfWidth: Double = Clad.halfWidth,
                          buriedTop: Bool = false) -> Part {
        let plan = hullSlice(halfWidth, Clad.halfLength, Clad.chamfer, y0, y1)
        let roles = Mesh3D.ExtrudeRoles(side: "cladding", top: buriedTop ? nil : "cladding", bottom: "cladding")
        return Mesh3D.extrude(id, plan, Clad.z0, Clad.z1, roles)
    }

    static func car(_ gear: CarGear) -> [Part] {
        let g = effectiveGear(gear)
        var parts: [Part] = []

        let archF0 = Arch.y - Arch.half
        let archF1 = Arch.y + Arch.half
        parts.append(cladSlice("cladding-front", archF1, Clad.halfLength))
        parts.append(cladSlice("cladding-sill", -archF1, archF1, halfWidth: Hull.archHalfWidth, buriedTop: true))
        parts.append(cladSlice("cladding-rear", -Clad.halfLength, -archF1))

        // The painted body, to the beltline — a stack of convex slices. Above
        // the shoulder it runs full width and is split only where a car really
        // has a shut line; below it, split at the arches and pulled inboard
        // across each axle, which is what stops a wheel living inside it.
        let bottom = Hull.bottom, top = Hull.top, shoulder = Hull.shoulder, L = Hull.halfLength
        parts.append(hullBlock("body-bonnet", Cabin.frontB, L, shoulder, top, buriedBottom: true))
        parts.append(hullBlock("body-roof", Cabin.rearB, Cabin.frontB, shoulder, top, buriedBottom: true))
        parts.append(hullBlock("body-lip", -L, Cabin.rearB, shoulder, top, buriedBottom: true))
        // Across each axle the skirt simply is not there — that gap IS the arch.
        parts.append(hullBlock("body-skirt-nose", archF1, L, bottom, shoulder, buriedTop: true, buriedBottom: true))
        parts.append(hullBlock("body-skirt-mid", -archF0, archF0, bottom, shoulder, buriedTop: true, buriedBottom: true))
        parts.append(hullBlock("body-skirt-tail", -L, -archF1, bottom, shoulder, buriedTop: true, buriedBottom: true))
        parts.append(contentsOf: cabin())
        if g.visors { parts.append(contentsOf: visors()) }

        // Wheels, with the outer rim on the outside of each.
        let wheelAt: [(String, Double, Double, Double)] = [
            ("wheel-fl", -0.84, 1.45, -1),
            ("wheel-fr", 0.84, 1.45, 1),
            ("wheel-rl", -0.84, -1.45, -1),
            ("wheel-rr", 0.84, -1.45, 1),
        ]
        for (id, x, y, sign) in wheelAt {
            parts.append(wheel(id, x, y))
            parts.append(contentsOf: rimParts(id, x, y, sign))
        }
        if g.mudFlaps { parts.append(contentsOf: mudFlaps()) }

        // Flares over the wheels, in the cladding's charcoal: an eyebrow
        // standing proud of the flank ABOVE the tyre, on the shoulder, touching
        // the wheel and the body without sharing a volume with either.
        for side in [-1.0, 1.0] {
            for y in [Arch.y, -Arch.y] {
                let id = "flare-\(side < 0 ? "l" : "r")-\(y > 0 ? "f" : "r")"
                let x0 = side * Hull.halfWidth
                let x1 = side * (Hull.halfWidth + 0.11)
                parts.append(Mesh3D.box(id, Vec3(x0, y - 0.6, Hull.shoulder), Vec3(x1, y + 0.6, Hull.shoulder + 0.14),
                                        "cladding"))
            }
        }

        // Roof rails, and the basket on them when asked.
        for x in [-0.62, 0.62] {
            parts.append(Mesh3D.box("rail-\(x < 0 ? "l" : "r")", Vec3(x - 0.04, -1.85, 1.95), Vec3(x + 0.04, 0.2, 2.06),
                                    "rail"))
        }
        if g.rack { parts.append(contentsOf: basket(g)) }

        // Door mirrors, on stalks the outline draws for us.
        if g.mirrors {
            for sign in [-1.0, 1.0] {
                parts.append(Mesh3D.box("mirror-\(sign < 0 ? "l" : "r")", Vec3(sign * 0.88, 0.62, 1.26),
                                        Vec3(sign * 1.06, 0.74, 1.4), "body"))
            }
        }

        // The spare on the tailgate, a little right of centre as on the real
        // car — which is the left when seen from behind.
        if g.spare {
            parts.append(Mesh3D.cylinder("spare", Vec3(0.28, -2.44, 1.02), .y, 0.36, 0.12, 12,
                                         Mesh3D.CylinderRoles(side: "tyre", sideAlt: "tread", cap: "tyre"),
                                         outline: false, spin: false))
            let rim: [Vec3] = (0..<12).map { i in
                let a = Double(i) / 12 * Double.pi * 2
                return Vec3(0.28 + 0.22 * cos(a), -2.565, 1.02 + 0.22 * sin(a))
            }
            parts.append(Mesh3D.decal("spare-rim", rim, "rim", Vec3(0, -1, 0)))
        }

        // The nose: wraparound headlights, a barred grille with its badge; the
        // tail: tall clusters wrapping the rear corners into the pillars —
        // decals a hair off the body's faces.
        let nose = Hull.halfLength + 0.004
        let tail = -nose
        // The nose face is only 1.5 wide where the chamfer starts, so a lamp is
        // kept inside it — a decal that overhangs its host is exactly what the
        // paint order cannot resolve.
        let noseHalf = Hull.halfWidth - Hull.chamfer
        for z in [0.78, 0.86, 0.94] {
            // `${z}` in the web: the shortest round-trip text, as Swift's `\(z)` writes it.
            parts.append(contentsOf: faceDecal("grille-\(z)", "trim", -0.36, 0.36, nose, z, z + 0.06))
        }
        let badge: [Vec3] = (0..<10).map { i in
            let a = Double(i) / 10 * Double.pi * 2
            // Above the shoulder, so the one round decal never needs cutting.
            return Vec3(0.07 * cos(a), nose + 0.003, 1.0 + 0.07 * sin(a))
        }
        parts.append(Mesh3D.decal("badge", badge, "badge", Vec3(0, 1, 0)))
        for sign in [-1.0, 1.0] {
            let side = sign < 0 ? "l" : "r"
            parts.append(contentsOf: faceDecal("headlight-\(side)", "light", sign * 0.4, sign * noseHalf, nose, 0.76, 1.08))
            parts.append(contentsOf: cornerDecal("headlight-\(side)-wrap", "light", sign, 1, 0.78, 1.06))
            parts.append(contentsOf: faceDecal("taillight-\(side)", "tail", sign * 0.5, sign * noseHalf, tail, 0.56, 1.12))
            parts.append(contentsOf: cornerDecal("taillight-\(side)-wrap", "tail", sign, -1, 0.56, 1.12))
        }

        if g.bullBar { parts.append(contentsOf: bullBar(g.spotLights)) }

        return parts
    }
}
