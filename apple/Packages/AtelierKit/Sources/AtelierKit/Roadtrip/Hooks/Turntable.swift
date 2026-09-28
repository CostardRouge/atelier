// The garage's turntable, as numbers — the layout arithmetic of the web's
// `src/tools/roadtrip/CarTurntable.tsx` (its `paint`, `turn`, the pointer and
// key handlers), lifted out of the component so the app's view is only a
// canvas and a gesture. The app paints the disc and hands `car` to the
// drive's own painter (`DrivePainter.paintCar`).
//
// The rules it keeps (`roadtrip.md`, «The car is the TRIP's»):
// - The turntable is the DRIVE's renderer, never a second drawing of the car:
//   the same `renderOrder` + `paintSteps`, the same `carLight(finish)`, the
//   same `carPalette(color)`, the same `groundShadow` — so what the garage
//   shows is what the map gets.
// - The angle is a LOOK: never stored on the trip, never a piece's camera.
// - It turns by itself at ~25 s a lap; a gesture pauses it and it resumes
//   1.5 s after the last one (the app's timer); a full width dragged is one
//   lap; only a mouse or a pen tilts (a finger turns), between 35° and 90°;
//   the arrows turn by 15° and tilt by 5°.

import Foundation

/// The namespace of the garage's turntable — the web component's constants
/// and its geometry.
public enum Turntable {
    /// Radians per second it turns on its own: a lap in ~25 s.
    public static let turnRate = 0.25
    /// Seconds after a gesture before it turns again.
    public static let resumeAfter = 1.5
    public static let minTilt = 35 * Double.pi / 180
    public static let maxTilt = Double.pi / 2
    /// One press of ← or →.
    public static let keyTurn = 15 * Double.pi / 180
    /// One press of ↑ or ↓.
    public static let keyTilt = 5 * Double.pi / 180

    /// Where the camera looks from: the platter's turn and the camera's tilt
    /// above the ground (π/2 is straight down), radians.
    public struct Angles: Equatable, Sendable {
        public var heading: Double
        public var tilt: Double

        public init(heading: Double, tilt: Double) {
            self.heading = heading
            self.tilt = tilt
        }

        /// The web's opening view: three-quarters from the front, 52° up.
        public static let initial = Angles(heading: Double.pi * 0.82, tilt: 52 * Double.pi / 180)
    }

    /// An arrow key, as the turntable reads it.
    public enum Arrow: String, CaseIterable, Sendable {
        case left, right, up, down
    }

    /// `angles` after `seconds` of turning on its own — the web's per-frame
    /// `(heading + dt × TURN_RATE) % 2π`, summed.
    public static func spun(_ angles: Angles, seconds: Double) -> Angles {
        guard seconds > 0, seconds.isFinite else { return angles }
        var out = angles
        out.heading = fmod(angles.heading + seconds * turnRate, Double.pi * 2)
        return out
    }

    /// The web's `turn`: the heading wrapped into one lap, the tilt held
    /// between 35° and 90°.
    public static func turned(_ angles: Angles, dHeading: Double, dTilt: Double) -> Angles {
        let lap = Double.pi * 2
        let heading = fmod(angles.heading + dHeading + lap, lap)
        let tilt = Swift.min(maxTilt, Swift.max(minTilt, angles.tilt + dTilt))
        return Angles(heading: heading, tilt: tilt)
    }

    /// A drag of `dx`, `dy` points over a `width` × `height` box. Dragging the
    /// near side of the car to the right turns the platter that way — a full
    /// width is one lap; pulling down raises the camera, for a pointer that
    /// `tilts` (a mouse, a pen) and never for a finger. A box with no size
    /// moves nothing.
    public static func dragged(_ angles: Angles, dx: Double, dy: Double, width: Double, height: Double,
                               tilts: Bool) -> Angles {
        guard width > 0, height > 0 else { return angles }
        let dHeading = -(dx / width) * Double.pi * 2
        let dTilt = tilts ? (dy / height) * (maxTilt - minTilt) : 0
        return turned(angles, dHeading: dHeading, dTilt: dTilt)
    }

    /// One arrow key: ← → turn by 15°, ↑ ↓ tilt by 5°.
    public static func keyed(_ angles: Angles, _ arrow: Arrow) -> Angles {
        switch arrow {
        case .left: return turned(angles, dHeading: -keyTurn, dTilt: 0)
        case .right: return turned(angles, dHeading: keyTurn, dTilt: 0)
        case .up: return turned(angles, dHeading: 0, dTilt: keyTilt)
        case .down: return turned(angles, dHeading: 0, dTilt: -keyTilt)
        }
    }

    /// The platter under the car: an ellipse of `radius` × `radius · squash`
    /// about `center` — the tilt foreshortening a disc on the ground — filled
    /// in `fill` and ringed at `ringWidth` in the app's strong line token.
    public struct Disc: Equatable, Sendable {
        public var center: Point
        public var radius: Double
        /// `sin(tilt)`: the vertical squash, the ring's width squashed with it.
        public var squash: Double
        public var fill: String
        public var ringWidth: Double
    }

    /// One frame of the turntable: the platter, then the car over its shadow.
    public struct Frame: Equatable, Sendable {
        public var disc: Disc
        public var car: DriveFrame.Car
    }

    /// The disc's own tint: a breath of the car's ink on the paper.
    public static let discFill = "rgba(20,16,12,0.045)"
    /// The car's outline on paper.
    public static let carInk = "rgba(20,16,12,0.85)"
    /// The ground shadow's strength on the platter.
    public static let shadowAlpha = 0.3

    /// The turntable in a `width` × `height` box: the car of `spec`, built as
    /// `parts` (the caller keeps them per gear — `carModel(spec.model).build`),
    /// seen from `angles`. Nil for a box with no size: a pane hidden behind
    /// its rail paints nothing.
    public static func frame(_ spec: CarSpec, parts: [Mesh3D.Part], angles: Angles,
                             width: Double, height: Double) -> Frame? {
        guard width > 0, height > 0 else { return nil }
        let model = carModel(spec.model)
        let scale = Swift.min(width, height) / (model.length * 1.35)
        let pose = Mesh3D.Pose(fx: sin(angles.heading), fy: cos(angles.heading), tilt: angles.tilt, scale: scale,
                               x: width / 2, y: height * 0.56, spins: [:])
        let disc = Disc(center: Point(pose.x, pose.y), radius: model.length * 0.64 * scale,
                        squash: sin(angles.tilt), fill: discFill, ringWidth: Swift.max(1, scale / 60))
        let shadow = Mesh3D.groundShadow(pose, halfLength: model.length / 2, halfWidth: model.width / 2,
                                         alpha: shadowAlpha)
        let faces = Mesh3D.paintSteps(Mesh3D.renderOrder(parts, pose, carLight(spec.finish)),
                                      palette: carPalette(spec.color), ink: carInk,
                                      outlineWidth: Swift.max(0.9, (scale * model.length) / 78))
        return Frame(disc: disc, car: DriveFrame.Car(pose: pose, shadow: shadow, faces: faces))
    }
}
